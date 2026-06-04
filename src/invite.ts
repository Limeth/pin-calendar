import * as uuid from 'uuid';
import Peer, { DataConnection } from 'peerjs';
import type { HashArgsAddPeer } from './hash';
import type { InviteSecret } from './documents/ephemeral';
import type { CalendarId, PeerJsPeerId } from './documents/local';
import * as auth from './auth';
import type { Challenge, Signature } from './auth';
import { asyncOnceClose, asyncOnceData, asyncOnceOpen } from './util/peerjs';
import type { WebRtcNetworkAdapterOptions } from './webrtc';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import * as jose from 'jose';

export type ErrorPacket = {
  kind: 'error';
  message: string;
};

// 1. Sent from invitee to inviter.
export type HandshakeRequest = {
  kind: 'handshake-request';
  challenge: Challenge;
  secretThumbprint: string;
};

// 2. Sent from inviter to invitee.
export type HandshakeResponseSuccess = {
  kind: 'handshake-response';
  challenge: Challenge;
  // The signature for `HandshakeRequest::challenge`.
  signature: Signature;
};

export type HandshakeResponse = HandshakeResponseSuccess | ErrorPacket;

// 3. Sent from invitee to inviter, if the `HandshakeResponse::signature` was correct.
export type AccessRequestSuccess = {
  kind: 'access-request';
  // The signature for `HandshakeResponse::challenge`.
  signature: Signature;
  ecdhKeyPubRaw: Uint8Array<ArrayBuffer>;
};

export type AccessRequest = AccessRequestSuccess | ErrorPacket;

// 4. Sent from inviter to invitee, if the `AccessRequest::signature` was correct.
export type AccessResponseSuccess = {
  kind: 'access-response';
  calendarId: CalendarId;
  sharedDocumentId: string;
  ecdhKeyPubRaw: Uint8Array<ArrayBuffer>;
};

export type AccessResponse = AccessResponseSuccess | ErrorPacket;

export type AccessRequestResultError = {
  kind: 'error';
  message: string;
};

export type AccessRequestResultSuccess = {
  kind: 'success';
  peerJsPeerId: PeerJsPeerId;
  calendarId: CalendarId;
  sharedDocumentId: string;
  authKeyId: string;
};

export type AccessRequestResult = AccessRequestResultError | AccessRequestResultSuccess;

export class AccessRequester {
  hashArgs: HashArgsAddPeer;
  peer: undefined | Peer;

  constructor(hashArgs: HashArgsAddPeer) {
    this.hashArgs = hashArgs;
  }

  async requestAccess(timeoutMs: number): Promise<AccessRequestResult> {
    return new Promise((resolve) => {
      this.peer = new Peer(uuid.v7(), {
        debug: 3,
        secure: true,
      });

      setTimeout(() => {
        this.peer!.destroy();
        resolve({
          kind: 'error',
          message: 'Access request timed out.',
        });
      }, timeoutMs);

      this.peer.on('error', (error) => {
        console.error('Peer error: ', error);
        this.peer!.destroy();
        resolve({
          kind: 'error',
          message: error.message,
        });
      });

      this.peer.on('open', async (id) => {
        console.log(`Peer is now accessible with Peer ID: ${id}`);

        const dataConnection = this.peer!.connect(this.hashArgs.peerJsPeerId);
        const challengeSent = auth.generateChallenge();

        dataConnection.on('error', (error) => {
          this.peer!.destroy();
          resolve({
            kind: 'error',
            message: error.message,
          });
        });

        await asyncOnceOpen(dataConnection);

        // Perform a handshake to check the equivalence of the shared secret.
        const secret = await auth.parseTemporarySecret(this.hashArgs.secret);
        const handshakeRequest: HandshakeRequest = {
          kind: 'handshake-request',
          challenge: challengeSent,
          secretThumbprint: secret.thumbprint,
        };

        const handshakeResponsePromise = asyncOnceData(dataConnection);
        await dataConnection.send(handshakeRequest);
        const handshakeResponse = (await handshakeResponsePromise) as HandshakeResponse; // TODO: Validation?

        if (handshakeResponse.kind === 'error') {
          this.peer!.destroy();
          resolve(handshakeResponse);
          return;
        }

        if (
          !(await auth.verifySignature(secret.hmacKey, handshakeResponse.signature, challengeSent))
        ) {
          this.peer!.destroy();
          resolve({
            kind: 'error',
            message: 'Invalid signature in handshake response.',
          });
          return;
        }

        // Create a permanent shared authentication key via Diffie-Hellman.
        const ecdhKeyPairTemporary = await window.crypto.subtle.generateKey(
          { name: 'ECDH', namedCurve: 'P-256' },
          true, // Must be true so we can export the public side to send it
          ['deriveKey'],
        );
        const accessRequest: AccessRequestSuccess = {
          kind: 'access-request',
          signature: await auth.signChallenge(secret.hmacKey, handshakeResponse.challenge),
          ecdhKeyPubRaw: new Uint8Array(
            await window.crypto.subtle.exportKey('raw', ecdhKeyPairTemporary.publicKey),
          ),
        };

        const accessResponsePromise = asyncOnceData(dataConnection);
        await dataConnection.send(accessRequest);
        const accessResponse = (await accessResponsePromise) as AccessResponse; // TODO: Validation?

        if (accessResponse.kind === 'error') {
          this.peer!.destroy();
          resolve(accessResponse);
          return;
        }

        const ecdhKeyPubRemote = await window.crypto.subtle.importKey(
          'raw',
          accessResponse.ecdhKeyPubRaw,
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          ['deriveKey'],
        );

        // A shared authentication key.
        const authKey = await auth.deriveAuthenticationKey(
          ecdhKeyPubRemote,
          ecdhKeyPairTemporary.privateKey,
        );
        const authKeyId = await jose.calculateJwkThumbprint(authKey, 'sha256');

        await auth.saveKeyToIDB(authKey, authKeyId);

        // Remote peer's authKeyId is updated during the initialization of the local document.
        // TODO:
        options.docLocal.value.remotePeers[changeSubtree]((remotePeers) => {
          remotePeers[dataConnection.peer] = {
            deviceName: '', // TODO
            authKeyId,
          };
        });

        this.peer!.destroy();
        resolve({
          kind: 'success',
          peerJsPeerId: id,
          calendarId: accessResponse.calendarId,
          sharedDocumentId: accessResponse.sharedDocumentId,
          authKeyId,
        });
      });
    });
  }
}

export async function processAccessRequest(
  dataConnection: DataConnection,
  handshakeRequest: HandshakeRequest,
  options: WebRtcNetworkAdapterOptions,
): Promise<ErrorPacket | undefined> {
  if (!dataConnection.open) await asyncOnceOpen(dataConnection);

  if (
    // Invite exists
    !(handshakeRequest.secretThumbprint in options.docEphemeral.value.invites) ||
    // And hasn't already been used
    options.docEphemeral.value.invites[handshakeRequest.secretThumbprint].usedBy !== undefined
  ) {
    const message: ErrorPacket = {
      kind: 'error',
      message:
        "This invite link cannot be used more than once. You might want to request a new invite link from the calendar's owner.",
    };
    await dataConnection.send(message);
    dataConnection.close();
    return {
      kind: 'error',
      message: 'Access request denied due to an invalid secret string',
    };
  }

  const invite = options.docEphemeral.value.invites[handshakeRequest.secretThumbprint];
  const secret = await auth.parseTemporarySecret(invite.secretString);

  // Mark invite as used immediately after checking whether it is usable, so that it cannot be
  // used multiple times. There shall be no yield points between this and the check above.
  invite[changeSubtree]((invite) => {
    invite.usedBy = dataConnection.peer;
  });

  const challenge = auth.generateChallenge();
  const handshakeResponse: HandshakeResponseSuccess = {
    kind: 'handshake-response',
    challenge,
    signature: await auth.signChallenge(secret.hmacKey, handshakeRequest.challenge),
  };

  const accessRequestPromise = asyncOnceData(dataConnection);
  await dataConnection.send(handshakeResponse);
  const accessRequest = (await accessRequestPromise) as AccessRequest;

  if (accessRequest.kind === 'error') return accessRequest;

  if (!(await auth.verifySignature(secret.hmacKey, accessRequest.signature, challenge)))
    return {
      kind: 'error',
      message: 'Invalid signature in access request.',
    };

  console.info(
    `Adding peer ${dataConnection.peer} to remote peers of document ${options.calendarId}.`,
  );

  const ecdhKeyPubRemote = await window.crypto.subtle.importKey(
    'raw',
    accessRequest.ecdhKeyPubRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey'],
  );
  const ecdhKeyPairTemporary = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // Must be true so we can export the public side to send it
    ['deriveKey'],
  );
  const authKey = await auth.deriveAuthenticationKey(
    ecdhKeyPubRemote,
    ecdhKeyPairTemporary.privateKey,
  );
  const authKeyId = await jose.calculateJwkThumbprint(authKey, 'sha256');

  await auth.saveKeyToIDB(authKey, authKeyId);

  options.docLocal.value.remotePeers[changeSubtree]((remotePeers) => {
    remotePeers[dataConnection.peer] = {
      deviceName: '', // TODO
      authKeyId,
    };
  });
  const message: AccessResponseSuccess = {
    kind: 'access-response',
    ecdhKeyPubRaw: new Uint8Array(
      await window.crypto.subtle.exportKey('raw', ecdhKeyPairTemporary.publicKey),
    ),
    calendarId: options.calendarId,
    sharedDocumentId: options.docLocal.value.documentIdShared!,
  };

  await dataConnection.send(message);
  await asyncOnceClose(dataConnection);
}

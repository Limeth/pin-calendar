import * as uuid from 'uuid';
import Peer, { type DataConnection } from 'peerjs';
import type { HashArgsAddPeer } from './hash';
import type { CalendarId, PeerJsPeerId } from './documents/local';
import * as auth from './auth';
import { asyncOnceClose, asyncOnceOpen } from './util/peerjs';
import type { WebRtcNetworkAdapterOptions } from './webrtc';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import {
  exchange,
  initiateHandshake,
  respondToHandshake,
  sendError,
  toErrorPacket,
  type ErrorPacket,
  type HandshakeAuthBase,
  type HandshakeRequestBase,
} from './handshake';

// Joining a calendar via an invite uses the handshake from `handshake.ts`, with the invite secret
// as the key.

// 1. Sent from invitee to inviter.
export type JoinRequestPacket = HandshakeRequestBase & {
  kind: 'join-request';
  secretThumbprint: string;
};

// 2. Sent from inviter to invitee: `HandshakeResponsePacket`.

// 3. Sent from invitee to inviter, if the `HandshakeResponsePacket::signature` was correct.
export type JoinAuthPacket = HandshakeAuthBase & {
  kind: 'join-auth';
  ecdhPublicKey: Uint8Array<ArrayBuffer>;
};

// 4. Sent from inviter to invitee, if the `JoinAuthPacket::signature` was correct.
export type JoinAcceptPacket = {
  kind: 'join-accept';
  calendarId: CalendarId;
  sharedDocumentId: string;
  ecdhPublicKey: Uint8Array<ArrayBuffer>;
};

export type JoinSuccess = {
  kind: 'success';
  peerJsPeerId: PeerJsPeerId;
  calendarId: CalendarId;
  sharedDocumentId: string;
  authKeyId: string;
};

export type JoinResult = JoinSuccess | ErrorPacket;

// Join a calendar using an invite, as the invitee.
export async function joinCalendar(
  invite: HashArgsAddPeer,
  timeoutMs: number,
): Promise<JoinResult> {
  const peer = new Peer(uuid.v7(), {
    debug: 3,
    secure: true,
  });

  // Resolved when joining times out, or when the peer fails. Errors of the data connection are
  // reported by `runJoinHandshake` itself.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const failure = new Promise<ErrorPacket>((resolve) => {
    timeout = setTimeout(
      () => resolve({ kind: 'error', message: 'Joining the calendar timed out.' }),
      timeoutMs,
    );
    peer.on('error', (error) => {
      console.error('Peer error: ', error);
      resolve(toErrorPacket(error));
    });
  });

  try {
    return await Promise.race([runJoinHandshake(peer, invite).catch(toErrorPacket), failure]);
  } finally {
    clearTimeout(timeout);
    peer.destroy();
  }
}

async function runJoinHandshake(peer: Peer, invite: HashArgsAddPeer): Promise<JoinResult> {
  const id = await new Promise<string>((resolve) => peer.once('open', resolve));
  console.log(`Peer is now accessible with Peer ID: ${id}`);

  const dataConnection = peer.connect(invite.peerJsPeerId);

  await asyncOnceOpen(dataConnection);

  // Perform a handshake to check the equivalence of the shared secret.
  const secret = await auth.parseInviteSecret(invite.secret);
  const joinRequest: JoinRequestPacket = {
    kind: 'join-request',
    challenge: auth.generateChallenge(),
    secretThumbprint: secret.thumbprint,
  };
  const handshake = await initiateHandshake(dataConnection, secret.hmacKey, joinRequest);

  if (handshake.kind === 'error') return handshake;

  // Create a permanent shared authentication key via Diffie-Hellman.
  const ecdhKeyPair = await auth.generateEcdhKeyPair();
  const joinAuth: JoinAuthPacket = {
    kind: 'join-auth',
    signature: handshake.signature,
    ecdhPublicKey: ecdhKeyPair.publicKeyRaw,
  };
  const joinAccept = await exchange<JoinAcceptPacket>(dataConnection, joinAuth);

  if (joinAccept.kind === 'error') return joinAccept;

  const authKeyId = await auth.establishAuthenticationKey(
    ecdhKeyPair.privateKey,
    joinAccept.ecdhPublicKey,
  );

  // Remote peer's authKeyId is updated during the initialization of the local document.

  return {
    kind: 'success',
    peerJsPeerId: id,
    calendarId: joinAccept.calendarId,
    sharedDocumentId: joinAccept.sharedDocumentId,
    authKeyId,
  };
}

// Let a peer join the calendar using an invite, as the inviter.
export async function handleJoinRequest(
  dataConnection: DataConnection,
  joinRequest: JoinRequestPacket,
  options: WebRtcNetworkAdapterOptions,
): Promise<ErrorPacket | undefined> {
  if (!dataConnection.open) await asyncOnceOpen(dataConnection);

  if (
    // Invite exists
    !(joinRequest.secretThumbprint in options.docEphemeral.value.invites) ||
    // And hasn't already been used
    options.docEphemeral.value.invites[joinRequest.secretThumbprint].usedBy !== undefined
  ) {
    await sendError(
      dataConnection,
      "This invite link cannot be used more than once. You might want to request a new invite link from the calendar's owner.",
    );
    return {
      kind: 'error',
      message: 'Join request denied due to an invalid invite secret.',
    };
  }

  const invite = options.docEphemeral.value.invites[joinRequest.secretThumbprint];

  // Mark invite as used immediately after checking whether it is usable, so that it cannot be
  // used multiple times. There shall be no yield points between this and the check above.
  invite[changeSubtree]((invite) => {
    invite.usedBy = dataConnection.peer;
  });

  const secret = await auth.parseInviteSecret(invite.secretString);
  const joinAuth = await respondToHandshake<JoinAuthPacket>(
    dataConnection,
    secret.hmacKey,
    joinRequest,
  );

  if (joinAuth.kind === 'error') return joinAuth;

  console.info(
    `Adding peer ${dataConnection.peer} to remote peers of document ${options.calendarId}.`,
  );

  const ecdhKeyPair = await auth.generateEcdhKeyPair();
  const authKeyId = await auth.establishAuthenticationKey(
    ecdhKeyPair.privateKey,
    joinAuth.ecdhPublicKey,
  );

  options.docLocal.value.remotePeers[changeSubtree]((remotePeers) => {
    remotePeers[dataConnection.peer] = {
      deviceName: '', // TODO
      authKeyId,
    };
  });
  const joinAccept: JoinAcceptPacket = {
    kind: 'join-accept',
    ecdhPublicKey: ecdhKeyPair.publicKeyRaw,
    calendarId: options.calendarId,
    sharedDocumentId: options.docLocal.value.documentIdShared!,
  };

  await dataConnection.send(joinAccept);
  await asyncOnceClose(dataConnection);
}

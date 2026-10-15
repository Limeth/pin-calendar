import * as uuid from 'uuid';
import Peer, { type DataConnection } from 'peerjs';
import type { HashArgsAddPeer } from './hash';
import type { CalendarId, PeerJsPeerId } from './documents/local';
import * as auth from './auth';
import { asyncOnceOpen, closeConnection } from './util/peerjs';
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

// 5. Sent from invitee to inviter, once the invitee has saved the shared authentication key.
// Only then does the inviter add the invitee as a peer, so that a failure on the invitee's side
// cannot leave the inviter with a peer that does not know about it.
export type JoinConfirmPacket = {
  kind: 'join-confirm';
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

  // Resolved when the inviter does not accept in time, or when the peer fails. Errors of the data
  // connection are reported by `runJoinHandshake` itself.
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

  let dataConnection: DataConnection | undefined;

  try {
    const peerJsPeerId = await Promise.race([
      new Promise<string>((resolve) => peer.once('open', resolve)),
      failure,
    ]);

    if (typeof peerJsPeerId !== 'string') return peerJsPeerId;

    console.log(`Peer is now accessible with Peer ID: ${peerJsPeerId}`);

    dataConnection = peer.connect(invite.peerJsPeerId);

    const accepted = await Promise.race([
      runJoinHandshake(dataConnection, invite).catch(toErrorPacket),
      failure,
    ]);

    if (accepted.kind === 'error') return accepted;

    // The remaining steps are not subject to the timeout: they do not wait for the inviter, and
    // once `join-confirm` is sent, the inviter adds this device as a peer, so joining must not be
    // reported as failed afterwards.
    clearTimeout(timeout);

    const authKeyId = await auth.establishAuthenticationKey(
      accepted.ecdhKeyPair.privateKey,
      accepted.joinAccept.ecdhPublicKey,
    );
    const joinConfirm: JoinConfirmPacket = { kind: 'join-confirm' };

    // Delivered by closing the connection below.
    await dataConnection.send(joinConfirm);

    // Remote peer's authKeyId is updated during the initialization of the local document.

    return {
      kind: 'success',
      peerJsPeerId,
      calendarId: accepted.joinAccept.calendarId,
      sharedDocumentId: accepted.joinAccept.sharedDocumentId,
      authKeyId,
    };
  } catch (error) {
    return toErrorPacket(error);
  } finally {
    clearTimeout(timeout);

    // Destroying the peer discards packets that are still in flight, such as `join-confirm` or an
    // error packet, so close the connection first, which delivers them.
    if (dataConnection !== undefined) await closeConnection(dataConnection);

    peer.destroy();
  }
}

// The invitee's state once the inviter has accepted the join request.
type JoinAccepted = {
  kind: 'accepted';
  ecdhKeyPair: auth.EcdhKeyPair;
  joinAccept: JoinAcceptPacket;
};

// Steps 1 to 4, as the invitee.
async function runJoinHandshake(
  dataConnection: DataConnection,
  invite: HashArgsAddPeer,
): Promise<JoinAccepted | ErrorPacket> {
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

  // Not confirming makes the inviter release the invite, see `JoinConfirmPacket`.
  if ((await auth.calendarIdTag(secret, joinAccept.calendarId)) !== invite.calendarIdTag)
    return await sendError(
      dataConnection,
      'The shared calendar does not match the calendar of the invite link.',
    );

  return {
    kind: 'accepted',
    ecdhKeyPair,
    joinAccept,
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

  // Reserve the invite immediately after checking whether it is usable, so that it cannot be used
  // by multiple join requests at once. There shall be no yield points between this and the check
  // above. The reservation is released if joining fails, so that the invite can be used again.
  invite[changeSubtree]((invite) => {
    invite.usedBy = dataConnection.peer;
  });

  let joined = false;

  try {
    const secret = await auth.parseInviteSecret(invite.secretString);
    const joinAuth = await respondToHandshake<JoinAuthPacket>(
      dataConnection,
      secret.hmacKey,
      joinRequest,
    );

    if (joinAuth.kind === 'error') return joinAuth;

    const ecdhKeyPair = await auth.generateEcdhKeyPair();
    const joinAccept: JoinAcceptPacket = {
      kind: 'join-accept',
      ecdhPublicKey: ecdhKeyPair.publicKeyRaw,
      calendarId: options.calendarId,
      sharedDocumentId: options.docLocal.value.documentIdShared!,
    };
    const joinConfirm = await exchange<JoinConfirmPacket>(dataConnection, joinAccept);

    if (joinConfirm.kind === 'error') return joinConfirm;

    console.info(
      `Adding peer ${dataConnection.peer} to remote peers of document ${options.calendarId}.`,
    );

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
    joined = true;

    await closeConnection(dataConnection);
  } finally {
    if (!joined) releaseInvite(options, joinRequest.secretThumbprint, dataConnection.peer);
  }
}

// Release the reservation of an invite made by `handleJoinRequest`, so that it can be used again.
function releaseInvite(
  options: WebRtcNetworkAdapterOptions,
  secretThumbprint: string,
  peerJsPeerId: PeerJsPeerId,
) {
  const invite = options.docEphemeral.value.invites[secretThumbprint];

  // The invite may have been deleted in the meantime, e.g. by closing the invite dialog.
  if (invite?.usedBy !== peerJsPeerId) return;

  invite[changeSubtree]((invite) => {
    delete invite.usedBy;
  });
}

import type { DataConnection } from 'peerjs';
import * as auth from './auth';
import type { Challenge, Signature } from './auth';
import { asyncOnceData } from './util/peerjs';

// The handshake shared by invitations and connections between paired peers, see
// `auth.signHandshake`. Each kind of handshake adds its own fields to the packets of steps 1, 3
// and 4.

export type ErrorPacket = {
  kind: 'error';
  message: string;
};

export function toErrorPacket(error: unknown): ErrorPacket {
  return {
    kind: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function isErrorPacket(packet: { kind: string }): packet is ErrorPacket {
  return packet.kind === 'error';
}

export async function sendError(
  dataConnection: DataConnection,
  message: string,
): Promise<ErrorPacket> {
  const packet: ErrorPacket = { kind: 'error', message };
  await dataConnection.send(packet);
  return packet;
}

// Send a packet and wait for the reply, or for the connection to be closed.
export async function exchange<T>(
  dataConnection: DataConnection,
  packet: unknown,
): Promise<T | ErrorPacket> {
  const replyPromise = asyncOnceData(dataConnection).catch(toErrorPacket);
  await dataConnection.send(packet);
  return (await replyPromise) as T | ErrorPacket; // TODO: Validation?
}

// 1. Sent from initiator to responder.
export type HandshakeRequestBase = {
  challenge: Challenge;
};

// 2. Sent from responder to initiator.
export type HandshakeResponsePacket = {
  kind: 'handshake-response';
  challenge: Challenge;
  // The responder's signature of both challenges, see `auth.signHandshake`.
  signature: Signature;
};

// 3. Sent from initiator to responder, if the `HandshakeResponsePacket::signature` was correct.
export type HandshakeAuthBase = {
  kind: string;
  // The initiator's signature of both challenges, see `auth.signHandshake`.
  signature: Signature;
};

// Steps 1 and 2, as the initiator: send the request and verify the responder's signature.
// Returns the initiator's signature, to be sent in step 3.
export async function initiateHandshake(
  dataConnection: DataConnection,
  hmacKey: CryptoKey,
  request: HandshakeRequestBase,
): Promise<{ kind: 'success'; signature: Signature } | ErrorPacket> {
  const response = await exchange<HandshakeResponsePacket>(dataConnection, request);

  if (isErrorPacket(response)) return response;

  if (
    !(await auth.verifyHandshake(
      hmacKey,
      'responder',
      request.challenge,
      response.challenge,
      response.signature,
    ))
  )
    return await sendError(dataConnection, 'Invalid signature in handshake response.');

  return {
    kind: 'success',
    signature: await auth.signHandshake(
      hmacKey,
      'initiator',
      request.challenge,
      response.challenge,
    ),
  };
}

// Steps 2 and 3, as the responder: send the response and verify the initiator's signature.
// Returns the packet of step 3.
export async function respondToHandshake<T extends HandshakeAuthBase>(
  dataConnection: DataConnection,
  hmacKey: CryptoKey,
  request: HandshakeRequestBase,
): Promise<T | ErrorPacket> {
  const challenge = auth.generateChallenge();
  const response: HandshakeResponsePacket = {
    kind: 'handshake-response',
    challenge,
    signature: await auth.signHandshake(hmacKey, 'responder', request.challenge, challenge),
  };
  const reply = await exchange<T>(dataConnection, response);

  if (isErrorPacket(reply)) return reply;

  if (
    !(await auth.verifyHandshake(
      hmacKey,
      'initiator',
      request.challenge,
      challenge,
      reply.signature,
    ))
  )
    return await sendError(dataConnection, 'Invalid signature in handshake request.');

  return reply;
}

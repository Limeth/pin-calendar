import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { DataConnection } from 'peerjs';
import * as auth from './auth';
import { asyncOnceData, decodePacket, getDtlsFingerprints } from './util/peerjs';
import { readValue } from './validation';

// The handshake shared by invitations and connections between paired peers, see
// `auth.signHandshake`. Each kind of handshake adds its own fields to the packets of steps 1, 3
// and 4.
// Packets are sent by the remote peer, so received ones are checked against their schemas, after
// `decodePacket`.

// Binary data, such as a challenge or a signature.
export const BytesSchema = Type.Unsafe<Uint8Array<ArrayBuffer>>(Type.Uint8Array());

const ErrorPacketSchema = Type.Object({
  kind: Type.Literal('error'),
  message: Type.String(),
});

export type ErrorPacket = Static<typeof ErrorPacketSchema>;

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

// Check a received packet against the schema of the packet expected, or of an error. An invalid
// packet is answered with an error.
async function readPacket<S extends TSchema>(
  dataConnection: DataConnection,
  schema: S,
  packet: unknown,
): Promise<Static<S> | ErrorPacket> {
  const decoded = decodePacket(packet);

  if (Value.Check(ErrorPacketSchema, decoded)) return decoded;
  if (readValue(schema, decoded, 'packet') !== undefined) return decoded as Static<S>;

  return await sendError(dataConnection, 'Invalid packet.');
}

// Send a packet and wait for the reply of the given schema, or for the connection to be closed.
export async function exchange<S extends TSchema>(
  dataConnection: DataConnection,
  packet: unknown,
  replySchema: S,
): Promise<Static<S> | ErrorPacket> {
  const replyPromise = asyncOnceData(dataConnection).then(
    (reply) => readPacket(dataConnection, replySchema, reply),
    toErrorPacket,
  );
  await dataConnection.send(packet);
  return await replyPromise;
}

// 1. Sent from initiator to responder.
export const HandshakeRequestBaseSchema = Type.Object({
  challenge: BytesSchema,
});

export type HandshakeRequestBase = Static<typeof HandshakeRequestBaseSchema>;

// 2. Sent from responder to initiator.
const HandshakeResponsePacketSchema = Type.Object({
  kind: Type.Literal('handshake-response'),
  challenge: BytesSchema,
  // The responder's signature of the handshake, see `auth.signHandshake`.
  signature: BytesSchema,
});

export type HandshakeResponsePacket = Static<typeof HandshakeResponsePacketSchema>;

// 3. Sent from initiator to responder, if the `HandshakeResponsePacket::signature` was correct.
export const HandshakeAuthBaseSchema = Type.Object({
  kind: Type.String(),
  // The initiator's signature of the handshake, see `auth.signHandshake`.
  signature: BytesSchema,
});

export type HandshakeAuthBase = Static<typeof HandshakeAuthBaseSchema>;

// Steps 1 and 2, as the initiator: send the request and verify the responder's signature.
// Returns the initiator's signature, to be sent in step 3.
export async function initiateHandshake(
  dataConnection: DataConnection,
  hmacKey: CryptoKey,
  request: HandshakeRequestBase,
): Promise<{ kind: 'success'; signature: auth.Signature } | ErrorPacket> {
  // The initiator's end of the connection is the local one, see `HandshakeSignedData`.
  const fingerprints = getDtlsFingerprints(dataConnection);
  const response = await exchange(dataConnection, request, HandshakeResponsePacketSchema);

  if (isErrorPacket(response)) return response;

  const transcript: auth.HandshakeTranscript = {
    challengeInitiator: request.challenge,
    challengeResponder: response.challenge,
    fingerprintsInitiator: fingerprints.local,
    fingerprintsResponder: fingerprints.remote,
  };

  if (!(await auth.verifyHandshake(hmacKey, 'responder', transcript, response.signature)))
    return await sendError(dataConnection, 'Invalid signature in handshake response.');

  return {
    kind: 'success',
    signature: await auth.signHandshake(hmacKey, 'initiator', transcript),
  };
}

// Steps 2 and 3, as the responder: send the response and verify the initiator's signature.
// Returns the packet of step 3, of the given schema.
export async function respondToHandshake<S extends TSchema & { static: HandshakeAuthBase }>(
  dataConnection: DataConnection,
  hmacKey: CryptoKey,
  request: HandshakeRequestBase,
  authSchema: S,
): Promise<Static<S> | ErrorPacket> {
  // The responder's end of the connection is the local one, see `HandshakeSignedData`.
  const fingerprints = getDtlsFingerprints(dataConnection);
  const challenge = auth.generateChallenge();
  const transcript: auth.HandshakeTranscript = {
    challengeInitiator: request.challenge,
    challengeResponder: challenge,
    fingerprintsInitiator: fingerprints.remote,
    fingerprintsResponder: fingerprints.local,
  };
  const response: HandshakeResponsePacket = {
    kind: 'handshake-response',
    challenge,
    signature: await auth.signHandshake(hmacKey, 'responder', transcript),
  };
  const reply = await exchange(dataConnection, response, authSchema);

  if (isErrorPacket(reply)) return reply;

  if (!(await auth.verifyHandshake(hmacKey, 'initiator', transcript, reply.signature)))
    return await sendError(dataConnection, 'Invalid signature in handshake request.');

  return reply;
}

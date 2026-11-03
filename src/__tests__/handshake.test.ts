import { afterEach, describe, expect, it, vi } from 'vitest';
import { Type, type Static } from '@sinclair/typebox';
import type { DataConnection as PeerJsDataConnection } from 'peerjs';
import * as auth from '@/auth';
import {
  exchange,
  HandshakeAuthBaseSchema,
  initiateHandshake,
  respondToHandshake,
  type ErrorPacket,
  type HandshakeRequestBase,
} from '@/handshake';
import { decodePacket } from '@/util/peerjs';
import { connectionPair, network, type DataConnection } from './fakes/peerjs';

const asPeerJs = (connection: DataConnection) => connection as unknown as PeerJsDataConnection;

afterEach(() => {
  vi.restoreAllMocks();
});

function open(...connections: DataConnection[]) {
  for (const connection of connections) connection.emit('open');
}

function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const AuthSchema = Type.Object({
  ...HandshakeAuthBaseSchema.properties,
  kind: Type.Literal('test-auth'),
});
const AcceptSchema = Type.Object({ kind: Type.Literal('test-accept') });

// Run the handshake between the two ends, with the same key on both, and return what each end
// ended up with: the initiator the packet of step 4, the responder the packet of step 3.
async function handshake(
  initiator: DataConnection,
  responder: DataConnection,
): Promise<[Static<typeof AcceptSchema> | ErrorPacket, Static<typeof AuthSchema> | ErrorPacket]> {
  const key = await hmacKey();
  const responded = new Promise<Static<typeof AuthSchema> | ErrorPacket>((resolve) =>
    responder.once('data', (request) =>
      respondToHandshake(
        asPeerJs(responder),
        key,
        decodePacket(request) as HandshakeRequestBase,
        AuthSchema,
      ).then(async (reply) => {
        if (reply.kind !== 'error') await responder.send({ kind: 'test-accept' });
        resolve(reply);
      }),
    ),
  );
  const result = await initiateHandshake(asPeerJs(initiator), key, {
    challenge: auth.generateChallenge(),
  });
  const initiated =
    result.kind === 'error'
      ? result
      : await exchange(
          asPeerJs(initiator),
          { kind: 'test-auth', signature: result.signature },
          AcceptSchema,
        );
  return [initiated, await responded];
}

describe('handshake', () => {
  it('succeeds over a direct connection', async () => {
    const [a, b] = connectionPair('A', 'B');
    open(a, b);

    const [initiated, responded] = await handshake(a, b);

    expect(initiated.kind).toBe('test-accept');
    expect(responded.kind).toBe('test-auth');
  });

  // The signalling server establishes a connection with each peer, and relays every packet between
  // them unchanged, see `HandshakeSignedData`.
  it('fails when relayed by a server in the middle', async () => {
    const [a, serverToA] = connectionPair('A', 'B');
    const [serverToB, b] = connectionPair('A', 'B');
    open(a, serverToA, serverToB, b);
    serverToA.on('data', (packet) => serverToB.send(packet));
    serverToB.on('data', (packet) => serverToA.send(packet));

    const [initiated, responded] = await handshake(a, b);

    expect(initiated).toEqual({
      kind: 'error',
      message: 'Invalid signature in handshake response.',
    });
    expect(responded.kind).toBe('error');
  });

  it('fails on a malformed reply, which is answered with an error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [a, b] = connectionPair('A', 'B');
    open(a, b);
    network.tamper = (packet) =>
      (packet as { kind?: string }).kind === 'handshake-response'
        ? { ...(packet as object), signature: 'not binary' }
        : packet;

    const [initiated, responded] = await handshake(a, b);

    expect(initiated).toEqual({ kind: 'error', message: 'Invalid packet.' });
    expect(responded).toEqual({ kind: 'error', message: 'Invalid packet.' });
  });

  it('does not start without the session descriptions of the connection', async () => {
    const [a, b] = connectionPair('A', 'B');
    open(a, b);
    delete a.peerConnection;

    await expect(
      initiateHandshake(asPeerJs(a), await hmacKey(), { challenge: auth.generateChallenge() }),
    ).rejects.toThrow('The session descriptions of the connection are not available.');
  });
});

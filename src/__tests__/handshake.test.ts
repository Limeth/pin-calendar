import { describe, expect, it } from 'vitest';
import type { DataConnection as PeerJsDataConnection } from 'peerjs';
import * as auth from '@/auth';
import {
  exchange,
  initiateHandshake,
  respondToHandshake,
  type ErrorPacket,
  type HandshakeAuthBase,
} from '@/handshake';
import { connectionPair, type DataConnection } from './fakes/peerjs';

const asPeerJs = (connection: DataConnection) => connection as unknown as PeerJsDataConnection;

function open(...connections: DataConnection[]) {
  for (const connection of connections) connection.emit('open');
}

function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

type Accept = { kind: 'test-accept' };

// Run the handshake between the two ends, with the same key on both, and return what each end
// ended up with: the initiator the packet of step 4, the responder the packet of step 3.
async function handshake(
  initiator: DataConnection,
  responder: DataConnection,
): Promise<[Accept | ErrorPacket, HandshakeAuthBase | ErrorPacket]> {
  const key = await hmacKey();
  const responded = new Promise<HandshakeAuthBase | ErrorPacket>((resolve) =>
    responder.once('data', (request) =>
      respondToHandshake(asPeerJs(responder), key, request).then(async (reply) => {
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
      : await exchange<Accept>(asPeerJs(initiator), {
          kind: 'test-auth',
          signature: result.signature,
        });
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

  it('does not start without the session descriptions of the connection', async () => {
    const [a, b] = connectionPair('A', 'B');
    open(a, b);
    delete a.peerConnection;

    await expect(
      initiateHandshake(asPeerJs(a), await hmacKey(), { challenge: auth.generateChallenge() }),
    ).rejects.toThrow('The session descriptions of the connection are not available.');
  });
});

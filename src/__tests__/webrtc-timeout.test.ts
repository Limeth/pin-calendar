import { afterEach, describe, expect, it } from 'vitest';
import { network } from './fakes/peerjs';
import {
  isConnected,
  pairedKeys,
  remotePeer,
  sleep,
  started,
  stopStartedDevices,
  until,
} from './helpers';

// In a file of its own, as it waits for the connection attempt timeout. Test files run in
// parallel, while the tests of a file run one after another.

afterEach(stopStartedDevices);

describe('connection attempts', () => {
  it('ignores a handshake that completes after timing out', { timeout: 30_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    let delayed = false;
    // The first reply arrives just after the attempt times out, while the close marker that the
    // timed-out attempt sends is still on its way.
    network.latency = (packet) => {
      const { kind, __peerData } = packet as { kind?: string; __peerData?: unknown };

      if (kind === 'connect-accept' && !delayed) {
        delayed = true;
        return 15_200;
      }

      return __peerData !== undefined ? 1_000 : 0;
    };
    const a = started('a12', { b12: remotePeer(keyA) });
    const events: string[] = [];
    a.adapter.on('peer-candidate', () => events.push('candidate'));
    a.adapter.on('peer-disconnected', () => events.push('disconnected'));
    started('b12', { a12: remotePeer(keyB) }, { passive: true });

    expect(await until(() => isConnected(a, 'b12'), 25_000)).toBe(true);
    await sleep(1_000);

    // Connected once, by the retry.
    expect(events).toEqual(['candidate']);
  });
});

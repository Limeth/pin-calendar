import { afterEach, describe, expect, it } from 'vitest';
import { forgetRemotePeer } from '@/peers';
import { signalling } from './fakes/peerjs';
import {
  device,
  isConnected,
  pairedKeys,
  remotePeer,
  sleep,
  started,
  stopStartedDevices,
  until,
} from './helpers';

afterEach(stopStartedDevices);

describe('reconnecting', () => {
  it('reconnects immediately after a connection drops', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started('a1', { b1: remotePeer(keyA) });
    const b = started('b1', { a1: remotePeer(keyB) }, { passive: true });
    expect(await until(() => isConnected(a, 'b1') && isConnected(b, 'a1'))).toBe(true);

    // A network failure closes both ends, without either adapter deciding to.
    a.adapter.connections.b1![0]!.dataConnection.close();
    expect(await until(() => !isConnected(a, 'b1'))).toBe(true);

    expect(await until(() => isConnected(a, 'b1') && isConnected(b, 'a1'), 1_500)).toBe(true);
  });

  it('retries a failed attempt until the other device is online', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started('a2', { b2: remotePeer(keyA) });
    await sleep(300);
    expect(a.peer().connectCalls).toEqual(['b2']);

    const b = started('b2', { a2: remotePeer(keyB) }, { passive: true });

    expect(await until(() => isConnected(a, 'b2') && isConnected(b, 'a2'), 6_000)).toBe(true);
  });

  it('reconnects to the signalling server, then to the peers', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started('a3', { b3: remotePeer(keyA) });
    const b = started('b3', { a3: remotePeer(keyB) }, { passive: true });
    expect(await until(() => isConnected(a, 'b3'))).toBe(true);

    signalling.reachable = false;
    a.peer().loseSignalling();
    a.adapter.connections.b3![0]!.dataConnection.close();
    await sleep(500);
    expect(isConnected(a, 'b3') || a.peer().open).toBe(false);

    signalling.reachable = true;

    expect(await until(() => a.peer().open, 6_000)).toBe(true);
    expect(await until(() => isConnected(a, 'b3') && isConnected(b, 'a3'), 3_000)).toBe(true);
  });

  it('retries immediately when the device is back online', { timeout: 20_000 }, async () => {
    const [keyA] = await pairedKeys();
    const a = started('a4', { b4: remotePeer(keyA) });
    await sleep(3_000);
    const attempts = a.peer().connectCalls.length;

    window.dispatchEvent(new Event('online'));
    await sleep(100);

    expect(a.peer().connectCalls.length).toBe(attempts + 1);
  });

  it('stops retrying forgotten peers, and when stopped', { timeout: 20_000 }, async () => {
    const [keyA] = await pairedKeys();
    const forgetting = started('a5', { b5: remotePeer(keyA) });
    const stopping = device('a6', { b6: remotePeer(keyA) });
    await sleep(300);

    await forgetRemotePeer(forgetting.docLocal, 'b5');
    stopping.adapter.disconnect();
    const attempts = forgetting.peer().connectCalls.length;
    await sleep(5_000);

    expect(forgetting.peer().connectCalls.length).toBe(attempts);
    expect(Object.keys(stopping.adapter.connectionRetries)).toEqual([]);
  });
});

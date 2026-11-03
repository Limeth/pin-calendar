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
  peerId,
} from './helpers';

afterEach(stopStartedDevices);

describe('reconnecting', () => {
  it('reconnects immediately after a connection drops', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started(peerId('a1'), { [peerId('b1')]: remotePeer(keyA) });
    const b = started(peerId('b1'), { [peerId('a1')]: remotePeer(keyB) }, { passive: true });
    expect(await until(() => isConnected(a, peerId('b1')) && isConnected(b, peerId('a1')))).toBe(
      true,
    );

    // A network failure closes both ends, without either adapter deciding to.
    a.adapter.connections[peerId('b1')]![0]!.dataConnection.close();
    expect(await until(() => !isConnected(a, peerId('b1')))).toBe(true);

    expect(
      await until(() => isConnected(a, peerId('b1')) && isConnected(b, peerId('a1')), 1_500),
    ).toBe(true);
  });

  it('retries a failed attempt until the other device is online', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started(peerId('a2'), { [peerId('b2')]: remotePeer(keyA) });
    await sleep(300);
    expect(a.peer().connectCalls).toEqual([peerId('b2')]);

    const b = started(peerId('b2'), { [peerId('a2')]: remotePeer(keyB) }, { passive: true });

    expect(
      await until(() => isConnected(a, peerId('b2')) && isConnected(b, peerId('a2')), 6_000),
    ).toBe(true);
  });

  it('reconnects to the signalling server, then to the peers', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started(peerId('a3'), { [peerId('b3')]: remotePeer(keyA) });
    const b = started(peerId('b3'), { [peerId('a3')]: remotePeer(keyB) }, { passive: true });
    expect(await until(() => isConnected(a, peerId('b3')))).toBe(true);

    signalling.reachable = false;
    a.peer().loseSignalling();
    a.adapter.connections[peerId('b3')]![0]!.dataConnection.close();
    await sleep(500);
    expect(isConnected(a, peerId('b3')) || a.peer().open).toBe(false);

    signalling.reachable = true;

    expect(await until(() => a.peer().open, 6_000)).toBe(true);
    expect(
      await until(() => isConnected(a, peerId('b3')) && isConnected(b, peerId('a3')), 3_000),
    ).toBe(true);
  });

  it('retries immediately when the device is back online', { timeout: 20_000 }, async () => {
    const [keyA] = await pairedKeys();
    const a = started(peerId('a4'), { [peerId('b4')]: remotePeer(keyA) });
    await sleep(3_000);
    const attempts = a.peer().connectCalls.length;

    window.dispatchEvent(new Event('online'));
    await sleep(100);

    expect(a.peer().connectCalls.length).toBe(attempts + 1);
  });

  it('stops retrying forgotten peers, and when stopped', { timeout: 20_000 }, async () => {
    const [keyA] = await pairedKeys();
    const forgetting = started(peerId('a5'), { [peerId('b5')]: remotePeer(keyA) });
    const stopping = device(peerId('a6'), { [peerId('b6')]: remotePeer(keyA) });
    await sleep(300);

    await forgetRemotePeer(forgetting.docLocal, peerId('b5'));
    stopping.adapter.disconnect();
    const attempts = forgetting.peer().connectCalls.length;
    await sleep(5_000);

    expect(forgetting.peer().connectCalls.length).toBe(attempts);
    expect(Object.keys(stopping.adapter.connectionRetries)).toEqual([]);
  });
});

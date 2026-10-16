import { afterEach, describe, expect, it } from 'vitest';
import { Peer } from './fakes/peerjs';
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

describe('a peer whose ID is still taken', () => {
  // A peer holding the ID, like the peer of the previous WebRTC host tab, which is released later.
  async function holdId(peerJsPeerId: string): Promise<Peer> {
    const holder = new Peer(peerJsPeerId);
    await until(() => holder.open);
    return holder;
  }

  it('is replaced once the ID is released', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const holder = await holdId('a7');
    const a = started('a7', { b7: remotePeer(keyA) });
    const b = started('b7', { a7: remotePeer(keyB) }, { passive: true });
    const first = a.peer();
    expect(await until(() => first.destroyed)).toBe(true);

    holder.destroy();

    expect(await until(() => a.peer().open, 6_000)).toBe(true);
    expect(a.peer()).not.toBe(first);
    expect(await until(() => isConnected(a, 'b7') && isConnected(b, 'a7'), 3_000)).toBe(true);
  });

  it('does not keep the ID registered while being destroyed', async () => {
    const holder = await holdId('a10');
    const a = started('a10');
    // The ID is released right as the peer is rejected, before it is destroyed.
    a.peer().once('error', () => holder.destroy());

    expect(await until(() => a.peer().open, 1_000)).toBe(true);
  });

  it('is replaced immediately when the device is back online', async () => {
    const holder = await holdId('a8');
    const a = started('a8');
    const first = a.peer();
    expect(await until(() => first.destroyed)).toBe(true);
    await sleep(100);

    holder.destroy();
    window.dispatchEvent(new Event('online'));

    expect(await until(() => a.peer().open, 500)).toBe(true);
  });

  it('is not replaced once the adapter is stopped', async () => {
    const holder = await holdId('a9');
    const stopping = device('a9');
    const first = stopping.peer();
    expect(await until(() => first.destroyed)).toBe(true);

    stopping.adapter.disconnect();
    holder.destroy();
    await sleep(3_000);

    expect(stopping.adapter.peer).toBeUndefined();
    // The ID is free for the next adapter.
    const next = new Peer('a9');
    expect(await until(() => next.open)).toBe(true);
    next.destroy();
  });
});

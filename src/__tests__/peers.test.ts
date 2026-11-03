import { describe, expect, it } from 'vitest';
import { forgetRemotePeer, setRemotePeerKey } from '@/peers';
import * as auth from '@/auth';
import type { LocalDocument } from '@/documents/local';
import { localDocument, peerId, reactiveDocument } from './helpers';

async function key(): Promise<string> {
  const [a, b] = [await auth.generateEcdhKeyPair(), await auth.generateEcdhKeyPair()];
  return await auth.establishAuthenticationKey(a.privateKey, b.publicKeyRaw);
}

describe('setting the key of a remote peer', () => {
  it('adds a peer that is not known yet', async () => {
    const docLocal = localDocument(peerId('laptop'));
    const tabletKey = await key();

    expect(await setRemotePeerKey(docLocal, peerId('tablet'), tabletKey)).toBe(false);
    expect(docLocal.value.remotePeers[peerId('tablet')]).toMatchObject({
      deviceName: '',
      authKeyId: tabletKey,
    });
  });

  it('replaces the key of a known peer, keeping its name and deleting the old key', async () => {
    const oldKey = await key();
    const docLocal = localDocument(peerId('laptop'), {
      [peerId('phone')]: { deviceName: 'Phone', authKeyId: oldKey },
    });
    const newKey = await key();

    expect(await setRemotePeerKey(docLocal, peerId('phone'), newKey)).toBe(true);
    expect(docLocal.value.remotePeers[peerId('phone')]).toMatchObject({
      deviceName: 'Phone',
      authKeyId: newKey,
    });
    expect(await auth.loadAuthKey(oldKey)).toBeUndefined();
    expect(await auth.loadAuthKey(newKey)).toBeDefined();
  });
});

describe('forgetting a remote peer', () => {
  it('removes the peer and deletes its key', async () => {
    const [phoneKey, tabletKey] = [await key(), await key()];
    const docLocal = localDocument(peerId('laptop'), {
      [peerId('phone')]: { deviceName: '', authKeyId: phoneKey },
      [peerId('tablet')]: { deviceName: '', authKeyId: tabletKey },
    });

    await forgetRemotePeer(docLocal, peerId('tablet'));

    expect(Object.keys(docLocal.value.remotePeers)).toEqual([peerId('phone')]);
    expect(await auth.loadAuthKey(tabletKey)).toBeUndefined();
    expect(await auth.loadAuthKey(phoneKey)).toBeDefined();
  });

  it('does nothing for an unknown peer', async () => {
    const docLocal = localDocument(peerId('laptop'), {
      [peerId('phone')]: { deviceName: '', authKeyId: await key() },
    });

    await forgetRemotePeer(docLocal, 'unknown');

    expect(Object.keys(docLocal.value.remotePeers)).toEqual([peerId('phone')]);
  });
});

describe('invalid remote peers', () => {
  it('are replaced when setting their key', async () => {
    const docLocal = localDocument(peerId('laptop'), {
      [peerId('phone')]: { deviceName: 42 } as never,
    });
    const phoneKey = await key();

    // Its key is not known, so it was not replaced.
    expect(await setRemotePeerKey(docLocal, peerId('phone'), phoneKey)).toBe(false);
    expect(docLocal.value.remotePeers[peerId('phone')]).toMatchObject({ authKeyId: phoneKey });
  });

  it('are replaced with all others when the list of peers is invalid', async () => {
    const docLocal = reactiveDocument({
      localPeer: { deviceName: '', peerJsPeerId: peerId('laptop') },
      remotePeers: 'not a list',
    } as unknown as LocalDocument);
    const phoneKey = await key();

    await setRemotePeerKey(docLocal, peerId('phone'), phoneKey);

    expect(Object.keys(docLocal.value.remotePeers)).toEqual([peerId('phone')]);
  });

  it('are forgotten', async () => {
    const docLocal = localDocument(peerId('laptop'), {
      [peerId('phone')]: { deviceName: 42 } as never,
    });

    await forgetRemotePeer(docLocal, peerId('phone'));

    expect(Object.keys(docLocal.value.remotePeers)).toEqual([]);
  });
});

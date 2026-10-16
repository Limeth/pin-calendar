import { describe, expect, it } from 'vitest';
import { forgetRemotePeer, setRemotePeerKey } from '@/peers';
import * as auth from '@/auth';
import { localDocument } from './helpers';

async function key(): Promise<string> {
  const [a, b] = [await auth.generateEcdhKeyPair(), await auth.generateEcdhKeyPair()];
  return await auth.establishAuthenticationKey(a.privateKey, b.publicKeyRaw);
}

describe('setting the key of a remote peer', () => {
  it('adds a peer that is not known yet', async () => {
    const docLocal = localDocument('laptop');
    const tabletKey = await key();

    expect(await setRemotePeerKey(docLocal, 'tablet', tabletKey)).toBe(false);
    expect(docLocal.value.remotePeers.tablet).toMatchObject({
      deviceName: '',
      authKeyId: tabletKey,
    });
  });

  it('replaces the key of a known peer, keeping its name and deleting the old key', async () => {
    const oldKey = await key();
    const docLocal = localDocument('laptop', { phone: { deviceName: 'Phone', authKeyId: oldKey } });
    const newKey = await key();

    expect(await setRemotePeerKey(docLocal, 'phone', newKey)).toBe(true);
    expect(docLocal.value.remotePeers.phone).toMatchObject({
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
    const docLocal = localDocument('laptop', {
      phone: { deviceName: '', authKeyId: phoneKey },
      tablet: { deviceName: '', authKeyId: tabletKey },
    });

    await forgetRemotePeer(docLocal, 'tablet');

    expect(Object.keys(docLocal.value.remotePeers)).toEqual(['phone']);
    expect(await auth.loadAuthKey(tabletKey)).toBeUndefined();
    expect(await auth.loadAuthKey(phoneKey)).toBeDefined();
  });

  it('does nothing for an unknown peer', async () => {
    const docLocal = localDocument('laptop', { phone: { deviceName: '', authKeyId: await key() } });

    await forgetRemotePeer(docLocal, 'unknown');

    expect(Object.keys(docLocal.value.remotePeers)).toEqual(['phone']);
  });
});

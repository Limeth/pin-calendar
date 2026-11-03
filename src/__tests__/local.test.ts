import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';
import {
  LocalDocumentDefault,
  LocalDocumentGetAlias,
  LocalDocumentGetDocumentIdShared,
  LocalDocumentGetInvalidRemotePeerIds,
  LocalDocumentGetLocalPeer,
  LocalDocumentGetRemotePeer,
  LocalDocumentGetRemotePeers,
  LocalDocumentSetAlias,
  LocalDocumentSetRemotePeerName,
  type LocalDocument,
  type LocalDocumentRop,
} from '@/documents/local';
import { peerId, reactiveDocument } from './helpers';

// A local document as another version of the app may have written it.
function localDocument(data: object): Ref<LocalDocumentRop> {
  return reactiveDocument(data as unknown as LocalDocument);
}

const LOCAL_PEER = { deviceName: 'Laptop', peerJsPeerId: peerId('laptop') };

beforeEach(() => {
  // Invalid data is logged.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the local document', () => {
  it('is read', () => {
    const phone = { deviceName: 'Phone', authKeyId: 'phone-key' };
    const document = localDocument({
      documentIdShared: 'shared-document',
      alias: 'Work',
      localPeer: LOCAL_PEER,
      remotePeers: { [peerId('phone')]: phone },
    });

    expect(LocalDocumentGetDocumentIdShared(document.value)).toBe('shared-document');
    expect(LocalDocumentGetAlias(document.value)).toBe('Work');
    expect(LocalDocumentGetLocalPeer(document.value)).toMatchObject(LOCAL_PEER);
    expect(LocalDocumentGetRemotePeer(document.value, peerId('phone'))).toMatchObject(phone);
    expect(Object.keys(LocalDocumentGetRemotePeers(document.value))).toEqual([peerId('phone')]);
    expect(LocalDocumentGetInvalidRemotePeerIds(document.value)).toEqual([]);
  });

  it('ignores invalid values', () => {
    const document = localDocument({
      documentIdShared: 42,
      alias: 42,
      localPeer: { deviceName: 'Laptop', peerJsPeerId: 'not a UUID' },
      remotePeers: {
        [peerId('phone')]: { deviceName: 'Phone', authKeyId: 'phone-key' },
        [peerId('tablet')]: { deviceName: 'Tablet' },
      },
    });

    expect(LocalDocumentGetDocumentIdShared(document.value)).toBeUndefined();
    expect(LocalDocumentGetAlias(document.value)).toBeUndefined();
    expect(LocalDocumentGetLocalPeer(document.value)).toBeUndefined();
    expect(LocalDocumentGetRemotePeer(document.value, peerId('tablet'))).toBeUndefined();
    expect(Object.keys(LocalDocumentGetRemotePeers(document.value))).toEqual([peerId('phone')]);
    // So that they can be forgotten.
    expect(LocalDocumentGetInvalidRemotePeerIds(document.value)).toEqual([peerId('tablet')]);
  });

  it('does not count inherited properties as remote peers', () => {
    const document = localDocument({ localPeer: LOCAL_PEER, remotePeers: {} });

    // The remote peer chooses its PeerJS peer ID.
    expect(LocalDocumentGetRemotePeer(document.value, 'toString')).toBeUndefined();
    expect(LocalDocumentGetRemotePeer(document.value, 'constructor')).toBeUndefined();
  });

  it('has no remote peers when their list is invalid', () => {
    const document = localDocument({ localPeer: LOCAL_PEER, remotePeers: 'not a list' });

    expect(LocalDocumentGetRemotePeers(document.value)).toEqual({});
    expect(LocalDocumentGetInvalidRemotePeerIds(document.value)).toEqual([]);
  });

  it('can only be used after it was checked', () => {
    const document = localDocument({ localPeer: LOCAL_PEER, remotePeers: {} });
    // @ts-expect-error: Unchecked, so it has to be read via `LocalDocumentGetLocalPeer`.
    const peerJsPeerId: string = document.value.localPeer.peerJsPeerId;

    expect(peerJsPeerId).toBe(peerId('laptop'));
  });
});

describe('the alias of a calendar', () => {
  it('is trimmed, and removed when blank', () => {
    const document = LocalDocumentDefault(peerId('laptop'));

    LocalDocumentSetAlias(document, '  Work  ');
    expect(document.alias).toBe('Work');

    LocalDocumentSetAlias(document, '   ');
    expect(document).not.toHaveProperty('alias');
  });
});

describe('the name of a remote peer', () => {
  it('is trimmed, and cleared when blank', () => {
    const document = LocalDocumentDefault(peerId('laptop'));
    const phone = peerId('phone');
    document.remotePeers[phone] = { deviceName: '', authKeyId: 'key' };

    LocalDocumentSetRemotePeerName(document, phone, '  Phone  ');
    expect(document.remotePeers[phone]).toEqual({ deviceName: 'Phone', authKeyId: 'key' });

    LocalDocumentSetRemotePeerName(document, phone, '   ');
    expect(document.remotePeers[phone]!.deviceName).toBe('');
  });

  it('is not set for unknown or invalid peers', () => {
    const document = LocalDocumentDefault(peerId('laptop'));
    const phone = peerId('phone');
    const invalid = { deviceName: 42, authKeyId: 'key' };
    document.remotePeers[phone] = invalid as unknown as LocalDocument['remotePeers'][string];

    LocalDocumentSetRemotePeerName(document, phone, 'Phone');
    LocalDocumentSetRemotePeerName(document, peerId('tablet'), 'Tablet');
    LocalDocumentSetRemotePeerName(document, 'toString', 'Inherited');

    expect(document.remotePeers).toEqual({ [phone]: invalid });
  });
});

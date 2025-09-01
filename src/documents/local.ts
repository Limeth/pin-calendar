import { Type, type Static } from '@sinclair/typebox';
import * as uuid from 'uuid';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { HashArgs } from '@/hash';
import { getCurrentVersionRop, type Versioned } from '@/versioned';

export const LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT = 1;

const RemotePeerSchema = Type.Object({
  deviceName: Type.String(),
});

export type RemotePeer = Static<typeof RemotePeerSchema>;

const LocalPeerSchema = Type.Composite([
  RemotePeerSchema,
  Type.Object({
    deviceName: Type.String(),
    /// Peer JS peer ID's are not secret, but should be unique if possible.
    peerJsPeerId: Type.String({ format: 'uuid' }),
  }),
]);

export type LocalPeer = Static<typeof LocalPeerSchema>;

export const CalendarIdSchema = Type.String({ format: 'uuid' });

export type CalendarId = Static<typeof CalendarIdSchema>;

const LocalDocumentSchema = Type.Object({
  documentIdShared: Type.Optional(Type.String()),
  localPeer: LocalPeerSchema,
  /// A map with PeerJS peer ID's as keys.
  remotePeers: Type.Record(Type.String({ format: 'uuid' }), RemotePeerSchema),
});

export type LocalDocument = Static<typeof LocalDocumentSchema>;

export function LocalDocumentGetCurrentVersion(
  versioned: Rop<Versioned<LocalDocument>>,
): Rop<LocalDocument> {
  const result = getCurrentVersionRop(
    versioned,
    LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT,
    LocalDocumentDefault,
  );

  if (result.type === 'current') return result.current;

  // TODO: This should be handled gracefully.
  if (result.type === 'unsupported')
    throw new Error(`Unsupported local document schema version: ${result.version}`);

  throw new Error(`No local document found.`);
}

export function LocalDocumentDefault(): LocalDocument {
  return {
    localPeer: {
      deviceName: 'New device',
      peerJsPeerId: uuid.v7(),
    },
    remotePeers: {},
  };
}

export function LocalDocumentAddPeer(self: Rop<LocalDocument>, peer: LocalPeer): boolean {
  const peerAlreadyAdded =
    self.localPeer.peerJsPeerId === peer.peerJsPeerId || peer.peerJsPeerId in self.remotePeers;

  if (peerAlreadyAdded) {
    console.log(`Not adding peer ${peer.peerJsPeerId}, because this peer is already known.`);
    return false;
  } else {
    self[changeSubtree]((localDocument) => {
      localDocument.remotePeers[peer.peerJsPeerId] = {
        deviceName: peer.deviceName,
      };
    });
    console.log(`Added new peer ${peer.peerJsPeerId}.`);
    return true;
  }
}

export function LocalDocumentProcessHash(self: Rop<LocalDocument>, hashArgs: HashArgs) {
  if (hashArgs?.action === 'addPeer') {
    if (self.documentIdShared !== undefined && self.documentIdShared !== hashArgs.documentId) {
      console.warn(
        `Document ID mismatch (current: ${self.documentIdShared}, requested: ${hashArgs.documentId})`,
      );
    } else {
      LocalDocumentAddPeer(self, {
        peerJsPeerId: hashArgs.peerJsPeerId,
        deviceName: '', // TODO
      });
    }
  }
}

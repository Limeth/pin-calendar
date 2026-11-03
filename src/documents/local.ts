import '@/formats';
import { Type, type Static } from '@sinclair/typebox';
import * as uuid from 'uuid';
import { type Rop } from 'automerge-diy-vue-hooks';
import { getCurrentVersionRop, type Versioned } from '@/versioned';
import {
  isObject,
  readEntry,
  readKeys,
  readProperty,
  type Unchecked,
  type UncheckedRop,
} from '@/validation';

export const LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT = 1;

const RemotePeerSchema = Type.Object({
  deviceName: Type.String(),
  authKeyId: Type.String(),
});

export type RemotePeer = Static<typeof RemotePeerSchema>;

/// Peer JS peer ID's are not secret, but should be unique if possible.
const PeerJsPeerIdSchema = Type.String({ format: 'uuid' });

export type PeerJsPeerId = Static<typeof PeerJsPeerIdSchema>;

const LocalPeerSchema = Type.Object({
  deviceName: Type.String(),
  peerJsPeerId: PeerJsPeerIdSchema,
});

export type LocalPeer = Static<typeof LocalPeerSchema>;

export const CalendarIdSchema = Type.String({ format: 'uuid' });

export type CalendarId = Static<typeof CalendarIdSchema>;

export const LocalDocumentSchema = Type.Object({
  documentIdShared: Type.Optional(Type.String()),
  /// What our peer is known as.
  localPeer: LocalPeerSchema,
  /// Peers we synchronize our shared document with.
  /// A map with PeerJS peer ID's as keys.
  remotePeers: Type.Record(Type.String({ format: 'uuid' }), RemotePeerSchema),
});

export type LocalDocument = Static<typeof LocalDocumentSchema>;

// The local document as it is read: this device wrote it, but possibly another version of the app,
// see `Unchecked`.
export type LocalDocumentRop = UncheckedRop<LocalDocument>;

// The ID of the shared document, or `undefined` if it has none yet, or an invalid one.
export function LocalDocumentGetDocumentIdShared(
  self: Unchecked<LocalDocument>,
): string | undefined {
  return readProperty(LocalDocumentSchema, self, 'documentIdShared', 'shared document ID');
}

// This device's peer, or `undefined` if it is invalid.
export function LocalDocumentGetLocalPeer(self: Unchecked<LocalDocument>): LocalPeer | undefined {
  return readProperty(LocalDocumentSchema, self, 'localPeer', 'local peer');
}

// The remote peer, or `undefined` if it is not known, or invalid: it cannot be connected to either
// way, as its authentication key is not known.
export function LocalDocumentGetRemotePeer(
  self: Unchecked<LocalDocument>,
  peerJsPeerId: string,
): RemotePeer | undefined {
  return readEntry(
    LocalDocumentSchema.properties.remotePeers,
    isObject(self) ? self.remotePeers : undefined,
    peerJsPeerId,
    `remote peer ${peerJsPeerId}`,
  );
}

// The valid remote peers, by their PeerJS peer IDs.
export function LocalDocumentGetRemotePeers(
  self: Unchecked<LocalDocument>,
): Record<PeerJsPeerId, RemotePeer> {
  const remotePeers: Record<PeerJsPeerId, RemotePeer> = {};

  for (const peerJsPeerId of readKeys(isObject(self) ? self.remotePeers : undefined)) {
    const remotePeer = LocalDocumentGetRemotePeer(self, peerJsPeerId);

    if (remotePeer !== undefined) remotePeers[peerJsPeerId] = remotePeer;
  }

  return remotePeers;
}

export function LocalDocumentGetCurrentVersion(
  versioned: Rop<Versioned<LocalDocument>>,
  defaultPeerJsPeerId: undefined | PeerJsPeerId,
): LocalDocumentRop {
  const result = getCurrentVersionRop(versioned, LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT, () =>
    LocalDocumentDefault(defaultPeerJsPeerId),
  );

  if (result.type === 'current') return result.current;

  // TODO: This should be handled gracefully.
  if (result.type === 'unsupported')
    throw new Error(`Unsupported local document schema version: ${result.version}`);

  if (result.type === 'invalid') throw new Error(`The local document is invalid.`);

  throw new Error(`No local document found.`);
}

export function LocalDocumentDefault(peerJsPeerId: undefined | PeerJsPeerId): LocalDocument {
  return {
    localPeer: {
      deviceName: 'New device',
      peerJsPeerId: peerJsPeerId ?? uuid.v7(),
    },
    remotePeers: {},
  };
}

import '@/formats';
import { Type, type Static } from '@sinclair/typebox';
import * as uuid from 'uuid';
import { type Rop } from 'automerge-diy-vue-hooks';
import type { Ref } from 'vue';
import { getCurrentVersionRop, NewerVersionError, type Versioned } from '@/versioned';
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
  /// The calendar's alias on this device, shown alongside its shared name, see `SharedDocument`.
  alias: Type.Optional(Type.String()),
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

// The calendar's alias, or `undefined` if it has none, or an invalid one.
export function LocalDocumentGetAlias(self: Unchecked<LocalDocument>): string | undefined {
  return readProperty(LocalDocumentSchema, self, 'alias', 'calendar alias');
}

// Set the calendar's alias, or remove it if the given one is blank.
export function LocalDocumentSetAlias(self: LocalDocument, alias: string) {
  const trimmed = alias.trim();

  if (trimmed.length === 0) delete self.alias;
  else if (self.alias !== trimmed) self.alias = trimmed;
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

// Set the name of a remote peer, which the user gives it on this device, or clear it if the given
// one is blank. An unknown or invalid peer is left as it is.
export function LocalDocumentSetRemotePeerName(
  self: LocalDocument,
  peerJsPeerId: PeerJsPeerId,
  deviceName: string,
) {
  const remotePeer = LocalDocumentGetRemotePeer(self, peerJsPeerId);
  const trimmed = deviceName.trim();

  if (remotePeer !== undefined && remotePeer.deviceName !== trimmed)
    remotePeer.deviceName = trimmed;
}

// The PeerJS peer IDs of the invalid remote peers, so that they can be forgotten, see
// `forgetRemotePeer`. None if the list of peers is invalid, which joining again replaces as a whole.
export function LocalDocumentGetInvalidRemotePeerIds(
  self: Unchecked<LocalDocument>,
): PeerJsPeerId[] {
  return readKeys(isObject(self) ? self.remotePeers : undefined).filter(
    (peerJsPeerId) => LocalDocumentGetRemotePeer(self, peerJsPeerId) === undefined,
  );
}

export function LocalDocumentGetCurrentVersion(
  versioned: Ref<Rop<Versioned<LocalDocument>>>,
  defaultPeerJsPeerId: undefined | PeerJsPeerId,
): LocalDocumentRop {
  const result = getCurrentVersionRop(versioned, LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT, () =>
    LocalDocumentDefault(defaultPeerJsPeerId),
  );

  if (result.type === 'current') return result.current;

  // Shown read-only, see `hasNewerVersionRop`.
  if (result.type === 'unsupported') {
    if (result.current !== undefined) return result.current;

    throw new NewerVersionError(`Unsupported local document schema version: ${result.version}`);
  }

  if (result.type === 'invalid') throw new Error(`The local document is invalid.`);

  if (result.type === 'outdated')
    throw new Error(`Outdated local document schema version: ${result.version}`);

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

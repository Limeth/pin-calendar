import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as uuid from 'uuid';
import type { HashArgs } from './hash';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';

const LOCAL_STORAGE_KEY = 'pinCalendar';

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

// TODO: Versioning
const LocalStorageDataSchema = Type.Object({
  leastRecentlyUsedCalendar: Type.Optional(CalendarIdSchema),
  calendars: Type.Record(
    CalendarIdSchema,
    Type.Object({
      documentIdEphemeral: Type.Optional(Type.String()),
      documentIdLocal: Type.Optional(Type.String()),
    }),
  ),
});

export type LocalStorageData = Static<typeof LocalStorageDataSchema>;

export function LocalStorageDataSave(self: LocalStorageData) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(self));
}

export function LocalStorageDataLoadOrDefault(): LocalStorageData {
  let localStorageData = LocalStorageDataLoad();

  if (localStorageData !== undefined) return localStorageData;

  localStorageData = LocalStorageDataDefault();
  LocalStorageDataSave(localStorageData);
  return localStorageData;
}

function LocalStorageDataLoad(): LocalStorageData | undefined {
  const string = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (string === null) return undefined;

  const json = JSON.parse(string);

  try {
    return Value.Parse(LocalStorageDataSchema, json);
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

function LocalStorageDataDefault(): LocalStorageData {
  return {
    calendars: {},
  };
}

const LocalDocumentSchema = Type.Object({
  documentIdShared: Type.Optional(Type.String()),
  localPeer: LocalPeerSchema,
  /// A map with PeerJS peer ID's as keys.
  remotePeers: Type.Record(Type.String({ format: 'uuid' }), RemotePeerSchema),
});

/// TODO: Automerge sync via BroadcastChannelNetworkAdapter only
export type LocalDocument = Static<typeof LocalDocumentSchema>;

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
    if (self.documentIdShared !== undefined || self.documentIdShared !== hashArgs.documentId) {
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

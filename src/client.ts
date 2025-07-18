import type { PeerId } from "@automerge/automerge-repo";
import { FormatRegistry, Type, type Static, type TObject } from '@sinclair/typebox';
import { Value } from "@sinclair/typebox/value";
import * as uuid from 'uuid';
import type { Hash } from "./hash";
const LOCAL_STORAGE_KEY_CLIENT_SETTINGS = 'clientSettings';

const RemotePeerSchema = Type.Object({
  peerJsPeerId: Type.String({ format: 'uuid' }),
})

export type RemotePeer = Static<typeof RemotePeerSchema>;

const LocalPeerSchema = Type.Object({
  deviceName: Type.String(),
  /// Peer JS peer ID's are not secret, but should be unique if possible.
  peerJsPeerId: Type.String({ format: 'uuid' }),
})

export type LocalPeer = Static<typeof LocalPeerSchema>;

// TODO: Versioning
const ClientSettingsSchema = Type.Object({
  documentId: Type.Optional(Type.String()),
  localPeer: LocalPeerSchema,
  remotePeers: Type.Array(RemotePeerSchema),
})

/// TODO: Automerge sync via BroadcastChannelNetworkAdapter only
export type ClientSettings = Static<typeof ClientSettingsSchema>;

export function ClientSettingsSave(self: ClientSettings) {
  localStorage.setItem(LOCAL_STORAGE_KEY_CLIENT_SETTINGS, JSON.stringify(self));
}

export function ClientSettingsLoadOrDefault(): ClientSettings {
  let clientSettings = ClientSettingsLoad();

  if (clientSettings !== undefined)
    return clientSettings;

  clientSettings = ClientSettingsDefault();
  ClientSettingsSave(clientSettings);
  return clientSettings;
}

function ClientSettingsLoad(): ClientSettings | undefined {
  const string = localStorage.getItem(LOCAL_STORAGE_KEY_CLIENT_SETTINGS);

  if (string === null)
    return undefined;

  const json = JSON.parse(string);

  try {
    return Value.Parse(ClientSettingsSchema, json);
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

function ClientSettingsDefault(): ClientSettings {
  return {
    localPeer: {
      deviceName: "New device",
      peerJsPeerId: uuid.v7(),
    },
    remotePeers: [],
  }
}

export function ClientSettingsAddPeer(self: ClientSettings, peerJsPeerId: string): boolean {
  const peerAlreadyAdded = self.localPeer.peerJsPeerId === peerJsPeerId
    || self.remotePeers.find((remotePeer) => remotePeer.peerJsPeerId === peerJsPeerId) !== undefined;

  if (peerAlreadyAdded) {
    console.log(`Not adding peer ${peerJsPeerId}, because this peer is already known.`);
    return false;
  }
  else {
    self.remotePeers.push({
      peerJsPeerId: peerJsPeerId
    })
    console.log(`Added new peer ${peerJsPeerId}.`)
    return true;
  }
}

export function ClientSettingsProcessHash(self: ClientSettings, hash: Hash) {
  if (self.documentId !== undefined && self.documentId !== hash.documentId) {
    console.warn(`Document ID mismatch (current: ${self.documentId}, requested: ${hash.documentId})`);
  } else {
    if (self.documentId === undefined) {
      self.documentId = hash.documentId;
      console.log(`Document ID set to ${self.documentId}`);
    }

    ClientSettingsAddPeer(self, hash.peerJsPeerId);
  }

}

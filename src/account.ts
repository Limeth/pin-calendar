import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import { type PinCalendar, PinCalendarNew, type PinCatalog, PinCatalogDefault } from './pins';
import * as A from '@automerge/automerge-repo';
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import { WebRtcNetworkAdapter } from './webrtc';
import {
  ClientSettingsLoadOrDefault,
  ClientSettingsProcessHash,
  ClientSettingsSave,
  type ClientSettings,
} from './client';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { decodeHash, encodeHash } from './hash';

export type ClientSettingsStore = {
  loadedClientSettings: null | Ref<ClientSettings>;

  GetClientSettings(): Promise<Ref<ClientSettings>>;
};

export const clientSettingsStore: ShallowRef<ClientSettingsStore> = shallowRef<ClientSettingsStore>(
  {
    loadedClientSettings: null,

    async GetClientSettings(): Promise<Ref<ClientSettings>> {
      if (this.loadedClientSettings === null)
        this.loadedClientSettings = ref(ClientSettingsLoadOrDefault());

      // Automatically update stored value.
      watch(
        this.loadedClientSettings,
        (loadedClientSettings) => {
          ClientSettingsSave(loadedClientSettings);
        },
        { deep: true },
      );

      return this.loadedClientSettings;
    },
  },
);

export type DocData = {
  // account: Account,
  pinCatalog: PinCatalog;
  pinCalendar: PinCalendar;
};

export type App = {
  readonly docData: Ref<Rop<DocData>>;
  readonly docHandle: A.DocHandle<DocData>;
};

async function LoadApp(): Promise<App> {
  // const account = await AccountLoadOrNew();
  // const roomName = await AccountGetPinCatalogRoom(account);
  // const roomPassword = await AccountGetRoomPassword(account);
  // const doc = new Y.Doc();
  // const persistence = new IndexeddbPersistence(roomName, doc);
  // const provider = new WebrtcProvider(roomName, doc, { password: roomPassword });
  const clientSettings = await clientSettingsStore.value.GetClientSettings();
  const currentUrl = URL.parse(window.location.href) ?? undefined;
  const currentHash = currentUrl !== undefined ? decodeHash(currentUrl.hash) : undefined;

  if (currentHash !== undefined) ClientSettingsProcessHash(clientSettings.value, currentHash);

  const webRtcAdapter = new WebRtcNetworkAdapter({
    clientSettings,
  });
  window.webrtc = webRtcAdapter;

  const repo = new A.Repo({
    network: [
      // new BroadcastChannelNetworkAdapter(),
      // The Automerge team provides a public community sync server at wss://sync.automerge.org.
      // For production software, you should run your own server, but for prototyping and development you are welcome to use ours on an "as-is" basis.
      // new WebSocketClientAdapter("wss://sync.automerge.org"),
      webRtcAdapter,
    ],
    storage: new IndexedDBStorageAdapter(),
  });

  let handle: A.DocHandle<DocData>;

  if (A.isValidDocumentId(clientSettings.value.documentId)) {
    handle = await repo.find<DocData>(clientSettings.value.documentId);
  } else {
    const pinCatalog = PinCatalogDefault();
    const pinCalendar = PinCalendarNew();
    handle = repo.create<DocData>({ pinCatalog, pinCalendar });
    clientSettings.value.documentId = handle.documentId;
  }

  if (currentUrl !== undefined) {
    const inviteUrl = new URL(currentUrl);
    inviteUrl.hash = encodeHash({
      action: 'addPeer',
      documentId: clientSettings.value.documentId,
      peerJsPeerId: clientSettings.value.localPeer.peerJsPeerId,
    });
    console.log(`Peer invitation URL: ${inviteUrl.href}`);
  }

  return {
    docData: makeReactive(handle),
    docHandle: handle,
  };
}

export type AppStore = {
  loadedApp: null | ShallowRef<App>;

  GetApp(): Promise<ShallowRef<App>>;
};

export const accountStore: ShallowRef<AppStore> = shallowRef<AppStore>({
  loadedApp: null,

  async GetApp(): Promise<ShallowRef<App>> {
    if (this.loadedApp === null) this.loadedApp = shallowRef(await LoadApp());

    return this.loadedApp;
  },
});

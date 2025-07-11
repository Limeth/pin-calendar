import { shallowRef, type Ref, type ShallowRef } from 'vue';
import { type PinCalendar, PinCalendarNew, type PinCatalog, PinCatalogDefault } from './pins';
import * as A from '@automerge/automerge-repo';
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';

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

  const repo = new A.Repo({
    network: [
      new BroadcastChannelNetworkAdapter(),
      // The Automerge team provides a public community sync server at wss://sync.automerge.org.
      // For production software, you should run your own server, but for prototyping and development you are welcome to use ours on an "as-is" basis.
      // new WebSocketClientAdapter("wss://sync.automerge.org"),
      // TODO: WebRTC
    ],
    storage: new IndexedDBStorageAdapter(),
  });

  const rootDocUrl = `${document.location.hash.substring(1)}`;
  let handle: A.DocHandle<DocData>;
  if (A.isValidAutomergeUrl(rootDocUrl)) {
    handle = await repo.find(rootDocUrl);
  } else {
    const pinCatalog = PinCatalogDefault();
    const pinCalendar = PinCalendarNew();
    handle = repo.create<DocData>({ pinCatalog, pinCalendar });
  }

  const docUrl = (document.location.hash = handle.url);

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

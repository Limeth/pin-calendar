import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import { type PinCalendar, PinCalendarNew, type PinCatalog, PinCatalogDefault } from './pins';
import * as A from '@automerge/automerge-repo';
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { changeSubtree, makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import { WebRtcNetworkAdapter, type ConnectMetadata } from './webrtc';
import {
  type LocalDocument,
  type LocalStorageData,
  LocalStorageDataSave,
  LocalStorageDataLoadOrDefault,
  LocalDocumentDefault,
  LocalDocumentProcessHash,
} from './client';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { decodeHash, encodeHash } from './hash';
import { type FromSharedRepoMessage, type ToSharedRepoMessage } from './workers/sharedRepo';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';

import SharedRepoWorker from './workers/sharedRepo?sharedworker';

export class MessagePortWrapper<MessageSend, MessageRecv> {
  port: MessagePort;

  constructor(port: MessagePort) {
    this.port = port;
    this.port.addEventListener('message', (event) => {
      console.log('message', event);
    });
  }

  postMessage(message: MessageSend, transfer?: Transferable[]) {
    console.log('post', {
      message,
      transfer,
    });
    this.port.postMessage(message, { transfer });
  }

  on(messageHandler: (message: MessageRecv) => void) {
    this.port.addEventListener('message', (event) => {
      messageHandler(event.data as MessageRecv);
    });
  }

  once(messageHandler: (message: MessageRecv) => void) {
    const wrapper: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      outerHandler?: (this: MessagePort, ev: MessagePortEventMap['message']) => any;
    } = {};
    wrapper.outerHandler = (event: MessageEvent) => {
      this.port.removeEventListener('message', wrapper.outerHandler!);
      messageHandler(event.data as MessageRecv);
    };
    this.port.addEventListener('message', wrapper.outerHandler);
  }

  onceAsync(): Promise<MessageRecv> {
    return new Promise((resolve) => {
      this.once(resolve);
    });
  }
}

export type ConnectedPeers = {
  [peerJsPeerId: string]: ConnectMetadata;
};

export type EphemeralDocument = {
  connectedPeers: {
    [peerJsPeerId: string]: ConnectMetadata;
  };
};

export function EphemeralDocumentDefault(): EphemeralDocument {
  return {
    connectedPeers: {},
  };
}

export type LocalStorageDataStore = {
  ref: null | Ref<LocalStorageData>;

  GetData(): Promise<Ref<LocalStorageData>>;
};

export const localStorageDataStore: ShallowRef<LocalStorageDataStore> =
  shallowRef<LocalStorageDataStore>({
    ref: null,

    async GetData(): Promise<Ref<LocalStorageData>> {
      if (this.ref === null) this.ref = ref(LocalStorageDataLoadOrDefault());

      // Automatically update stored value.
      watch(
        this.ref,
        (localStorageData) => {
          LocalStorageDataSave(localStorageData);
        },
        { deep: true },
      );

      return this.ref;
    },
  });

export type SharedDocument = {
  // account: Account,
  pinCatalog: PinCatalog;
  pinCalendar: PinCalendar;
};

export type DocumentWrapper<T> = {
  data: Ref<Rop<T>>,
  handle: A.DocHandle<T>,
};

export type App = {
  readonly docEphemeral: DocumentWrapper<EphemeralDocument>,
  readonly docLocal: DocumentWrapper<LocalDocument>,
  readonly docShared: DocumentWrapper<SharedDocument>,
};

async function LoadApp(): Promise<App> {
  // const account = await AccountLoadOrNew();
  // const roomName = await AccountGetPinCatalogRoom(account);
  // const roomPassword = await AccountGetRoomPassword(account);
  // const doc = new Y.Doc();
  // const persistence = new IndexeddbPersistence(roomName, doc);
  // const provider = new WebrtcProvider(roomName, doc, { password: roomPassword });

  const sharedRepoWorker: MessagePortWrapper<ToSharedRepoMessage, FromSharedRepoMessage> = (() => {
    const worker = new SharedRepoWorker({ name: 'shared-repo' });
    return new MessagePortWrapper<ToSharedRepoMessage, FromSharedRepoMessage>(worker.port);
  })();

  const localStorageData = await localStorageDataStore.value.GetData();
  const currentUrl = URL.parse(window.location.href) ?? undefined;
  const currentHash = currentUrl !== undefined ? decodeHash(currentUrl.hash) : undefined;

  const repoEphemeralMessageChannel = new MessageChannel();
  const repoLocalMessageChannel = new MessageChannel();
  const repoSharedMessageChannel = new MessageChannel();

  sharedRepoWorker.postMessage(
    {
      type: 'init',
      documentIdEphemeral: localStorageData.value.documentIdEphemeral as A.DocumentId,
      documentIdLocal: localStorageData.value.documentIdLocal as A.DocumentId,
      repoEphemeralPort: repoEphemeralMessageChannel.port2,
      repoLocalPort: repoLocalMessageChannel.port2,
      repoSharedPort: repoSharedMessageChannel.port2,
    },
    [
      repoEphemeralMessageChannel.port2,
      repoLocalMessageChannel.port2,
      repoSharedMessageChannel.port2,
    ],
  );

  const readyMsg = await sharedRepoWorker.onceAsync();

  const repoEphemeral = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoEphemeralMessageChannel.port1)],
  });

  let handleEphemeral: A.DocHandle<EphemeralDocument>;

  if (A.isValidDocumentId(localStorageData.value.documentIdEphemeral)) {
    handleEphemeral = await repoEphemeral.find<EphemeralDocument>(
      localStorageData.value.documentIdEphemeral,
    );
  } else {
    throw new Error('Failed to open the ephemeral document.');
  }

  const dataEphemeral: Ref<Rop<EphemeralDocument>> = makeReactive(handleEphemeral);
  const repoLocal = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoLocalMessageChannel.port1)],
    // storage: new IndexedDBStorageAdapter(),
  });

  let handleLocal: A.DocHandle<LocalDocument>;

  if (A.isValidDocumentId(readyMsg.documentIdLocal)) {
    handleLocal = await repoLocal.find<LocalDocument>(readyMsg.documentIdLocal);
  } else {
    throw new Error('Failed to open the local document.');
  }

  const dataLocal: Ref<Rop<LocalDocument>> = makeReactive(handleLocal);

  if (currentHash !== undefined) LocalDocumentProcessHash(dataLocal.value, currentHash);

  const repoShared = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoSharedMessageChannel.port1)],
    // TODO: Is this needed?
    storage: new IndexedDBStorageAdapter(),
  });

  let handleShared: A.DocHandle<SharedDocument>;

  if (A.isValidDocumentId(dataLocal.value.documentIdShared)) {
    handleShared = await repoShared.find<SharedDocument>(dataLocal.value.documentIdShared);
  } else {
    const pinCatalog = PinCatalogDefault();
    const pinCalendar = PinCalendarNew();
    handleShared = repoShared.create<SharedDocument>({ pinCatalog, pinCalendar });
    dataLocal.value[changeSubtree]((dataLocal) => {
      dataLocal.documentIdShared = handleShared.documentId;
    });
  }

  if (currentUrl !== undefined) {
    const inviteUrl = new URL(currentUrl);
    inviteUrl.hash = encodeHash({
      action: 'addPeer',
      documentId: dataLocal.value.documentIdShared!, // TODO: This assertion shouldn't be necessary
      peerJsPeerId: dataLocal.value.localPeer.peerJsPeerId,
    });
    console.log(`Peer invitation URL: ${inviteUrl.href}`);
  }

  return {
    docEphemeral: {
      data: dataEphemeral,
      handle: handleEphemeral,
    },
    docLocal: {
      data: dataLocal,
      handle: handleLocal,
    },
    docShared: {
      data: makeReactive(handleShared),
      handle: handleShared,
    }
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

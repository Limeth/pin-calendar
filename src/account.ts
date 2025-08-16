import { ref, shallowRef, toRef, watch, type Ref, type ShallowRef } from 'vue';
import { type PinCalendar, PinCalendarNew, type PinCatalog, PinCatalogDefault } from './pins';
import * as A from '@automerge/automerge-repo';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import {
  SYMBOL_IS_WEBRTC_NETWORK_ADAPTER,
  WebRtcNetworkAdapter,
  type ConnectMetadata,
} from './webrtc';
import {
  type LocalDocument,
  type LocalStorageData,
  LocalStorageDataSave,
  LocalStorageDataLoadOrDefault,
  LocalDocumentProcessHash,
} from './client';
import { decodeHash, encodeHash } from './hash';
import {
  type FromSharedRepoMessage,
  type FromSharedRepoMessageReadyLocal,
  type FromSharedRepoMessageReadyShared,
  type ToSharedRepoMessage,
} from './workers/sharedRepo';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';

import SharedRepoWorker from './workers/sharedRepo?sharedworker';

export class MessagePortWrapper<MessageSend, MessageRecv> {
  port: MessagePort;

  constructor(port: MessagePort) {
    this.port = port;
    this.port.addEventListener('message', (event) => {
      console.log('message', event.data);
    });
  }

  /// Start listening to incoming messages.
  start() {
    this.port.start();
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

  once(messageHandler: (message: MessageRecv) => boolean) {
    const wrapper: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      outerHandler?: (this: MessagePort, ev: MessagePortEventMap['message']) => any;
    } = {};
    wrapper.outerHandler = (event: MessageEvent) => {
      if (messageHandler(event.data as MessageRecv))
        this.port.removeEventListener('message', wrapper.outerHandler!);
    };
    this.port.addEventListener('message', wrapper.outerHandler);
  }

  /// Implies start().
  onceAsync(filter: (message: MessageRecv) => boolean = () => true): Promise<MessageRecv> {
    return new Promise((resolve) => {
      this.once((message) => {
        const accepted = filter(message);
        if (accepted) resolve(message);
        return accepted;
      });
      this.start();
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
  ref?: Promise<Ref<LocalStorageData>>;

  GetData(): Promise<Ref<LocalStorageData>>;
};

export const localStorageDataStore: ShallowRef<LocalStorageDataStore> =
  shallowRef<LocalStorageDataStore>({
    GetData(): Promise<Ref<LocalStorageData>> {
      if (this.ref !== undefined) return this.ref;

      this.ref = (async () => {
        const innerRef = ref(LocalStorageDataLoadOrDefault());

        // Automatically update stored value.
        watch(
          innerRef,
          (localStorageData) => {
            LocalStorageDataSave(localStorageData);
          },
          { deep: true },
        );

        return innerRef;
      })();

      return this.ref;
    },
  });

export type SharedDocument = {
  // account: Account,
  pinCatalog: PinCatalog;
  pinCalendar: PinCalendar;
};

export function SharedDocumentDefault() {
  return { pinCatalog: PinCatalogDefault(), pinCalendar: PinCalendarNew() };
}

export type DocumentWrapper<T> = {
  repo: A.Repo;
  data: Ref<Rop<T>>;
  handle: A.DocHandle<T>;
};

export type App = {
  readonly docEphemeral: DocumentWrapper<EphemeralDocument>;
  readonly docLocal: DocumentWrapper<LocalDocument>;
  readonly docShared: DocumentWrapper<SharedDocument>;
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

  type DataReadyLocal = {
    readonly docEphemeral: DocumentWrapper<EphemeralDocument>;
    readonly docLocal: DocumentWrapper<LocalDocument>;
    readonly repoShared: A.Repo;
  };

  const { resolvePromiseDataReadyLocal, promiseDataReadyLocal } = (() => {
    let resolvePromiseDataReadyLocal: undefined | ((data: DataReadyLocal) => void);
    const promiseDataReadyLocal: Promise<DataReadyLocal> = new Promise((resolve) => {
      resolvePromiseDataReadyLocal = resolve;
    });
    return { resolvePromiseDataReadyLocal: resolvePromiseDataReadyLocal!, promiseDataReadyLocal };
  })();

  sharedRepoWorker.on((message) => {
    // TODO: These promises could race.
    switch (message.type) {
      case 'webrtc-start': {
        (async () => {
          const dataReadyLocal = await promiseDataReadyLocal;
          console.log(`message:`, message);
          const webrtc = new WebRtcNetworkAdapter({
            clientSettings: dataReadyLocal.docLocal.data,
            connectedPeers: toRef(dataReadyLocal.docEphemeral.data.value.connectedPeers),
            attemptToWaitForAnyPeerDurationMilliseconds:
              message.documentSharedAvailableLocallyDuringInitialization ? undefined : 1000,
          });

          dataReadyLocal.repoShared.networkSubsystem.addNetworkAdapter(webrtc);
          console.log('WebRTC Network Adapter registered, waiting for it to be prepared.');
          await webrtc.whenReady();
          console.log('WebRTC Network Adapter prepared, signaling success.');
          sharedRepoWorker.postMessage({ type: 'webrtc-start-success' });
        })();
        break;
      }
      case 'webrtc-stop': {
        (async () => {
          const dataReadyLocal = await promiseDataReadyLocal;
          const adapters = dataReadyLocal.repoShared.networkSubsystem.adapters.filter(
            (adapter) => SYMBOL_IS_WEBRTC_NETWORK_ADAPTER in adapter,
          );
          if (adapters.length > 0) {
            for (const adapter of adapters)
              dataReadyLocal.repoShared.networkSubsystem.removeNetworkAdapter(adapter);
            console.log('WebRTC Network Adapter(s) unregistered.');
          }
          sharedRepoWorker.postMessage({ type: 'webrtc-stop-success' });
        })();
        break;
      }
      case 'webrtc-pollalive': {
        sharedRepoWorker.postMessage({
          type: 'webrtc-pollalive-acq',
        });
        break;
      }
    }
  });

  const readyLocal = sharedRepoWorker.onceAsync(
    (msg) => msg.type === 'ready-local',
  ) as Promise<FromSharedRepoMessageReadyLocal>;
  const readyShared = sharedRepoWorker.onceAsync(
    (msg) => msg.type === 'ready-shared',
  ) as Promise<FromSharedRepoMessageReadyShared>;

  sharedRepoWorker.postMessage(
    {
      type: 'init',
      documentIdEphemeral: localStorageData.value.documentIdEphemeral as A.DocumentId,
      documentIdLocal: localStorageData.value.documentIdLocal as A.DocumentId,
      hash: currentHash,
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

  /// Wait for the emphemeral and local documents to become available.
  const msgReadyLocal = await readyLocal;

  localStorageData.value.documentIdEphemeral = msgReadyLocal.documentIdEphemeral;
  localStorageData.value.documentIdLocal = msgReadyLocal.documentIdLocal;

  const repoEphemeral = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoEphemeralMessageChannel.port1)],
  });

  let handleEphemeral: A.DocHandle<EphemeralDocument>;

  if (A.isValidDocumentId(localStorageData.value.documentIdEphemeral)) {
    handleEphemeral = await repoEphemeral.find<EphemeralDocument>(
      localStorageData.value.documentIdEphemeral,
    );
  } else {
    throw new Error(
      `Failed to open the ephemeral document with ID: ${localStorageData.value.documentIdEphemeral}`,
    );
  }

  const dataEphemeral: Ref<Rop<EphemeralDocument>> = makeReactive(handleEphemeral);
  const repoLocal = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoLocalMessageChannel.port1)],
  });

  let handleLocal: A.DocHandle<LocalDocument>;

  if (A.isValidDocumentId(localStorageData.value.documentIdLocal)) {
    handleLocal = await repoLocal.find<LocalDocument>(localStorageData.value.documentIdLocal);
  } else {
    throw new Error(
      `Failed to open the local document with ID: ${localStorageData.value.documentIdLocal}`,
    );
  }

  const dataLocal: Ref<Rop<LocalDocument>> = makeReactive(handleLocal);

  console.log('dataLocal: ', dataLocal.value);

  if (currentHash !== undefined) LocalDocumentProcessHash(dataLocal.value, currentHash);

  const repoShared = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoSharedMessageChannel.port1)],
  });

  resolvePromiseDataReadyLocal({
    docEphemeral: {
      repo: repoEphemeral,
      data: dataEphemeral,
      handle: handleEphemeral,
    },
    docLocal: {
      repo: repoLocal,
      data: dataLocal,
      handle: handleLocal,
    },
    repoShared,
  });

  /// Wait for the shared document to become available.
  await readyShared;

  let handleShared: A.DocHandle<SharedDocument>;

  if (A.isValidDocumentId(dataLocal.value.documentIdShared)) {
    handleShared = await repoShared.find<SharedDocument>(dataLocal.value.documentIdShared);
  } else {
    throw new Error(
      `Failed to open the shared document with ID: ${dataLocal.value.documentIdShared}`,
    );
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
      repo: repoEphemeral,
      data: dataEphemeral,
      handle: handleEphemeral,
    },
    docLocal: {
      repo: repoLocal,
      data: dataLocal,
      handle: handleLocal,
    },
    docShared: {
      repo: repoShared,
      data: makeReactive(handleShared),
      handle: handleShared,
    },
  };
}

export type AppStore = {
  ref?: Promise<ShallowRef<App>>;

  GetApp(): Promise<ShallowRef<App>>;
};

export const accountStore: ShallowRef<AppStore> = shallowRef<AppStore>({
  GetApp(): Promise<ShallowRef<App>> {
    if (this.ref !== undefined) return this.ref;

    this.ref = (async () => {
      return shallowRef(await LoadApp());
    })();

    return this.ref;
  },
});

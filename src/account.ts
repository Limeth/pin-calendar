import { ref, shallowRef, toRef, watch, type Ref, type ShallowRef } from 'vue';
import { type PinCalendar, type PinCatalog } from './pins';
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
  type CalendarId,
} from './client';
import { encodeHash, type HashArgs } from './hash';
import {
  MessagePortWrapper,
  type FromSharedRepoMessage,
  type FromSharedRepoMessageReadyLocal,
  type FromSharedRepoMessageReadyShared,
  type ToSharedRepoMessage,
} from './workerMessages';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';

import SharedRepoWorker from './workers/sharedRepo?sharedworker';

export type ConnectedPeers = {
  [peerJsPeerId: string]: ConnectMetadata;
};

export type EphemeralDocument = {
  connectedPeers: {
    [peerJsPeerId: string]: ConnectMetadata;
  };
};

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

export type DocumentWrapper<T> = {
  repo: A.Repo;
  data: Ref<Rop<T>>;
  handle: A.DocHandle<T>;
};

export type App = {
  readonly calendarId: CalendarId;
  readonly docEphemeral: DocumentWrapper<EphemeralDocument>;
  readonly docLocal: DocumentWrapper<LocalDocument>;
  readonly docShared: DocumentWrapper<SharedDocument>;
};

async function LoadApp(calendarId: CalendarId, hashArgs: HashArgs): Promise<App> {
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

  if (!(calendarId in localStorageData.value.calendars))
    localStorageData.value.calendars[calendarId] = {};

  const calendarData = localStorageData.value.calendars[calendarId];
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
  sharedRepoWorker.start(); // Start processing received messages.

  sharedRepoWorker.postMessage(
    {
      type: 'init',
      calendarId,
      documentIdEphemeral: calendarData.documentIdEphemeral as A.DocumentId,
      documentIdLocal: calendarData.documentIdLocal as A.DocumentId,
      hashArgs,
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

  calendarData.documentIdEphemeral = msgReadyLocal.documentIdEphemeral;
  calendarData.documentIdLocal = msgReadyLocal.documentIdLocal;

  const repoEphemeral = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoEphemeralMessageChannel.port1)],
  });

  let handleEphemeral: A.DocHandle<EphemeralDocument>;

  if (A.isValidDocumentId(calendarData.documentIdEphemeral)) {
    handleEphemeral = await repoEphemeral.find<EphemeralDocument>(calendarData.documentIdEphemeral);
  } else {
    throw new Error(
      `Failed to open the ephemeral document with ID: ${calendarData.documentIdEphemeral}`,
    );
  }

  const dataEphemeral: Ref<Rop<EphemeralDocument>> = makeReactive(handleEphemeral);
  const repoLocal = new A.Repo({
    network: [new MessageChannelNetworkAdapter(repoLocalMessageChannel.port1)],
  });

  let handleLocal: A.DocHandle<LocalDocument>;

  if (A.isValidDocumentId(calendarData.documentIdLocal)) {
    handleLocal = await repoLocal.find<LocalDocument>(calendarData.documentIdLocal);
  } else {
    throw new Error(`Failed to open the local document with ID: ${calendarData.documentIdLocal}`);
  }

  const dataLocal: Ref<Rop<LocalDocument>> = makeReactive(handleLocal);

  console.log('dataLocal: ', dataLocal.value);

  LocalDocumentProcessHash(dataLocal.value, hashArgs);

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

  const currentUrl = URL.parse(window.location.href) ?? undefined;
  if (currentUrl !== undefined) {
    const inviteUrl = new URL(currentUrl);
    inviteUrl.hash = encodeHash({
      path: undefined,
      args: {
        action: 'addPeer',
        documentId: dataLocal.value.documentIdShared!, // TODO: This assertion shouldn't be necessary
        peerJsPeerId: dataLocal.value.localPeer.peerJsPeerId,
      },
    });
    console.log(`Peer invitation URL: ${inviteUrl.href}`);
  }

  return {
    calendarId,
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
  refMap: {
    [calendarId: CalendarId]: Promise<ShallowRef<App>>;
  };

  GetApp(calendarId: CalendarId, hashArgs: HashArgs): Promise<ShallowRef<App>>;
};

export const accountStore: ShallowRef<AppStore> = shallowRef<AppStore>({
  refMap: {},

  GetApp(calendarId: CalendarId, hashArgs: HashArgs): Promise<ShallowRef<App>> {
    if (calendarId in this.refMap) return this.refMap[calendarId];

    this.refMap[calendarId] = (async () => {
      return shallowRef(await LoadApp(calendarId, hashArgs));
    })();

    return this.refMap[calendarId];
  },
});

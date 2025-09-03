import { computed, shallowRef, toRef, type Ref, type ShallowRef } from 'vue';
import * as A from '@automerge/automerge-repo';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import { SYMBOL_IS_WEBRTC_NETWORK_ADAPTER, WebRtcNetworkAdapter } from './webrtc';
import {
  type LocalDocument,
  LocalDocumentProcessHash,
  type CalendarId,
  LocalDocumentGetCurrentVersion,
} from './documents/local';
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
import { SharedDocumentGetCurrentVersion, type SharedDocument } from './documents/shared';
import type { EphemeralDocument } from './documents/ephemeral';
import { localStorageDataStore, type LocalStorageDataCalendar } from './localStorageData';
import type { DocumentWrapper, VersionedDocumentWrapper } from './documents/wrapper';
import type { Versioned } from './versioned';

export type App = {
  readonly calendarId: CalendarId;
  readonly docEphemeral: DocumentWrapper<EphemeralDocument>;
  readonly docLocal: VersionedDocumentWrapper<LocalDocument>;
  readonly docShared: VersionedDocumentWrapper<SharedDocument>;
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
  let calendarData: LocalStorageDataCalendar;

  if (calendarId in localStorageData.value.calendars)
    calendarData = localStorageData.value.calendars[calendarId]!;
  else {
    localStorageData.value.calendars[calendarId] = {};
    calendarData = localStorageData.value.calendars[calendarId];
  }

  const repoEphemeralMessageChannel = new MessageChannel();
  const repoLocalMessageChannel = new MessageChannel();
  const repoSharedMessageChannel = new MessageChannel();

  type DataReadyLocal = {
    readonly docEphemeral: DocumentWrapper<EphemeralDocument>;
    readonly docLocal: VersionedDocumentWrapper<LocalDocument>;
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
            docLocal: dataReadyLocal.docLocal.data,
            connectedPeers: toRef(dataReadyLocal.docEphemeral.data.value.connectedPeers),
            attemptToWaitForDocumentAvailability:
              message.documentSharedAvailableLocallyDuringInitialization
                ? undefined
                : {
                    timeoutMilliseconds: 10_000,
                    documentId: dataReadyLocal.docLocal.data.value.documentIdShared as A.DocumentId,
                    repo: dataReadyLocal.repoShared,
                  },
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

  let handleLocal: A.DocHandle<Versioned<LocalDocument>>;

  if (A.isValidDocumentId(calendarData.documentIdLocal)) {
    handleLocal = await repoLocal.find<Versioned<LocalDocument>>(calendarData.documentIdLocal);
  } else {
    throw new Error(`Failed to open the local document with ID: ${calendarData.documentIdLocal}`);
  }

  const dataLocalVersioned: Ref<Rop<Versioned<LocalDocument>>> = makeReactive(handleLocal);
  // TODO/FIXME: This `computed` seems problematic because it might cause the entire app to be re-drawn,
  // but using `toRef` instead would break the reactivity, for some reason.
  // This affects `dataShared` and `docDataLocal` in `sharedRepo.ts`, too.
  const dataLocal = computed(() => LocalDocumentGetCurrentVersion(dataLocalVersioned.value));

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
      versionedData: dataLocalVersioned,
      data: dataLocal,
      handle: handleLocal,
    },
    repoShared,
  });

  /// Wait for the shared document to become available.
  await readyShared;

  let handleShared: A.DocHandle<Versioned<SharedDocument>>;

  if (A.isValidDocumentId(dataLocal.value.documentIdShared)) {
    handleShared = await repoShared.find<Versioned<SharedDocument>>(
      dataLocal.value.documentIdShared,
    );
  } else {
    throw new Error(
      `Failed to open the shared document with ID: ${dataLocal.value.documentIdShared}`,
    );
  }

  const dataSharedVersioned: Ref<Rop<Versioned<SharedDocument>>> = makeReactive(handleShared);
  const dataShared = computed(() => SharedDocumentGetCurrentVersion(dataSharedVersioned.value));

  const currentUrl = URL.parse(window.location.href) ?? undefined;
  if (currentUrl !== undefined) {
    const inviteUrl = new URL(currentUrl);
    inviteUrl.hash = encodeHash({
      path: {
        calendar: {
          id: calendarId,
        },
      },
      args: {
        action: 'addPeer',
        documentId: dataLocal.value.documentIdShared,
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
      versionedData: dataLocalVersioned,
      data: dataLocal,
      handle: handleLocal,
    },
    docShared: {
      repo: repoShared,
      versionedData: dataSharedVersioned,
      data: dataShared,
      handle: handleShared,
    },
  };
}

export type AppStore = {
  refMap: {
    [calendarId: CalendarId]: Promise<App>;
  };

  GetApp(calendarId: CalendarId, hashArgs: HashArgs): Promise<App>;
  GetAppOptional(calendarId: CalendarId | undefined, hashArgs: HashArgs): Promise<App | undefined>;
};

export const accountStore: ShallowRef<AppStore> = shallowRef<AppStore>({
  refMap: {},

  GetApp(calendarId: CalendarId, hashArgs: HashArgs): Promise<App> {
    if (calendarId in this.refMap) return this.refMap[calendarId]!;

    this.refMap[calendarId] = (async () => {
      return await LoadApp(calendarId, hashArgs);
    })();

    return this.refMap[calendarId];
  },

  async GetAppOptional(
    calendarId: CalendarId | undefined,
    hashArgs: HashArgs,
  ): Promise<App | undefined> {
    if (calendarId !== undefined) return await this.GetApp(calendarId, hashArgs);
  },
});

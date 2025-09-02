// Import only types from automerge here. See `wasmDependencies` for more info.
import type { DocHandle, DocumentId, Repo } from '@automerge/automerge-repo';
import type { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import type { Rop } from 'automerge-diy-vue-hooks';
import * as uuid from 'uuid';
import {
  LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT,
  LocalDocumentAddPeer,
  LocalDocumentDefault,
  LocalDocumentGetCurrentVersion,
  type CalendarId,
  type LocalDocument,
} from '@/documents/local';
import { computed, type Ref } from 'vue';
import {
  MessagePortWrapper,
  type FromSharedRepoMessage,
  type ToSharedRepoMessage,
  type ToSharedRepoMessageInit,
} from '@/workerMessages';
import { changeSubtree, makeReactive } from 'automerge-diy-vue-hooks';
import {
  SHARED_DOCUMENT_SCHEMA_VERSION_CURRENT,
  SharedDocumentDefault,
  type SharedDocument,
} from '@/documents/shared';
import type { EphemeralDocument } from '@/documents/ephemeral';
import type { DocumentWrapper, VersionedDocumentWrapper } from '@/documents/wrapper';
import { makeVersioned, type Versioned } from '@/versioned';

declare const self: SharedWorkerGlobalScope;

// Any dependencies that require async import must be explicitly imported asynchronously via the `await` keyword.
// If a regular import were to be used, the Chrome browser would implicitly `await` on the dependencies,
// which prevents `self.onconnect` to be set up soon enough.
// https://github.com/Menci/vite-plugin-wasm/issues/37
const wasmDependencies = (async () => {
  const { DocHandle, isValidDocumentId, Repo } = await import('@automerge/automerge-repo');
  const { IndexedDBStorageAdapter } = await import('@automerge/automerge-repo-storage-indexeddb');
  const { MessageChannelNetworkAdapter } = await import(
    '@automerge/automerge-repo-network-messagechannel'
  );
  return {
    DocHandle,
    isValidDocumentId,
    Repo,
    IndexedDBStorageAdapter,
    MessageChannelNetworkAdapter,
  };
})();

const firstConnectDebugTimeout = setTimeout(() => {
  console.warn(`
    No incoming connection detected after this shared worker was created.
    This may be caused by a WASM dependency being implicitly asynchronously imported.
    See \`wasmDependencies\` for more info.
  `);
}, 1000);

export function EphemeralDocumentDefault(): EphemeralDocument {
  return {
    connectedPeers: {},
  };
}

type TabMessagePort = MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage> & {
  calendarId?: undefined | CalendarId;
};

type Tab = {
  port: TabMessagePort;
  adapterEphemeral: MessageChannelNetworkAdapter;
  adapterLocal: MessageChannelNetworkAdapter;
  adapterShared: MessageChannelNetworkAdapter;
  timedOut: boolean;
};

class Initialized {
  docEphemeral: DocumentWrapper<EphemeralDocument>;
  docLocal: VersionedDocumentWrapper<LocalDocument>;
  documentSharedAvailableLocallyDuringInitialization: boolean;
  tabs: Tab[] = [];
  webRtcTab?: Tab;
  webRtcStarted: boolean = false;

  constructor(options: {
    docEphemeral: DocumentWrapper<EphemeralDocument>;
    docLocal: VersionedDocumentWrapper<LocalDocument>;
    documentSharedAvailableLocally: boolean;
  }) {
    this.docEphemeral = options.docEphemeral;
    this.docLocal = options.docLocal;
    this.documentSharedAvailableLocallyDuringInitialization =
      options.documentSharedAvailableLocally;
  }

  // TODO: Ports would have to be weak-referenced.
  // cleanupClosedTabs() {
  //   for (let i = this.tabs.length - 1; i >= 0; i--) {
  //     const tab = this.tabs[i];
  //     const port = tab.port.deref();
  //     if (port === undefined) {
  //       this.tabs.splice(i, 1);
  //       console.warn("Cleaning up closed tab.", tab);
  //     }
  //   }
  // }
}

/// There's a separate SharedRepo for each distinct calendar.
class SharedRepo {
  calendarId: CalendarId;
  repoEphemeral: Repo;
  repoLocal: Repo;
  repoShared: Repo;
  initialized?: Promise<Initialized>;

  constructor(wasmDeps: Awaited<typeof wasmDependencies>, calendarId: CalendarId) {
    this.calendarId = calendarId;
    this.repoEphemeral = new wasmDeps.Repo({
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-ephemeral:' + uuid.v7()) as any,
    });
    this.repoLocal = new wasmDeps.Repo({
      storage: new wasmDeps.IndexedDBStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-local:' + uuid.v7()) as any,
    });
    this.repoShared = new wasmDeps.Repo({
      storage: new wasmDeps.IndexedDBStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-shared:' + uuid.v7()) as any,
    });
  }

  initialize(message: ToSharedRepoMessageInit): NonNullable<typeof this.initialized> {
    if (this.initialized !== undefined) return this.initialized;

    this.initialized = this.initializeInner(message);
    return this.initialized;
  }

  // To ensure this method is invoked exactly once, invoke `initialize()` instead.
  async initializeInner(message: ToSharedRepoMessageInit): NonNullable<typeof this.initialized> {
    const docHandleEphemeral: DocHandle<EphemeralDocument> =
      this.repoEphemeral.create<EphemeralDocument>(EphemeralDocumentDefault());
    const docDataEphemeral = makeReactive(docHandleEphemeral) as Ref<Rop<EphemeralDocument>>;
    let docHandleLocal: DocHandle<Versioned<LocalDocument>>;

    if ((await wasmDependencies).isValidDocumentId(message.documentIdLocal)) {
      docHandleLocal = await this.repoLocal.find<Versioned<LocalDocument>>(message.documentIdLocal);
    } else {
      docHandleLocal = this.repoLocal.create<Versioned<LocalDocument>>(
        makeVersioned(LocalDocumentDefault(), LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT),
      );
    }

    const docDataLocalVersioned: Ref<Rop<Versioned<LocalDocument>>> = makeReactive(docHandleLocal);
    const docDataLocal = computed(() =>
      LocalDocumentGetCurrentVersion(docDataLocalVersioned.value),
    );

    if (message.hashArgs?.action === 'addPeer') {
      let suggestedDocumentIdUsed;

      if (docDataLocal.value.documentIdShared === undefined) {
        console.log(`Using suggested shared document ID: ${message.hashArgs.documentId}`);
        docDataLocal.value[changeSubtree]((local) => {
          local.documentIdShared = message.hashArgs?.documentId;
        });
        suggestedDocumentIdUsed = true;
      } else if (message.hashArgs.documentId === docDataLocal.value.documentIdShared) {
        console.log(
          `Suggested shared document ID matches the stored shared document ID: ${docDataLocal.value.documentIdShared}`,
        );
        suggestedDocumentIdUsed = true;
      } else {
        console.log(
          `A shared document ID was suggested (${message.hashArgs.documentId}), but was ignored, because an existing stored shared document ID was found: ${docDataLocal.value.documentIdShared}`,
        );
        suggestedDocumentIdUsed = false;
      }

      if (suggestedDocumentIdUsed)
        LocalDocumentAddPeer(docDataLocal.value, {
          peerJsPeerId: message.hashArgs.peerJsPeerId,
          deviceName: '', // TODO
        });
    }

    let documentSharedAvailableLocally;

    if (docDataLocal.value.documentIdShared === undefined) {
      const docHandleShared = this.repoShared.create<Versioned<SharedDocument>>(
        makeVersioned(SharedDocumentDefault(), SHARED_DOCUMENT_SCHEMA_VERSION_CURRENT),
      );
      docDataLocal.value[changeSubtree]((local) => {
        local.documentIdShared = docHandleShared.documentId;
      });
      documentSharedAvailableLocally = true;
      console.log(
        `No shared document ID is set, created a new document with ID: ${docHandleShared.documentId}`,
      );
    } else {
      /// Attempt to find the document in the local database, before any network adapters are added to the repo.
      try {
        this.repoShared.find<SharedDocument>(docDataLocal.value.documentIdShared as DocumentId);
        documentSharedAvailableLocally = true;
      } catch {
        documentSharedAvailableLocally = false;
      }
    }

    /// Launch a task that ensures a WebRTC network adapter is running on exactly one tab at any point.
    (async () => {
      const POLL_INTERVAL_MS = 1000;
      const POLL_TIMEOUT_MS = 4000;
      const repo = await GetSharedRepo(this.calendarId);
      const initialized = await repo.initialized!;

      while (true) {
        const webRtcRunning = await (async () => {
          if (initialized.webRtcTab === undefined) return false;

          const alivePromise = Promise.any([
            initialized.webRtcTab.port
              .onceAsync((message) => message.type === 'webrtc-pollalive-acq')
              .then(() => true),
            new Promise((r) => setTimeout(r, POLL_TIMEOUT_MS)).then(() => false),
          ]);

          initialized.webRtcTab.port.postMessage({ type: 'webrtc-pollalive' });

          if (await alivePromise) return true;

          console.warn('WebRTC pollalive timed out.');
          initialized.webRtcTab.port.postMessage({ type: 'webrtc-stop' });
          initialized.webRtcTab.timedOut = true;
          return false;
        })();

        if (!webRtcRunning) {
          initialized.webRtcTab = undefined;

          if (initialized.tabs.length > 0) {
            let responsiveTabs = initialized.tabs.filter((tab) => !tab.timedOut);

            // Reset timed out status of all tabs in hopes of finding a responsive tab among them.
            if (responsiveTabs.length === 0) {
              for (const tab of initialized.tabs) tab.timedOut = false;

              responsiveTabs = initialized.tabs;
            }

            const tabIndex = Math.floor(Math.random() * responsiveTabs.length);
            const tab = responsiveTabs[tabIndex]!;
            initialized.webRtcTab = tab;
            tab.port.postMessage({
              type: 'webrtc-start',
              documentSharedAvailableLocallyDuringInitialization:
                initialized.documentSharedAvailableLocallyDuringInitialization,
            });
          } else {
            initialized.webRtcTab = undefined;
            console.warn('No tabs to host a WebRTC client in available.');
          }
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    })();

    return new Initialized({
      docEphemeral: {
        repo: this.repoEphemeral,
        handle: docHandleEphemeral,
        data: docDataEphemeral,
      },
      docLocal: {
        repo: this.repoLocal,
        handle: docHandleLocal,
        versionedData: docDataLocalVersioned,
        data: docDataLocal,
      },
      documentSharedAvailableLocally,
    });
  }

  async addTab(message: ToSharedRepoMessageInit, port: TabMessagePort) {
    const initialized = await this.initialize(message);

    // be careful to not accidentally create a strong reference to port
    // that will prevent dead ports from being garbage collected
    const adapterEphemeral = new (await wasmDependencies).MessageChannelNetworkAdapter(
      message.repoEphemeralPort,
      {
        useWeakRef: true,
      },
    );
    const adapterLocal = new (await wasmDependencies).MessageChannelNetworkAdapter(
      message.repoLocalPort,
      {
        useWeakRef: true,
      },
    );
    const adapterShared = new (await wasmDependencies).MessageChannelNetworkAdapter(
      message.repoSharedPort,
      {
        useWeakRef: true,
      },
    );

    this.repoEphemeral.networkSubsystem.addNetworkAdapter(adapterEphemeral);
    this.repoLocal.networkSubsystem.addNetworkAdapter(adapterLocal);
    this.repoShared.networkSubsystem.addNetworkAdapter(adapterShared);

    initialized.tabs.push({ port, adapterEphemeral, adapterLocal, adapterShared, timedOut: false });
  }
}

const sharedRepoByCalendarId: {
  [calendarId: CalendarId]: Promise<SharedRepo>;
} = {};

async function GetSharedRepo(calendarId: CalendarId): Promise<SharedRepo> {
  if (calendarId in sharedRepoByCalendarId) return sharedRepoByCalendarId[calendarId]!;

  sharedRepoByCalendarId[calendarId] = (async (): Promise<SharedRepo> => {
    return new SharedRepo(await wasmDependencies, calendarId);
  })();

  return sharedRepoByCalendarId[calendarId];
}

self.onconnect = (eventConnect: MessageEvent) => {
  console.log('connect', eventConnect);

  if (eventConnect.ports[0] === undefined) return;

  clearTimeout(firstConnectDebugTimeout);

  const port = new MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>(
    eventConnect.ports[0],
  );

  port.on((message) => {
    onMessage(message, port);
  });

  port.start();
};

async function onMessage(message: ToSharedRepoMessage, port: TabMessagePort) {
  switch (message.type) {
    case 'init': {
      port.calendarId = message.calendarId;
      const repo = await GetSharedRepo(port.calendarId);
      const initialized = await repo.initialize(message);

      repo.addTab(message, port);
      port.postMessage({
        type: 'ready-local',
        documentIdEphemeral: initialized.docEphemeral.handle.documentId,
        documentIdLocal: initialized.docLocal.handle.documentId,
      });

      if (initialized.webRtcStarted) port.postMessage({ type: 'ready-shared' });

      break;
    }
    case 'webrtc-start-success': {
      // Notify all tabs that WebRTC is ready.
      const repo = await GetSharedRepo(port.calendarId!);
      const initialized = await repo.initialized!;
      initialized.webRtcStarted = true;

      for (const tab of initialized.tabs) tab.port.postMessage({ type: 'ready-shared' });

      break;
    }
    case 'webrtc-pollalive-acq': {
      // Handled elsewhere.
      break;
    }
  }
}

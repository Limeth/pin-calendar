import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { DocHandle, isValidDocumentId, Repo, type DocumentId } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as uuid from 'uuid';
import { LocalDocumentAddPeer, LocalDocumentDefault, type LocalDocument } from '@/client';
import { type Ref } from 'vue';
import { changeSubtree, makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import {
  EphemeralDocumentDefault,
  MessagePortWrapper,
  SharedDocumentDefault,
  type DocumentWrapper,
  type EphemeralDocument,
  type SharedDocument,
} from '@/account';
import type { Hash } from '@/hash';

export type ToSharedRepoMessageInit = {
  type: 'init';
  // TODO: The ID is always generated on the shared worker. Remove it from here and from LocalStorageData.
  documentIdEphemeral: DocumentId | undefined;
  documentIdLocal: DocumentId;
  hash: Hash | undefined;
  repoEphemeralPort: MessagePort;
  repoLocalPort: MessagePort;
  repoSharedPort: MessagePort;
};

export type ToSharedRepoMessageWebRtcStartSuccess = {
  type: 'webrtc-start-success';
};

export type ToSharedRepoMessageWebRtcStopSuccess = {
  type: 'webrtc-stop-success';
};

export type ToSharedRepoMessageWebRtcPollAliveAcq = {
  type: 'webrtc-pollalive-acq';
};

export type ToSharedRepoMessage =
  | ToSharedRepoMessageInit
  | ToSharedRepoMessageWebRtcStartSuccess
  | ToSharedRepoMessageWebRtcStopSuccess
  | ToSharedRepoMessageWebRtcPollAliveAcq;

/// Sent when the ephemeral and local documents are ready to be found.
export type FromSharedRepoMessageReadyLocal = {
  type: 'ready-local';
  documentIdEphemeral: DocumentId;
  documentIdLocal: DocumentId;
};

/// Sent when the shared documents are ready to be found.
export type FromSharedRepoMessageReadyShared = {
  type: 'ready-shared';
};

export type FromSharedRepoMessageWebRtcStart = {
  type: 'webrtc-start';
  documentSharedAvailableLocallyDuringInitialization: boolean;
};

export type FromSharedRepoMessageWebRtcStop = {
  type: 'webrtc-stop';
};

export type FromSharedRepoMessageWebRtcPollAlive = {
  type: 'webrtc-pollalive';
};

export type FromSharedRepoMessage =
  | FromSharedRepoMessageReadyLocal
  | FromSharedRepoMessageReadyShared
  | FromSharedRepoMessageWebRtcStart
  | FromSharedRepoMessageWebRtcStop
  | FromSharedRepoMessageWebRtcPollAlive;

type TabMessagePort = MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>;

declare const self: SharedWorkerGlobalScope;

type Tab = {
  port: TabMessagePort;
  adapterEphemeral: MessageChannelNetworkAdapter;
  adapterLocal: MessageChannelNetworkAdapter;
  adapterShared: MessageChannelNetworkAdapter;
  timedOut: boolean;
};

class Initialized {
  docEphemeral: DocumentWrapper<EphemeralDocument>;
  docLocal: DocumentWrapper<LocalDocument>;
  documentSharedAvailableLocallyDuringInitialization: boolean;
  tabs: Tab[] = [];
  webRtcTab?: Tab;
  webRtcStarted: boolean = false;

  constructor(options: {
    docEphemeral: DocumentWrapper<EphemeralDocument>;
    docLocal: DocumentWrapper<LocalDocument>;
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

class SharedRepo {
  repoEphemeral: Repo;
  repoLocal: Repo;
  repoShared: Repo;
  initialized?: Promise<Initialized>;

  constructor() {
    this.repoEphemeral = new Repo({
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-ephemeral:' + uuid.v7()) as any,
    });
    this.repoLocal = new Repo({
      storage: new IndexedDBStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-local:' + uuid.v7()) as any,
    });
    this.repoShared = new Repo({
      storage: new IndexedDBStorageAdapter(),
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
    let docHandleLocal: DocHandle<LocalDocument>;

    if (isValidDocumentId(message.documentIdLocal)) {
      docHandleLocal = await this.repoLocal.find<LocalDocument>(message.documentIdLocal);
    } else {
      docHandleLocal = this.repoLocal.create<LocalDocument>(LocalDocumentDefault());
    }

    const docDataLocal = makeReactive(docHandleLocal) as Ref<Rop<LocalDocument>>;

    if (message.hash !== undefined && message.hash.action === 'addPeer') {
      let suggestedDocumentIdUsed;

      if (docDataLocal.value.documentIdShared === undefined) {
        console.log(`Using suggested shared document ID: ${message.hash.documentId}`);
        docDataLocal.value[changeSubtree]((local) => {
          local.documentIdShared = message.hash?.documentId;
        });
        suggestedDocumentIdUsed = true;
      } else if (message.hash.documentId === docDataLocal.value.documentIdShared) {
        console.log(
          `Suggested shared document ID matches the stored shared document ID: ${docDataLocal.value.documentIdShared}`,
        );
        suggestedDocumentIdUsed = true;
      } else {
        console.log(
          `A shared document ID was suggested (${message.hash.documentId}), but was ignored, because an existing stored shared document ID was found: ${docDataLocal.value.documentIdShared}`,
        );
        suggestedDocumentIdUsed = false;
      }

      if (suggestedDocumentIdUsed)
        LocalDocumentAddPeer(docDataLocal.value, {
          peerJsPeerId: message.hash.peerJsPeerId,
          deviceName: '', // TODO
        });
    }

    let documentSharedAvailableLocally;

    if (docDataLocal.value.documentIdShared === undefined) {
      const docHandleShared = this.repoShared.create<SharedDocument>(SharedDocumentDefault());
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
      const repo = await repoPromise;
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
            const tab = responsiveTabs[tabIndex];
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
        data: docDataLocal,
      },
      documentSharedAvailableLocally,
    });
  }

  async addTab(message: ToSharedRepoMessageInit, port: TabMessagePort) {
    const initialized = await this.initialize(message);

    // be careful to not accidentally create a strong reference to port
    // that will prevent dead ports from being garbage collected
    const adapterEphemeral = new MessageChannelNetworkAdapter(message.repoEphemeralPort, {
      useWeakRef: true,
    });
    const adapterLocal = new MessageChannelNetworkAdapter(message.repoLocalPort, {
      useWeakRef: true,
    });
    const adapterShared = new MessageChannelNetworkAdapter(message.repoSharedPort, {
      useWeakRef: true,
    });

    this.repoEphemeral.networkSubsystem.addNetworkAdapter(adapterEphemeral);
    this.repoLocal.networkSubsystem.addNetworkAdapter(adapterLocal);
    this.repoShared.networkSubsystem.addNetworkAdapter(adapterShared);

    initialized.tabs.push({ port, adapterEphemeral, adapterLocal, adapterShared, timedOut: false });
  }
}

// Because automerge is a WASM module and loads asynchronously,
// a bug in Chrome causes the 'connect' event to fire before the
// module is loaded. This promise lets us block until the module loads
// even if the event arrives first.
// Ideally Chrome would fix this upstream but this isn't a terrible hack.
const repoPromise = (async () => {
  return new SharedRepo();
})();

self.onconnect = (eventConnect: MessageEvent) => {
  console.log('connect', eventConnect);

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
      const repo = await repoPromise;
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
      const repo = await repoPromise;
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

import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { DocHandle, isValidDocumentId, Repo, type DocumentId } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as uuid from 'uuid';
import { WebRtcNetworkAdapter } from '@/webrtc';
import { LocalDocumentDefault, type LocalDocument } from '@/client';
import { ref, toRef, type Ref } from 'vue';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import {
  EphemeralDocumentDefault,
  MessagePortWrapper,
  type DocumentWrapper,
  type EphemeralDocument,
} from '@/account';

export type ToSharedRepoMessageInit = {
  type: 'init';
  documentIdEphemeral: DocumentId | undefined;
  documentIdLocal: DocumentId;
  repoEphemeralPort: MessagePort;
  repoLocalPort: MessagePort;
  repoSharedPort: MessagePort;
};

export type ToSharedRepoMessageWebRtcPollAliveAcq = {
  type: 'webrtc-pollalive-acq';
};

export type ToSharedRepoMessage = ToSharedRepoMessageInit | ToSharedRepoMessageWebRtcPollAliveAcq;

export type FromSharedRepoMessageReady = {
  type: 'ready';
  documentIdEphemeral: DocumentId;
  documentIdLocal: DocumentId;
};

export type FromSharedRepoMessageWebRtcStart = {
  type: 'webrtc-start';
};

export type FromSharedRepoMessageWebRtcStop = {
  type: 'webrtc-stop';
};

export type FromSharedRepoMessageWebRtcPollAlive = {
  type: 'webrtc-pollalive';
};

export type FromSharedRepoMessage = FromSharedRepoMessageReady | FromSharedRepoMessageWebRtcStart | FromSharedRepoMessageWebRtcStop | FromSharedRepoMessageWebRtcPollAlive;

type TabMessagePort = MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>;

declare const self: SharedWorkerGlobalScope;

type Tab = {
  port: WeakRef<TabMessagePort>,
  adapterEphemeral: MessageChannelNetworkAdapter,
  adapterLocal: MessageChannelNetworkAdapter,
  adapterShared: MessageChannelNetworkAdapter,
}

class Initialized {
  docEphemeral: DocumentWrapper<EphemeralDocument>;
  docLocal: DocumentWrapper<LocalDocument>;
  tabs: Tab[] = [];
  /// The WebRTC tab is identified by its port.
  webRtcTab?: WeakRef<TabMessagePort>;

  constructor(
    options: {
      docEphemeral: DocumentWrapper<EphemeralDocument>,
      docLocal: DocumentWrapper<LocalDocument>,
    }
  ) {
    this.docEphemeral = options.docEphemeral;
    this.docLocal = options.docLocal;
  }

  cleanupClosedTabs() {
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      const tab = this.tabs[i];
      const port = tab.port.deref();
      if (port === undefined) {
        this.tabs.splice(i, 1);
        console.warn("Cleaning up closed tab.", tab);
      }
    }
  }
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

    /// Launch a task that ensures a WebRTC network adapter is running on exactly one tab at any point.
    (async () => {
      const POLL_INTERVAL_MS = 1000;
      const POLL_TIMEOUT_MS = 4000;
      const repo = await repoPromise;
      const initialized = await repo.initialized!;

      while (true) {
        const webRtcRunning = await (async () => {
          if (initialized.webRtcTab === undefined)
            return false;

          const webRtcTab = initialized.webRtcTab.deref();

          if (webRtcTab === undefined) {
            console.warn("WebRTC tab closed.");
            return false;
          }

          const alivePromise = Promise.any([
            webRtcTab.onceAsync((message) => message.type === 'webrtc-pollalive-acq').then(() => true),
            new Promise(r => setTimeout(r, POLL_TIMEOUT_MS)).then(() => false),
          ]);

          webRtcTab.postMessage({ type: 'webrtc-pollalive' })

          if (await alivePromise)
            return true;

          console.warn("WebRTC pollalive timed out.");
          webRtcTab.postMessage({ type: 'webrtc-stop' });
          return false;
        })();

        if (!webRtcRunning) {
          initialized.webRtcTab = undefined;

          initialized.cleanupClosedTabs();

          if (initialized.tabs.length > 0) {
            const tabIndex = Math.floor(Math.random() * initialized.tabs.length)
            const tab = initialized.tabs[tabIndex];
            const port = tab.port.deref();

            if (port !== undefined) {
              initialized.webRtcTab = tab.port;
              port.postMessage({
                type: 'webrtc-start',
              })
            }
          }
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
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
    });
  }

  async addTab(message: ToSharedRepoMessageInit, port: TabMessagePort) {
    const initialized = await this.initialize(message);

    // be careful to not accidentally create a strong reference to port
    // that will prevent dead ports from being garbage collected
    const adapterEphemeral = new MessageChannelNetworkAdapter(message.repoEphemeralPort, { useWeakRef: true });
    const adapterLocal = new MessageChannelNetworkAdapter(message.repoLocalPort, { useWeakRef: true });
    const adapterShared = new MessageChannelNetworkAdapter(message.repoSharedPort, { useWeakRef: true });

    this.repoEphemeral.networkSubsystem.addNetworkAdapter(adapterEphemeral);
    this.repoLocal.networkSubsystem.addNetworkAdapter(adapterLocal);
    this.repoShared.networkSubsystem.addNetworkAdapter(adapterShared);

    initialized.tabs.push({ port: new WeakRef(port), adapterEphemeral, adapterLocal, adapterShared, })
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

async function onMessage(
  message: ToSharedRepoMessage,
  port: TabMessagePort,
) {
  switch (message.type) {
    case 'init':
      {
        const repo = await repoPromise;
        const initialized = await repo.initialize(message);

        repo.addTab(message, port);
        port.postMessage({
          type: 'ready',
          documentIdEphemeral: initialized.docEphemeral.handle.documentId,
          documentIdLocal: initialized.docLocal.handle.documentId,
        });
        break;
      }
    case 'webrtc-pollalive-acq':
      {
        // Handled elsewhere.
        break;
      }
  }
}

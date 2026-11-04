// The code of the shared worker, imported by its entry, `sharedRepo.ts`.
import {
  isValidDocumentId,
  Repo,
  type DocHandle,
  type DocumentId,
  type StorageAdapterInterface,
} from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import type { Rop } from 'automerge-diy-vue-hooks';
import * as uuid from 'uuid';
import {
  LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT,
  LocalDocumentDefault,
  LocalDocumentGetCurrentVersion,
  LocalDocumentGetDocumentIdShared,
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
import { hasNewerVersionRop, makeVersioned, NewerVersionError, type Versioned } from '@/versioned';

export function EphemeralDocumentDefault(): EphemeralDocument {
  return {
    connectedPeers: {},
    invites: {},
    outgoingJoins: {},
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
  readySharedPosted: boolean;
  // Resolved when the tab is closed, see `SharedRepo.removeTab`.
  closed: Promise<void>;
  onClosed: () => void;
};

function postReadyShared(tab: Tab) {
  if (!tab.readySharedPosted) {
    tab.port.postMessage({ type: 'ready-shared' });
    tab.readySharedPosted = true;
  }
}

export type SharedRepoWorkerOptions = {
  // How often the tab hosting WebRTC is polled, and how long it has to reply.
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  // How long a deleted document is left to be saved, see `deleteDocument`.
  documentSaveDelayMs?: number;
  // The storage of the local and shared documents.
  createStorageAdapter?: () => StorageAdapterInterface;
};

const SHARED_REPO_WORKER_OPTIONS_DEFAULT: Required<SharedRepoWorkerOptions> = {
  pollIntervalMs: 1_000,
  pollTimeoutMs: 4_000,
  // Longer than the repo waits before saving a changed document (`saveDebounceRate`, 100 ms by
  // default), and for the save to finish.
  documentSaveDelayMs: 1_000,
  createStorageAdapter: () => new IndexedDBStorageAdapter(),
};

class Initialized {
  docEphemeral: DocumentWrapper<EphemeralDocument>;
  docLocal: VersionedDocumentWrapper<LocalDocument>;
  documentSharedAvailableLocallyDuringInitialization: boolean;
  tabs: Tab[] = [];
  webRtcTab?: Tab;
  webRtcStarted: boolean = false;
  // Whether WebRTC was shut down for good, as the calendar was deleted, see `SharedRepo.delete`.
  // Then, it is not started in any tab anymore.
  webRtcShutDown: boolean = false;

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
}

/// There's a separate SharedRepo for each distinct calendar.
class SharedRepo {
  calendarId: CalendarId;
  repoEphemeral: Repo;
  repoLocal: Repo;
  repoShared: Repo;
  initialized?: Promise<Initialized>;
  options: Required<SharedRepoWorkerOptions>;

  constructor(calendarId: CalendarId, options: Required<SharedRepoWorkerOptions>) {
    this.calendarId = calendarId;
    this.options = options;
    this.repoEphemeral = new Repo({
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-ephemeral:' + uuid.v7()) as any,
    });
    this.repoLocal = new Repo({
      storage: options.createStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-local:' + uuid.v7()) as any,
    });
    this.repoShared = new Repo({
      storage: options.createStorageAdapter(),
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

    if (isValidDocumentId(message.documentIdLocal)) {
      docHandleLocal = await this.repoLocal.find<Versioned<LocalDocument>>(message.documentIdLocal);
    } else {
      const localDocument = LocalDocumentDefault(message.invitation?.localPeerId);

      // The invitation is only applied when the local document is created. Afterwards, the local
      // document is the source of truth: e.g. the inviter must not be added again after the user
      // forgets it.
      if (message.invitation !== undefined) {
        localDocument.documentIdShared = message.invitation.documentIdShared;
        localDocument.remotePeers[message.invitation.invitedBy] = {
          // Named by the user, see `LocalDocumentSetRemotePeerName`.
          deviceName: '',
          authKeyId: message.invitation.authKeyId,
        };
      }

      docHandleLocal = this.repoLocal.create<Versioned<LocalDocument>>(
        makeVersioned(localDocument, LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT),
      );
    }

    const docDataLocalVersioned: Ref<Rop<Versioned<LocalDocument>>> = makeReactive(docHandleLocal);
    const docDataLocal = computed(() =>
      LocalDocumentGetCurrentVersion(docDataLocalVersioned, message.invitation?.localPeerId),
    );

    let documentSharedAvailableLocally;
    // A local document with only newer versions throws a `NewerVersionError` here, which is reported
    // to the tabs, see `init-failed`. Only a newer version of the app on this device could cause it,
    // by removing the current version, which it must not.
    const documentIdShared = LocalDocumentGetDocumentIdShared(docDataLocal.value);

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
    } else if (documentIdShared === undefined) {
      // Not replaced by a new document, which would lose the calendar's data. It is not opened,
      // see `LoadApp`.
      console.error('The shared document ID is invalid.');
      documentSharedAvailableLocally = false;
    } else {
      /// Attempt to find the document in the local database, before any network adapters are added to the repo.
      try {
        console.log(`Attempting to find shared document by ID ${documentIdShared}`);
        await this.repoShared.find<SharedDocument>(documentIdShared as DocumentId);
        console.log(`Successfully found shared document by ID ${documentIdShared}`);
        documentSharedAvailableLocally = true;
      } catch {
        console.log(`Failed to find shared document by ID ${documentIdShared}`);
        documentSharedAvailableLocally = false;
      }
    }

    const initialized = new Initialized({
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
        readOnly: computed(() =>
          hasNewerVersionRop(docDataLocalVersioned, LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT),
        ),
      },
      documentSharedAvailableLocally,
    });

    void this.keepWebRtcRunning(initialized);
    return initialized;
  }

  /// Ensures that a WebRTC network adapter is running in exactly one tab at any point, until WebRTC
  /// is shut down. The tab hosting it is polled, as a tab that stopped responding, e.g. as it was
  /// frozen, keeps its tab lock, see `removeTab`.
  async keepWebRtcRunning(initialized: Initialized) {
    while (!initialized.webRtcShutDown) {
      const webRtcTab = initialized.webRtcTab;
      const webRtcRunning =
        webRtcTab !== undefined &&
        (await (async () => {
          const alivePromise = Promise.race([
            webRtcTab.port
              .onceAsync((message) => message.type === 'webrtc-pollalive-acq')
              .then(() => true),
            new Promise((r) => setTimeout(r, this.options.pollTimeoutMs)).then(() => false),
            // Not waiting for the timeout, so that WebRTC is moved to another tab right away.
            webRtcTab.closed.then(() => false),
          ]);

          webRtcTab.port.postMessage({
            type: 'webrtc-pollalive',
          });

          if (await alivePromise) return true;
          if (!initialized.tabs.includes(webRtcTab)) return false;

          console.warn('WebRTC pollalive timed out.');
          webRtcTab.port.postMessage({ type: 'webrtc-stop' });
          webRtcTab.timedOut = true;
          return false;
        })());

      // Shut down while the tab was being polled.
      if (initialized.webRtcShutDown) break;

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
          console.log(`Requesting a WebRTC client to be hosted in tab #${tabIndex}.`);
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

      await new Promise((r) => setTimeout(r, this.options.pollIntervalMs));
    }
  }

  async addTab(message: ToSharedRepoMessageInit, port: TabMessagePort): Promise<Tab> {
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

    let onClosed!: () => void;
    const closed = new Promise<void>((resolve) => (onClosed = resolve));
    const tab: Tab = {
      port,
      adapterEphemeral,
      adapterLocal,
      adapterShared,
      timedOut: false,
      readySharedPosted: false,
      closed,
      onClosed,
    };

    initialized.tabs.push(tab);
    // Granted once the tab is closed, see `holdTabLock`.
    void navigator.locks.request(message.tabLockName, () => this.removeTab(initialized, tab));

    return tab;
  }

  // Forget a closed tab: stop synchronizing the documents with it, and move WebRTC to another tab if
  // it was hosting it, see `keepWebRtcRunning`.
  removeTab(initialized: Initialized, tab: Tab) {
    const index = initialized.tabs.indexOf(tab);

    // Already forgotten, as the calendar was deleted.
    if (index === -1) return;

    initialized.tabs.splice(index, 1);
    this.repoEphemeral.networkSubsystem.removeNetworkAdapter(tab.adapterEphemeral);
    this.repoLocal.networkSubsystem.removeNetworkAdapter(tab.adapterLocal);
    this.repoShared.networkSubsystem.removeNetworkAdapter(tab.adapterShared);

    if (initialized.webRtcTab === tab) initialized.webRtcTab = undefined;

    tab.onClosed();
    console.log('A tab of the calendar was closed.');
  }

  // Delete the calendar's documents from storage, see `ToSharedRepoMessageDeleteCalendar`.
  async delete() {
    const initialized = await this.initialized!;

    // Ends the task that keeps WebRTC running in one of the tabs.
    initialized.webRtcShutDown = true;
    initialized.webRtcTab?.port.postMessage({ type: 'webrtc-stop' });
    initialized.webRtcTab = undefined;

    // Disconnected first, so that the tabs' copies of the documents are not synchronized back, which
    // would store them again.
    for (const tab of initialized.tabs) {
      this.repoEphemeral.networkSubsystem.removeNetworkAdapter(tab.adapterEphemeral);
      this.repoLocal.networkSubsystem.removeNetworkAdapter(tab.adapterLocal);
      this.repoShared.networkSubsystem.removeNetworkAdapter(tab.adapterShared);
    }

    initialized.tabs = [];

    const documentIdShared = LocalDocumentGetDocumentIdShared(initialized.docLocal.data.value);

    await Promise.all([
      documentIdShared !== undefined && isValidDocumentId(documentIdShared)
        ? deleteDocument(this.repoShared, documentIdShared, this.options.documentSaveDelayMs)
        : undefined,
      deleteDocument(
        this.repoLocal,
        initialized.docLocal.handle.documentId,
        this.options.documentSaveDelayMs,
      ),
      deleteDocument(
        this.repoEphemeral,
        initialized.docEphemeral.handle.documentId,
        this.options.documentSaveDelayMs,
      ),
    ]);
  }
}

// Delete a document, also from storage.
//
// Works around a bug in automerge-repo (2.5.5, and still in 2.6.0-alpha.5): `Repo.delete` removes
// the document from storage, but does not cancel its pending throttled save, which then stores it
// again. Saves are pending for changes made just before, and for the deletion itself, which empties
// the document (`A.init()`) before removing it. So the document is removed again once these saves
// are done (`saveDelayMs`), as it cannot change anymore. Only `Repo.delete` is needed once this is
// fixed.
async function deleteDocument(repo: Repo, documentId: DocumentId, saveDelayMs: number) {
  repo.delete(documentId);
  await new Promise((resolve) => setTimeout(resolve, saveDelayMs));
  await repo.storageSubsystem?.removeDoc(documentId);
}

/// The shared worker's state: the calendars opened by its tabs. The worker's entry creates one;
/// tests create one for each test.
export class SharedRepoWorker {
  options: Required<SharedRepoWorkerOptions>;
  sharedRepoByCalendarId = new Map<CalendarId, SharedRepo>();

  constructor(options: SharedRepoWorkerOptions = {}) {
    this.options = { ...SHARED_REPO_WORKER_OPTIONS_DEFAULT, ...options };
  }

  // Connect a tab, which then sends `init`.
  onConnect(port: MessagePort) {
    const wrapper = new MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>(port);

    wrapper.on((message) => {
      void this.onMessage(message, wrapper);
    });

    wrapper.start();
  }

  // Stops the tasks keeping WebRTC running, e.g. at the end of a test. The worker is not used
  // afterwards.
  async close() {
    for (const repo of this.sharedRepoByCalendarId.values()) {
      const initialized = await repo.initialized?.catch(() => undefined);

      if (initialized !== undefined) initialized.webRtcShutDown = true;
    }
  }

  getSharedRepo(calendarId: CalendarId): SharedRepo {
    let repo = this.sharedRepoByCalendarId.get(calendarId);

    if (repo === undefined) {
      repo = new SharedRepo(calendarId, this.options);
      this.sharedRepoByCalendarId.set(calendarId, repo);
    }

    return repo;
  }

  // The repo of the tab's calendar, if the tab initialized it, and it was not deleted since.
  getInitializedSharedRepo(port: TabMessagePort): SharedRepo | undefined {
    if (port.calendarId === undefined) return undefined;

    const repo = this.sharedRepoByCalendarId.get(port.calendarId);

    return repo?.initialized !== undefined ? repo : undefined;
  }

  async onMessage(message: ToSharedRepoMessage, port: TabMessagePort) {
    switch (message.type) {
      case 'init': {
        port.calendarId = message.calendarId;
        const repo = this.getSharedRepo(port.calendarId);
        let initialized;

        try {
          initialized = await repo.initialize(message);
        } catch (error) {
          // The tab shows why the calendar cannot be loaded. The failed initialization is kept, so
          // that every tab of the calendar is told, until the page is refreshed.
          console.error(`Failed to initialize calendar ${port.calendarId}:`, error);
          port.postMessage({
            type: 'init-failed',
            newerVersion: error instanceof NewerVersionError,
            message: error instanceof Error ? error.message : String(error),
          });
          break;
        }

        const tab = await repo.addTab(message, port);

        // Only once the tab's repos are connected to the worker's: a tab's repo that finds no peer
        // reports the documents as unavailable. The worker's adapters connect only after their
        // repo's storage ID is loaded, which a new calendar's initialization does not wait for.
        await Promise.all(
          [tab.adapterEphemeral, tab.adapterLocal, tab.adapterShared].map((adapter) =>
            adapter.whenReady(),
          ),
        );

        port.postMessage({
          type: 'ready-local',
          documentIdEphemeral: initialized.docEphemeral.handle.documentId,
          documentIdLocal: initialized.docLocal.handle.documentId,
        });

        if (initialized.webRtcStarted) postReadyShared(tab);

        break;
      }
      case 'webrtc-start-success': {
        const repo = this.getInitializedSharedRepo(port);

        if (repo === undefined) break;

        // Notify all tabs that WebRTC is ready.
        const initialized = await repo.initialized!;
        initialized.webRtcStarted = true;

        for (const tab of initialized.tabs) postReadyShared(tab);

        break;
      }
      case 'webrtc-pollalive-acq': {
        // Handled elsewhere.
        break;
      }
      case 'delete-calendar': {
        const repo = this.getInitializedSharedRepo(port);

        if (repo === undefined) break;

        // Forgotten right away, so that messages from the calendar's other tabs are ignored, and
        // joining the calendar again initializes it anew.
        this.sharedRepoByCalendarId.delete(repo.calendarId);
        await repo.delete();
        console.log(`Calendar ${repo.calendarId} was deleted from this device.`);
        break;
      }
    }
  }
}

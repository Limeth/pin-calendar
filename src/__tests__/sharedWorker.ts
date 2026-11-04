import { Repo, type DocumentId } from '@automerge/automerge-repo';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import * as uuid from 'uuid';
import type { Ref } from 'vue';
import {
  LocalDocumentGetCurrentVersion,
  LocalDocumentGetDocumentIdShared,
  type CalendarId,
  type LocalDocument,
} from '@/documents/local';
import type { Invitation } from '@/localStorageData';
import {
  MessagePortWrapper,
  type FromSharedRepoMessage,
  type ToSharedRepoMessage,
} from '@/workerMessages';
import type { Versioned } from '@/versioned';
import { SharedRepoWorker, type SharedRepoWorkerOptions } from '@/workers/sharedRepoMain';
import { CALENDAR_ID, until } from './helpers';

// The shared worker's code, run in the test rather than in a `SharedWorker`, with its own storage
// and short polling intervals. Tabs connect to it via `MessageChannel`s, as in the app.
export class TestWorker {
  // The IndexedDB database of the worker's documents, which other workers may open, as after a
  // page is refreshed.
  readonly database: string;
  readonly worker: SharedRepoWorker;
  readonly tabs: TestTab[] = [];

  constructor(options: SharedRepoWorkerOptions & { database?: string } = {}) {
    this.database = options.database ?? `automerge-${uuid.v7()}`;
    this.worker = new SharedRepoWorker({
      pollIntervalMs: 20,
      pollTimeoutMs: 200,
      createStorageAdapter: () => new IndexedDBStorageAdapter(this.database),
      ...options,
    });
  }

  // The worker's storage, to look at the documents it stored.
  storage(): IndexedDBStorageAdapter {
    return new IndexedDBStorageAdapter(this.database);
  }

  // Whether any data of the document is in storage.
  async isStored(documentId: DocumentId): Promise<boolean> {
    return (await this.storage().loadRange([documentId])).length > 0;
  }

  // Open a calendar in a tab. Calendars opened in the same tab share its lock.
  openTab(lock = new TestTabLock()): TestTab {
    const tab = new TestTab(this.worker, lock);
    this.tabs.push(tab);
    return tab;
  }

  // The number of the calendar's tabs that the worker knows.
  async tabCount(calendarId: CalendarId = CALENDAR_ID): Promise<number> {
    const initialized = await this.worker.sharedRepoByCalendarId.get(calendarId)!.initialized!;
    return initialized.tabs.length;
  }

  async close() {
    for (const tab of this.tabs) tab.close();
    await this.worker.close();
  }
}

// The lock that a tab holds until it is closed, shared by the calendars opened in it, see
// `holdTabLock`.
export class TestTabLock {
  readonly name = `test-tab:${uuid.v7()}`;
  readonly held: Promise<void>;
  #release?: () => void;
  #released = false;

  constructor() {
    this.held = new Promise((resolve) => {
      void navigator.locks.request(this.name, () => {
        resolve();
        if (this.#released) return;

        return new Promise<void>((release) => (this.#release = release));
      });
    });
  }

  // As by the browser when the tab is closed.
  release() {
    this.#released = true;
    this.#release?.();
  }
}

// A calendar opened in a tab of the app, connected to the shared worker. It records the worker's
// messages, answers its polls while `answersPolls` (as a frozen tab does not), and leaves the other
// replies to the test.
export class TestTab {
  readonly port: MessagePortWrapper<ToSharedRepoMessage, FromSharedRepoMessage>;
  readonly received: FromSharedRepoMessage[] = [];
  answersPolls = true;
  readonly repoEphemeral: Repo;
  readonly repoLocal: Repo;
  readonly repoShared: Repo;
  readonly #channels: MessageChannel[];
  readonly #repoPorts: [MessagePort, MessagePort, MessagePort];
  readonly lock: TestTabLock;

  constructor(worker: SharedRepoWorker, lock: TestTabLock) {
    this.lock = lock;
    const channelWorker = new MessageChannel();
    const channelEphemeral = new MessageChannel();
    const channelLocal = new MessageChannel();
    const channelShared = new MessageChannel();

    this.#channels = [channelWorker, channelEphemeral, channelLocal, channelShared];
    this.#repoPorts = [channelEphemeral.port2, channelLocal.port2, channelShared.port2];
    this.repoEphemeral = new Repo({
      network: [new MessageChannelNetworkAdapter(channelEphemeral.port1)],
    });
    this.repoLocal = new Repo({ network: [new MessageChannelNetworkAdapter(channelLocal.port1)] });
    this.repoShared = new Repo({
      network: [new MessageChannelNetworkAdapter(channelShared.port1)],
    });

    this.port = new MessagePortWrapper(channelWorker.port1);
    this.port.on((message) => {
      this.received.push(message);

      if (message.type === 'webrtc-pollalive' && this.answersPolls)
        this.port.postMessage({ type: 'webrtc-pollalive-acq' });
    });
    this.port.start();
    worker.onConnect(channelWorker.port2);
  }

  // Sent once the tab lock is held, as in the app.
  init(calendarId: CalendarId, documentIdLocal?: DocumentId, invitation?: Invitation) {
    const [repoEphemeralPort, repoLocalPort, repoSharedPort] = this.#repoPorts;

    void this.lock.held.then(() => {
      this.port.postMessage(
        {
          type: 'init',
          calendarId,
          tabLockName: this.lock.name,
          documentIdLocal: documentIdLocal as DocumentId,
          invitation,
          repoEphemeralPort,
          repoLocalPort,
          repoSharedPort,
        },
        this.#repoPorts,
      );
    });
  }

  // The messages of a type received so far.
  messages<T extends FromSharedRepoMessage['type']>(
    type: T,
  ): Extract<FromSharedRepoMessage, { type: T }>[] {
    return this.received.filter(
      (message): message is Extract<FromSharedRepoMessage, { type: T }> => message.type === type,
    );
  }

  // Wait for the first message of a type.
  async message<T extends FromSharedRepoMessage['type']>(
    type: T,
  ): Promise<Extract<FromSharedRepoMessage, { type: T }>> {
    if (!(await until(() => this.messages(type).length > 0)))
      throw new Error(`The tab did not receive \`${type}\`.`);

    return this.messages(type)[0]!;
  }

  // Whether the worker started WebRTC in the tab, and did not stop it since.
  get hostsWebRtc(): boolean {
    return this.messages('webrtc-start').length > this.messages('webrtc-stop').length;
  }

  // The ID of the calendar's shared document, read from the local document, as the app does.
  async documentIdShared(): Promise<DocumentId> {
    const { documentIdLocal } = await this.message('ready-local');
    const handle = await this.repoLocal.find<Versioned<LocalDocument>>(documentIdLocal);
    const versioned = makeReactive(handle) as Ref<Rop<Versioned<LocalDocument>>>;
    const documentIdShared = LocalDocumentGetDocumentIdShared(
      LocalDocumentGetCurrentVersion(versioned, undefined),
    );

    if (documentIdShared === undefined) throw new Error('The shared document ID is not set.');

    return documentIdShared as DocumentId;
  }

  // Closed as by the browser, which releases the tab lock. Close the tab's other calendars, too.
  close() {
    this.lock.release();

    for (const channel of this.#channels) {
      channel.port1.close();
      channel.port2.close();
    }
  }
}

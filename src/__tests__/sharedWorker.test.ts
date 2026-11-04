import { afterEach, describe, expect, it } from 'vitest';
import { Repo, type DocumentId } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as uuid from 'uuid';
import { LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT, type LocalDocument } from '@/documents/local';
import type { Versioned } from '@/versioned';
import { CALENDAR_ID, OTHER_CALENDAR_ID, sleep, until } from './helpers';
import { TestTabLock, TestWorker, type TestTab } from './sharedWorker';
import type { SharedRepoWorkerOptions } from '@/workers/sharedRepoMain';

const workers: TestWorker[] = [];

function testWorker(database?: string, options: SharedRepoWorkerOptions = {}): TestWorker {
  const worker = new TestWorker({ database, ...options });
  workers.push(worker);
  return worker;
}

afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.close();
});

// Open a calendar in tabs, one after another, as when the user opens them.
async function openTabs(worker: TestWorker, count: number): Promise<TestTab[]> {
  const tabs = [];
  let documentIdLocal: DocumentId | undefined;

  for (let i = 0; i < count; i++) {
    const tab = worker.openTab();
    tab.init(CALENDAR_ID, documentIdLocal);
    documentIdLocal = (await tab.message('ready-local')).documentIdLocal;
    tabs.push(tab);
  }

  return tabs;
}

// The tab hosting WebRTC, once the worker started it more than `startsBefore` times.
async function webRtcTab(tabs: TestTab[], startsBefore = 0): Promise<TestTab> {
  const starts = () => tabs.flatMap((tab) => tab.messages('webrtc-start')).length;
  const hosting = () => tabs.filter((tab) => tab.hostsWebRtc);

  expect(await until(() => starts() > startsBefore && hosting().length === 1)).toBe(true);
  return hosting()[0]!;
}

describe('opening a calendar', () => {
  it('creates and stores the documents of a new calendar', async () => {
    const worker = testWorker();
    const [tab] = await openTabs(worker, 1);
    const { documentIdLocal } = await tab!.message('ready-local');
    const shared = await tab!.documentIdShared();

    expect(await until(() => worker.isStored(documentIdLocal))).toBe(true);
    expect(await until(() => worker.isStored(shared))).toBe(true);
  });

  it('is ready once the tab is connected, also when the storage is slow', async () => {
    // How long a `MessageChannelNetworkAdapter` waits for its peer before it is ready anyway.
    const ADAPTER_READY_TIMEOUT_MS = 100;
    const database = `automerge-${uuid.v7()}`;
    // The worker's adapters connect once their repo's storage ID is loaded.
    const worker = testWorker(database, {
      createStorageAdapter: () => {
        const adapter = new IndexedDBStorageAdapter(database);
        const load = adapter.load.bind(adapter);

        adapter.load = async (key) => {
          if (key[0] === 'storage-adapter-id') await sleep(2 * ADAPTER_READY_TIMEOUT_MS);

          return load(key);
        };

        return adapter;
      },
    });
    const [tab] = await openTabs(worker, 1);

    // Found via the worker, rather than reported as unavailable by a tab's repo with no peers.
    await tab!.documentIdShared();
  });

  it('opens the documents stored by an earlier worker', async () => {
    const earlier = testWorker();
    const [earlierTab] = await openTabs(earlier, 1);
    const { documentIdLocal } = await earlierTab!.message('ready-local');
    const shared = await earlierTab!.documentIdShared();

    expect(await until(() => earlier.isStored(documentIdLocal))).toBe(true);
    await earlier.close();

    // As after the page is refreshed.
    const worker = testWorker(earlier.database);
    const tab = worker.openTab();

    tab.init(CALENDAR_ID, documentIdLocal);
    expect((await tab.message('ready-local')).documentIdLocal).toBe(documentIdLocal);
    expect(await tab.documentIdShared()).toBe(shared);
  });

  it('opens the same documents in all tabs of the calendar', async () => {
    const [first, second] = await openTabs(testWorker(), 2);

    expect(await second!.message('ready-local')).toEqual(await first!.message('ready-local'));
  });

  it('tells the tab when the local document only has newer versions', async () => {
    const worker = testWorker();
    const repo = new Repo({ network: [], storage: new IndexedDBStorageAdapter(worker.database) });
    const handle = repo.create<Versioned<LocalDocument>>({
      schemaVersion: { [JSON.stringify(LOCAL_DOCUMENT_SCHEMA_VERSION_CURRENT + 1)]: {} },
    });
    await repo.flush([handle.documentId]);
    const tab = worker.openTab();

    tab.init(CALENDAR_ID, handle.documentId);
    expect(await tab.message('init-failed')).toMatchObject({ newerVersion: true });
    expect(tab.messages('ready-local')).toEqual([]);
  });
});

describe('closing a tab', () => {
  it('forgets the tab', async () => {
    const worker = testWorker();
    const tabs = await openTabs(worker, 2);

    tabs[1]!.close();
    expect(await until(async () => (await worker.tabCount()) === 1)).toBe(true);
  });

  it('keeps synchronizing the documents with the other tabs', async () => {
    const worker = testWorker();
    const [first, second] = await openTabs(worker, 2);
    const documentIdShared = await first!.documentIdShared();

    first!.close();
    expect(await until(async () => (await worker.tabCount()) === 1)).toBe(true);

    const handle = await second!.repoShared.find<{ value?: number }>(documentIdShared);
    handle.change((doc) => {
      doc.value = 1;
    });
    const later = worker.openTab();
    later.init(CALENDAR_ID, (await second!.message('ready-local')).documentIdLocal);
    const laterHandle = await later.repoShared.find<{ value?: number }>(documentIdShared);
    expect(await until(() => laterHandle.doc().value === 1)).toBe(true);
  });

  it('forgets the tab in all of the calendars opened in it', async () => {
    const worker = testWorker();
    const lock = new TestTabLock();
    const first = worker.openTab(lock);
    const second = worker.openTab(lock);

    first.init(CALENDAR_ID);
    second.init(OTHER_CALENDAR_ID);
    const { documentIdLocal } = await first.message('ready-local');
    await second.message('ready-local');
    const other = worker.openTab();
    other.init(CALENDAR_ID, documentIdLocal);
    await other.message('ready-local');

    first.close();
    second.close();
    expect(await until(async () => (await worker.tabCount()) === 1)).toBe(true);
    expect(await until(async () => (await worker.tabCount(OTHER_CALENDAR_ID)) === 0)).toBe(true);
  });

  it('forgets a tab closed while it was opening the calendar', async () => {
    const worker = testWorker();
    const tab = worker.openTab();

    tab.init(CALENDAR_ID);
    // `init` is posted once the lock is held. The lock is released before the worker requests it,
    // and the ports are left open, so that the worker still receives `init`.
    await tab.lock.held;
    tab.lock.release();
    const { documentIdLocal } = await tab.message('ready-local');
    expect(await until(async () => (await worker.tabCount()) === 0)).toBe(true);

    // Not hosting WebRTC, as it would otherwise not be started in another tab.
    const later = worker.openTab();
    later.init(CALENDAR_ID, documentIdLocal);
    await later.message('webrtc-start');
  });

  it('starts WebRTC in a tab opened after the last one was closed', async () => {
    const worker = testWorker();
    const [tab] = await openTabs(worker, 1);
    const { documentIdLocal } = await tab!.message('ready-local');

    await tab!.message('webrtc-start');
    tab!.close();
    expect(await until(async () => (await worker.tabCount()) === 0)).toBe(true);
    await sleep(100); // Several polls without tabs.

    const later = worker.openTab();
    later.init(CALENDAR_ID, documentIdLocal);
    await later.message('webrtc-start');
  });
});

describe('WebRTC', () => {
  it('is started in one of the tabs', async () => {
    const tabs = await openTabs(testWorker(), 3);

    await webRtcTab(tabs);
    await sleep(200); // Several polls.
    expect(tabs.flatMap((tab) => tab.messages('webrtc-start'))).toHaveLength(1);
    expect(tabs.flatMap((tab) => tab.messages('webrtc-stop'))).toEqual([]);
  });

  it('is reported as ready to all tabs, also to those opened afterwards', async () => {
    const worker = testWorker();
    const tabs = await openTabs(worker, 2);

    expect(tabs.flatMap((tab) => tab.messages('ready-shared'))).toEqual([]);
    (await webRtcTab(tabs)).port.postMessage({ type: 'webrtc-start-success' });

    for (const tab of tabs) await tab.message('ready-shared');

    const later = worker.openTab();
    later.init(CALENDAR_ID, (await tabs[0]!.message('ready-local')).documentIdLocal);
    await later.message('ready-shared');
  });

  it('is moved to another tab when its tab stops answering', async () => {
    const worker = testWorker();
    const tabs = await openTabs(worker, 2);
    const first = await webRtcTab(tabs);

    first.answersPolls = false;

    const second = await webRtcTab(tabs, 1);
    expect(second).not.toBe(first);
    expect(first.messages('webrtc-stop')).toHaveLength(1);
    // Kept, as it may only be frozen.
    expect(await worker.tabCount()).toBe(2);
  });

  it('is moved to another tab right away when its tab is closed', async () => {
    // Only the tab lock can tell that the tab is gone before the test times out.
    const tabs = await openTabs(testWorker(undefined, { pollTimeoutMs: 60_000 }), 2);
    const first = await webRtcTab(tabs);

    first.close();
    // The closed tab is not told to stop.
    await webRtcTab(tabs.filter((tab) => tab !== first));
  });

  it('is moved back to a tab that stopped answering when the other tabs are closed', async () => {
    const tabs = await openTabs(testWorker(), 2);
    const first = await webRtcTab(tabs);

    first.answersPolls = false;

    const second = await webRtcTab(tabs, 1);

    // E.g. was only frozen.
    first.answersPolls = true;
    second.close();
    expect(await until(() => first.messages('webrtc-start').length === 2)).toBe(true);
  });

  it('keeps running when a tab that stopped answering is closed', async () => {
    const worker = testWorker();
    const tabs = await openTabs(worker, 2);
    const first = await webRtcTab(tabs);

    first.answersPolls = false;

    const second = await webRtcTab(tabs, 1);

    first.close();
    expect(await until(async () => (await worker.tabCount()) === 1)).toBe(true);
    await sleep(200); // Several polls.
    expect(second.messages('webrtc-start')).toHaveLength(1);
    expect(second.messages('webrtc-stop')).toEqual([]);
  });

  it('is started in an unresponsive tab again when all tabs are unresponsive', async () => {
    const [tab] = await openTabs(testWorker(), 1);

    await webRtcTab([tab!]);
    tab!.answersPolls = false;
    expect(await until(() => tab!.messages('webrtc-start').length === 2)).toBe(true);
    expect(tab!.messages('webrtc-stop')).toHaveLength(1);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { Repo } from '@automerge/automerge-repo';
import { CALENDAR_ID, sleep, until } from './helpers';
import { TestWorker } from './sharedWorker';

// The repo's default `saveDebounceRate`, after which it saves a changed document.
const SAVE_DEBOUNCE_RATE_MS = 100;
// As in the app, see `SharedRepoWorkerOptions.documentSaveDelayMs`.
const DOCUMENT_SAVE_DELAY_MS = 1_000;

const workers: TestWorker[] = [];

afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.close();
});

describe('deleting a calendar', () => {
  it("deletes the calendar's documents from storage", async () => {
    const worker = new TestWorker({ documentSaveDelayMs: DOCUMENT_SAVE_DELAY_MS });
    workers.push(worker);
    const deleting = worker.openTab();
    const other = worker.openTab();

    deleting.init(CALENDAR_ID);
    const { documentIdLocal } = await deleting.message('ready-local');
    const documentIdShared = await deleting.documentIdShared();
    other.init(CALENDAR_ID, documentIdLocal);
    await other.message('ready-local');
    expect(await until(() => worker.isStored(documentIdLocal))).toBe(true);
    expect(await until(() => worker.isStored(documentIdShared))).toBe(true);

    deleting.port.postMessage({ type: 'delete-calendar' });
    // Also for the saves that would store the documents again, see `deleteDocument`.
    await sleep(DOCUMENT_SAVE_DELAY_MS + 5 * SAVE_DEBOUNCE_RATE_MS);
    expect(await worker.isStored(documentIdLocal)).toBe(false);
    expect(await worker.isStored(documentIdShared)).toBe(false);
  });

  it('stops WebRTC, and ignores the WebRTC replies of its tabs', async () => {
    const worker = new TestWorker();
    workers.push(worker);
    const tab = worker.openTab();

    tab.init(CALENDAR_ID);
    await tab.message('webrtc-start');
    tab.port.postMessage({ type: 'delete-calendar' });
    await tab.message('webrtc-stop');
    tab.port.postMessage({ type: 'webrtc-start-success' });
    await sleep(200); // Several polls.
    expect(tab.messages('ready-shared')).toEqual([]);
    expect(tab.messages('webrtc-start')).toHaveLength(1);
  });

  it('creates new documents when the calendar is opened again', async () => {
    const worker = new TestWorker();
    workers.push(worker);
    const tab = worker.openTab();

    tab.init(CALENDAR_ID);
    const { documentIdLocal } = await tab.message('ready-local');
    // `webrtc-stop` is only sent to a tab hosting WebRTC.
    await tab.message('webrtc-start');
    tab.port.postMessage({ type: 'delete-calendar' });
    // The calendar is forgotten by the worker.
    await tab.message('webrtc-stop');

    // E.g. joined again.
    const reopened = worker.openTab();
    reopened.init(CALENDAR_ID);
    expect((await reopened.message('ready-local')).documentIdLocal).not.toBe(documentIdLocal);
  });

  it('ignores its tabs being closed afterwards', async () => {
    const worker = new TestWorker();
    workers.push(worker);
    const tab = worker.openTab();

    tab.init(CALENDAR_ID);
    await tab.message('webrtc-start');
    tab.port.postMessage({ type: 'delete-calendar' });
    await tab.message('webrtc-stop');
    const reopened = worker.openTab();
    reopened.init(CALENDAR_ID);
    await reopened.message('webrtc-start');

    // Only forgotten by the deleted calendar's worker state, not by the one opened again.
    tab.close();
    await sleep(200); // Several polls.
    expect(await worker.tabCount()).toBe(1);
    expect(reopened.messages('webrtc-start')).toHaveLength(1);
    expect(reopened.messages('webrtc-stop')).toEqual([]);
  });
});

// The bug in automerge-repo that `deleteDocument` works around. Once this fails, e.g. after
// upgrading automerge-repo, the bug is fixed, and `deleteDocument` can only call `Repo.delete`.
it('automerge-repo stores a deleted document again', async () => {
  const worker = new TestWorker();
  workers.push(worker);
  const repo = new Repo({ network: [], storage: worker.storage() });
  const handle = repo.create({ name: 'Calendar' });

  expect(await until(() => worker.isStored(handle.documentId))).toBe(true);
  repo.delete(handle.documentId);
  await sleep(5 * SAVE_DEBOUNCE_RATE_MS);
  expect(await worker.isStored(handle.documentId)).toBe(true);
});

import { describe, expect, it, vi } from 'vitest';
import { localStorageDataStore } from '@/localStorageData';
import { CALENDAR_ID, OTHER_CALENDAR_ID, sleep } from './helpers';

const KEY = 'pinCalendar';

function stored(calendars: Record<string, object>, leastRecentlyUsedCalendar?: string): string {
  return JSON.stringify({ schemaVersion: { 1: { calendars, leastRecentlyUsedCalendar } } });
}

// A change made by another tab: the browser only notifies the other tabs.
function changeInAnotherTab(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
}

describe('the calendar list in local storage', () => {
  it('is kept in sync with other tabs', async () => {
    localStorage.setItem(KEY, stored({ [CALENDAR_ID]: {}, [OTHER_CALENDAR_ID]: {} }));
    const data = await localStorageDataStore.value.GetData();
    expect(Object.keys(data.value.calendars)).toEqual([CALENDAR_ID, OTHER_CALENDAR_ID]);
    const setItem = vi.spyOn(localStorage, 'setItem');

    // Another tab deletes a calendar.
    changeInAnotherTab(KEY, stored({ [CALENDAR_ID]: {} }));
    setItem.mockClear();
    await sleep(20);

    expect(Object.keys(data.value.calendars)).toEqual([CALENDAR_ID]);
    // The reloaded list is not written back.
    expect(setItem).not.toHaveBeenCalled();

    // Changes to other keys are ignored.
    changeInAnotherTab('otherKey', 'value');
    await sleep(20);
    expect(Object.keys(data.value.calendars)).toEqual([CALENDAR_ID]);

    // The tab's own changes are still saved, once.
    setItem.mockClear();
    data.value.leastRecentlyUsedCalendar = CALENDAR_ID;
    await sleep(20);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(KEY)!).schemaVersion[1].leastRecentlyUsedCalendar).toBe(
      CALENDAR_ID,
    );
  });
});

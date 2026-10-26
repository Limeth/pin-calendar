import { describe, expect, it, vi } from 'vitest';
import {
  LocalStorageDataSetCalendarAlias,
  LocalStorageDataSetCalendarName,
  localStorageDataStore,
  type LocalStorageData,
} from '@/localStorageData';
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

describe('the alias of a calendar', () => {
  it('is trimmed, and removed when blank', () => {
    const data: LocalStorageData = { calendars: { [CALENDAR_ID]: {} } };

    LocalStorageDataSetCalendarAlias(data, CALENDAR_ID, '  Work  ');
    expect(data.calendars[CALENDAR_ID]!.alias).toBe('Work');

    LocalStorageDataSetCalendarAlias(data, CALENDAR_ID, '   ');
    expect(data.calendars[CALENDAR_ID]).toEqual({});
  });

  it('does not add back a calendar that is no longer listed', () => {
    const data: LocalStorageData = { calendars: {} };

    LocalStorageDataSetCalendarAlias(data, CALENDAR_ID, 'Work');
    expect(data.calendars).toEqual({});
  });

  it('is kept when the list is loaded from storage', async () => {
    const data = await localStorageDataStore.value.GetData();

    changeInAnotherTab(KEY, stored({ [CALENDAR_ID]: { alias: 'Work' } }));
    await sleep(20);

    expect(data.value.calendars[CALENDAR_ID]!.alias).toBe('Work');
  });
});

describe("the copy of a calendar's name", () => {
  it('is set, and removed with the cache when the calendar has no name', () => {
    const data: LocalStorageData = { calendars: { [CALENDAR_ID]: {} } };

    LocalStorageDataSetCalendarName(data, CALENDAR_ID, 'Family');
    expect(data.calendars[CALENDAR_ID]!.cache).toEqual({ name: 'Family' });

    LocalStorageDataSetCalendarName(data, CALENDAR_ID, undefined);
    expect(data.calendars[CALENDAR_ID]).toEqual({});
  });

  it('does not add back a calendar that is no longer listed', () => {
    const data: LocalStorageData = { calendars: {} };

    LocalStorageDataSetCalendarName(data, CALENDAR_ID, 'Family');
    expect(data.calendars).toEqual({});
  });

  it('is kept when the list is loaded from storage', async () => {
    const data = await localStorageDataStore.value.GetData();

    changeInAnotherTab(KEY, stored({ [CALENDAR_ID]: { cache: { name: 'Family' } } }));
    await sleep(20);

    expect(data.value.calendars[CALENDAR_ID]!.cache?.name).toBe('Family');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageDataIsReadOnly,
  LocalStorageDataLoadOrDefault,
  LocalStorageDataParse,
  LocalStorageDataSave,
  LocalStorageDataSetCalendarCache,
  localStorageDataStore,
  type LocalStorageData,
} from '@/localStorageData';
import { CALENDAR_ID, OTHER_CALENDAR_ID, sleep } from './helpers';

const KEY = 'pinCalendar';

function stored(calendars: Record<string, object>, leastRecentlyUsedCalendar?: string): string {
  return JSON.stringify({ schemaVersion: { 1: { calendars, leastRecentlyUsedCalendar } } });
}

// The current version of the data, as stored.
function storedData(data: object): string {
  return JSON.stringify({ schemaVersion: { 1: data } });
}

function savedData(): unknown {
  return JSON.parse(localStorage.getItem(KEY)!).schemaVersion[1];
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

describe("the copies of a calendar's data", () => {
  it('are set, and removed with the cache when the calendar has none', () => {
    const data: LocalStorageData = { calendars: { [CALENDAR_ID]: {} } };

    LocalStorageDataSetCalendarCache(data, CALENDAR_ID, 'name', 'Family');
    LocalStorageDataSetCalendarCache(data, CALENDAR_ID, 'alias', 'Work');
    expect(data.calendars[CALENDAR_ID]!.cache).toEqual({ name: 'Family', alias: 'Work' });

    LocalStorageDataSetCalendarCache(data, CALENDAR_ID, 'name', undefined);
    expect(data.calendars[CALENDAR_ID]!.cache).toEqual({ alias: 'Work' });

    LocalStorageDataSetCalendarCache(data, CALENDAR_ID, 'alias', undefined);
    expect(data.calendars[CALENDAR_ID]).toEqual({});
  });

  it('do not add back a calendar that is no longer listed', () => {
    const data: LocalStorageData = { calendars: {} };

    LocalStorageDataSetCalendarCache(data, CALENDAR_ID, 'name', 'Family');
    expect(data.calendars).toEqual({});
  });

  it('are kept when the list is loaded from storage', async () => {
    const data = await localStorageDataStore.value.GetData();

    changeInAnotherTab(
      KEY,
      stored({ [CALENDAR_ID]: { cache: { name: 'Family', alias: 'Work' } } }),
    );
    await sleep(20);

    expect(data.value.calendars[CALENDAR_ID]!.cache).toEqual({ name: 'Family', alias: 'Work' });
  });
});

describe('reading the calendar list from storage', () => {
  beforeEach(() => {
    // Problems with the data are logged.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps properties unknown to this version', () => {
    const stored = {
      addedByNewerVersion: 1,
      calendars: { [CALENDAR_ID]: { documentIdLocal: 'local', addedByNewerVersion: 2 } },
    };
    const data = LocalStorageDataParse(storedData(stored))!;

    expect(data.calendars[CALENDAR_ID]!.documentIdLocal).toBe('local');

    LocalStorageDataSave(data);
    expect(savedData()).toEqual(stored);
  });

  it('drops an invalid cache, keeping the calendar', () => {
    const data = LocalStorageDataParse(
      storedData({
        calendars: { [CALENDAR_ID]: { documentIdLocal: 'local', cache: { name: 42 } } },
      }),
    )!;

    expect(data.calendars[CALENDAR_ID]).toEqual({ documentIdLocal: 'local' });
  });

  it('sets aside calendars that cannot be read, and saves them back as they were', () => {
    // Not converted to a string.
    const damaged = { documentIdLocal: 42 };
    const data = LocalStorageDataParse(
      storedData({
        calendars: {
          [CALENDAR_ID]: damaged,
          'not-a-calendar-id': {},
          [OTHER_CALENDAR_ID]: { documentIdLocal: 'home' },
        },
      }),
    )!;

    expect(Object.keys(data.calendars)).toEqual([OTHER_CALENDAR_ID]);

    data.calendars[OTHER_CALENDAR_ID]!.documentIdLocal = 'house';
    LocalStorageDataSave(data);
    expect(savedData()).toEqual({
      calendars: {
        [CALENDAR_ID]: damaged,
        'not-a-calendar-id': {},
        [OTHER_CALENDAR_ID]: { documentIdLocal: 'house' },
      },
    });
  });

  it('drops an invalid least recently used calendar', () => {
    expect(
      LocalStorageDataParse(storedData({ leastRecentlyUsedCalendar: 42, calendars: {} })),
    ).toEqual({ calendars: {} });
  });

  it('cannot read data without a calendar list', () => {
    expect(LocalStorageDataParse('{')).toBeUndefined();
    expect(LocalStorageDataParse(JSON.stringify({ calendars: {} }))).toBeUndefined();
    expect(LocalStorageDataParse(storedData({}))).toBeUndefined();
    expect(LocalStorageDataParse(storedData({ calendars: 'none' }))).toBeUndefined();
  });

  it('backs up data that cannot be read, before replacing it', () => {
    localStorage.setItem(KEY, '{');

    expect(LocalStorageDataLoadOrDefault()).toEqual({ calendars: {} });
    expect(localStorage.getItem('pinCalendarBackup')).toBe('{');
    expect(savedData()).toEqual({ calendars: {} });
  });
});

describe('saving the calendar list', () => {
  beforeEach(() => {
    // Problems with the data are logged.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('only replaces the current version, keeping the others', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        addedByNewerVersion: 1,
        schemaVersion: { 0: 'older', 1: { calendars: {} }, unknown: 'ignored' },
      }),
    );
    const data = LocalStorageDataLoadOrDefault();
    data.leastRecentlyUsedCalendar = CALENDAR_ID;
    LocalStorageDataSave(data);

    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      addedByNewerVersion: 1,
      schemaVersion: {
        0: 'older',
        1: { calendars: {}, leastRecentlyUsedCalendar: CALENDAR_ID },
        unknown: 'ignored',
      },
    });
  });

  it('keeps older versions when there is no current version', () => {
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: { 0: 'older' } }));

    expect(LocalStorageDataLoadOrDefault()).toEqual({ calendars: {} });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      schemaVersion: { 0: 'older', 1: { calendars: {} } },
    });
  });

  it('replaces stored data that is not versioned', () => {
    for (const string of ['{', JSON.stringify({ calendars: {} })]) {
      localStorage.setItem(KEY, string);
      LocalStorageDataSave({ calendars: {} });

      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
        schemaVersion: { 1: { calendars: {} } },
      });
    }
  });
});

describe('calendar list data of a newer version', () => {
  beforeEach(() => {
    // The newer version is logged.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Whatever a newer version stores, its version need not be an object.
  const newer = JSON.stringify({
    schemaVersion: {
      1: { calendars: { [CALENDAR_ID]: { documentIdLocal: 'local' } } },
      2: 'newer',
    },
  });
  const onlyNewer = JSON.stringify({ schemaVersion: { 2: 'newer' } });

  it('is read from the current version, read-only', () => {
    const data = LocalStorageDataParse(newer)!;

    expect(data.calendars).toEqual({ [CALENDAR_ID]: { documentIdLocal: 'local' } });
    expect(LocalStorageDataIsReadOnly(data)).toBe(true);
  });

  it('is an empty, read-only list without the current version', () => {
    const data = LocalStorageDataParse(onlyNewer)!;

    expect(data.calendars).toEqual({});
    expect(LocalStorageDataIsReadOnly(data)).toBe(true);
  });

  it('is neither replaced nor backed up when loaded', () => {
    for (const string of [newer, onlyNewer]) {
      localStorage.removeItem('pinCalendarBackup');
      localStorage.setItem(KEY, string);

      expect(LocalStorageDataIsReadOnly(LocalStorageDataLoadOrDefault())).toBe(true);
      expect(localStorage.getItem(KEY)).toBe(string);
      expect(localStorage.getItem('pinCalendarBackup')).toBeNull();
    }
  });

  it('is not saved', () => {
    localStorage.setItem(KEY, stored({}));
    const data = LocalStorageDataParse(newer)!;
    data.leastRecentlyUsedCalendar = CALENDAR_ID;
    LocalStorageDataSave(data);

    expect(localStorage.getItem(KEY)).toBe(stored({}));
  });

  it('is not overwritten by a list loaded before it was stored, e.g. by another tab', () => {
    localStorage.setItem(KEY, stored({ [CALENDAR_ID]: {} }));
    const data = LocalStorageDataLoadOrDefault();

    for (const string of [newer, onlyNewer]) {
      localStorage.setItem(KEY, string);
      LocalStorageDataSave(data);

      expect(localStorage.getItem(KEY)).toBe(string);
    }
  });
});

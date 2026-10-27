import { Type, type Static } from '@sinclair/typebox';
import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import * as uuid from 'uuid';
import { CalendarIdSchema, type CalendarId } from './documents/local';
import { getCurrentVersion, makeVersioned, Versioned } from './versioned';
import { isObject, readProperty, readValue } from './validation';

const LOCAL_STORAGE_KEY = 'pinCalendar';
const LOCAL_STORAGE_KEY_BACKUP = 'pinCalendarBackup';
const LOCAL_STORAGE_DATA_SCHEMA_VERSION_CURRENT = 1;

const InvitationSchema = Type.Object({
  // The ID of the shared document.
  documentIdShared: Type.String(),
  // The Peer JS peer ID of the peer that invited us.
  invitedBy: Type.String(),
  // Our Peer JS peer ID we used when confirming the invitation, that the inviter knows us as.
  localPeerId: Type.String(),
  authKeyId: Type.String(),
});

export type Invitation = Static<typeof InvitationSchema>;

// Data derived from a calendar's documents, so that it can be shown without loading the calendar,
// e.g. in the calendar list. It is updated whenever the calendar is loaded, so it may be outdated,
// e.g. when another device renamed the calendar since.
const LocalStorageDataCalendarCacheSchema = Type.Object({
  // A copy of the calendar's shared name, see `SharedDocument`.
  name: Type.Optional(Type.String()),
});

const LocalStorageDataCalendarSchema = Type.Object({
  documentIdEphemeral: Type.Optional(Type.String()),
  documentIdLocal: Type.Optional(Type.String()),
  invitation: Type.Optional(InvitationSchema),
  // The calendar's alias on this device, shown alongside its shared name.
  alias: Type.Optional(Type.String()),
  cache: Type.Optional(LocalStorageDataCalendarCacheSchema),
});

export type LocalStorageDataCalendar = Static<typeof LocalStorageDataCalendarSchema>;

const LocalStorageDataSchema = Type.Object({
  leastRecentlyUsedCalendar: Type.Optional(CalendarIdSchema),
  calendars: Type.Record(CalendarIdSchema, LocalStorageDataCalendarSchema),
});

// The calendars of the stored list that this version cannot read, e.g. damaged ones. They are not
// listed, but kept as they are, and saved with the list, so that they are not lost.
const UNREADABLE_CALENDARS = Symbol('unreadableCalendars');

export type LocalStorageData = Static<typeof LocalStorageDataSchema> & {
  [UNREADABLE_CALENDARS]?: Record<string, unknown>;
};

// Add a new, empty calendar, and return its ID. Always under a new ID: one that was used before may
// belong to a deleted calendar, which the shared worker still remembers, see `webRtcShutDown`.
export function LocalStorageDataAddCalendar(self: LocalStorageData): CalendarId {
  const calendarId = uuid.v7();
  self.calendars[calendarId] = {};
  return calendarId;
}

// Set a calendar's alias, or remove it if the given one is blank. A calendar that is no longer listed,
// e.g. because it was deleted in another tab, is not added back.
export function LocalStorageDataSetCalendarAlias(
  self: LocalStorageData,
  calendarId: CalendarId,
  alias: string,
) {
  if (!Object.hasOwn(self.calendars, calendarId)) return;

  const calendar = self.calendars[calendarId]!;
  const trimmed = alias.trim();

  if (trimmed.length === 0) delete calendar.alias;
  else if (calendar.alias !== trimmed) calendar.alias = trimmed;
}

// Set the copy of a calendar's shared name, see `LocalStorageDataCalendarCacheSchema`. A calendar that
// is no longer listed, e.g. because it was deleted in another tab, is not added back.
export function LocalStorageDataSetCalendarName(
  self: LocalStorageData,
  calendarId: CalendarId,
  name: string | undefined,
) {
  if (!Object.hasOwn(self.calendars, calendarId)) return;

  const calendar = self.calendars[calendarId]!;

  if (name !== undefined) {
    if (calendar.cache?.name !== name) calendar.cache = { ...calendar.cache, name };
  } else if (calendar.cache !== undefined) {
    delete calendar.cache.name;

    if (Object.keys(calendar.cache).length === 0) delete calendar.cache;
  }
}

export function LocalStorageDataSave(self: LocalStorageData) {
  // A calendar added under the ID of an unreadable one replaces it.
  const data = { ...self, calendars: { ...self[UNREADABLE_CALENDARS], ...self.calendars } };
  const string = JSON.stringify(makeVersioned(data, LOCAL_STORAGE_DATA_SCHEMA_VERSION_CURRENT));

  // Writing an unchanged value would only make the other tabs reload it, see
  // `localStorageDataStore`, which they would then save again.
  if (localStorage.getItem(LOCAL_STORAGE_KEY) === string) return;

  localStorage.setItem(LOCAL_STORAGE_KEY, string);
}

export function LocalStorageDataLoadOrDefault(): LocalStorageData {
  let localStorageData = LocalStorageDataLoad();

  if (localStorageData !== undefined) return localStorageData;

  localStorageData = LocalStorageDataDefault();
  LocalStorageDataSave(localStorageData);
  return localStorageData;
}

function LocalStorageDataLoad(): LocalStorageData | undefined {
  const string = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (string === null) return undefined;

  const localStorageData = LocalStorageDataParse(string);

  // Returning `undefined` causes the default value to be created, which will overwrite the current
  // value in local storage. In order to prevent data loss, we at least back up the original value.
  if (localStorageData === undefined) localStorage.setItem(LOCAL_STORAGE_KEY_BACKUP, string);

  return localStorageData;
}

// Read the stored data, keeping as much of it as can be read: a calendar that cannot be read is set
// aside, see `UNREADABLE_CALENDARS`, rather than the whole list being discarded. Properties unknown to
// this version are kept. `undefined` if not even the list can be read.
export function LocalStorageDataParse(string: string): LocalStorageData | undefined {
  let json: unknown;

  try {
    json = JSON.parse(string);
  } catch (error) {
    console.error('Failed to parse the data in local storage:', error);
    return undefined;
  }

  const versioned = readValue(Versioned(Type.Object({})), json, 'local storage data');

  if (versioned === undefined) return undefined;

  const result = getCurrentVersion<object, Versioned<object>>(
    versioned,
    LOCAL_STORAGE_DATA_SCHEMA_VERSION_CURRENT,
    undefined,
  );

  if (result.type === 'unsupported')
    throw new Error(`Unsupported local storage data schema version: ${result.version}`);

  if (result.type === 'none') return undefined;

  const { calendars, ...rest }: { calendars?: unknown } = result.current;

  if (!isObject(calendars)) {
    console.error('Ignoring the data in local storage, as it has no calendar list.');
    return undefined;
  }

  const readable: Record<CalendarId, LocalStorageDataCalendar> = {};
  const unreadable: Record<string, unknown> = {};

  for (const [calendarId, calendar] of Object.entries(calendars)) {
    const read = LocalStorageDataCalendarParse(calendarId, calendar);

    if (read !== undefined) readable[calendarId] = read;
    else unreadable[calendarId] = calendar;
  }

  const data = { ...rest, calendars: readable };

  // Only a preference, so an invalid one is dropped.
  if (readProperty(LocalStorageDataSchema, data, 'leastRecentlyUsedCalendar') === undefined)
    delete (data as { leastRecentlyUsedCalendar?: unknown }).leastRecentlyUsedCalendar;

  const localStorageData: LocalStorageData | undefined = readValue(
    LocalStorageDataSchema,
    data,
    'local storage data',
  );

  if (localStorageData !== undefined && Object.keys(unreadable).length > 0)
    localStorageData[UNREADABLE_CALENDARS] = unreadable;

  return localStorageData;
}

function LocalStorageDataCalendarParse(
  calendarId: string,
  calendar: unknown,
): LocalStorageDataCalendar | undefined {
  const description = `calendar ${calendarId} in local storage`;

  if (readValue(CalendarIdSchema, calendarId, `ID of ${description}`) === undefined)
    return undefined;

  // The cache can be rebuilt, so an invalid one is dropped, rather than the whole calendar.
  if (
    isObject(calendar) &&
    readProperty(LocalStorageDataCalendarSchema, calendar, 'cache', `cache of ${description}`) ===
      undefined
  ) {
    const { cache: _, ...withoutCache } = calendar as { cache?: unknown };
    calendar = withoutCache;
  }

  return readValue(LocalStorageDataCalendarSchema, calendar, description);
}

function LocalStorageDataDefault(): LocalStorageData {
  return {
    calendars: {},
  };
}

export type LocalStorageDataStore = {
  ref?: Promise<Ref<LocalStorageData>>;

  GetData(): Promise<Ref<LocalStorageData>>;
};

export const localStorageDataStore: ShallowRef<LocalStorageDataStore> =
  shallowRef<LocalStorageDataStore>({
    GetData(): Promise<Ref<LocalStorageData>> {
      if (this.ref !== undefined) return this.ref;

      this.ref = (async () => {
        const innerRef = ref(LocalStorageDataLoadOrDefault());

        // Automatically update stored value.
        watch(
          innerRef,
          (localStorageData) => {
            LocalStorageDataSave(localStorageData);
          },
          { deep: true },
        );

        // Reload the stored value when another tab changes it, e.g. when it deletes a calendar.
        // Otherwise, this tab would not see the change, and would overwrite it the next time it
        // saves. The browser only notifies the other tabs, not the one that made the change.
        window.addEventListener('storage', (event) => {
          // A `null` key means that the whole storage was cleared.
          if (event.storageArea !== localStorage) return;
          if (event.key !== null && event.key !== LOCAL_STORAGE_KEY) return;

          const localStorageData = LocalStorageDataLoad();

          if (localStorageData !== undefined) innerRef.value = localStorageData;
        });

        return innerRef;
      })();

      return this.ref;
    },
  });

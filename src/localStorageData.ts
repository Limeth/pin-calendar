import { Type, type Static } from '@sinclair/typebox';
import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import * as uuid from 'uuid';
import { CalendarIdSchema, type CalendarId } from './documents/local';
import { Value } from '@sinclair/typebox/value';
import { getCurrentVersion, makeVersioned, Versioned } from './versioned';

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

export type LocalStorageData = Static<typeof LocalStorageDataSchema>;

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
  const string = JSON.stringify(makeVersioned(self, LOCAL_STORAGE_DATA_SCHEMA_VERSION_CURRENT));

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

  const json = JSON.parse(string);
  let versioned: Versioned<LocalStorageData>;

  try {
    versioned = Value.Parse(Versioned(LocalStorageDataSchema), json);
  } catch (error) {
    console.error(error);
    // Returning `undefined` causes the default value to be created, which will overwrite the current value in local storage.
    // In order to prevent data loss, we at least back up the original value.
    localStorage.setItem(LOCAL_STORAGE_KEY_BACKUP, string);
    return undefined;
  }

  const result = getCurrentVersion<LocalStorageData, Versioned<LocalStorageData>>(
    versioned,
    LOCAL_STORAGE_DATA_SCHEMA_VERSION_CURRENT,
    undefined,
  );

  if (result.type === 'current') return result.current;
  else if (result.type === 'unsupported')
    throw new Error(`Unsupported local storage data schema version: ${result.version}`);
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

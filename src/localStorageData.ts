import { Type, type Static } from '@sinclair/typebox';
import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import { CalendarIdSchema } from './documents/local';
import { Value } from '@sinclair/typebox/value';
import { getCurrentVersion, makeVersioned, Versioned } from './versioned';

const LOCAL_STORAGE_KEY = 'pinCalendar';
const LOCAL_STORAGE_KEY_BACKUP = 'pinCalendarBackup';
const LOCAL_STORAGE_DATA_SCHEMA_VERSION_CURRENT = 1;

const LocalStorageDataSchema = Type.Object({
  leastRecentlyUsedCalendar: Type.Optional(CalendarIdSchema),
  calendars: Type.Record(
    CalendarIdSchema,
    Type.Object({
      documentIdEphemeral: Type.Optional(Type.String()),
      documentIdLocal: Type.Optional(Type.String()),
    }),
  ),
});

export type LocalStorageData = Static<typeof LocalStorageDataSchema>;

export function LocalStorageDataSave(self: LocalStorageData) {
  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify(makeVersioned(self, LOCAL_STORAGE_DATA_SCHEMA_VERSION_CURRENT)),
  );
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

        return innerRef;
      })();

      return this.ref;
    },
  });

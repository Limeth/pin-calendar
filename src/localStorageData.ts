import { Type, type Static } from '@sinclair/typebox';
import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import { CalendarIdSchema } from './documents/local';
import { Value } from '@sinclair/typebox/value';

const LOCAL_STORAGE_KEY = 'pinCalendar';

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
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(self));
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

  try {
    return Value.Parse(LocalStorageDataSchema, json);
  } catch (error) {
    console.error(error);
    return undefined;
  }
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

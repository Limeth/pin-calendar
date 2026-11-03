import '@/formats';
import { Type, type Static } from '@sinclair/typebox';
import {
  PIN_ID_SYMBOL,
  PinCatalogGetPinById,
  type PinCatalogUncheckedRop,
  type PinRop,
} from './pinCatalog';
import { keyToId } from './util';
import { toRef, type Ref } from 'vue';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import { Temporal } from '@js-temporal/polyfill';
import { PinDayAddPinById, PinDayNew, PinDaySchema, type PinDay } from './pinCalendarDay';
import { makeVersioned, parseCurrentVersion } from '@/versioned';
import {
  isObject,
  readEntry,
  readEntryRop,
  type Unchecked,
  type UncheckedRopValue,
} from '@/validation';

const PIN_CALENDAR_SCHEMA_VERSION_CURRENT = 1;

const PinCalendarDaysSchema = Type.Record(
  Type.String({
    format: 'date',
  }),
  PinDaySchema,
);

export type PinCalendarDays = Static<typeof PinCalendarDaysSchema>;

export const PinCalendarSchema = Type.Object({
  days: PinCalendarDaysSchema,
});

export type PinCalendar = Static<typeof PinCalendarSchema>;

export function PinCalendarNew(): PinCalendar {
  return {
    days: {},
  };
}

export function PinCalendarClear(self: PinCalendar) {
  self.days = {};
}

// The pin calendar of the shared document as it is read, see `UncheckedRop`.
export type PinCalendarUncheckedRop = UncheckedRopValue<PinCalendar>;

// The day under the key, or `undefined` if the calendar has none, or an invalid one.
function PinCalendarGetDayByKey(
  self: PinCalendarUncheckedRop,
  key: string,
): Rop<PinDay> | undefined {
  if (!isObject(self)) return undefined;

  return readEntryRop(PinCalendarDaysSchema, self.days, key, `calendar day ${key}`);
}

// The day to add pins to, added if the calendar has none, or `undefined` if it has an invalid one,
// which is left as it is. For use within a change of the document.
function PinCalendarGetOrAddDayByKey(self: PinCalendar, key: string): PinDay | undefined {
  if (!isObject(self.days)) return undefined;

  // Read back from the document, as changes to the added object itself would not be recorded.
  if (!(key in self.days)) self.days[key] = PinDayNew();

  return readEntry(PinCalendarDaysSchema, self.days, key, `calendar day ${key}`);
}

function PinCalendarPrepareDayByKey(self: PinCalendarUncheckedRop, key: string): boolean {
  // An invalid calendar or day is left as it is, so there is nothing to prepare.
  if (!isObject(self) || !isObject(self.days) || key in self.days) return true;

  self[changeSubtree]((pinCalendar: PinCalendar) => {
    pinCalendar.days[key] = PinDayNew();
  });
  return false;
}

// The day, read anew from the calendar whenever the reference is read, or `null` if the calendar has
// no valid day for it, see `PinCalendarPrepareDay`.
export function PinCalendarGetDayRef(
  self: Ref<PinCalendarUncheckedRop>,
  day: Temporal.PlainDate,
): Readonly<Ref<Rop<PinDay> | undefined>> | null {
  const key = PinCalendarDayToKey(day);

  if (PinCalendarGetDayByKey(self.value, key) === undefined) return null;

  return toRef(() => PinCalendarGetDayByKey(self.value, key));
}

/// Returns `true` if the day was already prepared, or cannot be, as the calendar or the day is
/// invalid. Otherwise, the document must be updated.
export function PinCalendarPrepareDay(
  self: PinCalendarUncheckedRop,
  day: Temporal.PlainDate,
): boolean {
  return PinCalendarPrepareDayByKey(self, PinCalendarDayToKey(day));
}

// The valid pins on the day.
export function PinCalendarGetPinsOnDay(
  self: PinCalendarUncheckedRop,
  catalog: PinCatalogUncheckedRop,
  day: Temporal.PlainDate,
): Set<PinRop> {
  const result: Set<PinRop> = new Set();
  const pinDay = PinCalendarGetDayByKey(self, PinCalendarDayToKey(day));

  if (pinDay !== undefined) {
    for (const pinIdKey of pinDay.pins) {
      const pin = PinCatalogGetPinById(catalog, keyToId(pinIdKey, PIN_ID_SYMBOL));

      if (pin !== null) result.add(pin);
    }
  }

  return result;
}

function PinCalendarAsJsonValue(self: Unchecked<PinCalendar>): object {
  return makeVersioned(self, PIN_CALENDAR_SCHEMA_VERSION_CURRENT);
}

export function PinCalendarSerialize(self: Unchecked<PinCalendar>): string {
  return JSON.stringify(PinCalendarAsJsonValue(self));
}

// function PinCalendarSaveToLocalStorage(self: Y.Map<PinCalendar>, ) {
//     localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CALENDAR, this.serialize());
// }

export function PinCalendarDayToKey(day: Temporal.PlainDate): string {
  return day.toString();
}

export function PinCalendarKeyToDay(key: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(key);
}

export function PinCalendarCombine(target: PinCalendar, source: PinCalendar) {
  for (const [key, loadedDay] of Object.entries(source.days)) {
    const day = PinCalendarGetOrAddDayByKey(target, key);

    if (day === undefined) continue;

    for (const pinIdKey of loadedDay.pins) PinDayAddPinById(day, keyToId(pinIdKey, PIN_ID_SYMBOL));
  }
}

// A calendar file, e.g. exported by another device, see `parseCurrentVersion`.
export function PinCalendarDeserialize(serialized: string) {
  let json: unknown;

  try {
    json = JSON.parse(serialized);
  } catch (error) {
    console.error('Ignoring a calendar file that is not JSON:', error);
    return { type: 'invalid' } as const;
  }

  return parseCurrentVersion(
    PinCalendarSchema,
    json,
    PIN_CALENDAR_SCHEMA_VERSION_CURRENT,
    'calendar',
  );
}

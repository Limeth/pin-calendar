import { Type, type Static } from '@sinclair/typebox';
import { PIN_ID_SYMBOL, type Pin, type PinCatalog } from './pinCatalog';
import { keyToId, type MaybeRo, type MaybeRop } from './util';
import { toRef, type Ref } from 'vue';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import { Temporal } from '@js-temporal/polyfill';
import { Value } from '@sinclair/typebox/value';
import { PinDayAddPinById, PinDayNew, PinDaySchema, type PinDay } from './pinCalendarDay';
import { getCurrentVersion, makeVersioned, Versioned } from '@/versioned';

const PIN_CALENDAR_SCHEMA_VERSION_CURRENT = 1;

const PinCalendarDaysSchema = Type.Record(
  Type.String({
    format: 'date',
  }),
  PinDaySchema,
);

export type PinCalendarDays = Static<typeof PinCalendarDaysSchema>;

const PinCalendarSchema = Type.Object({
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

function PinCalendarGetDayRefByKey(
  self: Ref<Rop<PinCalendar>>,
  key: string,
): Ref<Rop<PinDay>> | null {
  if (key in self.value.days) return toRef(self.value.days, key);
  else return null;
}

function PinCalendarGetDayByKey<P extends MaybeRop<PinCalendar>>(
  self: P,
  key: string,
): P['days'][string] | null {
  return (self.days[key] as P['days'][string] | undefined) ?? null;
}

function PinCalendarGetOrDefaultDayByKey(self: PinCalendar, key: string): PinDay {
  if (key in self.days) return self.days[key]!;
  else {
    const day = PinDayNew();
    self.days[key] = day;
    return day;
  }
}

function PinCalendarPrepareDayByKey(self: Rop<PinCalendar>, key: string): boolean {
  if (!(key in self.days)) {
    self[changeSubtree]((pinCalendar: PinCalendar) => {
      pinCalendar.days[key] = PinDayNew();
    });
    return false;
  } else return true;
}

export function PinCalendarGetDayRef(
  self: Ref<Rop<PinCalendar>>,
  day: Temporal.PlainDate,
): Ref<Rop<PinDay>> | null {
  return PinCalendarGetDayRefByKey(self, PinCalendarDayToKey(day));
}

export function PinCalendarGetDay<P extends MaybeRop<PinCalendar>>(
  self: P,
  day: Temporal.PlainDate,
): P['days'][string] | null {
  return PinCalendarGetDayByKey(self, PinCalendarDayToKey(day));
}

/// Returns `true` if the day was already prepared. Otherwise, the document must be updated.
export function PinCalendarPrepareDay(self: Rop<PinCalendar>, day: Temporal.PlainDate): boolean {
  return PinCalendarPrepareDayByKey(self, PinCalendarDayToKey(day));
}

export function PinCalendarGetPinsOnDay(
  self: Rop<PinCalendar>,
  catalog: Rop<PinCatalog>,
  day: Temporal.PlainDate,
): Set<Pin> {
  const result: Set<Pin> = new Set();
  const pinDay = PinCalendarGetDay(self, day);

  if (pinDay !== null) {
    for (const pinIdKey of pinDay.pins) {
      const pin = catalog.pins[pinIdKey];

      if (pin !== undefined) {
        result.add({
          id: keyToId(pinIdKey, PIN_ID_SYMBOL),
          value: pin,
        });
      }
    }
  }

  return result;
}

function PinCalendarAsJsonValue(self: MaybeRo<PinCalendar>): object {
  return makeVersioned(self, PIN_CALENDAR_SCHEMA_VERSION_CURRENT);
}

export function PinCalendarSerialize(self: MaybeRo<PinCalendar>): string {
  return JSON.stringify(PinCalendarAsJsonValue(self));
}

// function PinCalendarSaveToLocalStorage(self: Y.Map<PinCalendar>, ) {
//     localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CALENDAR, this.serialize());
// }

function PinCalendarFromJsonValue(json: unknown): PinCalendar | null {
  let versioned;

  try {
    versioned = Value.Parse(Versioned(PinCalendarSchema), json);
  } catch (error) {
    console.error(error);
    return null;
  }

  const currentVersion = getCurrentVersion(
    versioned,
    PIN_CALENDAR_SCHEMA_VERSION_CURRENT,
    PinCalendarNew,
  );

  if (currentVersion.type === 'current') return currentVersion.current;
  else if (currentVersion.type === 'unsupported')
    console.error(`Unsupported calendar version: ${currentVersion.version}`);

  return null;
}

export function PinCalendarDayToKey(day: Temporal.PlainDate): string {
  return day.toString();
}

export function PinCalendarKeyToDay(key: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(key);
}

export function PinCalendarCombine(target: PinCalendar, source: PinCalendar) {
  for (const [key, loadedDay] of Object.entries(source.days)) {
    const day = PinCalendarGetOrDefaultDayByKey(target, key);

    for (const pinIdKey of loadedDay.pins) PinDayAddPinById(day, keyToId(pinIdKey, PIN_ID_SYMBOL));
  }
}

export function PinCalendarDeserialize(serialized: string): PinCalendar | null {
  return PinCalendarFromJsonValue(JSON.parse(serialized));
}

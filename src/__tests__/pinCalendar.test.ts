import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, type Ref } from 'vue';
import { Temporal } from '@js-temporal/polyfill';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import type { SharedDocument, SharedDocumentRop } from '@/documents/shared';
import { PinCatalogDefault } from '@/pins/pinCatalog';
import {
  PinCalendarCombine,
  PinCalendarDeserialize,
  PinCalendarGetDayRef,
  PinCalendarGetPinsOnDay,
  PinCalendarPrepareDay,
  PinCalendarSerialize,
} from '@/pins/pinCalendar';
import { PinDayAddPinById } from '@/pins/pinCalendarDay';
import { PIN_ID_SYMBOL } from '@/pins/pinCatalog';
import { keyToId } from '@/pins/util';
import { reactiveDocument } from './helpers';

const DAY = Temporal.PlainDate.from('2026-11-03');
const OTHER_DAY = Temporal.PlainDate.from('2026-11-04');
const catalog = PinCatalogDefault();
const [PIN, OTHER_PIN] = Object.keys(catalog.pins) as [string, string];

// A shared document as other devices may have written it, with any pin calendar.
function sharedDocument(pinCalendar: unknown): Ref<SharedDocumentRop> {
  return reactiveDocument({ pinCatalog: catalog, pinCalendar } as unknown as SharedDocument);
}

function pinsOnDay(document: Ref<SharedDocumentRop>, day: Temporal.PlainDate): string[] {
  const pins = PinCalendarGetPinsOnDay(document.value.pinCalendar, document.value.pinCatalog, day);

  return [...pins].map((pin) => pin.id.key);
}

beforeEach(() => {
  // Invalid data is logged.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the days of the pin calendar', () => {
  it('are read with their pins', () => {
    const document = sharedDocument({ days: { [DAY.toString()]: { pins: [PIN, OTHER_PIN] } } });

    expect(pinsOnDay(document, DAY)).toEqual([PIN, OTHER_PIN]);
    expect(pinsOnDay(document, OTHER_DAY)).toEqual([]);
  });

  it('are ignored, but kept, when invalid', () => {
    const invalid = { pins: 'not a list' };
    const document = sharedDocument({
      days: { [DAY.toString()]: invalid, [OTHER_DAY.toString()]: { pins: [PIN] } },
    });

    expect(pinsOnDay(document, DAY)).toEqual([]);
    expect(pinsOnDay(document, OTHER_DAY)).toEqual([PIN]);
    expect(
      PinCalendarGetDayRef(
        computed(() => document.value.pinCalendar),
        DAY,
      ),
    ).toBeNull();

    // Nothing to prepare, as an invalid day is left as it is.
    expect(PinCalendarPrepareDay(document.value.pinCalendar, DAY)).toBe(true);
    expect(JSON.parse(JSON.stringify(document.value.pinCalendar))).toEqual({
      days: { [DAY.toString()]: invalid, [OTHER_DAY.toString()]: { pins: [PIN] } },
    });
  });

  it('are ignored when the calendar is invalid', () => {
    const document = sharedDocument('not a calendar');

    expect(pinsOnDay(document, DAY)).toEqual([]);
    expect(PinCalendarPrepareDay(document.value.pinCalendar, DAY)).toBe(true);
  });

  it('are prepared, and then read anew after each change', () => {
    const document = sharedDocument({ days: {} });
    const pinCalendar = computed(() => document.value.pinCalendar);

    expect(PinCalendarPrepareDay(pinCalendar.value, DAY)).toBe(false);
    expect(PinCalendarPrepareDay(pinCalendar.value, DAY)).toBe(true);

    const pinDay = PinCalendarGetDayRef(pinCalendar, DAY)!;

    expect([...pinDay.value!.pins]).toEqual([]);

    pinDay.value![changeSubtree]((day) => {
      PinDayAddPinById(day, keyToId(PIN, PIN_ID_SYMBOL));
    });
    expect([...pinDay.value!.pins]).toEqual([PIN]);
  });

  it('cannot be navigated before the calendar was confirmed to be an object', () => {
    const document = sharedDocument({ days: {} });

    // @ts-expect-error: The calendar may not be an object.
    const days = document.value.pinCalendar.days;

    expect(Object.keys(days)).toEqual([]);
  });
});

describe('importing a pin calendar', () => {
  it('adds the pins to new and existing days', () => {
    const document = sharedDocument({ days: { [DAY.toString()]: { pins: [PIN] } } });

    document.value[changeSubtree]((shared) => {
      PinCalendarCombine(shared.pinCalendar, {
        days: { [DAY.toString()]: { pins: [OTHER_PIN] }, [OTHER_DAY.toString()]: { pins: [PIN] } },
      });
    });

    expect(pinsOnDay(document, DAY)).toEqual([PIN, OTHER_PIN]);
    expect(pinsOnDay(document, OTHER_DAY)).toEqual([PIN]);
  });

  it('leaves invalid days as they are', () => {
    const invalid = { pins: 'not a list' };
    const document = sharedDocument({ days: { [DAY.toString()]: invalid } });

    document.value[changeSubtree]((shared) => {
      PinCalendarCombine(shared.pinCalendar, { days: { [DAY.toString()]: { pins: [PIN] } } });
    });

    expect(JSON.parse(JSON.stringify(document.value.pinCalendar))).toEqual({
      days: { [DAY.toString()]: invalid },
    });
  });
});

describe('importing a calendar file', () => {
  beforeEach(() => {
    // Invalid files are logged.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads an exported calendar', () => {
    const calendar = { days: { [DAY.toString()]: { pins: [PIN] } } };

    expect(PinCalendarDeserialize(PinCalendarSerialize(calendar))).toEqual({
      type: 'current',
      current: calendar,
    });
  });

  it('tells a file of a newer version from an invalid one', () => {
    expect(PinCalendarDeserialize(JSON.stringify({ schemaVersion: { 2: {} } }))).toEqual({
      type: 'newer',
      version: 2,
    });
    expect(PinCalendarDeserialize('{')).toEqual({ type: 'invalid' });
    expect(PinCalendarDeserialize(JSON.stringify({ schemaVersion: {} }))).toEqual({
      type: 'invalid',
    });
  });
});

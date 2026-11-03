import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import type { SharedDocument, SharedDocumentRop } from '@/documents/shared';
import {
  PIN_CATEGORY_ID_SYMBOL,
  PIN_ID_SYMBOL,
  PinCatalogAddPin,
  PinCatalogChange,
  PinCatalogDefault,
  PinCatalogDeserialize,
  PinCatalogGetOrphanedPins,
  PinCatalogGetPinById,
  PinCatalogGetPinCategories,
  PinCatalogGetPins,
  PinCatalogGetPinsInCategory,
  PinCatalogGetRootCategories,
  PinCatalogRemovePin,
  PinCatalogRemovePinCategory,
  PinCatalogSerialize,
  type PinCatalog,
} from '@/pins/pinCatalog';
import { PinCalendarGetPinsOnDay } from '@/pins/pinCalendar';
import { keyToId } from '@/pins/util';
import { Temporal } from '@js-temporal/polyfill';
import { reactiveDocument } from './helpers';

// The default catalog: the categories Health, with the subcategories Physical Health (with the pin
// Go on a jog) and Mental Health (Do some self-care), and Hobbies (Watch a movie).
function catalog(): PinCatalog {
  return PinCatalogDefault();
}

function pinKey(pinCatalog: PinCatalog, displayName: string): string {
  return Object.entries(pinCatalog.pins).find(([, pin]) => pin.displayName === displayName)![0];
}

function categoryKey(pinCatalog: PinCatalog, displayName: string): string {
  return Object.entries(pinCatalog.pinCategories).find(
    ([, category]) => category.displayName === displayName,
  )![0];
}

// A shared document as other devices may have written it, with any pin catalog.
function sharedDocument(
  pinCatalog: unknown,
  pinCalendar: unknown = { days: {} },
): Ref<SharedDocumentRop> {
  return reactiveDocument({ pinCatalog, pinCalendar } as unknown as SharedDocument);
}

function displayNames(items: { value: { displayName: string } }[]): string[] {
  return items.map((item) => item.value.displayName).toSorted();
}

function stored(document: Ref<SharedDocumentRop>): unknown {
  return JSON.parse(JSON.stringify(document.value.pinCatalog));
}

beforeEach(() => {
  // Invalid data is logged.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the pins and categories of the catalog', () => {
  it('are read', () => {
    const document = sharedDocument(catalog());
    const pinCatalog = document.value.pinCatalog;

    expect(displayNames(PinCatalogGetPins(pinCatalog))).toEqual([
      'Do some self-care',
      'Go on a jog',
      'Watch a movie',
    ]);
    expect(displayNames(PinCatalogGetRootCategories(pinCatalog))).toEqual(['Health', 'Hobbies']);
  });

  it('are ignored, but kept, when invalid', () => {
    const initial = catalog();
    const jog = pinKey(initial, 'Go on a jog');
    const hobbies = categoryKey(initial, 'Hobbies');

    (initial.pins[jog] as unknown as { displayName: unknown }).displayName = 42;
    (initial.pinCategories[hobbies] as unknown as { pins: unknown }).pins = 'not a list';

    const document = sharedDocument(initial);
    const pinCatalog = document.value.pinCatalog;
    const physical = keyToId(categoryKey(initial, 'Physical Health'), PIN_CATEGORY_ID_SYMBOL);

    expect(displayNames(PinCatalogGetPins(pinCatalog))).toEqual([
      'Do some self-care',
      'Watch a movie',
    ]);
    expect(PinCatalogGetPinById(pinCatalog, keyToId(jog, PIN_ID_SYMBOL))).toBeNull();
    expect(PinCatalogGetPinsInCategory(pinCatalog, physical)).toEqual([]);
    expect(displayNames(PinCatalogGetPinCategories(pinCatalog))).toEqual([
      'Health',
      'Mental Health',
      'Physical Health',
    ]);
    expect(stored(document)).toEqual(JSON.parse(JSON.stringify(initial)));
  });

  it('are ignored when the catalog is invalid', () => {
    const document = sharedDocument('not a catalog');

    expect(PinCatalogGetPins(document.value.pinCatalog)).toEqual([]);
    expect(PinCatalogGetRootCategories(document.value.pinCatalog)).toEqual([]);
    expect(PinCatalogChange(document.value.pinCatalog, () => {})).toBe(false);
  });

  it('are document proxies, which can be written to', () => {
    const initial = catalog();
    const jog = keyToId(pinKey(initial, 'Go on a jog'), PIN_ID_SYMBOL);
    const document = sharedDocument(initial);

    PinCatalogGetPinById(document.value.pinCatalog, jog)!.value[changeSubtree]((pin) => {
      pin.archived = true;
    });

    expect(PinCatalogGetPinById(document.value.pinCatalog, jog)!.value.archived).toBe(true);
  });

  it('are left out of the pins on a day when invalid', () => {
    const initial = catalog();
    const jog = pinKey(initial, 'Go on a jog');
    const movie = pinKey(initial, 'Watch a movie');

    (initial.pins[jog] as unknown as { icon: unknown }).icon = 'not an icon';

    const document = sharedDocument(initial, { days: { '2026-11-03': { pins: [jog, movie] } } });
    const pins = PinCalendarGetPinsOnDay(
      document.value.pinCalendar,
      document.value.pinCatalog,
      Temporal.PlainDate.from('2026-11-03'),
    );

    expect(displayNames([...pins])).toEqual(['Watch a movie']);
  });

  it('include the pins without a category, also when their category is invalid', () => {
    const initial = catalog();
    const hobbies = categoryKey(initial, 'Hobbies');
    const mental = categoryKey(initial, 'Mental Health');

    (initial.pinCategories[mental] as unknown as { displayName: unknown }).displayName = 42;

    const document = sharedDocument(initial);

    expect(displayNames(PinCatalogGetOrphanedPins(document.value.pinCatalog))).toEqual([
      'Do some self-care',
    ]);

    PinCatalogChange(document.value.pinCatalog, (pinCatalog) => {
      PinCatalogRemovePinCategory(pinCatalog, keyToId(hobbies, PIN_CATEGORY_ID_SYMBOL));
    });

    expect(displayNames(PinCatalogGetOrphanedPins(document.value.pinCatalog))).toEqual([
      'Do some self-care',
      'Watch a movie',
    ]);
  });

  it('cannot be navigated before the catalog was confirmed to be an object', () => {
    const document = sharedDocument(catalog());

    // @ts-expect-error: The catalog may not be an object.
    const pins = document.value.pinCatalog.pins;

    expect(Object.keys(pins)).toHaveLength(3);
  });
});

describe('changing the catalog', () => {
  it('removes a pin, even an invalid one, and only from valid categories', () => {
    const initial = catalog();
    const jog = pinKey(initial, 'Go on a jog');
    const health = categoryKey(initial, 'Health');

    (initial.pins[jog] as unknown as { displayName: unknown }).displayName = 42;
    (initial.pinCategories[health] as unknown as { subcategories: unknown }).subcategories = 7;

    const document = sharedDocument(initial);

    PinCatalogChange(document.value.pinCatalog, (pinCatalog) => {
      PinCatalogRemovePin(pinCatalog, keyToId(jog, PIN_ID_SYMBOL));
    });

    const result = stored(document) as PinCatalog;

    expect(Object.keys(result.pins)).not.toContain(jog);
    expect(result.pinCategories[categoryKey(initial, 'Physical Health')]!.pins).toEqual([]);
    expect(result.pinCategories[health]!.subcategories).toBe(7);
    expect(result.removed).toEqual([jog]);
  });

  it('leaves an invalid list of removed pins as it is', () => {
    const initial = catalog();
    const jog = pinKey(initial, 'Go on a jog');

    (initial as unknown as { removed: unknown }).removed = 'not a list';

    const document = sharedDocument(initial);

    PinCatalogChange(document.value.pinCatalog, (pinCatalog) => {
      PinCatalogRemovePin(pinCatalog, keyToId(jog, PIN_ID_SYMBOL));
    });

    const result = stored(document) as PinCatalog;

    expect(Object.keys(result.pins)).not.toContain(jog);
    expect(result.removed).toBe('not a list');
  });

  it('does not replace an existing pin when adding one', () => {
    const initial = catalog();
    const jog = pinKey(initial, 'Go on a jog');
    const document = sharedDocument(initial);
    let added: boolean | undefined;

    PinCatalogChange(document.value.pinCatalog, (pinCatalog) => {
      added = PinCatalogAddPin(pinCatalog, {
        id: keyToId(jog, PIN_ID_SYMBOL),
        value: { ...initial.pins[jog]!, displayName: 'Go for a walk' },
      });
    });

    expect(added).toBe(false);
    expect((stored(document) as PinCatalog).pins[jog]!.displayName).toBe('Go on a jog');
  });
});

describe('importing a pin catalog file', () => {
  beforeEach(() => {
    // Invalid files are logged.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads an exported catalog', () => {
    const catalog = PinCatalogDefault();

    expect(PinCatalogDeserialize(PinCatalogSerialize(catalog))).toEqual({
      type: 'current',
      current: catalog,
    });
  });

  it('tells a file of a newer version from an invalid one', () => {
    expect(PinCatalogDeserialize(JSON.stringify({ schemaVersion: { 2: {} } }))).toEqual({
      type: 'newer',
      version: 2,
    });
    expect(PinCatalogDeserialize('{')).toEqual({ type: 'invalid' });
    expect(PinCatalogDeserialize(JSON.stringify({ schemaVersion: {} }))).toEqual({
      type: 'invalid',
    });
  });
});

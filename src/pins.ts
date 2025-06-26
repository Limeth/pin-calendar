import { Temporal } from "@js-temporal/polyfill";
import * as A from '@automerge/automerge'
import { changeSubtree, type Ro, type Rop } from "automerge-diy-vue-hooks";
import { toRef, type Ref } from "vue";
// import * as Y from 'yjs';

const LOCAL_STORAGE_KEY_PIN_CATALOG = "pin_catalog";
const LOCAL_STORAGE_KEY_PIN_CALENDAR = "pin_calendar";

type MaybeRop<T> = T | Rop<T>;
type MaybeRo<T> = T | Ro<T>;

type LocalStorageSerializable = {
  version: number;
};

type PinId = string;
type PinCategoryId = string;

type IconSvg = {
  svg: string,
};

type IconEmoji = {
  emoji: string,
  scale: number,
};

// type Icon = IconSvg | IconEmoji;
type Icon = IconEmoji;

export type Archiveable = {
  archived?: boolean,
}

export type PinCategoryInfo = {
  id: PinCategoryId,
  displayName: string,
  description: string,
};

export type PinCategory = PinCategoryInfo & Archiveable & {
  subcategories: PinCategory[],
  pins: Pin[],
};

export type Pin = Archiveable & {
  id: PinId,
  displayName: string,
  description: string,
  icon: Icon,
  backgroundColor: string,
};

export type PinCatalog = LocalStorageSerializable & {
  rootCategories: PinCategory[];

  // Derived properties.
  pins: {
    [id: PinId]: {
      categoryId: PinCategoryId,
      pin: Pin,
    },
  };
  pinCategories: {
    [id: PinCategoryId]: {
      parentId?: PinCategoryId,
      pinCategory: PinCategory,
    },
  };
};

export function PinCatalogNew(): PinCatalog {
  return {
    version: 1,
    rootCategories: [],
    pins: {},
    pinCategories: {},
  }
}

export function PinCatalogClear(self: PinCatalog) {
  self.rootCategories.splice(0, self.rootCategories.length);
  self.pins = {};
  self.pinCategories = {};
}

export function PinCatalogAddPin(self: PinCatalog, categoryId: PinCategoryId, pin: Pin): Pin | null {
  if (categoryId in self.pinCategories) {
    const parentPins = self.pinCategories[categoryId].pinCategory.pins;
    const existingIndex = parentPins.findIndex((currentPin) => currentPin.id === pin.id);
    self.pins[pin.id] = {
      pin,
      categoryId,
    };
    if (existingIndex !== -1) {
      const previousValue = parentPins[existingIndex];
      parentPins[existingIndex] = pin;
      return previousValue;
    } else {
      parentPins.push(pin);
      return null;
    }
  }
  console.error("Failed to add a pin to a category.");
  return null;
}

export function PinCatalogRemovePin(self: PinCatalog, id: PinId): Pin | null {
  if (id in self.pins) {
    const previousValue = self.pins[id];

    // Delete from parent
    const parentPins = self.pinCategories[previousValue.categoryId].pinCategory.pins;
    const existingIndex = parentPins.findIndex((currentPin) => currentPin.id === id);
    parentPins.splice(existingIndex, 1);

    // Delete from map
    delete self.pins[id];

    return previousValue.pin;
  }

  return null;
}

export function PinCatalogAddPinCategory(self: PinCatalog, parentCategoryId: PinCategoryId | undefined, pinCategory: PinCategory): PinCategory | undefined {
  const previousValue = PinCatalogRemovePinCategory(self, pinCategory.id);

  function registerPinCategoryRecursive(pinCatalog: PinCatalog, parentCategoryId: PinCategoryId | undefined, pinCategory: PinCategory) {
    pinCatalog.pinCategories[pinCategory.id] = {
      pinCategory,
    };

    if (parentCategoryId !== undefined)
      pinCatalog.pinCategories[pinCategory.id].parentId = parentCategoryId;

    for (const subcategory of pinCategory.subcategories)
      registerPinCategoryRecursive(pinCatalog, pinCategory.id, subcategory);

    for (const pin of pinCategory.pins)
      pinCatalog.pins[pin.id] = {
        categoryId: pinCategory.id,
        pin,
      };
  }

  registerPinCategoryRecursive(self, parentCategoryId, pinCategory);

  if (parentCategoryId !== undefined) {
    if (parentCategoryId in self.pinCategories) {
      const parentSubcategories = self.pinCategories[parentCategoryId].pinCategory.subcategories;
      parentSubcategories.push(pinCategory);
    } else {
      console.error("Category not found.");
    }
  } else {
    self.rootCategories.push(pinCategory);
  }
  return previousValue;
}

export function PinCatalogRemovePinCategory(self: PinCatalog, id: PinCategoryId): PinCategory | undefined {
  if (id in self.pinCategories) {
    const previousValue = self.pinCategories[id];

    // Recursively delete subcategories
    while (previousValue.pinCategory.subcategories.length > 0)
      PinCatalogRemovePinCategory(self, previousValue.pinCategory.subcategories[0].id);

    // Delete pins
    while (previousValue.pinCategory.pins.length > 0)
      PinCatalogRemovePin(self, previousValue.pinCategory.pins[0].id);

    // Delete from parent
    const parentPinCategories = previousValue.parentId !== undefined ? self.pinCategories[previousValue.parentId].pinCategory.subcategories : self.rootCategories;
    const existingIndex = parentPinCategories.findIndex((currentPinCategory) => currentPinCategory.id === id);
    parentPinCategories.splice(existingIndex, 1);

    /// Delete from map
    delete self.pinCategories[id];

    return previousValue.pinCategory;
  }
}

export function PinCatalogAsJsonValue(self: MaybeRo<PinCatalog>): object {
  return {
    rootCategories: self.rootCategories,
    version: self.version,
  };
}

export function PinCatalogSerialize(self: MaybeRo<PinCatalog>): string {
  return JSON.stringify(PinCatalogAsJsonValue(self));
}

// export function PinCatalogSaveToLocalStorage(self: PinCatalog) {
//   localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CATALOG, this.serialize());
// }

export function PinCatalogDefault(): PinCatalog {
  const pinCatalog = PinCatalogNew();
  PinCatalogAddPinCategory(pinCatalog, undefined, {
    id: 'health',
    displayName: 'Health',
    description: 'Mental and physical health.',
    subcategories: [{
      id: 'health-physical',
      displayName: 'Physical Health',
      description: 'Tasks focused on physical health.',
      subcategories: [],
      pins: [],
    }],
    pins: [],
  });
  PinCatalogAddPinCategory(pinCatalog, 'health', {
    id: 'health-mental',
    displayName: 'Mental Health',
    description: 'Tasks focused on mental health.',
    subcategories: [],
    pins: [{
      id: "self-care",
      displayName: "Do some self-care",
      description: "Spend some personal time",
      icon: { emoji: '', scale: 1 },
      backgroundColor: "#00FF00",
      archived: false,
    }],
  });
  PinCatalogAddPinCategory(pinCatalog, undefined, {
    id: 'hobbies',
    displayName: 'Hobbies',
    description: 'Tasks focused on hobbies.',
    subcategories: [],
    pins: [],
  });
  PinCatalogAddPin(pinCatalog, 'health-physical', {
    id: "jog",
    displayName: "Go on a jog",
    description: "Run at least 5 km",
    icon: { emoji: '', scale: 1 },
    backgroundColor: "#FF0000",
    archived: false,
  });
  PinCatalogAddPin(pinCatalog, 'hobbies', {
    id: "movie",
    displayName: "Watch a movie",
    description: "And enjoy it!",
    icon: { emoji: '', scale: 1 },
    backgroundColor: "#0000FF",
    archived: false,
  });
  return pinCatalog;
}

export function PinCatalogFromJsonValue(json: unknown): PinCatalog | null {
  if (typeof json !== 'object' || json === null)
    return null;

  if (!('version' in json)) {
    console.error("No version found.");
    return null;
  }

  if (typeof json.version !== 'number' || json.version > PinCatalogNew().version) {
    console.error("Unsupported catalog version: " + json.version);
    return null;
  }

  const catalog = PinCatalogNew();

  if ('rootCategories' in json && Array.isArray(json.rootCategories))
    for (const rootCategory of json.rootCategories) {
      PinCatalogAddPinCategory(catalog, undefined, rootCategory);
    }

  return catalog;
}

export function PinCatalogDeserialize(serialized: string): PinCatalog | null {
  return PinCatalogFromJsonValue(JSON.parse(serialized));
}

// static loadFromLocalStorage(): PinCatalog | null {
//   const string = localStorage.getItem(LOCAL_STORAGE_KEY_PIN_CATALOG);

//   if (string === null)
//     return null;

//   return this.deserialize(string);
// }

// static loadFromLocalStorageOrDefault(): PinCatalog {
//   const loaded = this.loadFromLocalStorage();

//   if (loaded !== null)
//     return loaded;
//   else {
//     const catalog = this.default();
//     catalog.saveToLocalStorage();
//     return catalog;
//   }
// }

export type PinnedPin = {
  count: number, // TODO: Allow more than 1
};

export type PinDayPins = {
  [pinId: PinId]: PinnedPin
};

export type PinDay = {
  pins: Array<PinId>;
}

function PinDayNew(): PinDay {
  return {
    pins: []
  };
}

function PinDayHasPinById(self: PinDay | Ro<PinDay>, pinId: string): boolean {
  return self.pins.includes(pinId);
}

export function PinDayHasPin(self: PinDay | Ro<PinDay>, pin: Pin): boolean {
  return PinDayHasPinById(self, pin.id);
}

function PinDayAddPinById(self: PinDay, pinId: string): boolean {
  if (PinDayHasPinById(self, pinId))
    return false;
  else {
    self.pins.push(pinId);
    return true;
  }
}

export function PinDayAddPin(self: PinDay, pin: Pin): boolean {
  return PinDayAddPinById(self, pin.id);
}

function PinDayRemovePinById(self: PinDay, pinId: string): boolean {
  let removed = false;

  while (true) {
    const index = self.pins.findIndex((currentPinId) => currentPinId === pinId);

    if (index === -1)
      break;

    self.pins.splice(index, 1)
    removed = true;
  }

  return removed;
}

export function PinDayRemovePin(self: PinDay, pin: Pin): boolean {
  return PinDayRemovePinById(self, pin.id);
}

export function PinDaySetPinPresence(self: PinDay, pin: Pin, presence: boolean): boolean {
  if (presence)
    return PinDayAddPin(self, pin);
  else
    return PinDayRemovePin(self, pin);
}

export function PinDayTogglePin(self: PinDay, pin: Pin): boolean {
  const newValue = !PinDayHasPin(self, pin);
  PinDaySetPinPresence(self, pin, newValue);
  return newValue;
}

export function PinDayIsEmpty(self: PinDay): boolean {
  return self.pins.length === 0;
}

/// Creates an optimized clone of this pin day.
function PinDayAsJsonValue(self: MaybeRo<PinDay>): PinDay {
  return {
    // Deduplicate pins.
    pins: Array.from(new Set(self.pins)),
  };
}

function PinDayFromJsonValue(json: unknown): PinDay | null {
  if (typeof json !== 'object' || json === null)
    return null;

  const pinDay = PinDayNew();

  if ('pins' in json && Array.isArray(json.pins))
    for (const pinId of json.pins)
      PinDayAddPinById(pinDay, pinId);

  return pinDay;
}

export type PinCalendarDays = {
  [key: string]: PinDay,
};

export type PinCalendar = LocalStorageSerializable & {
  days: PinCalendarDays;
}

export function PinCalendarNew(): PinCalendar {
  return {
    version: 1,
    days: {},
  };
}

export function PinCalendarClear(self: PinCalendar) {
  self.days = {};
}

function PinCalendarGetDayRefByKey(self: Ref<Rop<PinCalendar>>, key: string): Ref<Rop<PinDay>> | null {
  if (key in self.value.days)
    return toRef(self.value.days, key);
  else
    return null;
}

function PinCalendarGetDayByKey<P extends MaybeRop<PinCalendar>>(self: P, key: string): P['days'][string] | null {
  return (self.days[key] as P['days'][string] | undefined) ?? null;
}

function PinCalendarGetOrDefaultDayByKey(self: PinCalendar, key: string): PinDay {
  if (key in self.days)
    return self.days[key];
  else {
    const day = PinDayNew();
    self.days[key] = day
    return day;
  }
}

function PinCalendarPrepareDayByKey(self: Rop<PinCalendar>, key: string): boolean {
  if (!(key in self.days)) {
    self[changeSubtree]((pinCalendar: PinCalendar) => {
      pinCalendar.days[key] = PinDayNew();
    })
    return false;
  }
  else
    return true;
}

export function PinCalendarGetDayRef(self: Ref<Rop<PinCalendar>>, day: Temporal.PlainDate): Ref<Rop<PinDay>> | null {
  return PinCalendarGetDayRefByKey(self, PinCalendarDayToKey(day));
}

export function PinCalendarGetDay<P extends MaybeRop<PinCalendar>>(self: P, day: Temporal.PlainDate): P['days'][string] | null {
  return PinCalendarGetDayByKey(self, PinCalendarDayToKey(day));
}

/// Returns `true` if the day was already prepared. Otherwise, the document must be updated.
export function PinCalendarPrepareDay(self: Rop<PinCalendar>, day: Temporal.PlainDate): boolean {
  return PinCalendarPrepareDayByKey(self, PinCalendarDayToKey(day));
}

export function PinCalendarGetPinsOnDay(self: Rop<PinCalendar>, catalog: Rop<PinCatalog>, day: Temporal.PlainDate): Set<Pin> {
  const result: Set<Pin> = new Set();
  const pinDay = PinCalendarGetDay(self, day);

  if (pinDay !== null) {
    for (const pinId of pinDay.pins) {
      const pin = catalog.pins[pinId];

      if (pin !== undefined) {
        result.add(pin.pin);
      }
    }
  }

  return result;
}

function PinCalendarAsJsonValue(self: MaybeRo<PinCalendar>): object {
  const calendarToSave: { days: { [key: string]: PinDay } } = { days: {} };

  for (const [key, day] of Object.entries(self.days))
    if (!PinDayIsEmpty(day))
      calendarToSave.days[key] = PinDayAsJsonValue(day);

  return calendarToSave;
}

export function PinCalendarSerialize(self: MaybeRo<PinCalendar>): string {
  return JSON.stringify(PinCalendarAsJsonValue(self));
}

// function PinCalendarSaveToLocalStorage(self: Y.Map<PinCalendar>, ) {
//     localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CALENDAR, this.serialize());
// }

function PinCalendarFromJsonValue(json: unknown): PinCalendar | null {
  if (typeof json !== 'object' || json === null)
    return null;

  if (!('version' in json)) {
    console.error("No version found.");
    return null;
  }

  if (typeof json.version !== 'number' || json.version > PinCalendarNew().version) {
    console.error("Unsupported calendar version: " + json.version);
    return null;
  }

  const calendar = PinCalendarNew();

  if ('days' in json && typeof json.days === 'object' && json.days !== null)
    for (const [key, value] of Object.entries(json.days)) {
      const pinDay = PinDayFromJsonValue(value)

      if (pinDay !== null)
        calendar.days[key] = pinDay;
    }

  return calendar;
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

    for (const pinId of loadedDay.pins)
      PinDayAddPinById(day, pinId);
  }
}

export function PinCalendarDeserialize(serialized: string): PinCalendar | null {
  return PinCalendarFromJsonValue(JSON.parse(serialized));
}

// function PinCalendarLoadFromLocalStorage(self: Y.Map<PinCalendar>): PinCalendar | null {
//     const string = localStorage.getItem(LOCAL_STORAGE_KEY_PIN_CALENDAR);

//     if (string === null)
//         return null;

//     return this.deserialize(string);
// }

// function PinCalendarLoadFromLocalStorageOrDefault(self: Y.Map<PinCalendar>): PinCalendar {
//     const loaded = this.loadFromLocalStorage();

//     if (loaded !== null)
//         return loaded;
//     else
//     {
//         const calendar = new PinCalendar();
//         calendar.saveToLocalStorage();
//         return calendar;
//     }
// }

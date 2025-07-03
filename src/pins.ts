import { Temporal } from '@js-temporal/polyfill';
import * as A from '@automerge/automerge';
import { changeSubtree, type Ro, type Rop } from 'automerge-diy-vue-hooks';
import { toRef, type Ref } from 'vue';
import * as uuid from 'uuid';
import { FormatRegistry, Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
// import * as Y from 'yjs';

FormatRegistry.Set('uuid', (value) => uuid.validate(value));
FormatRegistry.Set('date', (value) => {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
});

const LOCAL_STORAGE_KEY_PIN_CATALOG = 'pin_catalog';
const LOCAL_STORAGE_KEY_PIN_CALENDAR = 'pin_calendar';

type MaybeRop<T> = T | Rop<T>;
type MaybeRo<T> = T | Ro<T>;

const LocalStorageSerializableSchema = Type.Object({
  version: Type.Integer(),
});

type LocalStorageSerializable = Static<typeof LocalStorageSerializableSchema>;

// ID's are stringified UUIDv7
type Uuid = string;

export const PIN_ID_SYMBOL: unique symbol = Symbol.for('pinId');
export const PIN_CATEGORY_ID_SYMBOL: unique symbol = Symbol.for('pinCategoryId');

export type PinId = RegistryId<typeof PIN_ID_SYMBOL>;
export type PinCategoryId = RegistryId<typeof PIN_CATEGORY_ID_SYMBOL>;

const IconSvgSchema = Type.Object({
  svg: Type.String(),
});

type IconSvg = Static<typeof IconSvgSchema>;

const IconEmojiSchema = Type.Object({
  emoji: Type.String(),
  scale: Type.Number(),
});

type IconEmoji = Static<typeof IconEmojiSchema>;

const IconSchema = Type.Union([IconEmojiSchema /*IconSvgSchema*/]);

type Icon = Static<typeof IconSchema>;

const ArchivableSchema = Type.Object({
  archived: Type.Optional(Type.Boolean()),
});

export type Archiveable = Static<typeof ArchivableSchema>;

export class RegistryId<S extends symbol> {
  readonly idSymbol: S;
  readonly key: Uuid;

  constructor(idSymbol: S, key: Uuid) {
    this.idSymbol = idSymbol;
    this.key = key;
  }

  isEqualStatic(rhs: RegistryId<S>): boolean {
    return this.key === rhs.key;
  }

  isEqualDynamic<S2 extends symbol>(rhs: RegistryId<S2>): boolean {
    return this.key === rhs.key && (this.idSymbol as symbol) === (rhs.idSymbol as symbol);
  }
}

// TODO: Assert that IdKey is the same type?
function IdKeySchema<I extends { key: unknown }>() {
  return Type.String({
    format: 'uuid',
  });
}

export type IdKey<I extends { key: unknown }> = I['key'];

export type Registered<I, T> = {
  id: I;
  value: T;
};

const PinCategoryDescriptorSchema = Type.Intersect([
  ArchivableSchema,
  Type.Object({
    subcategories: Type.Array(IdKeySchema<PinCategoryId>()),
    pins: Type.Array(IdKeySchema<PinId>()),
    displayName: Type.String(),
    description: Type.String(),
  }),
]);

export type PinCategoryDescriptor = Static<typeof PinCategoryDescriptorSchema>;

export type PinCategory = Registered<PinCategoryId, PinCategoryDescriptor>;

const PinDescriptorSchema = Type.Intersect([
  ArchivableSchema,
  Type.Object({
    displayName: Type.String(),
    description: Type.String(),
    icon: IconSchema,
    backgroundColor: Type.String(),
  }),
]);

export type PinDescriptor = Static<typeof PinDescriptorSchema>;

export type Pin = Registered<PinId, PinDescriptor>;

export function keyToId<S extends symbol>(key: IdKey<RegistryId<S>>, idSymbol: S): RegistryId<S> {
  return new RegistryId(idSymbol, key);
}

function generateId<S extends symbol>(idSymbol: S): RegistryId<S> {
  return keyToId(uuid.v7(), idSymbol);
}

export function generatePinId(): PinId {
  return generateId(PIN_ID_SYMBOL);
}

export function generatePinCategoryId(): PinCategoryId {
  return generateId(PIN_CATEGORY_ID_SYMBOL);
}

export type PinDescriptorTypeOf<T extends { pins: { [id: IdKey<PinId>]: unknown } }> =
  T['pins'][IdKey<PinId>];
export type PinTypeOf<T extends { pins: { [id: IdKey<PinId>]: unknown } }> = Registered<
  PinId,
  PinDescriptorTypeOf<T>
>;
export type PinCategoryTypeOf<
  T extends { pinCategories: { [id: IdKey<PinCategoryId>]: unknown } },
> = Registered<PinCategoryId, T['pinCategories'][IdKey<PinCategoryId>]>;

const PinCatalogSchema = Type.Intersect([
  LocalStorageSerializableSchema,
  Type.Object({
    pins: Type.Record(IdKeySchema<PinId>(), PinDescriptorSchema),
    pinCategories: Type.Record(IdKeySchema<PinCategoryId>(), PinCategoryDescriptorSchema),
  }),
]);

export type PinCatalog = Static<typeof PinCatalogSchema>;

export function PinCatalogNew(): PinCatalog {
  return {
    version: 1,
    pins: {},
    pinCategories: {},
  };
}

export function PinCatalogClear(self: PinCatalog) {
  self.pins = {};
  self.pinCategories = {};
}

export function PinCatalogGetPinById<T extends MaybeRop<PinCatalog>>(
  self: T,
  pinId: PinId,
): PinTypeOf<T> | null {
  const pinDescriptor = self.pins[pinId.key];

  if (pinDescriptor === undefined) {
    return null;
  }

  return {
    id: pinId,
    value: pinDescriptor,
  } as PinTypeOf<T>;
}

export function PinCatalogGetPinCategoryById<T extends MaybeRop<PinCatalog>>(
  self: T,
  pinCategoryId: PinCategoryId,
): PinCategoryTypeOf<T> | null {
  const pinCategoryDescriptor = self.pinCategories[pinCategoryId.key];

  if (pinCategoryDescriptor === undefined) {
    return null;
  }

  return {
    id: pinCategoryId,
    value: pinCategoryDescriptor,
  } as PinCategoryTypeOf<T>;
}

function idSetAdd<S extends symbol>(idSet: IdKey<RegistryId<S>>[], id: RegistryId<S>): boolean {
  const existingIndex = idSet.findIndex((currentId) => currentId === id.key);

  if (existingIndex !== -1) {
    // Pin is already present.
    return false;
  } else {
    idSet.push(id.key);
    return true;
  }
}

function idSetRemove<S extends symbol>(idSet: IdKey<RegistryId<S>>[], id: RegistryId<S>): boolean {
  let removed = false;

  while (true) {
    const existingIndex = idSet.findIndex((currentId) => currentId === id.key);

    if (existingIndex === -1) return removed;

    idSet.splice(existingIndex, 1);
    removed = true;
  }
}

function PinCategoryAddPinById(self: PinCategory, pinId: PinId): boolean {
  return idSetAdd(self.value.pins, pinId);
}

function PinCategoryAddSubcategoryById(self: PinCategory, pinCategoryId: PinCategoryId): boolean {
  return idSetAdd(self.value.subcategories, pinCategoryId);
}

export function PinCategoryAddPin(self: PinCategory, pin: Pin): boolean {
  return PinCategoryAddPinById(self, pin.id);
}

export function PinCategoryAddSubcategory(self: PinCategory, pinCategory: PinCategory): boolean {
  return PinCategoryAddSubcategoryById(self, pinCategory.id);
}

export function PinCategoryRemovePin(self: PinCategoryDescriptor, pinId: PinId): boolean {
  return idSetRemove(self.pins, pinId);
}

export function PinCategoryRemoveSubcategory(
  self: PinCategoryDescriptor,
  pinCategoryId: PinCategoryId,
): boolean {
  return idSetRemove(self.subcategories, pinCategoryId);
}

export function PinCatalogAddPin(self: PinCatalog, pin: Pin): boolean {
  if (pin.id.key in self.pinCategories) return false;
  else {
    self.pins[pin.id.key] = pin.value;
    return true;
  }
}

export function PinCatalogCreatePin(self: PinCatalog, pinDescriptor: PinDescriptor): Pin {
  const pin = {
    id: generatePinId(),
    value: pinDescriptor,
  };

  PinCatalogAddPin(self, pin);

  return pin;
}

export function PinCatalogAddPinToCategory(
  self: PinCatalog,
  categoryId: PinCategoryId,
  pin: Pin,
): Pin | null {
  const pinCategory = PinCatalogGetPinCategoryById(self, categoryId);

  if (pinCategory === null) {
    console.error('Failed to add a pin to non-existent category.');
    return null;
  }

  PinCategoryAddPin(pinCategory, pin);
  return pin;
}

export function PinCatalogCreateAndAddPinToCategory(
  self: PinCatalog,
  categoryId: PinCategoryId,
  pinDescriptor: PinDescriptor,
): Pin | null {
  const pin = PinCatalogCreatePin(self, pinDescriptor);
  return PinCatalogAddPinToCategory(self, categoryId, pin);
}

export function PinCatalogRemovePin(self: PinCatalog, id: PinId): Pin | null {
  const previousValue = PinCatalogGetPinById(self, id);

  if (previousValue !== null) {
    // Delete from parents
    for (const parent of Object.values(self.pinCategories)) PinCategoryRemovePin(parent, id);

    // Delete from map
    delete self.pins[id.key];
  }

  return previousValue;
}

export function PinCatalogAddPinCategory(self: PinCatalog, pinCategory: PinCategory): boolean {
  if (pinCategory.id.key in self.pinCategories) return false;
  else {
    self.pinCategories[pinCategory.id.key] = pinCategory.value;
    return true;
  }
}

export function PinCatalogCreatePinCategory(
  self: PinCatalog,
  pinCategoryDescriptor: PinCategoryDescriptor,
): PinCategory {
  const pinCategory = {
    id: generatePinCategoryId(),
    value: pinCategoryDescriptor,
  };

  PinCatalogAddPinCategory(self, pinCategory);

  return pinCategory;
}

export function PinCatalogAddSubcategoryToCategory(
  self: PinCatalog,
  categoryId: PinCategoryId,
  subcategory: PinCategory,
): PinCategory | null {
  const pinCategory = PinCatalogGetPinCategoryById(self, categoryId);

  if (pinCategory === null) {
    console.error('Failed to add a subcategory to non-existent category.');
    return null;
  }

  PinCategoryAddSubcategory(pinCategory, subcategory);
  return subcategory;
}

export function PinCatalogCreateAndAddSubcategoryToCategory(
  self: PinCatalog,
  categoryId: PinCategoryId | null,
  subcategoryDescriptor: PinCategoryDescriptor,
): PinCategory | null {
  const subcategory = PinCatalogCreatePinCategory(self, subcategoryDescriptor);
  if (categoryId !== null) return PinCatalogAddSubcategoryToCategory(self, categoryId, subcategory);
  else return subcategory;
}

export function PinCatalogRemoveSubcategoryFromCategory(
  self: PinCatalog,
  categoryId: PinCategoryId,
  subcategoryId: PinCategoryId,
): boolean {
  const pinCategory = PinCatalogGetPinCategoryById(self, categoryId);

  if (pinCategory === null) return false;

  return PinCategoryRemoveSubcategory(pinCategory.value, subcategoryId);
}

// export function PinCatalogReplacePinCategory(self: PinCatalog, parentCategoryId: PinCategoryId | undefined, pinCategory: PinCategory): PinCategory | undefined {
//   const previousValue = PinCatalogRemovePinCategory(self, pinCategory.id);
// }

export function PinCatalogRemovePinCategory(
  self: PinCatalog,
  id: PinCategoryId,
): PinCategory | undefined {
  const previousValue = PinCatalogGetPinCategoryById(self, id);

  if (previousValue !== null) {
    // Delete from parents
    for (const parent of Object.values(self.pinCategories)) {
      PinCategoryRemoveSubcategory(parent, id);
    }

    /// Delete from map
    delete self.pinCategories[id.key];
  }

  return previousValue ?? undefined;
}

export function PinCatalogGetPins<T extends MaybeRop<PinCatalog>>(self: T): PinTypeOf<T>[] {
  const pins: PinTypeOf<T>[] = [];

  for (const [key, pin] of Object.entries(self.pins))
    pins.push({
      id: keyToId(key, PIN_ID_SYMBOL),
      value: pin,
    } as PinTypeOf<T>); // TODO: Why is type assertion here necessary while unnecessary in PinCatalogGetPinCategories?

  return pins;
}

export function PinCatalogGetPinCategories<T extends MaybeRop<PinCatalog>>(
  self: T,
): PinCategoryTypeOf<T>[] {
  const pinCategories: PinCategoryTypeOf<T>[] = [];

  for (const [key, category] of Object.entries(self.pinCategories))
    pinCategories.push({
      id: keyToId(key, PIN_CATEGORY_ID_SYMBOL),
      value: category,
    });

  return pinCategories;
}

export function PinCatalogGetRootCategories<T extends MaybeRop<PinCatalog>>(
  self: T,
): PinCategoryTypeOf<T>[] {
  const nonRootCategories = new Set();

  for (const pinCategory of Object.values(self.pinCategories))
    for (const subcategoryIdKey of pinCategory.subcategories)
      nonRootCategories.add(subcategoryIdKey);

  const rootCategories: PinCategoryTypeOf<T>[] = [];

  for (const [key, category] of Object.entries(self.pinCategories))
    if (!nonRootCategories.has(key))
      rootCategories.push({
        id: keyToId(key, PIN_CATEGORY_ID_SYMBOL),
        value: category,
      });

  return rootCategories;
}

export function PinCatalogAsJsonValue(self: MaybeRo<PinCatalog>): object {
  return self;
}

export function PinCatalogSerialize(self: MaybeRo<PinCatalog>): string {
  return JSON.stringify(PinCatalogAsJsonValue(self));
}

export function PinCatalogGetPinIdsInCategory(
  self: MaybeRop<PinCatalog>,
  pinCategoryId: PinCategoryId,
): PinId[] {
  const pinCategory = PinCatalogGetPinCategoryById(self, pinCategoryId);

  if (pinCategory === null) return [];

  const keySet = new Set<IdKey<PinId>>();

  for (const pinIdKey of pinCategory.value.pins) keySet.add(pinIdKey);

  const result: PinId[] = [];

  for (const pinIdKey of keySet) result.push(keyToId(pinIdKey, PIN_ID_SYMBOL));

  return Array.from(result);
}

export function PinCatalogGetPinsInCategory<T extends MaybeRop<PinCatalog>>(
  self: T,
  pinCategoryId: PinCategoryId,
): PinTypeOf<T>[] {
  const result: PinTypeOf<T>[] = [];

  for (const pinId of PinCatalogGetPinIdsInCategory(self, pinCategoryId)) {
    const pin = PinCatalogGetPinById(self, pinId);

    if (pin !== null) result.push(pin);
  }

  return result;
}

export function PinCatalogGetSubcategoryIdsInCategory(
  self: MaybeRop<PinCatalog>,
  pinCategoryId: PinCategoryId,
): PinCategoryId[] {
  const pinCategory = PinCatalogGetPinCategoryById(self, pinCategoryId);

  if (pinCategory === null) return [];

  const keySet = new Set<IdKey<PinId>>();

  for (const subcategoryIdKey of pinCategory.value.subcategories) keySet.add(subcategoryIdKey);

  const result: PinCategoryId[] = [];

  for (const pinIdKey of keySet) result.push(keyToId(pinIdKey, PIN_CATEGORY_ID_SYMBOL));

  return Array.from(result);
}

export function PinCatalogGetSubcategoriesInCategory<T extends MaybeRop<PinCatalog>>(
  self: T,
  pinCategoryId: PinCategoryId,
): PinCategoryTypeOf<T>[] {
  const result: PinCategoryTypeOf<T>[] = [];

  for (const subcategoryId of PinCatalogGetSubcategoryIdsInCategory(self, pinCategoryId)) {
    const subcategory = PinCatalogGetPinCategoryById(self, subcategoryId);

    if (subcategory !== null) result.push(subcategory);
  }

  return result;
}

// export function PinCatalogSaveToLocalStorage(self: PinCatalog) {
//   localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CATALOG, this.serialize());
// }

export function PinCatalogDefault(): PinCatalog {
  const pinCatalog = PinCatalogNew();
  const pinCategoryHealth = PinCatalogCreateAndAddSubcategoryToCategory(pinCatalog, null, {
    displayName: 'Health',
    description: 'Mental and physical health.',
    subcategories: [],
    pins: [],
  });
  const pinCategoryHealthPhysical = PinCatalogCreateAndAddSubcategoryToCategory(
    pinCatalog,
    pinCategoryHealth!.id,
    {
      displayName: 'Physical Health',
      description: 'Tasks focused on physical health.',
      subcategories: [],
      pins: [],
    },
  );
  PinCatalogCreateAndAddPinToCategory(pinCatalog, pinCategoryHealthPhysical!.id, {
    displayName: 'Go on a jog',
    description: 'Run at least 5 km',
    icon: { emoji: '', scale: 1 },
    backgroundColor: '#FF0000',
  });
  const pinCategoryHealthMental = PinCatalogCreateAndAddSubcategoryToCategory(
    pinCatalog,
    pinCategoryHealth!.id,
    {
      displayName: 'Mental Health',
      description: 'Tasks focused on mental health.',
      subcategories: [],
      pins: [],
    },
  );
  PinCatalogCreateAndAddPinToCategory(pinCatalog, pinCategoryHealthMental!.id, {
    displayName: 'Do some self-care',
    description: 'Spend some personal time',
    icon: { emoji: '', scale: 1 },
    backgroundColor: '#00FF00',
  });
  const pinCategoryHobbies = PinCatalogCreateAndAddSubcategoryToCategory(pinCatalog, null, {
    displayName: 'Hobbies',
    description: 'Tasks focused on hobbies.',
    subcategories: [],
    pins: [],
  });
  PinCatalogCreateAndAddPinToCategory(pinCatalog, pinCategoryHobbies!.id, {
    displayName: 'Watch a movie',
    description: 'And enjoy it!',
    icon: { emoji: '', scale: 1 },
    backgroundColor: '#0000FF',
  });
  return pinCatalog;
}

export function PinCatalogFromJsonValue(json: unknown): PinCatalog | null {
  if (typeof json !== 'object' || json === null) return null;

  if (!('version' in json)) {
    console.error('No version found.');
    return null;
  }

  if (typeof json.version !== 'number' || json.version > PinCatalogNew().version) {
    console.error('Unsupported catalog version: ' + json.version);
    return null;
  }

  try {
    return Value.Parse(PinCatalogSchema, json);
  } catch (error) {
    console.error(error);
    return null;
  }
}

export function PinCatalogDeserialize(serialized: string): PinCatalog | null {
  return PinCatalogFromJsonValue(JSON.parse(serialized));
}

export type PinnedPin = {
  count: number; // TODO: Allow more than 1
};

export type PinDayPins = {
  [pinId: IdKey<PinId>]: PinnedPin;
};

const PinDaySchema = Type.Object({
  pins: Type.Array(IdKeySchema<PinId>()),
});

export type PinDay = Static<typeof PinDaySchema>;

function PinDayNew(): PinDay {
  return {
    pins: [],
  };
}

function PinDayHasPinById(self: PinDay | Ro<PinDay>, pinId: PinId): boolean {
  return self.pins.includes(pinId.key);
}

export function PinDayHasPin(self: PinDay | Ro<PinDay>, pin: Pin): boolean {
  return PinDayHasPinById(self, pin.id);
}

function PinDayAddPinById(self: PinDay, pinId: PinId): boolean {
  if (PinDayHasPinById(self, pinId)) return false;
  else {
    self.pins.push(pinId.key);
    return true;
  }
}

export function PinDayAddPin(self: PinDay, pin: Pin): boolean {
  return PinDayAddPinById(self, pin.id);
}

function PinDayRemovePinById(self: PinDay, pinId: PinId): boolean {
  let removed = false;

  while (true) {
    const index = self.pins.findIndex((currentPinId) => currentPinId === pinId.key);

    if (index === -1) break;

    self.pins.splice(index, 1);
    removed = true;
  }

  return removed;
}

export function PinDayRemovePin(self: PinDay, pin: Pin): boolean {
  return PinDayRemovePinById(self, pin.id);
}

export function PinDaySetPinPresence(self: PinDay, pin: Pin, presence: boolean): boolean {
  if (presence) return PinDayAddPin(self, pin);
  else return PinDayRemovePin(self, pin);
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
  if (typeof json !== 'object' || json === null) return null;

  const pinDay = PinDayNew();

  if ('pins' in json && Array.isArray(json.pins))
    for (const pinId of json.pins) PinDayAddPinById(pinDay, pinId);

  return pinDay;
}

const PinCalendarDaysSchema = Type.Record(
  Type.String({
    format: 'date',
  }),
  PinDaySchema,
);

export type PinCalendarDays = Static<typeof PinCalendarDaysSchema>;

const PinCalendarSchema = Type.Intersect([
  LocalStorageSerializableSchema,
  Type.Object({
    days: PinCalendarDaysSchema,
  }),
]);

export type PinCalendar = Static<typeof PinCalendarSchema>;

export function PinCalendarNew(): PinCalendar {
  return {
    version: 1,
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
  if (key in self.days) return self.days[key];
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
  return self;
}

export function PinCalendarSerialize(self: MaybeRo<PinCalendar>): string {
  return JSON.stringify(PinCalendarAsJsonValue(self));
}

// function PinCalendarSaveToLocalStorage(self: Y.Map<PinCalendar>, ) {
//     localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CALENDAR, this.serialize());
// }

function PinCalendarFromJsonValue(json: unknown): PinCalendar | null {
  if (typeof json !== 'object' || json === null) return null;

  if (!('version' in json)) {
    console.error('No version found.');
    return null;
  }

  if (typeof json.version !== 'number' || json.version > PinCalendarNew().version) {
    console.error('Unsupported calendar version: ' + json.version);
    return null;
  }

  try {
    return Value.Parse(PinCalendarSchema, json);
  } catch (error) {
    console.error(error);
    return null;
  }
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

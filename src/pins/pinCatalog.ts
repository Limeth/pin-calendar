import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { getCurrentVersion, makeVersioned, Versioned } from '@/versioned';
import {
  ArchivableSchema,
  generateId,
  IdKeySchema,
  idSetAdd,
  idSetRemove,
  keyToId,
  type RegistryId,
  Variant,
  type Registered,
} from './util';
import {
  isObject,
  readEntry,
  readKeys,
  readProperty,
  type Unchecked,
  type UncheckedRopValue,
} from '@/validation';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';

export const PIN_ID_SYMBOL: unique symbol = Symbol.for('pinId');
export const PIN_CATEGORY_ID_SYMBOL: unique symbol = Symbol.for('pinCategoryId');

export type PinId = RegistryId<typeof PIN_ID_SYMBOL>;
export type PinCategoryId = RegistryId<typeof PIN_CATEGORY_ID_SYMBOL>;

const IconTypeImageSchema = Type.Object({
  base64: Type.String(),
  scale: Type.Number(),
});

export type IconTypeImage = Static<typeof IconTypeImageSchema>;

const IconTypeEmojiSchema = Type.Object({
  emoji: Type.String(),
  scale: Type.Number(),
});

export type IconTypeEmoji = Static<typeof IconTypeEmojiSchema>;

const IconSchema = Variant(
  'type',
  Type.Object({
    image: IconTypeImageSchema,
    emoji: IconTypeEmojiSchema,
  }),
);

export type Icon = Static<typeof IconSchema>;

const PinCategoryDescriptorSchema = Type.Intersect([
  ArchivableSchema,
  Type.Object({
    subcategories: Type.Array(IdKeySchema<PinCategoryId>()),
    pins: Type.Array(IdKeySchema<PinId>()),
    displayName: Type.String(),
    description: Type.String(),
    details: Type.Optional(Type.String()), // Added in v0.1.2
  }),
]);

export type PinCategoryDescriptor = Static<typeof PinCategoryDescriptorSchema>;

export type PinCategory = Registered<PinCategoryId, PinCategoryDescriptor>;

const PinDescriptorSchema = Type.Intersect([
  ArchivableSchema,
  Type.Object({
    displayName: Type.String(),
    description: Type.String(),
    details: Type.Optional(Type.String()), // Added in v0.1.2
    icon: IconSchema,
    backgroundColor: Type.String(),
  }),
]);

export type PinDescriptor = Static<typeof PinDescriptorSchema>;

export type Pin = Registered<PinId, PinDescriptor>;

export function generatePinId(): PinId {
  return generateId(PIN_ID_SYMBOL);
}

export function generatePinCategoryId(): PinCategoryId {
  return generateId(PIN_CATEGORY_ID_SYMBOL);
}

const PIN_CATALOG_SCHEMA_VERSION_CURRENT = 1;

export const PinCatalogSchema = Type.Object({
  pins: Type.Record(IdKeySchema<PinId>(), PinDescriptorSchema),
  pinCategories: Type.Record(IdKeySchema<PinCategoryId>(), PinCategoryDescriptorSchema),
  /// Any elements that should be removed from all peers are added to this array.
  removed: Type.Array(Type.Union([IdKeySchema<PinId>(), IdKeySchema<PinCategoryId>()])),
});

export type PinCatalog = Static<typeof PinCatalogSchema>;

// The pin catalog of the shared document as it is read, see `UncheckedRop`.
export type PinCatalogUncheckedRop = UncheckedRopValue<PinCatalog>;

// A pin or category read from the pin catalog of the shared document: its document proxy, checked.
export type PinRop = Registered<PinId, Rop<PinDescriptor>>;
export type PinCategoryRop = Registered<PinCategoryId, Rop<PinCategoryDescriptor>>;

// A catalog to read pins and categories from, which are checked: the pin catalog of the shared
// document, read as document proxies, or a catalog written within a change, or read from a file.
type PinCatalogReadable = PinCatalog | PinCatalogUncheckedRop;
type PinOf<C> = C extends PinCatalog ? Pin : PinRop;
type PinCategoryOf<C> = C extends PinCatalog ? PinCategory : PinCategoryRop;

export function PinCatalogNew(): PinCatalog {
  return {
    pins: {},
    pinCategories: {},
    removed: [],
  };
}

export function PinCatalogClear(self: PinCatalog) {
  self.pins = {};
  self.pinCategories = {};
}

// Change the catalog of the shared document, unless it is invalid. Whether it was changed.
export function PinCatalogChange(
  self: PinCatalogUncheckedRop,
  change: (pinCatalog: PinCatalog) => void,
): boolean {
  if (!isObject(self)) {
    console.error('Cannot change the pin catalog, as it is invalid.');
    return false;
  }

  self[changeSubtree](change);
  return true;
}

function PinCatalogGetPinsRecord(self: PinCatalogReadable): unknown {
  return isObject(self) ? self.pins : undefined;
}

function PinCatalogGetPinCategoriesRecord(self: PinCatalogReadable): unknown {
  return isObject(self) ? self.pinCategories : undefined;
}

// The pin, typed as in a catalog written within a change, see `PinOf` for the actual type.
function PinCatalogReadPin(self: PinCatalogReadable, pinId: PinId): Pin | null {
  const value = readEntry(
    PinCatalogSchema.properties.pins,
    PinCatalogGetPinsRecord(self),
    pinId.key,
    `pin ${pinId.key}`,
  );

  return value === undefined ? null : { id: pinId, value };
}

// The category, typed as in a catalog written within a change, see `PinCategoryOf` for the actual
// type.
function PinCatalogReadPinCategory(
  self: PinCatalogReadable,
  pinCategoryId: PinCategoryId,
): PinCategory | null {
  const value = readEntry(
    PinCatalogSchema.properties.pinCategories,
    PinCatalogGetPinCategoriesRecord(self),
    pinCategoryId.key,
    `pin category ${pinCategoryId.key}`,
  );

  return value === undefined ? null : { id: pinCategoryId, value };
}

function PinCatalogReadPins(self: PinCatalogReadable): Pin[] {
  return readKeys(PinCatalogGetPinsRecord(self)).flatMap((key) => {
    const pin = PinCatalogReadPin(self, keyToId(key, PIN_ID_SYMBOL));

    return pin === null ? [] : [pin];
  });
}

function PinCatalogReadPinCategories(self: PinCatalogReadable): PinCategory[] {
  return readKeys(PinCatalogGetPinCategoriesRecord(self)).flatMap((key) => {
    const pinCategory = PinCatalogReadPinCategory(self, keyToId(key, PIN_CATEGORY_ID_SYMBOL));

    return pinCategory === null ? [] : [pinCategory];
  });
}

// The pin, or `null` if the catalog has none, or an invalid one.
export function PinCatalogGetPinById<C extends PinCatalogReadable>(
  self: C,
  pinId: PinId,
): PinOf<C> | null {
  return PinCatalogReadPin(self, pinId) as PinOf<C> | null;
}

// The category, or `null` if the catalog has none, or an invalid one.
export function PinCatalogGetPinCategoryById<C extends PinCatalogReadable>(
  self: C,
  pinCategoryId: PinCategoryId,
): PinCategoryOf<C> | null {
  return PinCatalogReadPinCategory(self, pinCategoryId) as PinCategoryOf<C> | null;
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

// Ensure that the pin or category is deleted from peers in the future, unless the list is invalid.
function PinCatalogAddRemoved<S extends symbol>(self: PinCatalog, id: RegistryId<S>) {
  const removed = readProperty(PinCatalogSchema, self, 'removed', 'removed pins and categories');

  if (removed !== undefined) idSetAdd(removed, id);
}

export function PinCatalogAddPin(self: PinCatalog, pin: Pin): boolean {
  if (!isObject(self.pins) || pin.id.key in self.pins) return false;
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

// Remove the pin, even an invalid one, as it is removed on purpose.
export function PinCatalogRemovePin(self: PinCatalog, id: PinId): Pin | null {
  const previousValue = PinCatalogGetPinById(self, id);

  if (isObject(self.pins) && Object.hasOwn(self.pins, id.key)) {
    // Delete from parents
    for (const parent of PinCatalogReadPinCategories(self)) PinCategoryRemovePin(parent.value, id);

    // Delete from map
    delete self.pins[id.key];
  }

  PinCatalogAddRemoved(self, id);

  return previousValue;
}

export function PinCatalogAddPinCategory(self: PinCatalog, pinCategory: PinCategory): boolean {
  if (!isObject(self.pinCategories) || pinCategory.id.key in self.pinCategories) return false;
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

// Remove the category, even an invalid one, as it is removed on purpose.
export function PinCatalogRemovePinCategory(
  self: PinCatalog,
  id: PinCategoryId,
): PinCategory | undefined {
  const previousValue = PinCatalogGetPinCategoryById(self, id);

  if (isObject(self.pinCategories) && Object.hasOwn(self.pinCategories, id.key)) {
    // Delete from parents
    for (const parent of PinCatalogReadPinCategories(self))
      PinCategoryRemoveSubcategory(parent.value, id);

    // Delete from map
    delete self.pinCategories[id.key];
  }

  PinCatalogAddRemoved(self, id);

  return previousValue ?? undefined;
}

// The valid pins of the catalog.
export function PinCatalogGetPins<C extends PinCatalogReadable>(self: C): PinOf<C>[] {
  return PinCatalogReadPins(self) as PinOf<C>[];
}

// The valid categories of the catalog.
export function PinCatalogGetPinCategories<C extends PinCatalogReadable>(
  self: C,
): PinCategoryOf<C>[] {
  return PinCatalogReadPinCategories(self) as PinCategoryOf<C>[];
}

// The valid categories that are no valid category's subcategory.
export function PinCatalogGetRootCategories<C extends PinCatalogReadable>(
  self: C,
): PinCategoryOf<C>[] {
  const pinCategories = PinCatalogReadPinCategories(self);
  const nonRootCategories = new Set(
    pinCategories.flatMap((pinCategory) => pinCategory.value.subcategories),
  );

  return pinCategories.filter(
    (pinCategory) => !nonRootCategories.has(pinCategory.id.key),
  ) as PinCategoryOf<C>[];
}

export function PinCatalogAsJsonValue(self: Unchecked<PinCatalog>): object {
  return makeVersioned(self, PIN_CATALOG_SCHEMA_VERSION_CURRENT);
}

export function PinCatalogSerialize(self: Unchecked<PinCatalog>): string {
  return JSON.stringify(PinCatalogAsJsonValue(self));
}

export function PinCatalogGetPinIdsInCategory(
  self: PinCatalogReadable,
  pinCategoryId: PinCategoryId,
): PinId[] {
  const pinCategory = PinCatalogReadPinCategory(self, pinCategoryId);

  if (pinCategory === null) return [];

  return [...new Set(pinCategory.value.pins)].map((key) => keyToId(key, PIN_ID_SYMBOL));
}

// The valid pins of the category, in its order.
export function PinCatalogGetPinsInCategory<C extends PinCatalogReadable>(
  self: C,
  pinCategoryId: PinCategoryId,
): PinOf<C>[] {
  return PinCatalogGetPinIdsInCategory(self, pinCategoryId).flatMap((pinId) => {
    const pin = PinCatalogReadPin(self, pinId);

    return pin === null ? [] : [pin];
  }) as PinOf<C>[];
}

export function PinCatalogGetSubcategoryIdsInCategory(
  self: PinCatalogReadable,
  pinCategoryId: PinCategoryId,
): PinCategoryId[] {
  const pinCategory = PinCatalogReadPinCategory(self, pinCategoryId);

  if (pinCategory === null) return [];

  return [...new Set(pinCategory.value.subcategories)].map((key) =>
    keyToId(key, PIN_CATEGORY_ID_SYMBOL),
  );
}

// The valid subcategories of the category, in its order.
export function PinCatalogGetSubcategoriesInCategory<C extends PinCatalogReadable>(
  self: C,
  pinCategoryId: PinCategoryId,
): PinCategoryOf<C>[] {
  return PinCatalogGetSubcategoryIdsInCategory(self, pinCategoryId).flatMap((subcategoryId) => {
    const subcategory = PinCatalogReadPinCategory(self, subcategoryId);

    return subcategory === null ? [] : [subcategory];
  }) as PinCategoryOf<C>[];
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
    icon: {
      type: 'emoji',
      emoji: { emoji: '', scale: 1 },
      image: { base64: '', scale: 1 },
    },
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
    icon: {
      type: 'emoji',
      emoji: { emoji: '', scale: 1 },
      image: { base64: '', scale: 1 },
    },
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
    icon: {
      type: 'emoji',
      emoji: { emoji: '', scale: 1 },
      image: { base64: '', scale: 1 },
    },
    backgroundColor: '#0000FF',
  });
  return pinCatalog;
}

export function PinCatalogFromJsonValue(json: unknown): PinCatalog | null {
  let versioned;

  try {
    versioned = Value.Parse(Versioned(PinCatalogSchema), json);
  } catch (error) {
    console.error(error);
    return null;
  }

  const currentVersion = getCurrentVersion(
    versioned,
    PIN_CATALOG_SCHEMA_VERSION_CURRENT,
    PinCatalogDefault,
  );

  if (currentVersion.type === 'current') return currentVersion.current;
  else if (currentVersion.type === 'unsupported')
    console.error(`Unsupported catalog version: ${currentVersion.version}`);
  return null;
}

export function PinCatalogDeserialize(serialized: string): PinCatalog | null {
  return PinCatalogFromJsonValue(JSON.parse(serialized));
}

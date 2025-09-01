import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  ArchivableSchema,
  generateId,
  IdKeySchema,
  idSetAdd,
  idSetRemove,
  keyToId,
  LocalStorageSerializableSchema,
  RegistryId,
  Variant,
  type IdKey,
  type MaybeRo,
  type MaybeRop,
  type Registered,
} from './util';

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

const PinCatalogSchema = Type.Composite([
  LocalStorageSerializableSchema,
  Type.Object({
    pins: Type.Record(IdKeySchema<PinId>(), PinDescriptorSchema),
    pinCategories: Type.Record(IdKeySchema<PinCategoryId>(), PinCategoryDescriptorSchema),
    /// Any elements that should be removed from all peers are added to this array.
    removed: Type.Array(Type.Union([IdKeySchema<PinId>(), IdKeySchema<PinCategoryId>()])),
  }),
]);

export type PinCatalog = Static<typeof PinCatalogSchema>;

export function PinCatalogNew(): PinCatalog {
  return {
    version: 1,
    pins: {},
    pinCategories: {},
    removed: [],
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

  // Ensure it is deleted from peers in the future.
  idSetAdd(self.removed, id);

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
    for (const parent of Object.values(self.pinCategories))
      PinCategoryRemoveSubcategory(parent, id);

    // Delete from map
    delete self.pinCategories[id.key];
  }

  // Ensure it is deleted from peers in the future.
  idSetAdd(self.removed, id);

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
    icon: { type: 'emoji', emoji: { emoji: '', scale: 1 }, image: { base64: '', scale: 1 } },
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
    icon: { type: 'emoji', emoji: { emoji: '', scale: 1 }, image: { base64: '', scale: 1 } },
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
    icon: { type: 'emoji', emoji: { emoji: '', scale: 1 }, image: { base64: '', scale: 1 } },
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

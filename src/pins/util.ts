import { Temporal } from '@js-temporal/polyfill';
import { FormatRegistry, Type, type Static, type TObject } from '@sinclair/typebox';
import type { Ro, Rop } from 'automerge-diy-vue-hooks';
import * as uuid from 'uuid';

FormatRegistry.Set('uuid', (value) => uuid.validate(value));
FormatRegistry.Set('date', (value) => {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
});

export type MaybeRop<T> = T | Rop<T>;
export type MaybeRo<T> = T | Ro<T>;

export const LocalStorageSerializableSchema = Type.Object({
  version: Type.Integer(),
});

export type LocalStorageSerializable = Static<typeof LocalStorageSerializableSchema>;

type Literal<T, PrimitiveType> = T extends PrimitiveType
  ? PrimitiveType extends T
    ? never
    : T
  : never;
export function Variant<D, T extends TObject>(discriminantField: Literal<D, string>, object: T) {
  // TODO: Check that discriminantField doesn't interfere with the variants.
  return Type.Composite([
    Type.Mapped(Type.Literal(discriminantField), () => Type.KeyOf(object)),
    object,
  ]);
}

export const ArchivableSchema = Type.Object({
  archived: Type.Optional(Type.Boolean()),
});

export type Archiveable = Static<typeof ArchivableSchema>;

// ID's are stringified UUIDv7
type Uuid = string;

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
export function IdKeySchema<_ extends { key: unknown }>() {
  return Type.String({
    format: 'uuid',
  });
}

export type IdKey<I extends { key: unknown }> = I['key'];

export type Registered<I, T> = {
  id: I;
  value: T;
};

export function keyToId<S extends symbol>(key: IdKey<RegistryId<S>>, idSymbol: S): RegistryId<S> {
  return new RegistryId(idSymbol, key);
}

export function generateId<S extends symbol>(idSymbol: S): RegistryId<S> {
  return keyToId(uuid.v7(), idSymbol);
}

export function idSetAdd<S extends symbol>(
  idSet: IdKey<RegistryId<S>>[],
  id: RegistryId<S>,
): boolean {
  const existingIndex = idSet.findIndex((currentId) => currentId === id.key);

  if (existingIndex !== -1) {
    // Pin is already present.
    return false;
  } else {
    idSet.push(id.key);
    return true;
  }
}

export function idSetRemove<S extends symbol>(
  idSet: IdKey<RegistryId<S>>[],
  id: RegistryId<S>,
): boolean {
  let removed = false;

  while (true) {
    const existingIndex = idSet.findIndex((currentId) => currentId === id.key);

    if (existingIndex === -1) return removed;

    idSet.splice(existingIndex, 1);
    removed = true;
  }
}

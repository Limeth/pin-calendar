import { OptionalKind, type Static, type TObject, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Proxy, Ro } from 'automerge-diy-vue-hooks';

// Any value that is not an object, which unchecked data may hold where an object is expected.
type NonObject = string | number | bigint | boolean | symbol | null | undefined;

// Data that this version of the app did not necessarily write, e.g. data from another device, tab or
// app version. An object can be navigated once `isObject` confirmed it is one, but any of its
// properties may be missing, and other values have to be read via a getter that checks them, see
// `readProperty`.
export type Unchecked<T> = T extends object
  ? { readonly [K in keyof T]?: Unchecked<NonNullable<T[K]>> } | NonObject
  : unknown;

// A document proxy, see `Rop`, whose data is unchecked when read, but written with the type `T` of its
// schema. Nested objects are proxies, too, once `isObject` confirmed they are objects. The properties
// in `Trusted` are still read as if they had been checked.
export type UncheckedRop<T, Trusted extends keyof T = never> = {
  readonly [K in Exclude<keyof T, Trusted>]?: UncheckedRopValue<NonNullable<T[K]>>;
} & Pick<Ro<T>, Trusted> &
  Proxy<T>;

type UncheckedRopValue<V> = V extends object ? UncheckedRop<V> | NonObject : unknown;

// Whether an unchecked value is an object, so that it can be navigated, see `Unchecked`.
export function isObject<T>(value: T): value is Exclude<T, NonObject> & object {
  return typeof value === 'object' && value !== null;
}

// The problems already logged, so that values read on every change are only reported once.
const loggedProblems = new Set<string>();

// Check an unchecked value against its schema: the value if it matches, otherwise `undefined`. Unlike
// `Value.Parse`, the value is neither cleaned nor converted, so that it keeps properties unknown to
// this version, e.g. added by a newer one, when it is written back.
export function readValue<S extends TSchema>(
  schema: S,
  value: unknown,
  description: string,
): Static<S> | undefined {
  if (Value.Check(schema, value)) return value;

  const errors = [...Value.Errors(schema, value)].map((error) => `${error.path}: ${error.message}`);
  const problem = `Ignoring an invalid ${description}: ${errors.join(', ')}`;

  if (!loggedProblems.has(problem)) {
    loggedProblems.add(problem);
    console.warn(problem);
  }

  return undefined;
}

// Read a property of an unchecked object, checked against its schema within the object's schema.
// `undefined` if it is missing or invalid.
export function readProperty<S extends TObject, K extends keyof S['properties'] & string>(
  schema: S,
  object: unknown,
  key: K,
  description: string = key,
): Static<S['properties'][K]> | undefined {
  if (!isObject(object)) return undefined;

  const value: unknown = (object as Record<string, unknown>)[key];
  const propertySchema: S['properties'][K] = schema.properties[key];

  // A missing optional property is valid.
  if (value === undefined && OptionalKind in propertySchema) return undefined;

  return readValue(propertySchema, value, description);
}

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { isObject, readEntry, readProperty, readValue, type Unchecked } from '@/validation';
import type { VersionedDocumentWrapper } from '@/documents/wrapper';

const PointSchema = Type.Object({ x: Type.Number(), label: Type.Optional(Type.String()) });

describe('reading a value that may not match its schema', () => {
  it('returns a matching value as it is, keeping unknown properties', () => {
    const value = { x: 1, addedByNewerVersion: true };

    expect(readValue(PointSchema, value, 'point')).toBe(value);
    expect(value).toEqual({ x: 1, addedByNewerVersion: true });
  });

  it('returns undefined for a value that does not match, without converting it', () => {
    expect(readValue(PointSchema, { x: '1' }, 'point')).toBeUndefined();
    expect(readValue(Type.String(), 42, 'string')).toBeUndefined();
  });

  it('reports each problem once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    readValue(PointSchema, { x: 'once' }, 'point reported once');
    readValue(PointSchema, { x: 'once' }, 'point reported once');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('/x');

    warn.mockRestore();
  });
});

describe('reading a property', () => {
  it('checks it against its schema within the object schema', () => {
    expect(readProperty(PointSchema, { x: 1 }, 'x')).toBe(1);
    expect(readProperty(PointSchema, { x: 'one' }, 'x')).toBeUndefined();
    expect(readProperty(PointSchema, { x: 1, label: 'A' }, 'label')).toBe('A');
  });

  it('only reports a missing property if it is required', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readProperty(PointSchema, { x: 1 }, 'label', 'optional label')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    expect(readProperty(PointSchema, {}, 'x', 'required x')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it('returns undefined for something that is not an object', () => {
    expect(readProperty(PointSchema, null, 'x')).toBeUndefined();
    expect(readProperty(PointSchema, 'point', 'x')).toBeUndefined();
  });
});

describe('navigating unchecked data', () => {
  type Nested = { inner: { value: string } };

  it('needs a check that each object is one', () => {
    const valid: Unchecked<Nested> = { inner: { value: 'A' } };
    const invalid: Unchecked<Nested> = { inner: 'not an object' };

    if (!isObject(valid) || !isObject(invalid)) throw new Error('Expected objects.');

    // @ts-expect-error: `inner` may not be an object.
    expect(invalid.inner?.value).toBeUndefined();
    expect(isObject(invalid.inner)).toBe(false);
    expect(isObject(valid.inner) && valid.inner.value).toBe('A');
  });

  it('only counts objects as objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject('object')).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

describe('versioned documents', () => {
  it('are read unchecked, unless properties are explicitly trusted', () => {
    type Document = { value: string };

    expectTypeOf<VersionedDocumentWrapper<Document>['data']['value']['value']>().toBeUnknown();
    expectTypeOf<
      VersionedDocumentWrapper<Document, 'value'>['data']['value']['value']
    >().toEqualTypeOf<string>();
  });
});

describe('reading an entry of a record', () => {
  const PointsSchema = Type.Record(Type.String(), PointSchema);

  it('checks it against the schema of values', () => {
    const points = { a: { x: 1 }, b: { x: 'one' } };

    expect(readEntry(PointsSchema, points, 'a', 'point a')).toBe(points.a);
    expect(readEntry(PointsSchema, points, 'b', 'point b')).toBeUndefined();
  });

  it('only finds entries of the record itself', () => {
    expect(readEntry(PointsSchema, { a: { x: 1 } }, 'missing', 'missing point')).toBeUndefined();
    // Inherited from `Object.prototype`.
    expect(readEntry(PointsSchema, {}, 'toString', 'inherited point')).toBeUndefined();
    expect(readEntry(PointsSchema, 'points', 'a', 'point of a string')).toBeUndefined();
  });
});

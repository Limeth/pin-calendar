import { describe, expect, it } from 'vitest';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { IdKeySchema, Variant } from '@/pins/util';

const VariantsSchema = Type.Object({ number: Type.Number(), text: Type.String() });

describe('variants', () => {
  it('store the values of all variants, and which one is chosen', () => {
    const schema = Variant('type', VariantsSchema);
    const value: Static<typeof schema> = { type: 'number', number: 1, text: '' };

    expect(Value.Check(schema, value)).toBe(true);
    expect(Value.Check(schema, { ...value, type: 'other' })).toBe(false);
  });

  it('cannot have a discriminant with the name of a variant', () => {
    // @ts-expect-error: `number` is the name of a variant.
    Variant('number', VariantsSchema);
  });
});

describe('ID key schemas', () => {
  it('are only for ID types with string keys', () => {
    expect(
      Value.Check(IdKeySchema<{ key: string }>(), '01a19e8c-f2ca-766e-aa30-71aec44a612e'),
    ).toBe(true);
    // @ts-expect-error: The keys are numbers.
    IdKeySchema<{ key: number }>();
  });
});

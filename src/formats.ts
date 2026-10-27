import { Temporal } from '@js-temporal/polyfill';
import { FormatRegistry } from '@sinclair/typebox';
import * as uuid from 'uuid';

// The string formats of the schemas. Every module defining a schema with a format imports this one,
// so that the format is registered before any value is checked against the schema.

FormatRegistry.Set('uuid', (value) => uuid.validate(value));
FormatRegistry.Set('date', (value) => {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
});
FormatRegistry.Set('integer', (value) => {
  return JSON.stringify(parseInt(value)) === value;
});

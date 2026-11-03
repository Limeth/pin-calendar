import { describe, expect, it } from 'vitest';
import { getCurrentVersionRop, type Versioned } from '@/versioned';
import { SharedDocumentGetCurrentVersion, type SharedDocument } from '@/documents/shared';
import { reactiveDocument } from './helpers';

type Data = { value: string };

// A versioned document as other devices or versions of the app may have written it.
function versioned(data: unknown) {
  return reactiveDocument(data as Versioned<Data>);
}

function init(): Data {
  return { value: 'new' };
}

describe('the current version of a document', () => {
  it('is read', () => {
    const result = getCurrentVersionRop(
      versioned({ schemaVersion: { 1: { value: 'a' } } }).value,
      1,
      init,
    );

    expect(result.type).toBe('current');
    expect(result.type === 'current' && result.current.value).toBe('a');
  });

  it('is created if there is none', () => {
    const document = versioned({ schemaVersion: {} });

    expect(getCurrentVersionRop(document.value, 1, init).type).toBe('current');
    expect(JSON.parse(JSON.stringify(document.value))).toEqual({ schemaVersion: { 1: init() } });
  });

  it('is unsupported if a newer one exists', () => {
    const result = getCurrentVersionRop(
      versioned({ schemaVersion: { 1: {}, 2: {} } }).value,
      1,
      init,
    );

    expect(result).toEqual({ type: 'unsupported', version: 2 });
  });

  it('is invalid if it is not an object, and left as it is', () => {
    const document = versioned({ schemaVersion: { 1: 'not an object' } });

    expect(getCurrentVersionRop(document.value, 1, init)).toEqual({ type: 'invalid' });
    expect(getCurrentVersionRop(versioned({ schemaVersion: 'none' }).value, 1, init)).toEqual({
      type: 'invalid',
    });
    expect(JSON.parse(JSON.stringify(document.value))).toEqual({
      schemaVersion: { 1: 'not an object' },
    });
  });

  it('makes loading an invalid shared document fail', () => {
    const document = reactiveDocument({
      schemaVersion: { 1: 42 },
    } as unknown as Versioned<SharedDocument>);

    expect(() => SharedDocumentGetCurrentVersion(document.value)).toThrow(
      'The shared document is invalid.',
    );
  });
});

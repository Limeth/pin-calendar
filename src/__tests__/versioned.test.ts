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

  it('is unsupported if a newer one exists, but still read', () => {
    const result = getCurrentVersionRop(
      versioned({ schemaVersion: { 1: { value: 'a' }, 2: {}, 10: {} } }).value,
      1,
      init,
    );

    expect(result.type).toBe('unsupported');
    expect(result.type === 'unsupported' && result.version).toBe('10');
    expect(result.type === 'unsupported' && result.current?.value).toBe('a');
  });

  it('is unsupported and not created if only a newer one exists', () => {
    const document = versioned({ schemaVersion: { 2: {} } });

    expect(getCurrentVersionRop(document.value, 1, init)).toEqual({
      type: 'unsupported',
      version: '2',
    });
    expect(JSON.parse(JSON.stringify(document.value))).toEqual({ schemaVersion: { 2: {} } });
  });

  it('counts keys that are no version numbers as newer versions', () => {
    for (const key of ['next', '1.5', '01', '-1', '']) {
      const document = versioned({ schemaVersion: { [key]: {} } });

      expect(getCurrentVersionRop(document.value, 1, init)).toEqual({
        type: 'unsupported',
        version: key,
      });
      expect(JSON.parse(JSON.stringify(document.value))).toEqual({ schemaVersion: { [key]: {} } });
    }
  });

  it('is outdated and not created if only older ones exist', () => {
    const document = versioned({ schemaVersion: { 0: {}, 1: { value: 'a' } } });

    expect(getCurrentVersionRop(document.value, 2, init)).toEqual({
      type: 'outdated',
      version: 1,
    });
    expect(JSON.parse(JSON.stringify(document.value))).toEqual({
      schemaVersion: { 0: {}, 1: { value: 'a' } },
    });
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

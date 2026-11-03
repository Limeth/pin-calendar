import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentVersionRop,
  hasNewerVersionRop,
  NewerVersionError,
  parseCurrentVersion,
  type Versioned,
} from '@/versioned';
import { Type } from '@sinclair/typebox';
import {
  SharedDocumentDefault,
  SharedDocumentGetCurrentVersion,
  SharedDocumentGetName,
  type SharedDocument,
} from '@/documents/shared';
import {
  LocalDocumentDefault,
  LocalDocumentGetCurrentVersion,
  LocalDocumentGetLocalPeer,
  type LocalDocument,
} from '@/documents/local';
import { peerId, reactiveDocument } from './helpers';

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
      versioned({ schemaVersion: { 1: { value: 'a' } } }),
      1,
      init,
    );

    expect(result.type).toBe('current');
    expect(result.type === 'current' && result.current.value).toBe('a');
  });

  it('is created if there is none', () => {
    const document = versioned({ schemaVersion: {} });

    const result = getCurrentVersionRop(document, 1, init);

    expect(result.type).toBe('current');
    expect(result.type === 'current' && result.current.value).toBe('new');
    expect(JSON.parse(JSON.stringify(document.value))).toEqual({ schemaVersion: { 1: init() } });
  });

  it('is unsupported if a newer one exists, but still read', () => {
    const result = getCurrentVersionRop(
      versioned({ schemaVersion: { 1: { value: 'a' }, 2: {}, 10: {} } }),
      1,
      init,
    );

    expect(result.type).toBe('unsupported');
    expect(result.type === 'unsupported' && result.version).toBe(10);
    expect(result.type === 'unsupported' && result.current?.value).toBe('a');
  });

  it('is unsupported and not created if only a newer one exists', () => {
    const document = versioned({ schemaVersion: { 2: {} } });

    expect(getCurrentVersionRop(document, 1, init)).toEqual({
      type: 'unsupported',
      version: 2,
    });
    expect(JSON.parse(JSON.stringify(document.value))).toEqual({ schemaVersion: { 2: {} } });
  });

  it('ignores keys that are no version numbers', () => {
    for (const key of ['next', '1.5', '01', '-1', '']) {
      const document = versioned({ schemaVersion: { [key]: {}, 1: { value: 'a' } } });
      const result = getCurrentVersionRop(document, 1, init);

      expect(result.type).toBe('current');
      expect(result.type === 'current' && result.current.value).toBe('a');
      expect(
        getCurrentVersionRop(versioned({ schemaVersion: { [key]: {} } }), 1, undefined),
      ).toEqual({
        type: 'none',
      });
    }
  });

  it('is outdated and not created if only older ones exist', () => {
    const document = versioned({ schemaVersion: { 0: {}, 1: { value: 'a' } } });

    expect(getCurrentVersionRop(document, 2, init)).toEqual({
      type: 'outdated',
      version: 1,
    });
    expect(JSON.parse(JSON.stringify(document.value))).toEqual({
      schemaVersion: { 0: {}, 1: { value: 'a' } },
    });
  });

  it('is invalid if it is not an object, and left as it is', () => {
    const document = versioned({ schemaVersion: { 1: 'not an object' } });

    expect(getCurrentVersionRop(document, 1, init)).toEqual({ type: 'invalid' });
    expect(getCurrentVersionRop(versioned({ schemaVersion: 'none' }), 1, init)).toEqual({
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

    expect(() => SharedDocumentGetCurrentVersion(document)).toThrow(
      'The shared document is invalid.',
    );
  });

  it('is newer only if a newer version exists', () => {
    expect(hasNewerVersionRop(versioned({ schemaVersion: { 1: {}, 2: 'newer' } }), 1)).toBe(true);
    expect(hasNewerVersionRop(versioned({ schemaVersion: { 2: {} } }), 1)).toBe(true);
    expect(hasNewerVersionRop(versioned({ schemaVersion: { 1: {}, next: {} } }), 1)).toBe(false);
    expect(hasNewerVersionRop(versioned({ schemaVersion: { 0: {}, 1: {} } }), 1)).toBe(false);
    expect(hasNewerVersionRop(versioned({ schemaVersion: 'none' }), 1)).toBe(false);
  });

  it('is read from a shared document of a newer version, if it has one', () => {
    const document = reactiveDocument({
      schemaVersion: { 1: { ...SharedDocumentDefault(), name: 'Work' }, 2: 'newer' },
    } as unknown as Versioned<SharedDocument>);

    expect(SharedDocumentGetName(SharedDocumentGetCurrentVersion(document))).toBe('Work');
    expect(() =>
      SharedDocumentGetCurrentVersion(
        reactiveDocument({ schemaVersion: { 2: {} } } as unknown as Versioned<SharedDocument>),
      ),
    ).toThrow(NewerVersionError);
  });

  it('is read from a local document of a newer version, if it has one', () => {
    const document = reactiveDocument({
      schemaVersion: { 1: LocalDocumentDefault(peerId('laptop')), 2: 'newer' },
    } as unknown as Versioned<LocalDocument>);

    expect(
      LocalDocumentGetLocalPeer(LocalDocumentGetCurrentVersion(document, undefined))?.peerJsPeerId,
    ).toBe(peerId('laptop'));
    expect(() =>
      LocalDocumentGetCurrentVersion(
        reactiveDocument({ schemaVersion: { 2: {} } } as unknown as Versioned<LocalDocument>),
        undefined,
      ),
    ).toThrow(NewerVersionError);
  });
});

describe('the current version of a file', () => {
  beforeEach(() => {
    // Invalid files are logged.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const DataSchema = Type.Object({ value: Type.String() });

  function parse(json: unknown) {
    return parseCurrentVersion(DataSchema, json, 1, 'file');
  }

  it('is parsed', () => {
    expect(parse({ schemaVersion: { 1: { value: 'a' } } })).toEqual({
      type: 'current',
      current: { value: 'a' },
    });
    // Also next to a newer version, like a document shown read-only.
    expect(parse({ schemaVersion: { 1: { value: 'a' }, 2: 'newer' } })).toEqual({
      type: 'current',
      current: { value: 'a' },
    });
  });

  it('is newer or outdated if there are only newer or older versions', () => {
    expect(parse({ schemaVersion: { 2: 'newer' } })).toEqual({ type: 'newer', version: 2 });
    expect(parse({ schemaVersion: { 0: {} } })).toEqual({ type: 'outdated', version: 0 });
  });

  it('is invalid without versions, or if the current one is invalid', () => {
    expect(parse({ schemaVersion: {} })).toEqual({ type: 'invalid' });
    expect(parse({ value: 'a' })).toEqual({ type: 'invalid' });
    expect(parse({ schemaVersion: { 1: {} } })).toEqual({ type: 'invalid' });
    expect(parse({ schemaVersion: { 1: 'not an object' } })).toEqual({ type: 'invalid' });
  });
});

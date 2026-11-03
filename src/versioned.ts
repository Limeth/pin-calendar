import '@/formats';
import { Type, type TObject } from '@sinclair/typebox';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import { isObject, type UncheckedRop } from '@/validation';

const VersionSchema = Type.String({ format: 'integer' });

// The keys of versions: canonical integers. Any other key, e.g. of a future key scheme, counts as a
// version newer than all of them, so that it is never mistaken for the absence of a version.
const VERSION_KEY_PATTERN = /^(0|[1-9][0-9]*)$/;

export function Versioned<T extends TObject>(innerSchema: T) {
  return Type.Object({
    schemaVersion: Type.Record(VersionSchema, innerSchema),
  });
}

// Data in several schema versions, by version number. Versions are never removed from synchronized
// storage (documents, and local storage, which tabs share), as other devices or tabs, running older
// versions of the app, may still be using them.
// oxlint-disable-next-line no-unused-vars
export type Versioned<T> = {
  schemaVersion: {
    [version: string]: unknown;
  };
};

type GetCurrentVersionResult<R> =
  | {
      // There are no versions.
      type: 'none';
    }
  | {
      // There are only older versions, the newest of which is given.
      type: 'outdated';
      version: number;
    }
  | {
      // There is a newer version, which this version of the app cannot read, but other devices or
      // tabs may still use the current one, if there is one.
      type: 'unsupported';
      version: string;
      current?: R;
    }
  | {
      type: 'current';
      current: R;
    };

// Which version is the current one, without creating it.
function findCurrentVersion(
  schemaVersion: object,
  currentVersion: number,
): GetCurrentVersionResult<unknown> {
  if (currentVersion !== (currentVersion | 0))
    throw new Error('The current version must be an integer.');

  const versionKeys = Object.keys(schemaVersion);
  const currentKey = String(currentVersion);
  const current: unknown = versionKeys.includes(currentKey)
    ? (schemaVersion as Record<string, unknown>)[currentKey]
    : undefined;
  let newerNumber: number | undefined;
  let newerUnknown: string | undefined;
  let older: number | undefined;

  for (const versionKey of versionKeys) {
    if (!VERSION_KEY_PATTERN.test(versionKey)) {
      newerUnknown ??= versionKey;
      continue;
    }

    const version = Number(versionKey);

    if (version > currentVersion && (newerNumber === undefined || version > newerNumber))
      newerNumber = version;
    else if (version < currentVersion && (older === undefined || version > older)) older = version;
  }

  const newer = newerNumber !== undefined ? String(newerNumber) : newerUnknown;

  if (newer !== undefined)
    return versionKeys.includes(currentKey)
      ? { type: 'unsupported', version: newer, current }
      : { type: 'unsupported', version: newer };

  if (versionKeys.includes(currentKey)) return { type: 'current', current };

  if (older !== undefined) return { type: 'outdated', version: older };

  return { type: 'none' };
}

export function getCurrentVersion<R, T extends Versioned<R>>(
  versioned: T,
  currentVersion: number,
  init: undefined | (() => R),
): GetCurrentVersionResult<R> {
  const result = findCurrentVersion(versioned.schemaVersion, currentVersion);

  // TODO: Migrate from older versions.

  if (result.type === 'none' && typeof init === 'function') {
    const versionKey = String(currentVersion);
    (versioned.schemaVersion[versionKey] as R) = init();
    return {
      type: 'current',
      current: versioned.schemaVersion[versionKey] as R,
    };
  }

  return result as GetCurrentVersionResult<R>;
}

// The current version of a document, which other devices or versions of the app may have written:
// `invalid` if its versions, or the current one, are not objects. The current version is read
// unchecked, see `UncheckedRop`.
type GetCurrentVersionRopResult<R> =
  | GetCurrentVersionResult<UncheckedRop<R>>
  | {
      type: 'invalid';
    };

export function getCurrentVersionRop<R, T extends Versioned<R>>(
  versioned: Rop<T>,
  currentVersion: number,
  init: undefined | (() => R),
): GetCurrentVersionRopResult<R> {
  const schemaVersion: unknown = versioned.schemaVersion;

  if (!isObject(schemaVersion)) return { type: 'invalid' };

  const result = findCurrentVersion(schemaVersion, currentVersion);

  if (result.type === 'current')
    return isObject(result.current)
      ? { type: 'current', current: result.current as UncheckedRop<R> }
      : { type: 'invalid' };

  // A current version that is not an object cannot be read either way.
  if (result.type === 'unsupported')
    return isObject(result.current)
      ? { type: 'unsupported', version: result.version, current: result.current as UncheckedRop<R> }
      : { type: 'unsupported', version: result.version };

  // TODO: Migrate from older versions.

  if (result.type === 'none' && typeof init === 'function') {
    const versionKey = String(currentVersion);
    versioned[changeSubtree]((versioned) => {
      (versioned.schemaVersion[versionKey] as R) = init();
    });
    return {
      type: 'current',
      current: versioned.schemaVersion[versionKey] as UncheckedRop<R>,
    };
  }

  return result;
}

export function makeVersioned<T>(currentVersion: T, currentVersionNumber: number): Versioned<T> {
  return {
    schemaVersion: {
      [JSON.stringify(currentVersionNumber)]: currentVersion,
    },
  };
}

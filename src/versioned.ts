import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { Ref } from 'vue';
import { isObject, type UncheckedRop } from '@/validation';

// The keys of versions: canonical integers. Any other key is ignored, as if it were not present.
const VERSION_KEY_PATTERN = /^(0|[1-9][0-9]*)$/;

// Only the container of the versions, see `Versioned`: each version is checked on its own, the
// current one by its readers.
export const VersionedSchema = Type.Object({
  schemaVersion: Type.Record(Type.String(), Type.Unknown()),
});

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
      version: number;
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
  let newer: number | undefined;
  let older: number | undefined;

  for (const versionKey of versionKeys) {
    if (!VERSION_KEY_PATTERN.test(versionKey)) continue;

    const version = Number(versionKey);

    if (version > currentVersion && (newer === undefined || version > newer)) newer = version;
    else if (version < currentVersion && (older === undefined || version > older)) older = version;
  }

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
// unchecked, see `UncheckedRop`. The document is read from its `Ref`, so that a current version that
// is created is read from the changed document.
type GetCurrentVersionRopResult<R> =
  | GetCurrentVersionResult<UncheckedRop<R>>
  | {
      type: 'invalid';
    };

export function getCurrentVersionRop<R, T extends Versioned<R>>(
  versioned: Ref<Rop<T>>,
  currentVersion: number,
  init: undefined | (() => R),
): GetCurrentVersionRopResult<R> {
  const schemaVersion: unknown = versioned.value.schemaVersion;

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
    versioned.value[changeSubtree]((versioned) => {
      (versioned.schemaVersion[versionKey] as R) = init();
    });
    return getCurrentVersionRop(versioned, currentVersion, undefined);
  }

  return result;
}

// Thrown when a document only has versions newer than this version of the app, so that it cannot even
// be shown read-only, see `hasNewerVersionRop`.
export class NewerVersionError extends Error {}

// Whether a document has a version newer than the current one, which this version of the app cannot
// read: the GUI then does not allow editing it, so that the current version stays as other devices or
// tabs, running older versions of the app, left it.
export function hasNewerVersionRop<R, T extends Versioned<R>>(
  versioned: Ref<Rop<T>>,
  currentVersion: number,
): boolean {
  const schemaVersion: unknown = versioned.value.schemaVersion;

  return (
    isObject(schemaVersion) &&
    findCurrentVersion(schemaVersion, currentVersion).type === 'unsupported'
  );
}

// The current version of data that is not saved back as it was read, e.g. an imported file. It is
// parsed, see `Value.Parse`, rather than read unchecked. `newer` and `outdated` if the data has no
// current version, but newer or older ones, `invalid` if it has none, or an invalid current one.
type ParseCurrentVersionResult<T> =
  | { type: 'current'; current: T }
  | { type: 'newer'; version: number }
  | { type: 'outdated'; version: number }
  | { type: 'invalid' };

export function parseCurrentVersion<S extends TSchema>(
  schema: S,
  json: unknown,
  currentVersion: number,
  description: string,
): ParseCurrentVersionResult<Static<S>> {
  if (!Value.Check(VersionedSchema, json)) {
    console.error(`Ignoring an invalid ${description}, as it has no schema versions.`);
    return { type: 'invalid' };
  }

  const result = getCurrentVersion(json, currentVersion, undefined);

  if (result.type === 'unsupported' && result.current === undefined)
    return { type: 'newer', version: result.version };

  if (result.type === 'outdated') return result;

  if (result.type === 'none') {
    console.error(`Ignoring an invalid ${description}, as it has no schema versions.`);
    return { type: 'invalid' };
  }

  try {
    return { type: 'current', current: Value.Parse(schema, result.current) };
  } catch (error) {
    console.error(`Ignoring an invalid ${description}:`, error);
    return { type: 'invalid' };
  }
}

export function makeVersioned<T>(currentVersion: T, currentVersionNumber: number): Versioned<T> {
  return {
    schemaVersion: {
      [JSON.stringify(currentVersionNumber)]: currentVersion,
    },
  };
}

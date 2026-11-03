import '@/formats';
import { Type, type TObject } from '@sinclair/typebox';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import { isObject, type UncheckedRop } from '@/validation';

const VersionSchema = Type.String({ format: 'integer' });

export function Versioned<T extends TObject>(innerSchema: T) {
  return Type.Object({
    schemaVersion: Type.Record(VersionSchema, innerSchema),
  });
}

// oxlint-disable-next-line no-unused-vars
export type Versioned<T> = {
  schemaVersion: {
    [version: string]: unknown;
  };
};

type GetCurrentVersionResult<R> =
  | {
      type: 'none';
    }
  | {
      type: 'unsupported';
      version: number;
    }
  | {
      type: 'current';
      current: R;
    };

export function getCurrentVersion<R, T extends Versioned<R>>(
  versioned: T,
  currentVersion: number,
  init: undefined | (() => R),
): GetCurrentVersionResult<R> {
  if (currentVersion !== (currentVersion | 0))
    throw new Error('The current version must be an integer.');

  const availableVersions = Object.keys(versioned.schemaVersion)
    .map((versionKey) => parseInt(versionKey))
    .toSorted((a, b) => a - b);
  const latestVersion = availableVersions.length > 0 ? Math.max(...availableVersions) : undefined;

  if (latestVersion !== undefined && latestVersion > currentVersion)
    return {
      type: 'unsupported',
      version: latestVersion,
    };

  const versionKey = JSON.stringify(currentVersion | 0); // Remove trailing '.0'

  if (versionKey in versioned.schemaVersion)
    return {
      type: 'current',
      current: versioned.schemaVersion[versionKey] as R,
    };

  // TODO: Migrate from previous versions.

  if (typeof init === 'function') {
    (versioned.schemaVersion[versionKey] as R) = init();
    return {
      type: 'current',
      current: versioned.schemaVersion[versionKey] as R,
    };
  }

  return { type: 'none' };
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
  if (currentVersion !== (currentVersion | 0))
    throw new Error('The current version must be an integer.');

  const schemaVersion: unknown = versioned.schemaVersion;

  if (!isObject(schemaVersion)) return { type: 'invalid' };

  const availableVersions = Object.keys(schemaVersion)
    .map((versionKey) => parseInt(versionKey))
    .toSorted((a, b) => a - b);
  const latestVersion =
    availableVersions.length > 0 ? availableVersions[availableVersions.length - 1] : undefined;

  if (latestVersion !== undefined && latestVersion > currentVersion)
    return {
      type: 'unsupported',
      version: latestVersion,
    };

  const versionKey = JSON.stringify(currentVersion | 0); // Remove trailing '.0'

  if (versionKey in schemaVersion) {
    const current: unknown = (schemaVersion as Record<string, unknown>)[versionKey];

    return isObject(current)
      ? { type: 'current', current: current as UncheckedRop<R> }
      : { type: 'invalid' };
  }

  // TODO: Migrate from previous versions.

  if (typeof init === 'function') {
    versioned[changeSubtree]((versioned) => {
      (versioned.schemaVersion[versionKey] as R) = init();
    });
    return {
      type: 'current',
      current: versioned.schemaVersion[versionKey] as UncheckedRop<R>,
    };
  }

  return { type: 'none' };
}

export function makeVersioned<T>(currentVersion: T, currentVersionNumber: number): Versioned<T> {
  return {
    schemaVersion: {
      [JSON.stringify(currentVersionNumber)]: currentVersion,
    },
  };
}

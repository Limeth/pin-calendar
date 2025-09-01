import { FormatRegistry, Type, type TObject } from '@sinclair/typebox';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';

FormatRegistry.Set('integer', (value) => {
  return JSON.stringify(parseInt(value)) === value;
});

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
    return { type: 'current', current: versioned.schemaVersion[versionKey] as R };

  // TODO: Migrate from previous versions.

  if (typeof init === 'function') {
    (versioned.schemaVersion[versionKey] as R) = init();
    return { type: 'current', current: versioned.schemaVersion[versionKey] as R };
  }

  return { type: 'none' };
}

export function getCurrentVersionRop<R, T extends Versioned<R>>(
  versioned: Rop<T>,
  currentVersion: number,
  init: undefined | (() => R),
): GetCurrentVersionResult<Rop<R>> {
  if (currentVersion !== (currentVersion | 0))
    throw new Error('The current version must be an integer.');

  const availableVersions = Object.keys(versioned.schemaVersion)
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

  if (versionKey in versioned.schemaVersion)
    return { type: 'current', current: versioned.schemaVersion[versionKey] as Rop<R> };

  // TODO: Migrate from previous versions.

  if (typeof init === 'function') {
    versioned[changeSubtree]((versioned) => {
      (versioned.schemaVersion[versionKey] as R) = init();
    });
    return { type: 'current', current: versioned.schemaVersion[versionKey] as Rop<R> };
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

import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as uuid from 'uuid';

const HashArgsSchema = Type.Union([
  Type.Undefined(),
  Type.Object({
    action: Type.Literal('addPeer'),
    documentId: Type.String(),
    peerJsPeerId: Type.String(),
  }),
]);

export type HashArgs = Static<typeof HashArgsSchema>;

export type HashPath =
  | undefined
  | {
      calendar: {
        id: string;
      };
    };

export type Hash = {
  path: HashPath;
  args: HashArgs;
};

export function decodeHashPath(path: string): HashPath {
  if (path.length === 0) return undefined;

  const segments = path.split('/').map(decodeURIComponent);

  if (uuid.validate(segments[0])) {
    return {
      calendar: {
        id: segments[0]!,
      },
    };
  }

  return undefined;
}

export function encodeHashPath(path: HashPath): string {
  if (path === undefined) return '';

  return path.calendar.id;
}

export function decodeHash(hash: string): Hash {
  if (hash.startsWith('#')) hash = hash.slice(1);

  const [path, args] = hash.split('?', 2);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const object: any = {};

  if (args !== undefined)
    for (const segments of args.split('&')) {
      const [key, value] = segments.split('=', 2);
      if (key != undefined && value !== undefined)
        object[decodeURIComponent(key)] = decodeURIComponent(value);
    }

  const decodedPath = decodeHashPath(path ?? '');

  try {
    return {
      path: decodedPath,
      args: Value.Parse(HashArgsSchema, object),
    };
  } catch {
    return { path: decodedPath, args: undefined };
  }
}

export function encodeHash(hash: Hash): string {
  let result = encodeHashPath(hash.path);

  if (hash.args !== undefined && Object.entries(hash.args).length > 0) {
    let argsString = '';

    for (const [key, value] of Object.entries(hash.args))
      argsString += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(value);

    // Replace the first & with #
    result += '?' + argsString.slice(1);
  }

  return result.length > 0 ? '#' + result : '';
}

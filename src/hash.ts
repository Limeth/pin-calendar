import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const HashSchema = Type.Object({
  action: Type.Literal('addPeer'),
  documentId: Type.String(),
  peerJsPeerId: Type.String(),
});

export type Hash = Static<typeof HashSchema>;

export function decodeHash(hash: string): Hash | undefined {
  if (hash.startsWith('#')) hash = hash.slice(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const object: any = {};

  for (const segments of hash.split('&')) {
    const [key, value] = segments.split('=', 2);
    object[decodeURIComponent(key)] = decodeURIComponent(value);
  }

  try {
    return Value.Parse(HashSchema, object);
  } catch {
    return undefined;
  }
}

export function encodeHash(hash: Hash): string {
  let result = '';

  for (const [key, value] of Object.entries(hash))
    result += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(value);

  // Replace the first & with #
  result = '#' + result.slice(1);

  return result;
}

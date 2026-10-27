import { describe, expect, it } from 'vitest';
import type { Ref } from 'vue';
import { ImmutableString } from '@automerge/automerge';
import {
  SharedDocumentGetName,
  type SharedDocument,
  type SharedDocumentRop,
} from '@/documents/shared';
import { reactiveDocument } from './helpers';

// A shared document as another device may have written it, with any name, or none if `undefined`.
function sharedDocumentNamed(name: unknown): Ref<SharedDocumentRop> {
  return reactiveDocument((name === undefined ? {} : { name }) as unknown as SharedDocument);
}

describe('the name of a calendar', () => {
  it('is read from the shared document', () => {
    expect(SharedDocumentGetName(sharedDocumentNamed('Family').value)).toBe('Family');
    expect(SharedDocumentGetName(sharedDocumentNamed(undefined).value)).toBeUndefined();
  });

  it('is ignored when it is not a string', () => {
    // E.g. written as a string that is not collaboratively editable.
    expect(
      SharedDocumentGetName(sharedDocumentNamed(new ImmutableString('Family')).value),
    ).toBeUndefined();
    expect(SharedDocumentGetName(sharedDocumentNamed(42).value)).toBeUndefined();
    expect(SharedDocumentGetName(sharedDocumentNamed({ text: 'Family' }).value)).toBeUndefined();
  });

  it('can only be used after it was checked', () => {
    const document = sharedDocumentNamed('Family').value;
    // @ts-expect-error: Unchecked, so it has to be read via `SharedDocumentGetName`.
    const name: string | undefined = document.name;

    expect(name).toBe('Family');
  });
});

import { updateText } from '@automerge/automerge';
import type { Property } from 'automerge-diy-vue-hooks';

// Functions to pass to `ValidatedInput` as `parse` and `change`. Their types only allow them to be
// used for properties of the types that they handle.

// The input's text, as the value of a string property.
export function parseText(text: string): string {
  return text;
}

// Assign the value to the property.
export function assignProperty<T, P extends keyof T>(subtree: T, property: P, value: T[P]): void {
  subtree[property] = value;
}

// Update the text of a string property, so that concurrent edits of it are merged, rather than one
// of them replacing the others.
export function updateTextProperty<P extends Property, T extends { [K in P]?: string }>(
  subtree: T,
  property: P,
  text: string,
): void {
  updateText(subtree, [property], text);
}

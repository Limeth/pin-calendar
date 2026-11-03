import { PinCalendarNew, PinCalendarSchema } from '@/pins/pinCalendar';
import { PinCatalogDefault, PinCatalogSchema } from '@/pins/pinCatalog';
import { getCurrentVersionRop, type Versioned } from '@/versioned';
import { readProperty, type Unchecked, type UncheckedRop } from '@/validation';
import { Type, type Static } from '@sinclair/typebox';
import type { Rop } from 'automerge-diy-vue-hooks';

export const SHARED_DOCUMENT_SCHEMA_VERSION_CURRENT = 1;

export const SharedDocumentSchema = Type.Object({
  // account: Account,
  // The calendar's name, shared with all of its devices. Unset for an unnamed calendar.
  name: Type.Optional(Type.String()),
  pinCatalog: PinCatalogSchema,
  pinCalendar: PinCalendarSchema,
});

// The shared document as this version writes it.
export type SharedDocument = Static<typeof SharedDocumentSchema>;

// The shared document as it is read: other devices may have written anything, see `Unchecked`.
export type SharedDocumentRop = UncheckedRop<SharedDocument>;

// The calendar's name, or `undefined` if it has none, or an invalid one.
export function SharedDocumentGetName(self: Unchecked<SharedDocument>): string | undefined {
  return readProperty(SharedDocumentSchema, self, 'name', 'calendar name');
}

// Rename the calendar, or remove its name if the given one is blank. The name is replaced as a
// whole, so that concurrent renames result in one of the names, rather than a merge of their text.
export function SharedDocumentSetName(self: SharedDocument, name: string) {
  const trimmed = name.trim();

  if (trimmed.length === 0) delete self.name;
  else if (self.name !== trimmed) self.name = trimmed;
}

export function SharedDocumentGetCurrentVersion(
  versioned: Rop<Versioned<SharedDocument>>,
): SharedDocumentRop {
  const result = getCurrentVersionRop(
    versioned,
    SHARED_DOCUMENT_SCHEMA_VERSION_CURRENT,
    SharedDocumentDefault,
  );

  if (result.type === 'current') return result.current;

  // TODO: This should be handled gracefully.
  if (result.type === 'unsupported')
    throw new Error(`Unsupported shared document schema version: ${result.version}`);

  if (result.type === 'invalid') throw new Error(`The shared document is invalid.`);

  if (result.type === 'outdated')
    throw new Error(`Outdated shared document schema version: ${result.version}`);

  throw new Error(`No shared document found.`);
}

export function SharedDocumentDefault(): SharedDocument {
  return { pinCatalog: PinCatalogDefault(), pinCalendar: PinCalendarNew() };
}

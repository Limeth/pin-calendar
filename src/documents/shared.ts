import { PinCalendarNew, type PinCalendar } from '@/pins/pinCalendar';
import { PinCatalogDefault, type PinCatalog } from '@/pins/pinCatalog';
import { getCurrentVersionRop, type Versioned } from '@/versioned';
import type { Rop } from 'automerge-diy-vue-hooks';

export const SHARED_DOCUMENT_SCHEMA_VERSION_CURRENT = 1;

export type SharedDocument = {
  // account: Account,
  // The calendar's name, shared with all of its devices. Unset for an unnamed calendar.
  name?: string;
  pinCatalog: PinCatalog;
  pinCalendar: PinCalendar;
};

// Rename the calendar, or remove its name if the given one is blank. The name is replaced as a
// whole, so that concurrent renames result in one of the names, rather than a merge of their text.
export function SharedDocumentSetName(self: SharedDocument, name: string) {
  const trimmed = name.trim();

  if (trimmed.length === 0) delete self.name;
  else if (self.name !== trimmed) self.name = trimmed;
}

export function SharedDocumentGetCurrentVersion(
  versioned: Rop<Versioned<SharedDocument>>,
): Rop<SharedDocument> {
  const result = getCurrentVersionRop(
    versioned,
    SHARED_DOCUMENT_SCHEMA_VERSION_CURRENT,
    SharedDocumentDefault,
  );

  if (result.type === 'current') return result.current;

  // TODO: This should be handled gracefully.
  if (result.type === 'unsupported')
    throw new Error(`Unsupported shared document schema version: ${result.version}`);

  throw new Error(`No shared document found.`);
}

export function SharedDocumentDefault(): SharedDocument {
  return { pinCatalog: PinCatalogDefault(), pinCalendar: PinCalendarNew() };
}

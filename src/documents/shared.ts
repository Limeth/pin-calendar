import { PinCalendarNew, type PinCalendar } from '@/pins/pinCalendar';
import { PinCatalogDefault, type PinCatalog } from '@/pins/pinCatalog';
import { getCurrentVersionRop, type Versioned } from '@/versioned';
import type { Rop } from 'automerge-diy-vue-hooks';

export const SHARED_DOCUMENT_SCHEMA_VERSION_CURRENT = 1;

export type SharedDocument = {
  // account: Account,
  pinCatalog: PinCatalog;
  pinCalendar: PinCalendar;
};

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

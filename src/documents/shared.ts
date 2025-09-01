import { PinCalendarNew, type PinCalendar } from '@/pins/pinCalendar';
import { PinCatalogDefault, type PinCatalog } from '@/pins/pinCategory';

export type SharedDocument = {
  // account: Account,
  pinCatalog: PinCatalog;
  pinCalendar: PinCalendar;
};

export function SharedDocumentDefault(): SharedDocument {
  return { pinCatalog: PinCatalogDefault(), pinCalendar: PinCalendarNew() };
}

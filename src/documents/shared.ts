import { PinCalendarNew, PinCatalogDefault, type PinCalendar, type PinCatalog } from '@/pins';

export type SharedDocument = {
  // account: Account,
  pinCatalog: PinCatalog;
  pinCalendar: PinCalendar;
};

export function SharedDocumentDefault(): SharedDocument {
  return { pinCatalog: PinCatalogDefault(), pinCalendar: PinCalendarNew() };
}

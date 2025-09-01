import { Type, type Static } from '@sinclair/typebox';
import type { Pin, PinId } from './pinCategory';
import { IdKeySchema, type IdKey } from './util';
import type { Ro } from 'automerge-diy-vue-hooks';

export type PinnedPin = {
  count: number; // TODO: Allow more than 1
};

export type PinDayPins = {
  [pinId: IdKey<PinId>]: PinnedPin;
};

export const PinDaySchema = Type.Object({
  pins: Type.Array(IdKeySchema<PinId>()),
});

export type PinDay = Static<typeof PinDaySchema>;

export function PinDayNew(): PinDay {
  return {
    pins: [],
  };
}

function PinDayHasPinById(self: PinDay | Ro<PinDay>, pinId: PinId): boolean {
  return self.pins.includes(pinId.key);
}

export function PinDayHasPin(self: PinDay | Ro<PinDay>, pin: Pin): boolean {
  return PinDayHasPinById(self, pin.id);
}

export function PinDayAddPinById(self: PinDay, pinId: PinId): boolean {
  if (PinDayHasPinById(self, pinId)) return false;
  else {
    self.pins.push(pinId.key);
    return true;
  }
}

export function PinDayAddPin(self: PinDay, pin: Pin): boolean {
  return PinDayAddPinById(self, pin.id);
}

function PinDayRemovePinById(self: PinDay, pinId: PinId): boolean {
  let removed = false;

  while (true) {
    const index = self.pins.findIndex((currentPinId) => currentPinId === pinId.key);

    if (index === -1) break;

    self.pins.splice(index, 1);
    removed = true;
  }

  return removed;
}

export function PinDayRemovePin(self: PinDay, pin: Pin): boolean {
  return PinDayRemovePinById(self, pin.id);
}

export function PinDaySetPinPresence(self: PinDay, pin: Pin, presence: boolean): boolean {
  if (presence) return PinDayAddPin(self, pin);
  else return PinDayRemovePin(self, pin);
}

export function PinDayTogglePin(self: PinDay, pin: Pin): boolean {
  const newValue = !PinDayHasPin(self, pin);
  PinDaySetPinPresence(self, pin, newValue);
  return newValue;
}

export function PinDayIsEmpty(self: PinDay): boolean {
  return self.pins.length === 0;
}

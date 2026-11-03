<script setup lang="ts">
import { PinDayHasPin, type PinDay } from '@/pins/pinCalendarDay';
import { type Pin, type PinRop } from '../pins/pinCatalog';
import PinCard from './PinCard.vue';
import type { Rop } from 'automerge-diy-vue-hooks';

const { depth, pin, pinDay, disabled } = defineProps<{
  depth: number;
  pin: PinRop;
  pinDay: Rop<PinDay>;
  // The pin cannot be toggled, e.g. as the calendar is read-only.
  disabled: boolean;
}>();

export type CalendarPinCategoryEvent = {
  kind: 'toggle';
  pin: Pin;
};

const emit = defineEmits<{
  event: [CalendarPinCategoryEvent];
}>();
</script>

<template>
  <li
    class="pin-btn flex flex-row items-center gap-1 px-4 py-1"
    :class="{
      'pin-btn-even-depth': depth % 2 == 0,
      'pin-btn-odd-depth': depth % 2 == 1,
      'pin-btn-active': pinDay !== null && PinDayHasPin(pinDay, pin),
      'cursor-pointer': !disabled,
      'cursor-not-allowed': disabled,
    }"
    :aria-disabled="disabled"
    @click="!disabled && emit('event', { kind: 'toggle', pin })"
  >
    <PinCard :pin="pin" :details="true" class="w-full" />
  </li>
</template>

<style lang="css" scoped>
.pin-btn {
  border: 1px solid transparent;
  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
}

.pin-btn-active {
  border-color: v-bind('pin.value.backgroundColor');
  background-color: white;
}

.pin-btn-active:hover {
  background-color: color-mix(in oklab, white, v-bind('pin.value.backgroundColor') 20%) !important;
}

.pin-btn-even-depth:nth-child(odd):not(.pin-btn-active) {
  background-color: oklch(var(--b2));
}

.pin-btn-even-depth:nth-child(even):not(.pin-btn-active) {
  background-color: oklch(var(--b1));
}

.pin-btn-odd-depth:nth-child(odd):not(.pin-btn-active) {
  background-color: oklch(var(--b3));
}

.pin-btn-odd-depth:nth-child(even):not(.pin-btn-active) {
  background-color: oklch(var(--b2));
}

.pin-btn-even-depth:nth-child(odd):hover:not(.pin-btn-active) {
  background-color: color-mix(
    in oklab,
    oklch(var(--b2)),
    v-bind('pin.value.backgroundColor') 20%
  ) !important;
}

.pin-btn-even-depth:nth-child(even):hover:not(.pin-btn-active) {
  background-color: color-mix(
    in oklab,
    oklch(var(--b1)),
    v-bind('pin.value.backgroundColor') 20%
  ) !important;
}

.pin-btn-odd-depth:nth-child(odd):hover:not(.pin-btn-active) {
  background-color: color-mix(
    in oklab,
    oklch(var(--b3)),
    v-bind('pin.value.backgroundColor') 20%
  ) !important;
}

.pin-btn-odd-depth:nth-child(even):hover:not(.pin-btn-active) {
  background-color: color-mix(
    in oklab,
    oklch(var(--b2)),
    v-bind('pin.value.backgroundColor') 20%
  ) !important;
}
</style>

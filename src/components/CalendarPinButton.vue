<script setup lang="ts">
import { type PinDay, type Pin, PinDayHasPin, type PinCatalog, type PinTypeOf } from '../pins';
import PinCard from './PinCard.vue';
import type { Rop } from 'automerge-diy-vue-hooks';

const { depth, pin, pinDay } = defineProps<{
  depth: number,
  pin: PinTypeOf<Rop<PinCatalog>>,
  pinDay: Rop<PinDay>,
}>();

export type CalendarPinCategoryEvent = {
  kind: 'toggle',
  pin: Pin,
};

const emit = defineEmits<{
  event: [CalendarPinCategoryEvent],
}>();
</script>

<template>
  <li class="pin-btn flex flex-row items-center gap-1 px-4 py-1 cursor-pointer" :class="{
    'pin-btn-even-depth': (depth % 2) == 0,
    'pin-btn-odd-depth': (depth % 2) == 1,
    'pin-btn-active': pinDay !== null && PinDayHasPin(pinDay, pin),
  }" @click="emit('event', { kind: 'toggle', pin })">
    <PinCard :pin="pin" />
  </li>
</template>

<style lang="css" scoped>
.pin-btn {
  border: 1px solid transparent;
  transition-duration: .2s;
  transition-timing-function: cubic-bezier(0, 0, .2, 1);
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
  background-color: color-mix(in oklab, oklch(var(--b2)), v-bind('pin.value.backgroundColor') 20%) !important;
}

.pin-btn-even-depth:nth-child(even):hover:not(.pin-btn-active) {
  background-color: color-mix(in oklab, oklch(var(--b1)), v-bind('pin.value.backgroundColor') 20%) !important;
}

.pin-btn-odd-depth:nth-child(odd):hover:not(.pin-btn-active) {
  background-color: color-mix(in oklab, oklch(var(--b3)), v-bind('pin.value.backgroundColor') 20%) !important;
}

.pin-btn-odd-depth:nth-child(even):hover:not(.pin-btn-active) {
  background-color: color-mix(in oklab, oklch(var(--b2)), v-bind('pin.value.backgroundColor') 20%) !important;
}
</style>

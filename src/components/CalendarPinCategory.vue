<script setup lang="ts">
import * as feather from 'feather-icons';
import { ref } from 'vue';
import {
  type PinDay,
  type Pin,
  PinCatalogGetPinsInCategory,
  type PinCatalog,
  PinCatalogGetSubcategoriesInCategory,
  type PinCategoryTypeOf,
} from '../pins';
import * as R from 'ramda';
import CalendarPinButton from './CalendarPinButton.vue';
import type { Rop } from 'automerge-diy-vue-hooks';

const { depth, pinCategory, pinDay } = defineProps<{
  depth: number;
  pinCatalog: Rop<PinCatalog>;
  pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>;
  pinDay: Rop<PinDay>;
}>();

export type CalendarPinCategoryEvent = {
  kind: 'toggle';
  pin: Pin;
};

const emit = defineEmits<{
  event: [CalendarPinCategoryEvent];
}>();

const isCollapsed = ref(true);
</script>

<template>
  <div class="flex justify-center flex-col w-full">
    <ul
      class="flex flex-col gap-2 px-4 py-2 rounded-lg overflow-hidden"
      :class="depth % 2 == 0 ? 'bg-base-100' : 'bg-base-200'"
    >
      <ul class="flex flex-row relative -mx-4 -my-2 px-4 py-2">
        <div
          class="hover:bg-base-300 w-full absolute top-0 left-0 bottom-0 cursor-pointer z-0"
          @click="isCollapsed = !isCollapsed"
        ></div>
        <div class="flex-grow flex flex-row items-center z-10 pointer-events-none">
          <div>{{ pinCategory.value.displayName }}</div>
          <div
            class="px-2"
            v-html="feather.icons[isCollapsed ? 'chevron-up' : 'chevron-down'].toSvg()"
          />
        </div>
      </ul>
      <!-- <li class="flex-grow flex flex-row items-center gap-1 text-lg">
        <div class="flex-grow">{{ pinCategory.displayName }}</div>
      </li> -->
      <template v-if="!isCollapsed">
        <li class="text-sm" v-if="pinCategory.value.description">
          {{ pinCategory.value.description }}
        </li>
        <li class="-mx-4 w-[inherit]">
          <ul class="flex flex-col">
            <CalendarPinButton
              v-for="pin of R.filter(
                (pin) => !pin.value.archived,
                PinCatalogGetPinsInCategory(pinCatalog, pinCategory.id),
              )"
              :key="pin.id.key"
              @event="emit('event', $event)"
              :depth
              :pin
              :pin-day
            />
          </ul>
        </li>
        <li
          v-for="subcategory in R.filter(
            (subcategory) => !subcategory.value.archived,
            PinCatalogGetSubcategoriesInCategory(pinCatalog, pinCategory.id),
          )"
          :key="subcategory.id.key"
          class="flex flex-row items-center w-full gap-1"
        >
          <CalendarPinCategory
            @event="emit('event', $event)"
            :depth="depth + 1"
            :pin-catalog
            :pin-category="subcategory"
            :pin-day
          />
        </li>
      </template>
    </ul>
  </div>
</template>

<!-- <style lang="css">
  .pin-btn:hover {
    background-color: color-mix(in oklab,  percentage, color percentage);
  }
</style> -->

<script setup lang="ts">
import { type Pin } from '../pins/pinCatalog';
import CollapsibleText from './CollapsibleText.vue';
import PinIcon from './PinIcon.vue';

const { pin, details } = defineProps<{
  pin: Pin;
  details: boolean;
}>();
</script>

<template>
  <div
    class="grid grid-cols-[max-content_1fr] grid-rows-[auto_auto_auto] gap-x-2 gap-y-1 items-center text-left"
  >
    <PinIcon :pin="pin" class="flex-shrink-0 grid-start col-start-1 row-start-1 row-span-2" />
    <div class="text-xl col-start-2 row-start-1">{{ pin.value.displayName }}</div>
    <div class="text-sm col-start-2 row-start-2">{{ pin.value.description }}</div>
    <CollapsibleText
      v-if="details && (pin.value.details?.length ?? 0) > 0"
      class="text-xs col-start-2 row-start-3 -ml-2 pl-2 -mu-1 py-1 rounded-md"
      :text="pin.value.details"
      :collapsible-class="{ 'hover:bg-base-100': true }"
    />
  </div>
</template>

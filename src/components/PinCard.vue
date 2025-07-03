<script setup lang="ts">
import { type Pin } from '../pins';
import PinIcon from './PinIcon.vue';

const { pin } = defineProps<{
  pin: Pin;
}>();
</script>

<template>
  <div class="flex flex-row items-center gap-1">
    <PinIcon :pin="pin" class="mr-1 flex-shrink-0" />
    <div class="flex-grow">
      <div class="text-xl">{{ pin.value.displayName }}</div>
      <div class="text-sm">{{ pin.value.description }}</div>
    </div>
  </div>
</template>

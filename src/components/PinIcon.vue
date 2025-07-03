<script setup lang="ts">
import { type Pin } from '../pins';

const { pin } = defineProps<{
  pin: Pin;
}>();
</script>

<template>
  <div
    class="w-6 h-6 rounded-full overflow-hidden align-center items-center flex text-[24px]"
    :style="
      'background-color: ' +
      pin.value.backgroundColor +
      '; font-size: ' +
      20 * pin.value.icon.scale +
      'px'
    "
  >
    <div class="text-center ml-[-100%] mr-[-100%] w-[400%]">
      {{ pin.value.icon.emoji }}
    </div>
  </div>
</template>

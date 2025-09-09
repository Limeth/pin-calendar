<script setup lang="ts">
import { computed, ref } from 'vue';
import * as feather from 'feather-icons';

const { text, collapsibleClass } = defineProps<{
  text: string | undefined;
  collapsibleClass?: object;
}>();
const lines = computed(() => text?.split('\n'));
const areDetailsCollapsed = ref(true);
const collapsibleClassComputed = computed(() =>
  lines.value !== undefined && lines.value?.length > 1 ? collapsibleClass : {},
);

function onClick(event: PointerEvent) {
  areDetailsCollapsed.value = !areDetailsCollapsed.value;

  if (lines.value !== undefined && lines.value?.length > 1) event.stopPropagation();
}
</script>

<template>
  <div
    v-if="lines !== undefined && lines.length > 0"
    class="flex-grow flex flex-row text-xs items-end wrap-break-word"
    :class="collapsibleClassComputed"
    @click="onClick"
  >
    <template v-if="lines.length > 1">
      <div class="overflow-hidden text-ellipsis flex-1 cursor-pointer">
        <template v-if="areDetailsCollapsed">
          {{ lines[0] }}… <span class="text-gray-500">Click to read more.</span>
        </template>
        <template v-else>
          <div v-for="(line, index) of lines" :key="index">
            {{ line }}
          </div>
        </template>
      </div>
      <div
        class="px-2 scale-75 h-4"
        style="translate: 0 -0.2rem"
        v-html="feather.icons[areDetailsCollapsed ? 'chevron-up' : 'chevron-down'].toSvg()"
      />
    </template>
    <template v-else>
      <div class="flex-1">
        <div v-for="(line, index) of lines" :key="index">
          {{ line }}
        </div>
      </div>
    </template>
  </div>
</template>

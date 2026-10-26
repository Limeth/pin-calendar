<script setup lang="ts">
import type { CalendarId } from '@/documents/local';

defineProps<{
  name?: string;
  calendarId: CalendarId;
}>();
</script>

<template>
  <div class="flex flex-col min-w-0">
    <span v-if="name !== undefined" class="truncate">{{ name }}</span>
    <template v-else>
      <span class="truncate italic opacity-60">Unnamed Calendar</span>
      <!-- Keeps unnamed calendars distinguishable. -->
      <span class="truncate text-xs font-mono opacity-60">{{ calendarId }}</span>
    </template>
  </div>
</template>

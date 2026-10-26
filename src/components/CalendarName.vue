<script setup lang="ts">
import type { CalendarId } from '@/documents/local';

defineProps<{
  name?: string;
  // The alias on this device, shown less prominently than the shared name.
  alias?: string;
  calendarId: CalendarId;
}>();
</script>

<template>
  <div class="flex flex-col min-w-0">
    <span v-if="name !== undefined" class="truncate">{{ name }}</span>
    <span v-else class="truncate italic opacity-60">Unnamed Calendar</span>
    <span v-if="alias !== undefined" class="truncate text-xs opacity-60">{{ alias }}</span>
    <!-- Keeps calendars without a name or an alias distinguishable. -->
    <span v-else-if="name === undefined" class="truncate text-xs font-mono opacity-60">
      {{ calendarId }}
    </span>
  </div>
</template>

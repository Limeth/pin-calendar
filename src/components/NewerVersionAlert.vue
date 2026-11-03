<script setup lang="ts">
// Shown while data cannot be edited, as a newer version of the app changed it: refreshing the page
// loads the newer version. One component for all such data, so that the alerts do not overlap.
defineProps<{
  // The list of calendars, see `LocalStorageDataIsReadOnly`.
  list: boolean;
  // The open calendar's documents, see `hasNewerVersionRop`.
  calendar: boolean;
}>();

function refresh() {
  window.location.reload();
}
</script>

<template>
  <!-- Above the menu bar of `SharedApp`. -->
  <div v-if="list || calendar" class="toast toast-center bottom-20 z-50">
    <div role="alert" class="alert alert-warning">
      <span class="whitespace-normal">
        {{
          list && calendar
            ? 'The list of calendars and this calendar were changed by a newer version of the app.'
            : list
              ? 'The list of calendars was changed by a newer version of the app.'
              : 'This calendar was changed by a newer version of the app.'
        }}
        Refresh the page to update the app. Until then, {{ list && calendar ? 'they' : 'it' }}
        cannot be changed.
      </span>
      <button class="btn btn-sm" @click="refresh">Refresh</button>
    </div>
  </div>
</template>

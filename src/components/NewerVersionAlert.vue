<script setup lang="ts">
// Shown while data cannot be edited, as a newer version of the app changed it: refreshing the page
// loads the newer version.
defineProps<{ message: string }>();

function refresh() {
  window.location.reload();
}
</script>

<template>
  <!-- Above the menu bar of `SharedApp`. -->
  <div class="toast toast-center bottom-20 z-50">
    <div role="alert" class="alert alert-warning">
      <span class="whitespace-normal">{{ message }}</span>
      <button class="btn btn-sm" @click="refresh">Refresh</button>
    </div>
  </div>
</template>

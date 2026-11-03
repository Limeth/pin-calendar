<script setup lang="ts">
import SinglePageApp from './SinglePageApp.vue';
</script>

<template>
  <Suspense>
    <SinglePageApp />
    <template #fallback>
      <!-- Keep consistent with the indicator shown while a calendar loads, in `SharedApp`. -->
      <div class="flex h-svh flex-col items-center justify-center gap-2">
        <span class="loading loading-bars loading-xl"></span>
        <h1>Loading, please wait.</h1>
      </div>
    </template>
  </Suspense>
</template>

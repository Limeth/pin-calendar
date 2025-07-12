<script setup lang="ts">
import SinglePageApp from './SinglePageApp.vue';
</script>

<template>
  <Suspense>
    <SinglePageApp />
    <template #fallback><!-- TODO: Improve -->Loading</template>
  </Suspense>
</template>

<script setup lang="ts">
import SinglePageApp from './SinglePageApp.vue';
</script>

<template>
  <!-- <!doctype html> -->
  <html lang="en" data-theme="light">
    <head>
      <meta charset="UTF-8" />
      <meta name="description" content="Astro description" />
      <meta name="viewport" content="viewport-fit=cover, width=device-width, initial-scale=1.0" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <meta name="generator" content="{Astro.generator}" />
      <title>{title}</title>
    </head>

    <body>
      <Suspense>
        <SinglePageApp />
        <template #fallback> Loading </template>
      </Suspense>
    </body>
  </html>
</template>

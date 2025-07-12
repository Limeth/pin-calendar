<script setup lang="ts">
import type { App } from '../account';
import SettingsPins from './SettingsPins.vue';
import SettingsIO from './SettingsIO.vue';

const app = defineModel<App>();
</script>

<template>
  <div class="join join-vertical w-full">
    <!-- `!isolation-auto` is used to prevent `collapse` from applying `isolation: isolate` and causing a new stacking context to be created, messing with the drawer overlay. -->
    <div class="!isolation-auto join-item collapse collapse-arrow bg-base-200">
      <input type="radio" name="my-accordion-2" />
      <div class="collapse-title text-xl font-medium">Edit Pins</div>
      <div class="collapse-content">
        <SettingsPins v-model="app" />
      </div>
    </div>
    <div class="!isolation-auto join-item collapse collapse-arrow bg-base-200">
      <input type="radio" name="my-accordion-2" />
      <div class="collapse-title text-xl font-medium">Import and Export</div>
      <div class="collapse-content">
        <SettingsIO v-model="app" />
      </div>
    </div>
  </div>
</template>

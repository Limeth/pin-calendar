<script setup lang="ts">
import type { App } from '../account';
import SettingsPins from './SettingsPins.vue';
import SettingsIO from './SettingsIO.vue';
import type { Rop } from 'automerge-diy-vue-hooks';

const app = defineModel<App>();
</script>

<template>
  <div class="join join-vertical w-full">
    <div class="join-item collapse collapse-arrow bg-base-200">
      <input type="radio" name="my-accordion-2" />
      <div class="collapse-title text-xl font-medium">Edit Pins</div>
      <div class="collapse-content">
        <SettingsPins v-model="app" />
      </div>
    </div>
    <div class="join-item collapse collapse-arrow bg-base-200">
      <input type="radio" name="my-accordion-2" />
      <div class="collapse-title text-xl font-medium">Import/Export Settings</div>
      <div class="collapse-content">
        <SettingsIO v-model="app" />
      </div>
    </div>
  </div>
</template>

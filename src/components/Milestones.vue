<script setup lang="ts">
  import type { App } from '../account';
  import * as feather from 'feather-icons';
  import { reactive, ref, onMounted, watch } from 'vue';
  import type { Ref } from 'vue';
  import { type PinCalendar, PinCatalog, type PinDay, type Pin } from '../pins';
  import { Temporal } from '@js-temporal/polyfill';
  import * as emojiSearch from 'node-emoji';
  import * as emojiGroups from 'unicode-emoji-json/data-by-group.json';
  import * as emojiComponents from 'unicode-emoji-json/data-emoji-components.json';
import type { Rop } from 'automerge-diy-vue-hooks';

  const app = defineModel<Rop<App>>();

</script>

<template>
  Milestones
</template>

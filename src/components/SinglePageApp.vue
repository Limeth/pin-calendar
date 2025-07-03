<script setup lang="ts">
import { ref, type ShallowRef } from 'vue';
import Calendar from './Calendar.vue';
import Milestones from './Milestones.vue';
import Settings from './Settings.vue';
import feather from 'feather-icons';
import { accountStore, type App } from '../account';

// const app: Ref<App> = ref({
//   pinCatalog: PinCatalog.loadFromLocalStorageOrDefault(),
//   pinCalendar: PinCalendar.loadFromLocalStorageOrDefault(),
// });

const app: ShallowRef<App> = await accountStore.value.GetApp();

console.log('pinCalendar', app.value!.docData.value!.pinCalendar);
console.log('pinCatalog', app.value!.docData.value!.pinCatalog);

// const account = await accountStore.value.GetAccount();

enum Page {
  CALENDAR,
  MILESTONES,
  SETTINGS,
}

const pages = [Page.CALENDAR, Page.MILESTONES, Page.SETTINGS];
const currentPage = ref(pages[0]);

function setPage(newPage: Page) {
  currentPage.value = newPage;
}
</script>

<template>
  <div class="pb-16">
    <!-- Padding equal to the bottom navigation height -->
    <Calendar v-if="currentPage === Page.CALENDAR" v-model="app" />
    <Milestones v-if="currentPage === Page.MILESTONES" v-model="app" />
    <Settings v-if="currentPage === Page.SETTINGS" v-model="app" />
  </div>
  <div class="dock">
    <button
      @click="setPage(Page.CALENDAR)"
      v-html="feather.icons['calendar'].toSvg()"
      :class="currentPage == Page.CALENDAR ? 'dock-active' : ''"
    />
    <button
      @click="setPage(Page.MILESTONES)"
      v-html="feather.icons['bar-chart-2'].toSvg()"
      :class="currentPage == Page.MILESTONES ? 'dock-active' : ''"
    />
    <button
      @click="setPage(Page.SETTINGS)"
      v-html="feather.icons['settings'].toSvg()"
      :class="currentPage == Page.SETTINGS ? 'dock-active' : ''"
    />
  </div>
</template>

<style scoped></style>

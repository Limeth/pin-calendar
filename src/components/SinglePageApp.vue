<script setup lang="ts">
import { computed, ref, toRaw, watch, type Ref } from 'vue';
import Calendar from './Calendar.vue';
import Milestones from './Milestones.vue';
import Settings from './Settings.vue';
import feather from 'feather-icons';
import { accountStore } from '../app';
import QRCode from 'qrcode';
import { asyncComputed, computedAsync } from '@vueuse/core';
import { decodeHash, encodeHash, type Hash } from '@/hash';
import * as uuid from 'uuid';
import type { CalendarId } from '@/documents/local';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import { localStorageDataStore } from '@/localStorageData';

// const app: Ref<App> = ref({
//   pinCatalog: PinCatalog.loadFromLocalStorageOrDefault(),
//   pinCalendar: PinCalendar.loadFromLocalStorageOrDefault(),
// });

const localStorageData = await localStorageDataStore.value.GetData();
const currentUrl = URL.parse(window.location.href) ?? undefined;
const currentHash: Ref<Hash> = ref(decodeHash(currentUrl?.hash ?? ''));

// Automatically update the URL's hash when `currentHash` is altered.
watch(
  currentHash,
  () => {
    window.location.hash = encodeHash(currentHash.value);
  },
  { deep: true },
);

// Initialize calendar ID if no ID was given.
if (Object.keys(localStorageData.value.calendars).length === 0) {
  // If no calendars exist, create one.
  currentHash.value.path = {
    calendar: {
      id: currentHash.value.path?.calendar.id ?? uuid.v7(),
    },
  };
  localStorageData.value.calendars[currentHash.value.path.calendar.id] = {};
} else if (
  currentHash.value.path?.calendar.id === undefined ||
  !(currentHash.value.path.calendar.id in localStorageData.value.calendars)
) {
  currentHash.value.path = {
    calendar: {
      // Open the least recently used calendar.
      id:
        localStorageData.value.leastRecentlyUsedCalendar ??
        Object.keys(localStorageData.value.calendars)[0],
    },
  };
  // Reset args to make sure no operation is performed on implicitly selected calendar.
  currentHash.value.args = undefined;
}

function openCalendar(calendarId: CalendarId) {
  if (calendarId in localStorageData.value.calendars) {
    localStorageData.value.leastRecentlyUsedCalendar = calendarId;
  }

  currentHash.value.path = {
    calendar: {
      id: calendarId,
    },
  };
}

// Remove args from the URL.
const originalHashArgs = structuredClone(toRaw(currentHash.value.args));
currentHash.value.args = undefined;

openCalendar(currentHash.value.path.calendar.id);

const appIsBeingLoaded = ref(true);
const appAsync = asyncComputed(
  async () => {
    const app = await accountStore.value.GetAppOptional(
      currentHash.value.path!.calendar.id,
      originalHashArgs,
    );
    // To debug the loading indicator when switching between calendars, uncomment this:
    // await new Promise(() => { /* Never resolve */ });
    return app;
  },
  undefined,
  {
    evaluating: appIsBeingLoaded,
  },
);
// This property exists so that the app has the value `undefined`
// when switching from a loaded calendar to a not-yet-loaded calendar.
const app = computed(() => (appIsBeingLoaded.value ? undefined : appAsync.value));

const isDrawerOpen = ref(false);
const drawerContent: Ref<undefined | 'calendars' | 'peers'> = ref(undefined);
const connected = computed(() => {
  if (app.value === undefined) return 0;
  return Object.keys(app.value.docEphemeral.data.value.connectedPeers).length;
});
const peers = computed(() => {
  if (app.value === undefined) return [];

  const remotePeers = app.value.docLocal.data.value.remotePeers;
  const connectedPeers = app.value.docEphemeral.data.value.connectedPeers;
  const result = [];

  for (const [peerJsPeerId, remotePeer] of Object.entries(remotePeers)) {
    const connectedPeer = connectedPeers[peerJsPeerId];

    if (connectedPeer === undefined) {
      result.push({
        ...remotePeer,
        peerJsPeerId,
        connected: false,
      });
    } else
      result.push({
        ...remotePeer,
        ...connectedPeer,
        peerJsPeerId,
        connected: true,
      });
  }

  // Include peers that we are connected to, but that aren't known.
  for (const [peerJsPeerId, connectedPeer] of Object.entries(connectedPeers))
    if (!(peerJsPeerId in remotePeers))
      result.push({
        ...connectedPeer,
        peerJsPeerId,
        connected: true,
      });

  return result;
});
const inviteUrl = computed(() => {
  if (app.value === undefined) return undefined;

  const inviteUrl = URL.parse(window.location.href)!;
  inviteUrl.hash = encodeHash({
    path:
      currentHash.value.path?.calendar.id !== undefined
        ? {
            calendar: {
              id: currentHash.value.path.calendar.id,
            },
          }
        : undefined,
    args: {
      action: 'addPeer',
      documentId: app.value.docLocal.data.value.documentIdShared!,
      peerJsPeerId: app.value.docLocal.data.value.localPeer.peerJsPeerId,
    },
  });
  return inviteUrl.href;
});
const inviteQr = computedAsync(async () => {
  if (inviteUrl.value === undefined) return undefined;

  return await QRCode.toDataURL(inviteUrl.value, {
    scale: 1,
  });
});

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

function createNewCalendar() {
  const calendarId = uuid.v7();
  localStorageData.value.calendars[calendarId] = {};
}

function forgetPeer(peerJsPeerId: string) {
  if (app.value === undefined) return;

  app.value.docLocal.data.value.remotePeers[changeSubtree]((remotePeers) => {
    delete remotePeers[peerJsPeerId];
  });

  console.log(app.value.docLocal.data.value.remotePeers);
  // TODO/FIXME: We reload the page to get rid of stray connections.
  // Ideally, we would just close the WebRTC connections instead.
  location.reload();
}
</script>

<template>
  <div class="drawer">
    <input id="spa-drawer" type="checkbox" class="drawer-toggle" v-model="isDrawerOpen" />
    <div class="drawer-content">
      <div class="pb-16" v-if="app !== undefined">
        <Calendar v-if="currentPage === Page.CALENDAR" v-model="app" />
        <Milestones v-if="currentPage === Page.MILESTONES" v-model="app" />
        <Settings v-if="currentPage === Page.SETTINGS" v-model="app" />
      </div>
      <div
        v-else
        class="flex flex-col items-center justify-center"
        style="height: calc(100svh - var(--spacing) * 16); /* Full height excluding the menu bar */"
      >
        <div class="flex flex-col gap-2 items-center">
          <template v-if="appIsBeingLoaded">
            <span class="loading loading-bars loading-xl"></span>
            <h1>Loading calendar, please wait.</h1>
          </template>
          <template v-else>
            <h1>Please select a calendar to display, in the bottom left menu.</h1>
          </template>
        </div>
      </div>
      <div class="dock gap-2">
        <button
          @click="
            drawerContent = 'calendars';
            isDrawerOpen = true;
          "
          v-html="feather.icons['user'].toSvg()"
          :class="
            'tooltip tooltip-right bg-neutral-800 text-white flex-none aspect-square ' +
            (drawerContent === 'calendars' ? 'dock-active ' : '')
          "
        />
        <button
          @click="
            drawerContent = 'peers';
            isDrawerOpen = true;
          "
          v-html="feather.icons[connected ? 'upload-cloud' : 'cloud-off'].toSvg()"
          :class="
            'tooltip tooltip-right bg-neutral-800 flex-none aspect-square ' +
            (drawerContent === 'peers' ? 'dock-active ' : '') +
            (connected ? 'text-lime-300' : 'text-neutral-500')
          "
          :data-tip="
            connected > 1
              ? `Connected to ${connected} devices`
              : connected > 0
                ? 'Connected to 1 device'
                : 'Not connected to any devices'
          "
        />
        <button
          @click="setPage(Page.CALENDAR)"
          v-html="feather.icons['calendar'].toSvg()"
          :class="'!max-w-none ' + (currentPage == Page.CALENDAR ? 'dock-active' : '')"
        />
        <!-- <button
          @click="setPage(Page.MILESTONES)"
          v-html="feather.icons['bar-chart-2'].toSvg()"
          :class="currentPage == Page.MILESTONES ? 'dock-active' : ''"
        /> -->
        <button
          @click="setPage(Page.SETTINGS)"
          v-html="feather.icons['settings'].toSvg()"
          :class="'!max-w-none ' + (currentPage == Page.SETTINGS ? 'dock-active' : '')"
        />
      </div>
    </div>
    <div class="drawer-side w-full z-10">
      <label for="spa-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
      <div
        class="bg-base-200 text-base-content min-h-full w-80 p-4 shadow-[0_0_4rem_0px_rgba(0,0,0,0.3)] custom-drawer flex flex-col items-center"
      >
        <template v-if="drawerContent === 'calendars'">
          <div class="text-2xl text-center">My Calendars</div>
          <div class="flex flex-col w-full mt-4 mb-4 gap-1">
            <button
              v-for="calendarId of Object.keys(localStorageData.calendars)"
              :key="calendarId"
              @click="openCalendar(calendarId)"
              class="px-4 py-1 text-center btn btn-ghost btn-neutral"
            >
              {{ calendarId }}
            </button>
          </div>
          <button @click="createNewCalendar" class="btn btn-sm btn-primary">
            <div v-html="feather.icons['plus'].toSvg()" />
            <div class="max-sm:hidden">Create New Calendar</div>
          </button>
        </template>
        <template v-if="drawerContent === 'peers'">
          <div class="text-2xl mb-4 text-center">Known Devices</div>
          <ul class="flex flex-col w-full">
            <template v-if="peers.length === 0"
              ><li class="text-center m-5 text-neutral-500">No devices known.</li></template
            >
            <template v-else>
              <li
                v-for="peer of peers"
                :key="peer.peerJsPeerId"
                class="flex flex-row items-center gap-4 px-4 py-1"
              >
                <div
                  :class="
                    'rounded-full bg-neutral p-2 ' +
                    (peer.connected ? 'text-lime-300' : 'text-neutral-500')
                  "
                >
                  <div
                    v-html="feather.icons[peer.connected ? 'upload-cloud' : 'cloud-off'].toSvg()"
                  />
                </div>
                <div class="flex flex-1 flex-col items-start">
                  <div>PEER NAME (TODO)</div>
                  <div class="text-xs">
                    {{ peer.peerJsPeerId }}
                  </div>
                </div>
                <div class="flex flex-col gap-1 items-stretch">
                  <button
                    class="btn btn-sm btn-neutral max-sm:btn-square"
                    @click="forgetPeer(peer.peerJsPeerId)"
                  >
                    <div v-html="feather.icons['trash-2'].toSvg()" />
                    <div class="max-sm:hidden">Forget</div>
                  </button>
                </div>
              </li>
            </template>
          </ul>
          <div class="text-2xl mb-4 text-center">Add a Device</div>
          <label class="w-full flex gap-2">
            <div class="label">
              <span class="label-text">Invite Link</span>
            </div>
            <input
              type="text"
              :value="inviteUrl"
              readonly
              class="input flex-1"
              @focus="(event) => (event.target! as HTMLInputElement).select()"
            />
          </label>
          <img
            :src="inviteQr"
            class="scale-400 mt-2"
            style="image-rendering: pixelated; transform-origin: 50% top"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped lang="css">
.custom-drawer {
  width: calc(min(max(30rem, 30%), 80%));
}
</style>

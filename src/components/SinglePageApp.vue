<script setup lang="ts">
import { computed, ref, watch, type ShallowRef } from 'vue';
import Calendar from './Calendar.vue';
import Milestones from './Milestones.vue';
import Settings from './Settings.vue';
import feather from 'feather-icons';
import { accountStore, type App } from '../account';
import type { Repo } from '@automerge/automerge-repo';
import type { Rop } from 'automerge-diy-vue-hooks';
import type { RemotePeer } from '@/client';
import QRCode from 'qrcode';
import { computedAsync } from '@vueuse/core';
import { encodeHash } from '@/hash';

// const app: Ref<App> = ref({
//   pinCatalog: PinCatalog.loadFromLocalStorageOrDefault(),
//   pinCalendar: PinCalendar.loadFromLocalStorageOrDefault(),
// });

const app: ShallowRef<App> = await accountStore.value.GetApp();
const isDrawerOpen = ref(false);
const connected = computed(() => {
  return Object.keys(app.value.docEphemeral.data.value.connectedPeers).length;
});
const peers = computed(() => {
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
  const inviteUrl = URL.parse(window.location.href)!;
  inviteUrl.hash = encodeHash({
    action: 'addPeer',
    documentId: app.value.docLocal.data.value.documentIdShared!,
    peerJsPeerId: app.value.docLocal.data.value.localPeer.peerJsPeerId,
  });
  return inviteUrl.href;
});
const inviteQr = computedAsync(async () => {
  return await QRCode.toDataURL(inviteUrl.value, {
    scale: 1,
  });
});

console.log('pinCalendar', app.value!.docShared.data.value!.pinCalendar);

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
  <div class="drawer">
    <input id="spa-drawer" type="checkbox" class="drawer-toggle" v-model="isDrawerOpen" />
    <div class="drawer-content">
      <div class="pb-16">
        <!-- Padding equal to the bottom navigation height -->
        <Calendar v-if="currentPage === Page.CALENDAR" v-model="app" />
        <Milestones v-if="currentPage === Page.MILESTONES" v-model="app" />
        <Settings v-if="currentPage === Page.SETTINGS" v-model="app" />
      </div>
      <div class="dock">
        <button
          @click="isDrawerOpen = true"
          v-html="feather.icons[connected ? 'upload-cloud' : 'cloud-off'].toSvg()"
          :class="
            'tooltip tooltip-right bg-neutral-800 flex-none aspect-square ' +
            (isDrawerOpen ? 'dock-active ' : '') +
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
                <button class="btn btn-sm btn-neutral max-sm:btn-square">
                  <div v-html="feather.icons['trash-2'].toSvg()" />
                  <div class="max-sm:hidden">Forget</div>
                </button>
                <button class="btn btn-sm max-sm:btn-square btn-error">
                  <div v-html="feather.icons['slash'].toSvg()" />
                  <div class="max-sm:hidden">Block</div>
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
      </div>
    </div>
  </div>
</template>

<style scoped lang="css">
.custom-drawer {
  width: calc(min(max(30rem, 30%), 80%));
}
</style>

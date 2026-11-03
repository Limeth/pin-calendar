<script setup lang="ts">
import { computed, markRaw, ref, watch, type Ref } from 'vue';
import Calendar from './Calendar.vue';
import Milestones from './Milestones.vue';
import Settings from './Settings.vue';
import CalendarName from './CalendarName.vue';
import feather from 'feather-icons';
import { appStore, type App } from '../app';
import QRCode from 'qrcode';
import { computedAsync } from '@vueuse/core';
import { decodeHash, encodeHash, type Hash, type HashAddPeer } from '@/hash';
import {
  LocalDocumentGetLocalPeer,
  LocalDocumentGetRemotePeers,
  type CalendarId,
} from '@/documents/local';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import {
  LocalStorageDataAddCalendar,
  LocalStorageDataIsReadOnly,
  LocalStorageDataSetCalendarAlias,
  localStorageDataStore,
} from '@/localStorageData';
import * as auth from '@/auth';
import { forgetRemotePeer } from '@/peers';
import { SharedDocumentGetName, SharedDocumentSetName } from '@/documents/shared';
import NewerVersionAlert from './NewerVersionAlert.vue';
import { NewerVersionError } from '@/versioned';

// const app: Ref<App> = ref({
//   pinCatalog: PinCatalog.loadFromLocalStorageOrDefault(),
//   pinCalendar: PinCalendar.loadFromLocalStorageOrDefault(),
// });

// export type SharedAppModel = {
//   isDrawerOpen: boolean;
// };

// const sharedAppModel = defineModel<SharedAppModel>();
// const isDrawerOpen = toRef(sharedAppModel.value?.isDrawerOpen);
// watch(isDrawerOpen, () => {
//   console.log(isDrawerOpen);
// });

const isDrawerOpen = ref(false);
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

// The calendar to open when none is chosen: the least recently used one, if it still exists, or
// the first one.
function defaultCalendarId(): CalendarId | undefined {
  const { calendars, leastRecentlyUsedCalendar } = localStorageData.value;

  if (leastRecentlyUsedCalendar !== undefined && leastRecentlyUsedCalendar in calendars)
    return leastRecentlyUsedCalendar;

  return Object.keys(calendars)[0];
}

// Initialize the `currentHash.value.path` field, ensuring it's present.
{
  const calendarIds = Object.keys(localStorageData.value.calendars);

  if (calendarIds.length === 0) {
    // If no calendars exist, create one. The ID in the URL, if any, is not used, like when it is
    // not one of the calendars below.
    // TODO: This should be done manually by the user.
    currentHash.value.path = {
      calendar: {
        id: LocalStorageDataAddCalendar(localStorageData.value),
      },
    };
  } else if (
    currentHash.value.path?.calendar.id === undefined ||
    !(currentHash.value.path.calendar.id in localStorageData.value.calendars)
  ) {
    // Otherwise, if no ID was given, choose one of the calendars to display.
    currentHash.value.path = {
      calendar: {
        id: defaultCalendarId()!,
      },
    };
  }
}

// const calendar = computed(() =>
//   currentHash.value.path?.calendar.id !== undefined
//     ? localStorageData.value.calendars[currentHash.value.path?.calendar.id]
//     : undefined,
// );

function openCalendar(calendarId: CalendarId) {
  // Not in a read-only list, which is never saved, see `LocalStorageDataIsReadOnly`.
  if (
    calendarId in localStorageData.value.calendars &&
    !LocalStorageDataIsReadOnly(localStorageData.value)
  ) {
    localStorageData.value.leastRecentlyUsedCalendar = calendarId;
  }

  currentHash.value.path = {
    calendar: {
      id: calendarId,
    },
  };
}

openCalendar(currentHash.value.path!.calendar.id);

// Open another calendar when the open one is removed from the list, e.g. when it was deleted,
// possibly in another tab. `in`, because Vue does not track `Object.hasOwn`.
watch(
  () =>
    currentHash.value.path !== undefined &&
    currentHash.value.path.calendar.id in localStorageData.value.calendars,
  (isListed) => {
    if (isListed) return;

    const calendarId = defaultCalendarId();

    if (calendarId !== undefined) {
      openCalendar(calendarId);
      return;
    }

    // No calendars are left, so create one, as on startup. Deleting the last calendar already
    // creates one, so this is only a fallback, e.g. for when the site data was cleared. Not in a
    // read-only list, which this component is not shown for without calendars, see `SinglePageApp`.
    if (LocalStorageDataIsReadOnly(localStorageData.value)) return;

    openCalendar(LocalStorageDataAddCalendar(localStorageData.value));
  },
);

const appIsBeingLoaded = ref(true);
// Whether the calendar could not be loaded, as its documents only have newer versions, see
// `NewerVersionError`. Loading is not retried, so the page needs to be refreshed.
const appHasOnlyNewerVersions = ref(false);
const appAsync = computedAsync(
  async () => {
    appHasOnlyNewerVersions.value = false;

    const app = await appStore.value.GetAppOptional(currentHash.value.path!.calendar.id);
    // To debug the loading indicator when switching between calendars, uncomment this:
    // await new Promise(() => { /* Never resolve */ });
    return app;
  },
  undefined,
  {
    evaluating: appIsBeingLoaded,
    onError(error) {
      console.error('Failed to load the calendar:', error);
      appHasOnlyNewerVersions.value = error instanceof NewerVersionError;
    },
  },
);
// This property exists so that the app has the value `undefined`
// when switching from a loaded calendar to a not-yet-loaded calendar.
const app = computed(() => (appIsBeingLoaded.value ? undefined : appAsync.value));

// The open calendar, shown in the header. While it is loading, its name is the copy in local storage.
const headerCalendar = computed(() => {
  const calendarId = app.value?.calendarId ?? currentHash.value.path?.calendar.id;

  if (calendarId === undefined) return undefined;

  const calendar = localStorageData.value.calendars[calendarId];

  return {
    calendarId,
    name:
      app.value !== undefined
        ? SharedDocumentGetName(app.value.docShared.data.value)
        : calendar?.cache?.name,
    alias: calendar?.alias,
  };
});

const drawerContent: Ref<undefined | 'calendars' | 'peers'> = ref(undefined);
const connected = computed(() => {
  if (app.value === undefined) return 0;
  return Object.keys(app.value.docEphemeral.data.value.connectedPeers).length;
});
const peers = computed(() => {
  if (app.value === undefined) return [];

  const remotePeers = LocalDocumentGetRemotePeers(app.value.docLocal.data.value);
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

  // Include peers that we are connected to, but that aren't known. `hasOwn`, as the peer chooses its
  // ID, and `remotePeers` is a plain copy, which Vue does not need to track.
  for (const [peerJsPeerId, connectedPeer] of Object.entries(connectedPeers))
    if (!Object.hasOwn(remotePeers, peerJsPeerId))
      result.push({
        ...connectedPeer,
        peerJsPeerId,
        connected: true,
      });

  return result;
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

const inviteLink = ref('');

function useInviteLink() {
  const [currentPath] = window.location.href.split('#', 2);
  const [newPath] = inviteLink.value.split('#', 2);

  if (currentPath === newPath) {
    window.location.href = newPath;
    return;
  }

  console.warn(`Invalid invite link: ${inviteLink.value}`);
}

function createNewCalendar() {
  if (LocalStorageDataIsReadOnly(localStorageData.value)) return;

  LocalStorageDataAddCalendar(localStorageData.value);
}

async function forgetPeer(peerJsPeerId: string) {
  if (app.value === undefined) return;
  if (app.value.docLocal.readOnly.value) return;

  await forgetRemotePeer(app.value.docLocal.data, peerJsPeerId);
}

type ModalAddDevice = {
  kind: 'add-device';
  inviteUrl: string;
  inviteQr: string;
  // The key of the invite in `EphemeralDocument::invites`.
  secretThumbprint: string;
};

type ModalRename = {
  kind: 'rename';
  // The calendar being renamed, which stays the same if another calendar is opened meanwhile.
  app: App;
  name: string;
  alias: string;
};

type ModalData = ModalAddDevice | ModalRename;

const modalData: Ref<ModalData | undefined> = ref(undefined);
// The state of the invite of the open invite dialog: waiting for a device, being used by a device
// that is joining, or used by a device that has joined.
const inviteState = computed((): 'waiting' | 'joining' | 'joined' => {
  if (modalData.value?.kind !== 'add-device') return 'waiting';

  const invite = app.value?.docEphemeral.data.value.invites[modalData.value.secretThumbprint];

  if (invite?.joined) return 'joined';
  if (invite?.usedBy !== undefined) return 'joining';
  return 'waiting';
});

async function createInviteUrl() {
  if (app.value === undefined) return undefined;

  const calendarId = currentHash.value.path?.calendar.id;
  const localPeer = LocalDocumentGetLocalPeer(app.value.docLocal.data.value);

  if (calendarId === undefined || localPeer === undefined) return undefined;

  const secret = await auth.generateInviteSecret();

  // Create a new invite.
  app.value.docEphemeral.data.value.invites[changeSubtree]((invites) => {
    invites[secret.thumbprint] = {
      secretString: secret.string,
    };
  });

  const inviteUrl = URL.parse(window.location.href)!;
  const hash: HashAddPeer = {
    path: undefined,
    args: {
      action: 'addPeer',
      secret: secret.string,
      peerJsPeerId: localPeer.peerJsPeerId,
      calendarIdTag: await auth.calendarIdTag(secret, calendarId),
    },
  };
  inviteUrl.hash = encodeHash(hash);
  return [inviteUrl.href, secret.thumbprint] as const;
}

async function openAddDeviceDialog() {
  if (modalData.value !== undefined) return;
  if (app.value?.docLocal.readOnly.value) return;

  const inviteUrlResult = await createInviteUrl();

  if (inviteUrlResult === undefined) return;

  const [inviteUrl, secretThumbprint] = inviteUrlResult;
  const inviteQr = await QRCode.toDataURL(inviteUrl, {
    scale: 1,
  });

  modalData.value = {
    kind: 'add-device',
    inviteUrl,
    inviteQr,
    secretThumbprint,
  };
}

function closeAddDeviceDialog() {
  if (app.value === undefined) return undefined;
  if (modalData.value?.kind !== 'add-device') return;

  const modalAddDevice: ModalAddDevice = modalData.value;

  app.value.docEphemeral.data.value.invites[changeSubtree]((invites) => {
    delete invites[modalAddDevice.secretThumbprint];
  });

  modalData.value = undefined;
}

function openRenameDialog() {
  if (modalData.value !== undefined) return;
  if (app.value === undefined) return;

  modalData.value = {
    kind: 'rename',
    // Raw, as `modalData` is deeply reactive, which would unwrap the app's `Ref`s.
    app: markRaw(app.value),
    name: SharedDocumentGetName(app.value.docShared.data.value) ?? '',
    alias: localStorageData.value.calendars[app.value.calendarId]?.alias ?? '',
  };
}

function saveRenameDialog() {
  if (modalData.value?.kind !== 'rename') return;

  const { app, name, alias } = modalData.value;

  if (!app.docShared.readOnly.value)
    app.docShared.data.value[changeSubtree]((shared) => {
      SharedDocumentSetName(shared, name);
    });
  if (!LocalStorageDataIsReadOnly(localStorageData.value))
    LocalStorageDataSetCalendarAlias(localStorageData.value, app.calendarId, alias);

  modalData.value = undefined;
}
</script>

<template>
  <input id="spa-drawer" type="checkbox" class="drawer-toggle" v-model="isDrawerOpen" />
  <div class="modal" :class="{ 'modal-open': modalData !== undefined }">
    <div v-if="modalData?.kind === 'add-device'" class="modal-box flex flex-col gap-2">
      <h3 class="text-lg font-bold">Add a Device</h3>
      <p>
        The following link or QR code can be used to invite one user/device to the currently opened
        calendar.
      </p>
      <p>
        Whoever you share this link with will be able to edit the calendar, and read your IP
        address.
      </p>
      <p>
        Access for other users/devices to your copy of the calendar can be revoked from the devices
        menu.
      </p>
      <p>Only share this link with people you trust.</p>
      <img :src="modalData?.inviteQr" class="m-auto" style="image-rendering: pixelated; zoom: 4" />
      <label class="w-full flex gap-2">
        <div class="label">
          <span class="label-text">Invite Link</span>
        </div>
        <input
          type="text"
          :value="modalData?.inviteUrl"
          readonly
          class="input flex-1"
          @focus="(event) => (event.target! as HTMLInputElement).select()"
        />
      </label>
      <div class="modal-action items-baseline" v-if="inviteState === 'waiting'">
        <p class="mr-2">Waiting for device...</p>
        <button class="btn" @click="closeAddDeviceDialog">Cancel</button>
      </div>
      <!-- Cancelling is not possible while a device is joining, as the device may already have
      added this one as a peer, see `JoinConfirmPacket`. Joining either finishes or fails soon. -->
      <div class="modal-action items-baseline" v-if="inviteState === 'joining'">
        <p class="mr-2">
          A device is joining... <span class="loading loading-spinner loading-sm"></span>
        </p>
        <button class="btn" disabled>Cancel</button>
      </div>
      <div class="modal-action items-baseline" v-if="inviteState === 'joined'">
        <p class="mr-2 text-primary">Device added successfully.</p>
        <button class="btn btn-primary" @click="closeAddDeviceDialog">Close</button>
      </div>
    </div>
    <form
      v-if="modalData?.kind === 'rename'"
      class="modal-box flex flex-col gap-2"
      @submit.prevent="saveRenameDialog"
    >
      <h3 class="text-lg font-bold">Rename Calendar</h3>
      <label class="flex flex-col gap-1">
        <span class="label-text">Name</span>
        <input
          type="text"
          v-model="modalData.name"
          class="input w-full"
          maxlength="100"
          placeholder="Unnamed Calendar"
          :disabled="modalData.app.docShared.readOnly.value"
        />
        <span class="text-xs opacity-60">Shared with all devices of this calendar.</span>
      </label>
      <label class="flex flex-col gap-1">
        <span class="label-text">Alias</span>
        <input
          type="text"
          v-model="modalData.alias"
          class="input w-full"
          maxlength="100"
          :disabled="LocalStorageDataIsReadOnly(localStorageData)"
        />
        <span class="text-xs opacity-60">
          Only on this device, shown alongside the name. Optional.
        </span>
      </label>
      <div class="modal-action">
        <button type="button" class="btn" @click="modalData = undefined">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  </div>
  <div class="drawer-content">
    <!-- Fixed height, so that the page does not shift with the name's second line, and the loading
    placeholder below can subtract it. -->
    <header class="navbar h-16 bg-base-200 justify-center px-4">
      <!-- The name is the rename button. The pencil only appears on hover. -->
      <!-- Renaming needs the shared document, so it waits for the calendar to load. -->
      <button
        v-if="headerCalendar !== undefined"
        class="group btn btn-ghost h-full max-w-full gap-4 py-0 text-xl font-normal"
        :class="{ 'pointer-events-none': app === undefined }"
        title="Rename calendar"
        :aria-disabled="app === undefined"
        @click="openRenameDialog"
      >
        <span class="sr-only">Rename calendar</span>
        <!-- Balances the pencil, so that the name is centered. -->
        <span class="w-4 shrink-0" aria-hidden="true" />
        <CalendarName
          class="text-center"
          :name="headerCalendar.name"
          :alias="headerCalendar.alias"
          :calendar-id="headerCalendar.calendarId"
        />
        <span
          class="shrink-0 opacity-0 group-hover:opacity-100"
          aria-hidden="true"
          v-html="feather.icons['edit-2'].toSvg({ width: 16, height: 16 })"
        />
      </button>
    </header>
    <div class="pb-16" v-if="app !== undefined">
      <Calendar v-if="currentPage === Page.CALENDAR" v-model="app" />
      <Milestones v-if="currentPage === Page.MILESTONES" v-model="app" />
      <Settings v-if="currentPage === Page.SETTINGS" v-model="app" />
    </div>
    <div
      v-else
      class="flex flex-col items-center justify-center"
      style="
        height: calc(
          100svh - var(--spacing) * 32
        ); /* Full height excluding the header and the menu bar */
      "
    >
      <div class="flex flex-col gap-2 items-center">
        <template v-if="appIsBeingLoaded">
          <span class="loading loading-bars loading-xl"></span>
          <h1>Loading calendar, please wait.</h1>
        </template>
        <template v-else-if="appHasOnlyNewerVersions">
          <h1>This calendar cannot be shown, as it was changed by a newer version of the app.</h1>
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
        :class="'max-w-none! ' + (currentPage == Page.CALENDAR ? 'dock-active' : '')"
      />
      <!-- <button
          @click="setPage(Page.MILESTONES)"
          v-html="feather.icons['bar-chart-2'].toSvg()"
          :class="currentPage == Page.MILESTONES ? 'dock-active' : ''"
        /> -->
      <button
        @click="setPage(Page.SETTINGS)"
        v-html="feather.icons['settings'].toSvg()"
        :class="'max-w-none! ' + (currentPage == Page.SETTINGS ? 'dock-active' : '')"
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
            v-for="[calendarId, calendar] of Object.entries(localStorageData.calendars)"
            :key="calendarId"
            @click="openCalendar(calendarId)"
            class="h-auto min-h-10 px-4 py-1 text-center btn btn-ghost btn-neutral"
          >
            <CalendarName
              class="text-center"
              :name="calendar.cache?.name"
              :alias="calendar.alias"
              :calendar-id="calendarId"
            />
          </button>
        </div>
        <button
          @click="createNewCalendar"
          class="btn btn-sm btn-primary"
          :disabled="LocalStorageDataIsReadOnly(localStorageData)"
        >
          <div v-html="feather.icons['plus'].toSvg()" />
          <div class="max-sm:hidden">Create New Calendar</div>
        </button>
        <form
          @submit.prevent="useInviteLink"
          class="flex justify-center flex-col w-full mt-6 gap-2"
        >
          <input
            type="text"
            v-model="inviteLink"
            class="input w-full"
            placeholder="Paste Invite Link Here"
            @focus="(event) => (event.target! as HTMLInputElement).select()"
          />
          <button type="submit" class="btn btn-sm btn-primary">
            <div>Use Invite Link</div>
          </button>
        </form>
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
                  :disabled="app?.docLocal.readOnly.value"
                  @click="forgetPeer(peer.peerJsPeerId)"
                >
                  <div v-html="feather.icons['trash-2'].toSvg()" />
                  <div class="max-sm:hidden">Forget</div>
                </button>
              </div>
            </li>
          </template>
          <li class="py-4 w-full flex justify-center">
            <button
              @click="openAddDeviceDialog"
              class="btn btn-sm btn-primary"
              :disabled="app?.docLocal.readOnly.value"
            >
              <div v-html="feather.icons['user-plus'].toSvg()" />
              <div class="max-sm:hidden">Add a Device</div>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </div>
  <NewerVersionAlert
    :list="LocalStorageDataIsReadOnly(localStorageData)"
    :calendar="
      appHasOnlyNewerVersions || !!(app?.docShared.readOnly.value || app?.docLocal.readOnly.value)
    "
  />
</template>

<style scoped lang="css">
.custom-drawer {
  width: calc(min(max(30rem, 30%), 80%));
}
</style>

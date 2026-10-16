<script setup lang="ts">
import { ref, watch, type Ref } from 'vue';
import { decodeHash, encodeHash, type Hash, type HashAddPeer, type HashArgsAddPeer } from '@/hash';
import { localStorageDataStore } from '@/localStorageData';
import SharedApp from './SharedApp.vue';
import { joinCalendar } from '@/invite';
import { checkInviterPairing, joinExistingCalendar, type InviterPairing } from '@/rejoin';
import { appStore } from '@/app';
import type { ErrorPacket } from '@/handshake';
import * as auth from '@/auth';
import type { CalendarId } from '@/documents/local';

// const sharedAppModel: Reactive<SharedAppModel> = reactive({
//   isDrawerOpen: false,
// });

// watch(sharedAppModel, () => {
//   console.log(toRaw(sharedAppModel));
// });

const localStorageData = await localStorageDataStore.value.GetData();
const currentUrl = URL.parse(window.location.href) ?? undefined;
const currentHash: Ref<Hash> = ref(decodeHash(currentUrl?.hash ?? ''));

console.log(localStorageData.value);
console.log(currentUrl);
console.log(currentHash);

// Automatically update the URL's hash when `currentHash` is altered.
watch(
  currentHash,
  () => {
    window.location.hash = encodeHash(currentHash.value);
  },
  { deep: true },
);

function isHashValidAddPeer(hash: Hash): hash is HashAddPeer {
  // TODO: Use schema validation
  return (
    hash.args?.action === 'addPeer' &&
    typeof hash.args?.peerJsPeerId === 'string' &&
    typeof hash.args?.secret === 'string' &&
    typeof hash.args?.calendarIdTag === 'string'
  );
}

// Find the calendar an invite is for among the calendars of this device, see `auth.calendarIdTag`.
async function findInvitedCalendar(invite: HashArgsAddPeer): Promise<CalendarId | undefined> {
  let secret;

  try {
    secret = await auth.parseInviteSecret(invite.secret);
  } catch {
    // An invalid secret is reported when joining.
    return undefined;
  }

  for (const calendarId of Object.keys(localStorageData.value.calendars))
    if ((await auth.calendarIdTag(secret, calendarId)) === invite.calendarIdTag) return calendarId;

  return undefined;
}

type ModalInviteConfirmation = {
  kind: 'invite-confirmation';
  status: 'idle' | 'requesting-access';
  error: undefined | string;
  // The calendar of the invite, if this device already has it. Then, joining shares the device's
  // existing copy of the calendar with the inviter, see `joinExistingCalendar`.
  existingCalendarId: undefined | CalendarId;
  // Whether the existing calendar is still shared with the inviter, see `InviterPairing`. Joining is
  // only offered if it is not. Undefined if this device does not have the calendar.
  inviterPairing: undefined | 'checking' | InviterPairing;
  actionCancel(): void;
  actionConfirm(): void;
  actionOpenExistingCalendar(): void;
};

// Whether joining is offered: for a new calendar, or an existing one no longer shared with the
// inviter.
function isJoinOffered(inviterPairing: ModalInviteConfirmation['inviterPairing']): boolean {
  return (
    inviterPairing === undefined ||
    inviterPairing === 'forgotten-inviter' ||
    inviterPairing === 'unconnected-inviter'
  );
}

// How long to wait for a connection to the inviter, before concluding that the existing calendar
// is no longer shared with it, see `checkInviterPairing`.
const PAIRING_CHECK_TIMEOUT_MS = 10_000;

// Join a calendar this device does not have yet, as a new device. Returns the calendar's ID.
async function joinNewCalendar(invite: HashArgsAddPeer): Promise<CalendarId | ErrorPacket> {
  const result = await joinCalendar(invite, 10_000);

  if (result.kind === 'error') return result;

  // Initialize a calendar to be added.
  if (!(result.calendarId in localStorageData.value.calendars))
    localStorageData.value.calendars[result.calendarId] = {
      invitation: {
        invitedBy: invite.peerJsPeerId,
        localPeerId: result.peerJsPeerId,
        documentIdShared: result.sharedDocumentId,
        authKeyId: result.authKeyId,
      },
    };

  return result.calendarId;
}

// TODO: Combine with ModalData in SharedApp and other dialogs in settings.
type ModalData = ModalInviteConfirmation;

const modalData: Ref<ModalData | undefined> = ref(undefined);

// Initialize the `currentHash.value.path` field, ensuring it's present.
console.log('isHashValidAddPeer(currentHash.value)', isHashValidAddPeer(currentHash.value));
if (isHashValidAddPeer(currentHash.value)) {
  const existingCalendarId = await findInvitedCalendar(currentHash.value.args);

  modalData.value = {
    kind: 'invite-confirmation',
    status: 'idle',
    error: undefined,
    existingCalendarId,
    inviterPairing: existingCalendarId === undefined ? undefined : 'checking',
    actionCancel() {
      modalData.value = undefined;
      currentHash.value = { path: undefined, args: undefined };
      modalData.value = undefined;
    },
    async actionConfirm() {
      if (!isHashValidAddPeer(currentHash.value)) return;
      if (this.existingCalendarId !== undefined && !isJoinOffered(this.inviterPairing)) return;

      this.status = 'requesting-access';
      this.error = undefined;

      const existingCalendarId = this.existingCalendarId;
      // The ID of the joined calendar, or an error.
      const result =
        existingCalendarId === undefined
          ? await joinNewCalendar(currentHash.value.args)
          : ((await joinExistingCalendar(
              await appStore.value.GetApp(existingCalendarId),
              currentHash.value.args,
              30_000,
            )) ?? existingCalendarId);

      if (typeof result === 'string') {
        // Open the joined calendar.
        currentHash.value = { path: { calendar: { id: result } }, args: undefined };
        modalData.value = undefined;
      } else {
        console.error('Failed to join the calendar:', result.message);
        this.error = result.message;
      }

      this.status = 'idle';
    },
    actionOpenExistingCalendar() {
      if (this.existingCalendarId === undefined) return;

      currentHash.value = { path: { calendar: { id: this.existingCalendarId } }, args: undefined };
      modalData.value = undefined;
    },
  };

  if (existingCalendarId !== undefined) {
    const invite = currentHash.value.args;

    appStore.value
      .GetApp(existingCalendarId)
      .then((app) => checkInviterPairing(app, invite, PAIRING_CHECK_TIMEOUT_MS))
      .catch((error): InviterPairing => {
        // Offer joining, which reports its own errors. Assume that the inviter was not contacted, so
        // that the dialog mentions that joining shares the IP address with it.
        console.error('Failed to check whether the calendar is shared with the inviter:', error);
        return 'forgotten-inviter';
      })
      .then((pairing) => {
        if (modalData.value?.kind === 'invite-confirmation')
          modalData.value.inviterPairing = pairing;
      });
  }
}
</script>

<template>
  <div class="drawer">
    <SharedApp v-if="currentHash.args?.action !== 'addPeer'" />
  </div>
  <div class="modal" :class="{ 'modal-open': modalData !== undefined }">
    <div v-if="modalData?.kind === 'invite-confirmation'" class="modal-box flex flex-col gap-2">
      <h3 class="text-lg font-bold">Join Calendar</h3>
      <!-- The ID is only known for a calendar this device already has. For a new calendar, the invite
      link only identifies it by a tag, see `auth.calendarIdTag`. -->
      <!-- TODO: Display the calendar's name instead of its ID, once calendars have names. -->
      <p v-if="modalData.existingCalendarId !== undefined">
        Calendar: <span class="font-mono break-all">{{ modalData.existingCalendarId }}</span>
      </p>
      <template v-if="modalData.inviterPairing === 'checking'">
        <p>
          You have been invited to join a calendar, which you already have on this device. Checking
          whether it is still shared with the device that created this invite link...
          <span class="loading loading-spinner loading-sm"></span>
        </p>
      </template>
      <template v-else-if="modalData.inviterPairing === 'own-invite'">
        <p>
          This invite link was created by this device, for a calendar it already has, so there is
          nothing to join.
        </p>
        <p>The invite link has not been used, so it can still be used to invite another device.</p>
      </template>
      <template v-else-if="modalData.inviterPairing === 'paired'">
        <p>
          You have been invited to join a calendar, which you already have on this device. It is
          already shared with the device that created this invite link, so there is nothing to join.
        </p>
        <p>The invite link has not been used, so it can still be used to invite another device.</p>
      </template>
      <template v-else-if="modalData.inviterPairing === 'forgotten-inviter'">
        <p>
          You have been invited to join a calendar, which you already have on this device. It is not
          shared with the device that invited you, for example because this device removed it.
        </p>
        <div role="alert" class="alert alert-warning">
          <span>
            Joining will share your existing copy of the calendar with the device that invited you.
            Both copies will be merged, and each device will receive the other's changes.
          </span>
        </div>
        <p>Joining will also cause your IP address to be shared with that device.</p>
        <p>
          To only view the calendar, open your copy of it instead. The invite link will remain
          unused.
        </p>
        <p>Only proceed with sharing the calendar if you trust the sender.</p>
      </template>
      <template v-else-if="modalData.inviterPairing === 'unconnected-inviter'">
        <p>
          You have been invited to join a calendar, which you already have on this device. The
          device that invited you is still one of this device's peers, but they could not connect,
          for example because that device removed this one.
        </p>
        <div role="alert" class="alert alert-warning">
          <span>
            Joining will share your existing copy of the calendar with the device that invited you.
            Both copies will be merged, and each device will receive the other's changes.
          </span>
        </div>
        <p>
          As with all of its peers, this device already connects to that device whenever the
          calendar is open, which shares your IP address with it. Joining lets the two devices
          recognize each other again.
        </p>
        <p>
          To only view the calendar, open your copy of it instead. The invite link will remain
          unused.
        </p>
        <p>Only proceed with sharing the calendar if you trust the sender.</p>
      </template>
      <template v-else>
        <p>
          You have been invited to join a calendar. Confirming this invitation will cause your IP
          address to be shared with the owner of the calendar, so that the calendars can be kept in
          sync.
        </p>
        <p>
          The owner of the calendar may share the calendar with other parties, which will not show
          up in your list of devices.
        </p>
        <p>
          Access for other users/devices to your copy of the calendar can be revoked from the
          devices menu.
        </p>
        <p>Only proceed if you trust the sender.</p>
      </template>
      <div
        v-if="modalData.error !== undefined"
        class="border-2 border-error rounded-xl px-4 py-2 mt-4"
      >
        <div class="text-error text-xs">
          An error occurred while requesting access to the calendar:
        </div>
        <div class="text-error">{{ modalData.error }}</div>
      </div>
      <div class="modal-action">
        <button class="btn" @click="modalData.actionCancel">Cancel</button>
        <!-- Hidden while checking, as the choice depends on whether joining is offered. -->
        <button
          v-if="
            modalData.existingCalendarId !== undefined && modalData.inviterPairing !== 'checking'
          "
          class="btn"
          :class="{ 'btn-primary': !isJoinOffered(modalData.inviterPairing) }"
          :disabled="modalData.status !== 'idle'"
          @click="modalData.actionOpenExistingCalendar"
        >
          <!-- When joining is offered, make clear that this is the alternative to sharing. -->
          {{ isJoinOffered(modalData.inviterPairing) ? 'Open Without Sharing' : 'Open Calendar' }}
        </button>
        <button
          v-if="isJoinOffered(modalData.inviterPairing)"
          class="btn btn-primary"
          :disabled="modalData.status !== 'idle'"
          @click="modalData.actionConfirm"
        >
          <template v-if="modalData.status === 'idle'">
            {{ modalData.existingCalendarId !== undefined ? 'Open and Share' : 'Request Access' }}
          </template>
          <template v-if="modalData.status === 'requesting-access'"
            >Requesting Access <span class="loading loading-spinner loading-md"></span
          ></template>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="css">
.custom-drawer {
  width: calc(min(max(30rem, 30%), 80%));
}
</style>

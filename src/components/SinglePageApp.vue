<script setup lang="ts">
import { ref, watch, type Ref } from 'vue';
import { decodeHash, encodeHash, type Hash, type HashAddPeer, type HashArgsAddPeer } from '@/hash';
import { localStorageDataStore } from '@/localStorageData';
import SharedApp from './SharedApp.vue';
import { joinCalendar } from '@/invite';
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
  // The calendar of the invite, if this device already has it. Then, it is not joined again.
  existingCalendarId: undefined | CalendarId;
  actionCancel(): void;
  actionConfirm(): void;
  actionOpenExistingCalendar(): void;
};

// TODO: Combine with ModalData in SharedApp and other dialogs in settings.
type ModalData = ModalInviteConfirmation;

const modalData: Ref<ModalData | undefined> = ref(undefined);

// Initialize the `currentHash.value.path` field, ensuring it's present.
console.log('isHashValidAddPeer(currentHash.value)', isHashValidAddPeer(currentHash.value));
if (isHashValidAddPeer(currentHash.value)) {
  modalData.value = {
    kind: 'invite-confirmation',
    status: 'idle',
    error: undefined,
    existingCalendarId: await findInvitedCalendar(currentHash.value.args),
    actionCancel() {
      modalData.value = undefined;
      currentHash.value = { path: undefined, args: undefined };
      modalData.value = undefined;
    },
    async actionConfirm() {
      if (isHashValidAddPeer(currentHash.value)) {
        this.status = 'requesting-access';
        this.error = undefined;
        const result = await joinCalendar(currentHash.value.args, 10_000);

        if (result.kind === 'success') {
          // Initialize a calendar to be added.
          if (!(result.calendarId in localStorageData.value.calendars))
            localStorageData.value.calendars[result.calendarId] = {
              invitation: {
                invitedBy: currentHash.value.args.peerJsPeerId,
                localPeerId: result.peerJsPeerId,
                documentIdShared: result.sharedDocumentId,
                authKeyId: result.authKeyId,
              },
            };

          currentHash.value = { path: currentHash.value.path, args: undefined };
          modalData.value = undefined;
        } else if (result.kind === 'error') {
          console.error('Failed to join the calendar:', result.message);
          this.error = result.message;
        }

        this.status = 'idle';
      }
    },
    actionOpenExistingCalendar() {
      if (this.existingCalendarId === undefined) return;

      currentHash.value = { path: { calendar: { id: this.existingCalendarId } }, args: undefined };
      modalData.value = undefined;
    },
  };
}
</script>

<template>
  <div class="drawer">
    <SharedApp v-if="currentHash.args?.action !== 'addPeer'" />
  </div>
  <div class="modal" :class="{ 'modal-open': modalData !== undefined }">
    <div v-if="modalData?.kind === 'invite-confirmation'" class="modal-box flex flex-col gap-2">
      <h3 class="text-lg font-bold">Join Calendar</h3>
      <template v-if="modalData.existingCalendarId !== undefined">
        <p>You have been invited to join a calendar, which you already have on this device.</p>
        <p>The invite link has not been used, so it can still be used to invite another device.</p>
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
        <button
          v-if="modalData.existingCalendarId !== undefined"
          class="btn btn-primary"
          @click="modalData.actionOpenExistingCalendar"
        >
          Open Calendar
        </button>
        <button
          v-else
          class="btn btn-primary"
          :disabled="modalData.status !== 'idle'"
          @click="modalData.actionConfirm"
        >
          <template v-if="modalData.status === 'idle'">Request Access</template>
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

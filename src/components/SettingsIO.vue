<script setup lang="ts">
import { type App } from '../app';
import * as feather from 'feather-icons';
import { computed, ref } from 'vue';
import type { Ref } from 'vue';
import {
  type PinCatalog,
  PinCatalogSerialize,
  PinCatalogDeserialize,
  PinCatalogChange,
  PinCatalogClear,
  PinCatalogNew,
  PinCatalogRemovePinCategory,
  type PinCategoryId,
  type PinId,
  PIN_ID_SYMBOL,
  PIN_CATEGORY_ID_SYMBOL,
  PinCatalogRemovePin,
  PinCatalogAddPinCategory,
  PinCatalogGetPinCategories,
  PinCatalogGetPins,
  PinCatalogAddPin,
  PinCatalogGetPinById,
  PinCatalogGetPinCategoryById,
} from '../pins/pinCatalog';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import {
  LocalStorageDataAddCalendar,
  LocalStorageDataIsReadOnly,
  localStorageDataStore,
} from '@/localStorageData';
import * as auth from '@/auth';
import { keyToId } from '@/pins/util';
import { isObject, readKeys } from '@/validation';
import { LocalDocumentGetRemotePeers } from '@/documents/local';
import {
  PinCalendarClear,
  PinCalendarCombine,
  PinCalendarDeserialize,
  PinCalendarNew,
  PinCalendarSerialize,
  type PinCalendar,
} from '@/pins/pinCalendar';
// import { Temporal } from '@js-temporal/polyfill';
// import * as emojiSearch from 'node-emoji';
// import * as emojiGroups from 'unicode-emoji-json/data-by-group.json';
// import * as emojiComponents from 'unicode-emoji-json/data-emoji-components.json';
// import emojiRegex from 'emoji-regex';
// import PinIcon from './PinIcon.vue';

type ModalSimple = {
  kind: 'simple';
  title: string;
  message: string;
  buttonConfirm: string;
  actionConfirm(): void;
};

type ModalImport = {
  kind: 'import';
  import: Import;
};

// Why a file could not be imported.
type ModalError = {
  kind: 'error';
  title: string;
  message: string;
};

type ModalData = ModalSimple | ModalImport | ModalError;

type Download = {
  fileName: string;
  content: Blob;
};

type Upload = {
  onSuccess: (fileContent: string) => void;
};

type ImportPins = {
  kind: 'pins';
  pinCatalog: PinCatalog;
  conflicts: {
    pinCategories: PinCategoryId[];
    pins: PinId[];
  };
  overwrite: boolean;
};

type ImportCalendar = {
  kind: 'calendar';
  calendar: PinCalendar;
};

type Import = ImportPins | ImportCalendar;

const app = defineModel<App>();
const localStorageData = await localStorageDataStore.value.GetData();
// Exporting stays possible, see `hasNewerVersionRop`.
const readOnly = computed(() => app.value!.docShared.readOnly.value);
const docData = computed(() => app.value!.docShared.data.value);
const pinCalendar = computed(() => docData.value!.pinCalendar);
const pinCatalog = computed(() => docData.value!.pinCatalog);

const modalData: Ref<ModalData | undefined> = ref(undefined);

function getSettingsIoModal(): HTMLDialogElement {
  return document.getElementById('settings_io_modal') as HTMLDialogElement;
}

function triggerDownload(download: Download) {
  const url = window.URL.createObjectURL(download.content);
  const a = document.createElement('a');
  a.href = url;
  a.download = download.fileName;
  a.click();
  window.URL.revokeObjectURL(url);
}

function triggerUpload(upload: Upload) {
  const element = document.createElement('input');
  element.type = 'file';
  element.accept = 'application/json';
  element.onchange = () => {
    if (element.files === null || element.files === undefined || element.files.length < 1) {
      console.warn('Upload: No files specified. Aborting upload.');
      return;
    }

    if (element.files.length > 1) {
      console.warn('Upload: More than 1 file specified. Aborting upload.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result;

      if (typeof contents !== 'string') {
        console.warn('Upload: Not a text file. Aborting upload.');
        return;
      }

      upload.onSuccess(contents);
    };
    if (element.files[0]) reader.readAsText(element.files[0]);
  };
  element.click();
}

function onClickPinsExport() {
  triggerDownload({
    fileName: 'pin-catalog.json',
    content: new Blob([PinCatalogSerialize(pinCatalog.value)], {
      type: 'application/json',
    }),
  });
}

function showImportError(
  title: string,
  description: string,
  result: { type: 'newer' | 'outdated' | 'invalid' },
) {
  modalData.value = {
    kind: 'error',
    title,
    message:
      result.type === 'newer'
        ? 'This file was exported by a newer version of the app. Refresh the page to update the app, then import the file again.'
        : result.type === 'outdated'
          ? 'This file was exported by an older version of the app, which cannot be imported yet.'
          : `This file is not a valid ${description}.`,
  };
  getSettingsIoModal().showModal();
}

// Describes a conflict by the names of the existing and the imported entry, e.g. "Jog → Run". The
// existing entry may be invalid, as invalid entries conflict too, see `onClickPinsImport`.
function describeConflict(
  existing: { value: { displayName: string } } | null,
  imported: { value: { displayName: string } } | null,
  unreadable: string,
): string {
  const existingName = existing?.value.displayName ?? unreadable;
  const importedName = imported?.value.displayName ?? existingName;

  return existingName === importedName ? existingName : `${existingName} → ${importedName}`;
}

function describePinConflict(importPins: ImportPins, pinId: PinId): string {
  const catalog = pinCatalog.value;

  return describeConflict(
    isObject(catalog) ? PinCatalogGetPinById(catalog, pinId) : null,
    PinCatalogGetPinById(importPins.pinCatalog, pinId),
    'Unreadable pin',
  );
}

function describePinCategoryConflict(importPins: ImportPins, pinCategoryId: PinCategoryId): string {
  const catalog = pinCatalog.value;

  return describeConflict(
    isObject(catalog) ? PinCatalogGetPinCategoryById(catalog, pinCategoryId) : null,
    PinCatalogGetPinCategoryById(importPins.pinCatalog, pinCategoryId),
    'Unreadable category',
  );
}

function onClickPinsImport() {
  triggerUpload({
    onSuccess(fileContent: string) {
      const result = PinCatalogDeserialize(fileContent);

      if (result.type !== 'current') {
        showImportError('Pin Catalog Import', 'pin catalog', result);
        return;
      }

      const loadedPinCatalog = result.current;

      console.log(loadedPinCatalog);

      // Also invalid entries, which are replaced when overwriting.
      const catalog = pinCatalog.value;
      const existingPinIdKeys = isObject(catalog) ? readKeys(catalog.pins) : [];
      const existingPinCategoryIdKeys = isObject(catalog) ? readKeys(catalog.pinCategories) : [];
      const conflictingPinIdKeys = new Set(Object.keys(loadedPinCatalog.pins)).intersection(
        new Set(existingPinIdKeys),
      );
      const conflictingPinIds: PinId[] = [];

      for (const conflictingIdKey of conflictingPinIdKeys)
        conflictingPinIds.push(keyToId(conflictingIdKey, PIN_ID_SYMBOL));

      const conflictingPinCategoryIdKeys = new Set(
        Object.keys(loadedPinCatalog.pinCategories),
      ).intersection(new Set(existingPinCategoryIdKeys));
      const conflictingPinCategoryIds: PinCategoryId[] = [];

      for (const conflictingIdKey of conflictingPinCategoryIdKeys)
        conflictingPinCategoryIds.push(keyToId(conflictingIdKey, PIN_CATEGORY_ID_SYMBOL));

      modalData.value = {
        kind: 'import',
        import: {
          kind: 'pins',
          pinCatalog: loadedPinCatalog,
          conflicts: {
            pins: conflictingPinIds,
            pinCategories: conflictingPinCategoryIds,
          },
          overwrite: false,
        },
      };

      getSettingsIoModal().showModal();
    },
  });
}

function onClickPinsClear() {
  modalData.value = {
    kind: 'simple',
    title: 'Clear Pin Catalog',
    message:
      'Are you sure you want to delete all pin definitions from the pin catalog? This action cannot be undone.',
    buttonConfirm: 'Delete All Pins',
    actionConfirm: () => {
      if (readOnly.value) return;

      docData.value[changeSubtree]((shared) => {
        // Replaced if invalid, as it is cleared anyway.
        if (isObject(shared.pinCatalog)) PinCatalogClear(shared.pinCatalog);
        else shared.pinCatalog = PinCatalogNew();
      });
    },
  };
  getSettingsIoModal().showModal();
}

function onClickCalendarExport() {
  triggerDownload({
    fileName: 'calendar.json',
    content: new Blob([PinCalendarSerialize(pinCalendar.value)], {
      type: 'application/json',
    }),
  });
}

function onClickCalendarImport() {
  triggerUpload({
    onSuccess(fileContent: string) {
      const result = PinCalendarDeserialize(fileContent);

      if (result.type !== 'current') {
        showImportError('Calendar Import', 'calendar', result);
        return;
      }

      const loadedPinCalendar = result.current;

      console.log(loadedPinCalendar);

      modalData.value = {
        kind: 'import',
        import: {
          kind: 'calendar',
          calendar: loadedPinCalendar,
        },
      };

      getSettingsIoModal().showModal();
    },
  });
}

function onClickCalendarClear() {
  modalData.value = {
    kind: 'simple',
    title: 'Clear Calendar',
    message:
      'Are you sure you want to clear all pins from the calendar? This action cannot be undone.',
    buttonConfirm: 'Clear Calendar',
    actionConfirm: () => {
      if (readOnly.value) return;

      docData.value[changeSubtree]((shared) => {
        // Replaced if invalid, as it is cleared anyway.
        if (isObject(shared.pinCalendar)) PinCalendarClear(shared.pinCalendar);
        else shared.pinCalendar = PinCalendarNew();
      });
    },
  };
  getSettingsIoModal().showModal();
}

function onClickCalendarDelete() {
  modalData.value = {
    kind: 'simple',
    title: 'Delete Calendar From This Device',
    message:
      'Are you sure you want to delete this calendar from this device? This action cannot be undone.',
    buttonConfirm: 'Delete Calendar From This Device',
    actionConfirm: async () => {
      if (LocalStorageDataIsReadOnly(localStorageData.value)) return;

      // Disconnect from the calendar's peers, in whichever tab the connections are.
      app.value!.shutDownWebRtc();

      const authKeyIds = Object.values(
        LocalDocumentGetRemotePeers(app.value!.docLocal.data.value),
      ).map((remotePeer) => remotePeer.authKeyId);

      // TODO: Implement proper deletion of all calendar data. This is just superficial.
      delete localStorageData.value.calendars[app.value!.calendarId];

      // Replace the last calendar in the same change, so that the list is saved once, and never
      // saved empty. Otherwise, every open tab would receive the empty list, and create its own.
      if (Object.keys(localStorageData.value.calendars).length === 0)
        LocalStorageDataAddCalendar(localStorageData.value);

      // The keys authenticate this device's connections with the calendar's peers.
      await Promise.all(authKeyIds.map((authKeyId) => auth.deleteAuthKey(authKeyId)));
    },
  };
  getSettingsIoModal().showModal();
}

function onClickImportPinsConfirm(importPins: ImportPins) {
  if (readOnly.value) return;

  PinCatalogChange(pinCatalog.value, (pinCatalog) => {
    if (importPins.overwrite) {
      // Remove conflicting elements
      for (const pinCategoryId of importPins.conflicts.pinCategories)
        PinCatalogRemovePinCategory(pinCatalog, pinCategoryId);

      for (const pinId of importPins.conflicts.pins) PinCatalogRemovePin(pinCatalog, pinId);

      // Add all elements
      for (const pinCategory of PinCatalogGetPinCategories(importPins.pinCatalog))
        PinCatalogAddPinCategory(pinCatalog, pinCategory);

      for (const pin of PinCatalogGetPins(importPins.pinCatalog)) PinCatalogAddPin(pinCatalog, pin);
    } else {
      // Only add non-conflicting elements.
      for (const pinCategory of PinCatalogGetPinCategories(importPins.pinCatalog))
        if (
          !importPins.conflicts.pinCategories.find((current) =>
            current.isEqualStatic(pinCategory.id),
          )
        )
          PinCatalogAddPinCategory(pinCatalog, pinCategory);

      for (const pin of PinCatalogGetPins(importPins.pinCatalog))
        if (!importPins.conflicts.pins.find((current) => current.isEqualStatic(pin.id)))
          PinCatalogAddPin(pinCatalog, pin);
    }
  });
}

function onClickImportCalendarConfirm(importCalendar: ImportCalendar) {
  if (readOnly.value) return;

  const calendar = pinCalendar.value;

  // An invalid calendar is left as it is, rather than replaced.
  if (!isObject(calendar)) {
    console.error('Cannot import into the calendar, as it is invalid.');
    return;
  }

  calendar[changeSubtree]((pinCalendar) => {
    PinCalendarCombine(pinCalendar, importCalendar.calendar);
  });
}
</script>

<template>
  <dialog id="settings_io_modal" class="modal">
    <div class="modal-box" v-if="modalData !== undefined && modalData.kind === 'simple'">
      <h3 class="text-lg font-bold">{{ modalData.title }}</h3>
      <p class="py-4">{{ modalData.message }}</p>
      <form method="dialog" class="modal-action flex flex-row gap-2">
        <button class="btn btn-neutral flex-1">Cancel</button>
        <button class="btn btn-error flex-1" @click="modalData.actionConfirm">
          {{ modalData.buttonConfirm }}
        </button>
      </form>
    </div>
    <div class="modal-box" v-if="modalData !== undefined && modalData.kind === 'error'">
      <h3 class="text-lg font-bold">{{ modalData.title }}</h3>
      <p class="py-4">{{ modalData.message }}</p>
      <form method="dialog" class="modal-action">
        <button class="btn btn-primary flex-1">Close</button>
      </form>
    </div>
    <div class="modal-box" v-if="modalData !== undefined && modalData.kind == 'import'">
      <template v-if="modalData.import.kind === 'pins'">
        <h3 class="text-lg font-bold pb-4">Pin Catalog Import</h3>
        <div class="flex flex-col gap-4">
          <div>
            <p>
              {{ Object.keys(modalData.import.pinCatalog.pinCategories).length }}
              categories to import.
            </p>
            <p>{{ Object.keys(modalData.import.pinCatalog.pins).length }} pins to import.</p>
          </div>
          <div
            class="flex flex-col gap-4 border-2 border-warning rounded-xl p-4"
            v-if="
              modalData.import.conflicts.pinCategories.length > 0 ||
              modalData.import.conflicts.pins.length > 0
            "
          >
            <div class="flex flex-col gap-2">
              <div v-if="modalData.import.conflicts.pinCategories.length > 0">
                <p class="font-semibold">
                  Found {{ modalData.import.conflicts.pinCategories.length }} conflicting
                  categories:
                </p>
                <ul class="list-disc ps-5">
                  <li
                    v-for="pinCategoryId in modalData.import.conflicts.pinCategories"
                    :key="pinCategoryId.key"
                  >
                    {{ describePinCategoryConflict(modalData.import, pinCategoryId) }}
                  </li>
                </ul>
              </div>
              <div v-if="modalData.import.conflicts.pins.length > 0">
                <p class="font-semibold">
                  Found {{ modalData.import.conflicts.pins.length }} conflicting pins:
                </p>
                <ul class="list-disc ps-5">
                  <li v-for="pinId in modalData.import.conflicts.pins" :key="pinId.key">
                    {{ describePinConflict(modalData.import, pinId) }}
                  </li>
                </ul>
              </div>
            </div>
            <div>
              What do you wish to perform with conflicting elements?
              <label class="label cursor-pointer items-start justify-start gap-2 whitespace-normal">
                <input
                  type="radio"
                  name="radio-1"
                  class="radio radio-sm"
                  v-model="modalData.import.overwrite"
                  :value="false"
                />
                <span class="label-text">Keep existing elements with conflicting ID's</span>
              </label>
              <label class="label cursor-pointer items-start justify-start gap-2 whitespace-normal">
                <input
                  type="radio"
                  name="radio-1"
                  class="radio radio-sm"
                  v-model="modalData.import.overwrite"
                  :value="true"
                />
                <span class="label-text"
                  >Overwrite existing elements with conflicting ID's with imported elements</span
                >
              </label>
            </div>
          </div>
        </div>
        <form method="dialog" class="modal-action flex flex-row gap-2">
          <button class="btn btn-neutral flex-1">Cancel</button>
          <template
            v-if="
              modalData.import.conflicts.pinCategories.length > 0 ||
              modalData.import.conflicts.pins.length > 0
            "
          >
            <button
              v-if="!modalData.import.overwrite"
              class="btn btn-primary flex-1"
              @click="onClickImportPinsConfirm(modalData.import)"
            >
              Import, Keeping Existing Elements
            </button>
            <button
              v-else
              class="btn btn-error flex-1"
              @click="onClickImportPinsConfirm(modalData.import)"
            >
              Import, Overwriting Existing Elements
            </button>
          </template>
          <button
            v-else
            class="btn btn-primary flex-1"
            @click="onClickImportPinsConfirm(modalData.import)"
          >
            Import
          </button>
        </form>
      </template>
      <template v-if="modalData.import.kind === 'calendar'">
        <h3 class="text-lg font-bold pb-4">Calendar Import</h3>
        <div class="flex flex-col gap-4">
          <div>
            <p>{{ Object.keys(modalData.import.calendar.days).length }} days to import.</p>
          </div>
        </div>
        <form method="dialog" class="modal-action flex flex-row gap-2">
          <button class="btn btn-neutral flex-1">Cancel</button>
          <button
            class="btn btn-primary flex-1"
            @click="onClickImportCalendarConfirm(modalData.import)"
          >
            Import
          </button>
        </form>
      </template>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
  <div class="flex max-md:flex-col flex-row gap-4">
    <div class="flex flex-col gap-2 flex-1">
      <div class="text-md">Pin Catalog</div>
      <div class="flex flex-row gap-2">
        <button @click="onClickPinsExport" class="btn max-sm:btn-square btn-neutral flex-1">
          <div v-html="feather.icons['upload'].toSvg()" />
          <div>Export</div>
        </button>
        <button
          @click="onClickPinsImport"
          class="btn max-sm:btn-square btn-neutral flex-1"
          :disabled="readOnly"
        >
          <div v-html="feather.icons['download'].toSvg()" />
          <div>Import</div>
        </button>
        <button
          @click="onClickPinsClear"
          class="btn max-sm:btn-square btn-error flex-1"
          :disabled="readOnly"
        >
          <div v-html="feather.icons['trash-2'].toSvg()" />
          <div>Clear</div>
        </button>
      </div>
    </div>
    <div class="flex flex-col gap-2 flex-1">
      <div class="text-md">Calendar</div>
      <div class="flex flex-row gap-2">
        <button @click="onClickCalendarExport" class="btn max-sm:btn-square btn-neutral flex-1">
          <div v-html="feather.icons['upload'].toSvg()" />
          <div>Export</div>
        </button>
        <button
          @click="onClickCalendarImport"
          class="btn max-sm:btn-square btn-neutral flex-1"
          :disabled="readOnly"
        >
          <div v-html="feather.icons['download'].toSvg()" />
          <div>Import</div>
        </button>
        <button
          @click="onClickCalendarClear"
          class="btn max-sm:btn-square btn-error flex-1"
          :disabled="readOnly"
        >
          <div v-html="feather.icons['trash-2'].toSvg()" />
          <div>Clear</div>
        </button>
      </div>
      <div class="flex flex-row gap-2">
        <button
          @click="onClickCalendarDelete"
          class="btn btn-error flex-1"
          :disabled="LocalStorageDataIsReadOnly(localStorageData)"
        >
          <div v-html="feather.icons['trash-2'].toSvg()" />
          <div>Delete calendar from this device only</div>
        </button>
      </div>
    </div>
  </div>
</template>

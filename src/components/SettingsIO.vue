<script setup lang="ts">
import type { App } from '../account';
import * as feather from 'feather-icons';
import { ref, toRef } from 'vue';
import type { Ref } from 'vue';
import { type PinCalendar, type PinCatalog, PinCalendarClear, PinCalendarCombine, PinCalendarDeserialize, PinCalendarSerialize, PinCatalogSerialize, PinCatalogDeserialize, PinCatalogClear, PinCatalogRemovePinCategory, type IdKey, type PinCategoryId, type PinId, keyToId, PIN_ID_SYMBOL, PIN_CATEGORY_ID_SYMBOL, type PinCategory, PinCatalogRemovePin, PinCatalogAddPinCategory, PinCatalogGetPinCategories, type PinTypeOf, PinCatalogGetPins, PinCatalogCreateAndAddPinToCategory, PinCatalogAddPin } from '../pins';
import { changeSubtree, type Ro, type Rop } from 'automerge-diy-vue-hooks';
// import { Temporal } from '@js-temporal/polyfill';
// import * as emojiSearch from 'node-emoji';
// import * as emojiGroups from 'unicode-emoji-json/data-by-group.json';
// import * as emojiComponents from 'unicode-emoji-json/data-emoji-components.json';
// import emojiRegex from 'emoji-regex';
// import PinIcon from './PinIcon.vue';

type ModalSimple = {
  kind: 'simple',
  title: string,
  message: string,
  buttonConfirm: string,
  actionConfirm(): void,
}

type ModalImport = {
  kind: 'import',
  import: Import,
}

type ModalData = ModalSimple | ModalImport;

type Download = {
  fileName: string,
  content: Blob,
};

type Upload = {
  onSuccess: (fileContent: string) => void,
}

type ImportPins = {
  kind: 'pins',
  pinCatalog: PinCatalog,
  conflicts: {
    pinCategories: PinCategoryId[],
    pins: PinId[],
  },
  overwrite: boolean,
};

type ImportCalendar = {
  kind: 'calendar',
  calendar: PinCalendar,
};

type Import = ImportPins | ImportCalendar;

const app = defineModel<App>();
const docData = toRef(app.value!, 'docData');

function getPinCalendar() {
  return toRef(docData.value!, 'pinCalendar');
}

function getPinCatalog() {
  return toRef(docData.value!, 'pinCatalog');
}

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
      console.warn("Upload: No files specified. Aborting upload.");
      return;
    }

    if (element.files.length > 1) {
      console.warn("Upload: More than 1 file specified. Aborting upload.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result;

      if (typeof (contents) !== 'string') {
        console.warn("Upload: Not a text file. Aborting upload.");
        return;
      }

      upload.onSuccess(contents);
    };
    reader.readAsText(element.files[0]);
  };
  element.click();
}

function onClickPinsExport() {
  triggerDownload({
    fileName: 'pin-catalog.json',
    content: new Blob([PinCatalogSerialize(getPinCatalog().value)], { type: 'application/json' }),
  });
}

function onClickPinsImport() {
  triggerUpload({
    onSuccess(fileContent: string) {
      const loadedPinCatalog = PinCatalogDeserialize(fileContent);

      console.log(loadedPinCatalog);

      if (loadedPinCatalog === null)
        return;

      const conflictingPinIdKeys = new Set(Object.keys(loadedPinCatalog.pins))
        .intersection(new Set(Object.keys(getPinCatalog().value.pins)));
      const conflictingPinIds: PinId[] = [];

      for (const conflictingIdKey of conflictingPinIdKeys)
        conflictingPinIds.push(keyToId(conflictingIdKey, PIN_ID_SYMBOL));

      const conflictingPinCategoryIdKeys = new Set(Object.keys(loadedPinCatalog.pinCategories))
        .intersection(new Set(Object.keys(getPinCatalog().value.pinCategories)));
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
    message: 'Are you sure you want to delete all pin definitions from the pin catalog? This action cannot be undone.',
    buttonConfirm: 'Delete All Pins',
    actionConfirm: () => {
      getPinCatalog().value[changeSubtree]((pinCatalog) => {
        PinCatalogClear(pinCatalog);
      })
    },
  };
  getSettingsIoModal().showModal();
}

function onClickCalendarExport() {
  triggerDownload({
    fileName: 'calendar.json',
    content: new Blob([PinCalendarSerialize(getPinCalendar().value)], { type: 'application/json' }),
  });
}

function onClickCalendarImport() {
  triggerUpload({
    onSuccess(fileContent: string) {
      const loadedPinCalendar = PinCalendarDeserialize(fileContent);

      console.log(loadedPinCalendar);

      if (loadedPinCalendar === null)
        return;

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
    message: 'Are you sure you want to clear all pins from the calendar? This action cannot be undone.',
    buttonConfirm: 'Clear Calendar',
    actionConfirm: () => {
      getPinCalendar().value![changeSubtree]((pinCalendar) => {
        PinCalendarClear(pinCalendar);
      })
    },
  };
  getSettingsIoModal().showModal();
}

function onClickImportPinsConfirm(importPins: ImportPins) {
  getPinCatalog().value![changeSubtree]((pinCatalog) => {
    if (importPins.overwrite) {
      // Remove conflicting elements
      for (const pinCategoryId of importPins.conflicts.pinCategories)
        PinCatalogRemovePinCategory(pinCatalog, pinCategoryId);

      for (const pinId of importPins.conflicts.pins)
        PinCatalogRemovePin(pinCatalog, pinId);

      // Add all elements
      for (const pinCategory of PinCatalogGetPinCategories(importPins.pinCatalog))
        PinCatalogAddPinCategory(pinCatalog, pinCategory);

      for (const pin of PinCatalogGetPins(importPins.pinCatalog))
        PinCatalogAddPin(pinCatalog, pin);
    } else {
      // Only add non-conflicting elements.
      for (const pinCategory of PinCatalogGetPinCategories(importPins.pinCatalog))
        if (!importPins.conflicts.pinCategories.find((current) => current.isEqualStatic(pinCategory.id)))
          PinCatalogAddPinCategory(pinCatalog, pinCategory);

      for (const pin of PinCatalogGetPins(importPins.pinCatalog))
        if (!importPins.conflicts.pins.find((current) => current.isEqualStatic(pin.id)))
          PinCatalogAddPin(pinCatalog, pin);
    }
  });
}

function onClickImportCalendarConfirm(importCalendar: ImportCalendar) {
  getPinCalendar().value![changeSubtree]((pinCalendar) => {
    PinCalendarCombine(pinCalendar, importCalendar.calendar);
  })
}
</script>

<template>
  <dialog id="settings_io_modal" class="modal">
    <div class="modal-box" v-if="modalData !== undefined && modalData.kind === 'simple'">
      <h3 class="text-lg font-bold">{{ modalData.title }}</h3>
      <p class="py-4">{{ modalData.message }}</p>
      <form method="dialog" class="modal-action flex flex-row gap-2">
        <button class="btn btn-neutral flex-1">Cancel</button>
        <button class="btn btn-error flex-1" @click="modalData.actionConfirm">{{ modalData.buttonConfirm }}</button>
      </form>
    </div>
    <div class="modal-box" v-if="modalData !== undefined && modalData.kind == 'import'">
      <template v-if="modalData.import.kind === 'pins'">
        <h3 class="text-lg font-bold pb-4">Pin Catalog Import</h3>
        <div class="flex flex-col gap-4">
          <div>
            <p>{{ Object.keys(modalData.import.pinCatalog.pinCategories).length }} categories to import.</p>
            <p>{{ Object.keys(modalData.import.pinCatalog.pins).length }} pins to import.</p>
          </div>
          <div class="flex flex-col gap-4 border-2 border-warning rounded-xl p-4"
            v-if="modalData.import.conflicts.pinCategories.length > 0 || modalData.import.conflicts.pins.length > 0">
            <div>
              <p v-if="modalData.import.conflicts.pinCategories.length > 0"><span class="font-semibold">Found {{
                modalData.import.conflicts.pinCategories.length }} conflicting categories</span>: {{
                    Array.from(modalData.import.conflicts.pinCategories).join(", ") }}.</p>
              <p v-if="modalData.import.conflicts.pins.length > 0"><span class="font-semibold">Found {{
                modalData.import.conflicts.pins.length }} conflicting pins</span>: {{
                    Array.from(modalData.import.conflicts.pins).join(", ") }}.</p>
            </div>
            <div>
              What do you wish to perform with conflicting elements?
              <label class="label cursor-pointer items-start justify-start gap-2">
                <input type="radio" name="radio-1" class="radio radio-sm" v-model="modalData.import.overwrite"
                  :value="false" />
                <span class="label-text">Keep existing elements with conflicting ID's</span>
              </label>
              <label class="label cursor-pointer items-start justify-start gap-2">
                <input type="radio" name="radio-1" class="radio radio-sm" v-model="modalData.import.overwrite"
                  :value="true" />
                <span class="label-text">Overwrite existing elements with conflicting ID's with imported elements</span>
              </label>
            </div>
          </div>
        </div>
        <form method="dialog" class="modal-action flex flex-row gap-2">
          <button class="btn btn-neutral flex-1">Cancel</button>
          <template
            v-if="modalData.import.conflicts.pinCategories.length > 0 || modalData.import.conflicts.pins.length > 0">
            <button v-if="!modalData.import.overwrite" class="btn btn-primary flex-1"
              @click="onClickImportPinsConfirm(modalData.import)">Import, Keeping Existing
              Elements</button>
            <button v-else class="btn btn-error flex-1 " @click="onClickImportPinsConfirm(modalData.import)">Import,
              Overwriting Existing
              Elements</button>
          </template>
          <button v-else class="btn btn-primary flex-1"
            @click="onClickImportPinsConfirm(modalData.import)">Import</button>
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
          <button class="btn btn-primary flex-1" @click="onClickImportCalendarConfirm(modalData.import)">Import</button>
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
        <button @click="onClickPinsImport" class="btn max-sm:btn-square btn-neutral flex-1">
          <div v-html="feather.icons['download'].toSvg()" />
          <div>Import</div>
        </button>
        <button @click="onClickPinsClear" class="btn max-sm:btn-square btn-error flex-1">
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
        <button @click="onClickCalendarImport" class="btn max-sm:btn-square btn-neutral flex-1">
          <div v-html="feather.icons['download'].toSvg()" />
          <div>Import</div>
        </button>
        <button @click="onClickCalendarClear" class="btn max-sm:btn-square btn-error flex-1">
          <div v-html="feather.icons['trash-2'].toSvg()" />
          <div>Clear</div>
        </button>
      </div>
    </div>
  </div>
</template>

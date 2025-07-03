<script setup lang="ts">
import type { App } from '../account';
import * as feather from 'feather-icons';
import { ref, watch, toRef } from 'vue';
import type { Ref } from 'vue';
import {
  PinCatalogCreateAndAddPinToCategory,
  PinCatalogCreateAndAddSubcategoryToCategory,
  PinCatalogGetRootCategories,
  type Pin,
  type PinCatalog,
  type PinCategoryDescriptor,
  type PinCategoryTypeOf,
  type PinDescriptor,
  type PinTypeOf,
} from '../pins';
import emojiRegex from 'emoji-regex';
import SettingsPinCategory, { type SettingsPinCategoryEvent } from './SettingsPinCategory.vue';
import * as R from 'ramda';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';

type EditingPin = {
  kind: 'pin';
  element: PinTypeOf<Rop<PinCatalog>>;
  // parent: PinCategoryTypeOf<Rop<PinCatalog>>,
  error?: {
    displayNameError?: string;
    iconEmojiError?: string;
  };
};

type EditingPinCategory = {
  kind: 'category';
  element: PinCategoryTypeOf<Rop<PinCatalog>>;
  // parent?: PinCategoryTypeOf<Rop<PinCatalog>>,
  error?: {
    displayNameError?: string;
  };
};

type Editing = EditingPin | EditingPinCategory;

const emojiRegexPattern = emojiRegex();

const app = defineModel<App>();

function getPinCatalog(): Ref<Rop<PinCatalog>> {
  return toRef(app.value!.docData.value, 'pinCatalog');
}

const editing: Ref<Editing | undefined> = ref(undefined);
const isDrawerOpen = ref(false);
const isArchiveOpen = ref(false);

function onClickEditPinCategory(pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>) {
  if (editing.value?.element.id.isEqualDynamic(pinCategory.id)) {
    editing.value = undefined;
  } else {
    // const parentId = getPinCatalog().value.pinCategories[pinCategory.id].parentId;
    // const parent = parentId !== undefined ? getPinCatalog().value.pinCategories[parentId].pinCategory : undefined;
    editing.value = {
      kind: 'category',
      element: pinCategory,
    };
  }
}

function onClickEditPin(pin: PinTypeOf<Rop<PinCatalog>>) {
  if (editing.value?.element.id.isEqualDynamic(pin.id)) {
    editing.value = undefined;
  } else {
    editing.value = {
      kind: 'pin',
      // parent: getPinCatalog().value.pinCategories[getPinCatalog().value.pins[pin.id].categoryId].pinCategory,
      element: pin,
    };
  }
}

function onClickAddPinCategory(parent: PinCategoryTypeOf<Rop<PinCatalog>> | undefined) {
  getPinCatalog().value[changeSubtree]((pinCatalog) => {
    const pinCategory = PinCatalogCreateAndAddSubcategoryToCategory(
      pinCatalog,
      parent?.id ?? null,
      {
        displayName: '',
        description: '',
        subcategories: [],
        pins: [],
      },
    );
  });

  // TODO: Open the editing pane
}

function onClickAddPin(parent: PinCategoryTypeOf<Rop<PinCatalog>>) {
  getPinCatalog().value[changeSubtree]((pinCatalog) => {
    const pin = PinCatalogCreateAndAddPinToCategory(pinCatalog, parent.id, {
      displayName: '',
      description: '',
      icon: {
        emoji: '',
        scale: 1,
      },
      backgroundColor: 'black',
    });
  });

  // TODO: Open the editing pane
}

function onClickArchive(item: Rop<PinDescriptor | PinCategoryDescriptor>, archive: boolean) {
  item[changeSubtree]((item: PinDescriptor | PinCategoryDescriptor) => {
    item.archived = archive;
  });
}

function onClickEditCancel() {
  editing.value = undefined;
}

function onClickEditConfirmCategory() {
  if (editing.value === undefined || editing.value.kind !== 'category') {
    return;
  }

  // Perform input validation.
  {
    editing.value.error = {};

    if (editing.value.element.value.displayName.length === 0) {
      editing.value.error.displayNameError = 'The display name must not be empty.';
    }

    if (Object.keys(editing.value.error).length === 0) {
      delete editing.value.error;
    } else {
      return;
    }
  }

  // if (editing.value.parent !== undefined) {
  //   if (editing.value.originalId !== undefined) {
  //     const index = editing.value.parent.subcategories.findIndex((subcategory) => subcategory.id === editing.value?.originalId);

  //     if (index != -1) {
  //       editing.value.parent.subcategories[index] = editing.value.pinCategoryClone;
  //     } else {
  //       console.error("Pin category not found in parent.");
  //     }
  //   } else {
  //     editing.value.parent.subcategories.push(editing.value.pinCategoryClone);
  //   }
  // } else {
  //   if (editing.value.originalId !== undefined) {
  //     const index = pinCatalog.rootCategories.findIndex((pinCategory) => pinCategory.id === editing.value?.originalId);

  //     if (index != -1) {
  //       pinCatalog.rootCategories[index] = editing.value.pinCategoryClone;
  //     } else {
  //       console.error("Pin category not found in root.");
  //     }
  //   } else {
  //     pinCatalog.rootCategories.push(editing.value.pinCategoryClone);
  //   }
  // }

  // pinCatalog.pinCategories[editing.value.pinCategoryClone.id] = {
  //   parentId: editing.value.parent?.id,
  //   pinCategory: editing.value.pinCategoryClone,
  // };

  // pinCatalog.saveToLocalStorage();
  editing.value = undefined;
}

function onClickEditConfirmPin() {
  if (editing.value === undefined || editing.value.kind !== 'pin') {
    return;
  }

  // Perform input validation.
  {
    editing.value.error = {};

    if (editing.value.element.value.displayName.length === 0) {
      editing.value.error.displayNameError = 'The display name must not be empty.';
    }

    {
      const emojis = [...editing.value.element.value.icon.emoji.matchAll(emojiRegexPattern)];

      if (emojis.length > 1) {
        editing.value.error.iconEmojiError = 'Only a single emoji is allowed.';
      }

      const stringWithoutEmojis = editing.value.element.value.icon.emoji.replaceAll(
        emojiRegexPattern,
        '',
      );

      if (stringWithoutEmojis.length > 0) {
        editing.value.error.iconEmojiError = 'The icon must not contain non-emoji symbols.';
      }
    }

    if (Object.keys(editing.value.error).length === 0) {
      delete editing.value.error;
    } else {
      return;
    }
  }

  // if (editing.value.originalId !== undefined) {
  //   const index = editing.value.parent.pins.findIndex((pin) => pin.id === editing.value?.originalId);

  //   if (index != -1) {
  //     editing.value.parent.pins[index] = editing.value.element.value;
  //   } else {
  //     console.error("Pin not found in parent.");
  //   }
  // } else {
  //   editing.value.parent.pins.push(editing.value.pinClone);
  // }

  // pinCatalog.pins[editing.value.pinClone.id] = {
  //   categoryId: editing.value.parent.id,
  //   pin: editing.value.pinClone,
  // };

  // pinCatalog.saveToLocalStorage();
  editing.value = undefined;
}

function onClickDeletePinCategory(pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>) {
  getPinCatalog().value[changeSubtree]((pinCatalog) => {
    console.log('TODO');
    // PinCatalogRemovePinCategory(pinCatalog, pinCategory.id);
  });
}

function onClickDeletePin(pin: Pin) {
  getPinCatalog().value[changeSubtree]((pinCatalog) => {
    console.log('TODO');
    // PinCatalogRemovePin(pinCatalog, pin.id);
  });
}

watch(editing, () => {
  isDrawerOpen.value = editing.value !== undefined;
});

function onSettingsPinCategoryEvent(event: SettingsPinCategoryEvent) {
  switch (event.kind) {
    case 'pinAdd': {
      onClickAddPin(event.parent);
      break;
    }
    case 'pinEdit': {
      onClickEditPin(event.pin);
      break;
    }
    case 'pinArchive': {
      onClickArchive(event.pin.value, event.archive);
      break;
    }
    case 'pinDelete': {
      onClickDeletePin(event.pin);
      break;
    }
    case 'categoryAdd': {
      onClickAddPinCategory(event.parent);
      break;
    }
    case 'categoryEdit': {
      onClickEditPinCategory(event.pinCategory);
      break;
    }
    case 'categoryArchive': {
      onClickArchive(event.pinCategory.value, event.archive);
      break;
    }
    case 'categoryDelete': {
      onClickDeletePinCategory(event.pinCategory);
      break;
    }
  }
}
</script>

<template>
  <div class="drawer drawer-end">
    <input id="settings-pins-drawer" type="checkbox" class="drawer-toggle" v-model="isDrawerOpen" />
    <div class="drawer-content">
      <div class="flex justify-center">
        <ul
          class="flex flex-col gap-2 items-center lg:w-[64rem] lg:my-8 max-lg:w-full lg:shadow-xl px-4 py-2"
        >
          <li
            v-for="rootCategory of R.filter(
              (rootCategory) => !rootCategory.value.archived,
              PinCatalogGetRootCategories(getPinCatalog().value),
            )"
            :key="rootCategory.id.key"
            class="flex flex-row items-center w-full gap-1"
          >
            <SettingsPinCategory
              @event="onSettingsPinCategoryEvent"
              :depth="0"
              :pin-catalog="getPinCatalog().value"
              :pin-category="rootCategory"
            />
          </li>
          <li
            v-if="
              R.any(
                (pinCategory) => !!pinCategory.value.archived,
                PinCatalogGetRootCategories(getPinCatalog().value),
              )
            "
            class="collapse collapse-arrow"
          >
            <input type="checkbox" v-model="isArchiveOpen" />
            <div class="collapse-title flex flex-row items-center pl-0">
              <div class="divider flex-1 my-0 mr-4 h-auto" />
              <div>{{ isArchiveOpen ? 'Hide' : 'Show' }} Archived</div>
            </div>
            <ul class="collapse-content px-0 flex flex-col gap-1">
              <li
                v-for="rootCategory of R.filter(
                  (rootCategory) => !!rootCategory.value.archived,
                  PinCatalogGetRootCategories(getPinCatalog().value),
                )"
                :key="rootCategory.id.key"
                class="flex flex-row items-center w-full gap-1"
              >
                <SettingsPinCategory
                  @event="onSettingsPinCategoryEvent"
                  :depth="0"
                  :pin-catalog="getPinCatalog().value"
                  :pin-category="rootCategory"
                />
              </li>
            </ul>
          </li>
          <li>
            <button
              @click="onSettingsPinCategoryEvent({ kind: 'categoryAdd' })"
              class="btn btn-primary max-sm:btn-square"
            >
              <div v-html="feather.icons['plus-square'].toSvg()" />
              <div class="max-sm:hidden">Add Category</div>
            </button>
          </li>
        </ul>
      </div>
    </div>
    <div class="drawer-side w-full z-10">
      <label for="settings-pins-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
      <div
        class="bg-base-200 text-base-content min-h-full w-80 p-4 flex flex-col gap-1 shadow-[0_0_4rem_0px_rgba(0,0,0,0.3)]"
      >
        <template v-if="editing !== undefined">
          <template v-if="editing.kind === 'category'">
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Unique ID</span>
              </div>
              <input
                v-model="editing.element.id.key"
                type="text"
                placeholder="example-category-id"
                class="input input-bordered w-full max-w-xs"
                disabled
              />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Display Name</span>
              </div>
              <input
                v-model="editing.element.value.displayName"
                type="text"
                placeholder="Example Pin"
                class="input input-bordered w-full max-w-xs"
                :class="editing.error?.displayNameError !== undefined ? 'input-error' : ''"
              />
              <div v-if="editing.error?.displayNameError !== undefined" class="label">
                <span class="label-text-alt text-error">{{ editing.error?.displayNameError }}</span>
              </div>
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Description</span>
              </div>
              <textarea
                v-model="editing.element.value.description"
                placeholder="This is an example description of this example pin."
                class="textarea textarea-bordered w-full max-w-xs min-h-32"
                style="line-height: 1"
              />
            </label>
            <div class="flex gap-3 pt-4">
              <button @click="onClickEditCancel" class="btn btn-secondary flex-1">Cancel</button>
              <button @click="onClickEditConfirmCategory" class="btn btn-primary flex-1">
                Apply
              </button>
            </div>
          </template>
          <template v-if="editing.kind === 'pin'">
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Unique ID</span>
              </div>
              <input
                v-model="editing.element.id.key"
                type="text"
                placeholder="example-pin-id"
                class="input input-bordered w-full max-w-xs"
                disabled
              />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Display Name</span>
              </div>
              <input
                v-model="editing.element.value.displayName"
                type="text"
                placeholder="Example Pin"
                class="input input-bordered w-full max-w-xs"
                :class="editing.error?.displayNameError !== undefined ? 'input-error' : ''"
              />
              <div v-if="editing.error?.displayNameError !== undefined" class="label">
                <span class="label-text-alt text-error">{{ editing.error?.displayNameError }}</span>
              </div>
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Description</span>
              </div>
              <textarea
                v-model="editing.element.value.description"
                placeholder="This is an example description of this example pin."
                class="textarea textarea-bordered w-full max-w-xs min-h-32"
                style="line-height: 1"
              />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Pin Emoji</span>
              </div>
              <input
                v-model="editing.element.value.icon.emoji"
                type="text"
                placeholder="Example Pin"
                class="input input-bordered w-full max-w-xs"
                :class="editing.error?.iconEmojiError !== undefined ? 'input-error' : ''"
              />
              <div v-if="editing.error?.iconEmojiError !== undefined" class="label">
                <span class="label-text-alt text-error">{{ editing.error?.iconEmojiError }}</span>
              </div>
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Pin Emoji Scale</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.5"
                class="range"
                step="0.1"
                v-model="editing.element.value.icon.scale"
              />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Pin Background Color</span>
              </div>
              <input
                v-model="editing.element.value.backgroundColor"
                type="color"
                placeholder="CSS color"
                class="input input-bordered w-full max-w-xs"
              />
            </label>
            <div class="flex gap-3 pt-4">
              <button @click="onClickEditCancel" class="btn btn-secondary flex-1">Cancel</button>
              <button @click="onClickEditConfirmPin" class="btn btn-primary flex-1">Apply</button>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

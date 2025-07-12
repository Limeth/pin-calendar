<script setup lang="ts">
import type { App } from '../account';
import * as feather from 'feather-icons';
import { ref, watch, toRef, computed, toRaw } from 'vue';
import type { Ref } from 'vue';
import {
  PinCatalogCreateAndAddPinToCategory,
  PinCatalogCreateAndAddSubcategoryToCategory,
  PinCatalogGetPinById,
  PinCatalogGetPinCategoryById,
  PinCatalogGetRootCategories,
  PinCatalogRemovePin,
  PinCatalogRemovePinCategory,
  type Pin,
  type PinCatalog,
  type PinCategoryDescriptor,
  type PinCategoryId,
  type PinCategoryTypeOf,
  type PinDescriptor,
  type PinId,
  type PinTypeOf,
} from '../pins';
import emojiRegex from 'emoji-regex';
import SettingsPinCategory, { type SettingsPinCategoryEvent } from './SettingsPinCategory.vue';
import * as R from 'ramda';
import { changeSubtree, type Ro, type Rop } from 'automerge-diy-vue-hooks';
import ValidatedInput from './ValidatedInput.vue';

type EditingPin = {
  kind: 'pin';
  elementId: PinId;
  original: Ro<PinDescriptor>;
  error?: {
    displayNameError?: string;
    iconEmojiError?: string;
  };
};

type EditingPinCategory = {
  kind: 'category';
  elementId: PinCategoryId;
  original: Ro<PinCategoryDescriptor>;
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

const editingPinCategory = computed(() => {
  if (editing.value !== undefined && editing.value.kind == 'category')
    return PinCatalogGetPinCategoryById(getPinCatalog().value, editing.value.elementId);

  return null;
});

const editingPin = computed(() => {
  if (editing.value !== undefined && editing.value.kind == 'pin')
    return PinCatalogGetPinById(getPinCatalog().value, editing.value.elementId);

  return null;
});

const editing: Ref<Editing | undefined> = ref(undefined);
const isDrawerOpen = ref(false);
const isArchiveOpen = ref(false);

function onClickEditPinCategory(pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>) {
  if (editing.value?.elementId.isEqualDynamic(pinCategory.id)) {
    editing.value = undefined;
  } else {
    // const parentId = getPinCatalog().value.pinCategories[pinCategory.id].parentId;
    // const parent = parentId !== undefined ? getPinCatalog().value.pinCategories[parentId].pinCategory : undefined;
    editing.value = {
      kind: 'category',
      elementId: pinCategory.id,
      original: structuredClone(toRaw(pinCategory.value)),
    };
  }
}

function onClickEditPin(pin: PinTypeOf<Rop<PinCatalog>>) {
  if (editing.value?.elementId.isEqualDynamic(pin.id)) {
    editing.value = undefined;
  } else {
    editing.value = {
      kind: 'pin',
      // parent: getPinCatalog().value.pinCategories[getPinCatalog().value.pins[pin.id].categoryId].pinCategory,
      elementId: pin.id,
      original: structuredClone(toRaw(pin.value)),
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
        type: 'emoji',
        emoji: {
          emoji: '',
          scale: 1,
        },
        image: {
          base64: '',
          scale: 1,
        },
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
  if (
    editing.value === undefined ||
    editing.value.kind !== 'category' ||
    editingPinCategory.value === null
  ) {
    return;
  }

  // Perform input validation.
  {
    editing.value.error = {};

    if (editingPinCategory.value.value.displayName.length === 0) {
      editing.value.error.displayNameError = 'The display name is empty.';
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
  if (editing.value === undefined || editing.value.kind !== 'pin' || editingPin.value === null) {
    return;
  }

  // Perform input validation.
  {
    editing.value.error = {};

    if (editingPin.value.value.displayName.length === 0) {
      editing.value.error.displayNameError = 'The display name is empty.';
    }

    {
      const emojis = [...editingPin.value.value.icon.emoji.emoji.matchAll(emojiRegexPattern)];

      if (emojis.length > 1) {
        editing.value.error.iconEmojiError = 'Only a single emoji is allowed.';
      }

      const stringWithoutEmojis = editingPin.value.value.icon.emoji.emoji.replaceAll(
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
    PinCatalogRemovePinCategory(pinCatalog, pinCategory.id);
  });
}

function onClickDeletePin(pin: Pin) {
  getPinCatalog().value[changeSubtree]((pinCatalog) => {
    PinCatalogRemovePin(pinCatalog, pin.id);
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
          <template v-if="editing.kind === 'category' && editingPinCategory !== null">
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Unique ID</span>
              </div>
              <input
                :value="editingPinCategory.id.key"
                type="text"
                class="input input-bordered w-full max-w-xs"
                disabled
              />
            </label>
            <label class="form-control w-full max-w-xs">
              <ValidatedInput
                v-slot="slot"
                :subtree="editingPinCategory.value"
                :original="editing.original"
                property="displayName"
                label="Display Name"
                :validate="
                  (value) => {
                    if (value.length === 0) return 'The display name is empty.';
                  }
                "
                change="updateText"
              >
                <input
                  type="text"
                  placeholder="Example Category"
                  class="input input-bordered w-full max-w-xs"
                  :value="slot.value"
                  @input="slot.onChange"
                  :class="slot.class"
                />
              </ValidatedInput>
            </label>
            <label class="form-control w-full max-w-xs">
              <ValidatedInput
                v-slot="slot"
                :subtree="editingPinCategory.value"
                :original="editing.original"
                property="description"
                label="Description"
                :validate="
                  (value) => {
                    if (value.length === 0) return 'The description is empty.';
                  }
                "
                change="updateText"
              >
                <input
                  type="text"
                  placeholder="Example Description"
                  class="input input-bordered w-full max-w-xs"
                  :value="slot.value"
                  @input="slot.onChange"
                  :class="slot.class"
                />
              </ValidatedInput>
            </label>
            <div class="flex gap-3 pt-4">
              <button @click="onClickEditCancel" class="btn btn-secondary flex-1">Cancel</button>
              <button @click="onClickEditConfirmCategory" class="btn btn-primary flex-1">
                Apply
              </button>
            </div>
          </template>
          <template v-if="editing.kind === 'pin' && editingPin !== null">
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Unique ID</span>
              </div>
              <input
                :value="editingPin.id.key"
                type="text"
                class="input input-bordered w-full max-w-xs"
                disabled
              />
            </label>
            <label class="form-control w-full max-w-xs">
              <ValidatedInput
                v-slot="slot"
                :subtree="editingPin.value"
                :original="editing.original"
                property="displayName"
                label="Display Name"
                :validate="
                  (value) => {
                    if (value.length === 0) return 'The display name is empty.';
                  }
                "
                change="updateText"
              >
                <input
                  type="text"
                  placeholder="Example Category"
                  class="input input-bordered w-full max-w-xs"
                  :value="slot.value"
                  @input="slot.onChange"
                  :class="slot.class"
                />
              </ValidatedInput>
            </label>
            <label class="form-control w-full max-w-xs">
              <ValidatedInput
                v-slot="slot"
                :subtree="editingPin.value"
                :original="editing.original"
                property="description"
                label="Description"
                :validate="
                  (value) => {
                    if (value.length === 0) return 'The description is empty.';
                  }
                "
                change="updateText"
              >
                <input
                  type="text"
                  placeholder="Example Description"
                  class="input input-bordered w-full max-w-xs"
                  :value="slot.value"
                  @input="slot.onChange"
                  :class="slot.class"
                />
              </ValidatedInput>
            </label>
            <label class="form-control w-full max-w-xs">
              <ValidatedInput
                v-slot="slot"
                :subtree="editingPin.value.icon.emoji"
                :original="editing.original.icon.emoji"
                property="emoji"
                label="Emoji"
                :validate="
                  (value) => {
                    const emojis = [...value.matchAll(emojiRegexPattern)];
                    if (emojis.length > 1) return 'More than one emojis present.';
                    const stringWithoutEmojis = value.replaceAll(emojiRegexPattern, '');
                    if (stringWithoutEmojis.length > 0) return 'Non-emoji characters present.';
                  }
                "
                change="assign"
              >
                <input
                  type="text"
                  placeholder="⭐"
                  class="input input-bordered w-full max-w-xs"
                  :value="slot.value"
                  @input="slot.onChange"
                  :class="slot.class"
                />
              </ValidatedInput>
            </label>
            <label class="form-control w-full max-w-xs">
              <ValidatedInput
                v-slot="slot"
                :subtree="editingPin.value.icon.emoji"
                :original="editing.original.icon.emoji"
                property="scale"
                label="Emoji Scale"
                :parse="(string) => parseFloat(string)"
                :validate="
                  (value) => {
                    if (value <= 0) return 'Non-positive scale entered.';
                  }
                "
                change="assign"
              >
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  class="range"
                  step="0.1"
                  :value="slot.value"
                  @input="slot.onChange"
                  :class="slot.class"
                />
              </ValidatedInput>
            </label>
            <label class="form-control w-full max-w-xs">
              <ValidatedInput
                v-slot="slot"
                :subtree="editingPin.value"
                :original="editing.original"
                property="backgroundColor"
                label="Background Color"
                change="assign"
              >
                <input
                  type="color"
                  placeholder="CSS color"
                  class="input input-bordered w-full max-w-xs"
                  :value="slot.value"
                  @input="slot.onChange"
                  :class="slot.class"
                />
              </ValidatedInput>
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

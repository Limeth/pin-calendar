<script setup lang="ts">
import type { App } from '../app';
import * as feather from 'feather-icons';
import { ref, watch, computed, toRaw, reactive } from 'vue';
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
} from '../pins/pinCatalog';
import emojiRegex from 'emoji-regex';
import SettingsPinCategory, { type SettingsPinCategoryEvent } from './SettingsPinCategory.vue';
import * as R from 'ramda';
import { changeSubtree, type Ro, type Rop } from 'automerge-diy-vue-hooks';
import ValidatedInput from './ValidatedInput.vue';

type EditingPin = {
  kind: 'pin';
  elementId: PinId;
  original?: Ro<PinDescriptor>;
  error?: {
    displayNameError?: string;
    iconEmojiError?: string;
  };
};

type EditingPinCategory = {
  kind: 'category';
  elementId: PinCategoryId;
  original?: Ro<PinCategoryDescriptor>;
  error?: {
    displayNameError?: string;
  };
};

type Editing = EditingPin | EditingPinCategory;

const emojiRegexPattern = emojiRegex();

const app = defineModel<App>();
const docData = computed(() => reactive(app.value!.docShared.data.value));
const pinCatalog = computed(() => reactive(docData.value!.pinCatalog));

const editingPinCategory = computed(() => {
  if (editing.value !== undefined && editing.value.kind == 'category')
    return PinCatalogGetPinCategoryById(pinCatalog.value, editing.value.elementId);

  return null;
});

const editingPin = computed(() => {
  if (editing.value !== undefined && editing.value.kind == 'pin')
    return PinCatalogGetPinById(pinCatalog.value, editing.value.elementId);

  return null;
});

const editing: Ref<Editing | undefined> = ref(undefined);
const isDrawerOpen = ref(false);
const isArchiveOpen = ref(false);

function editPinCategory(
  pinCategoryId: PinCategoryId,
  pinCategory: Rop<PinCategoryDescriptor> | undefined,
) {
  if (editing.value?.elementId.isEqualDynamic(pinCategoryId)) {
    editing.value = undefined;
  } else {
    // const parentId = pinCatalog.value.pinCategories[pinCategory.id].parentId;
    // const parent = parentId !== undefined ? pinCatalog.value.pinCategories[parentId].pinCategory : undefined;
    editing.value = {
      kind: 'category',
      elementId: pinCategoryId,
      original: pinCategory !== undefined ? structuredClone(toRaw(pinCategory)) : undefined,
    };
  }
}

function editPin(pinId: PinId, pin: Rop<PinDescriptor> | undefined) {
  if (editing.value?.elementId.isEqualDynamic(pinId)) {
    editing.value = undefined;
  } else {
    editing.value = {
      kind: 'pin',
      // parent: pinCatalog.value.pinCategories[pinCatalog.value.pins[pin.id].categoryId].pinCategory,
      elementId: pinId,
      original: pin !== undefined ? structuredClone(toRaw(pin)) : undefined,
    };
  }
}

function onClickEditPinCategory(pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>) {
  editPinCategory(pinCategory.id, pinCategory.value);
}

function onClickEditPin(pin: PinTypeOf<Rop<PinCatalog>>) {
  editPin(pin.id, pin.value);
}

function onClickAddPinCategory(parent: PinCategoryTypeOf<Rop<PinCatalog>> | undefined) {
  let id: PinCategoryId | undefined;

  pinCatalog.value[changeSubtree]((pinCatalog) => {
    const pinCategory = PinCatalogCreateAndAddSubcategoryToCategory(
      pinCatalog,
      parent?.id ?? null,
      {
        displayName: 'New category',
        description: '',
        subcategories: [],
        pins: [],
      },
    );
    id = pinCategory?.id;
  });

  if (id !== undefined) editPinCategory(id, undefined);
}

function onClickAddPin(parent: PinCategoryTypeOf<Rop<PinCatalog>>) {
  let id: PinId | undefined;

  pinCatalog.value[changeSubtree]((pinCatalog) => {
    // prettier-ignore
    const DEFAULT_EMOJIS = [
      '🎀', '🎗️', '🥼', '🦺', '👔', '👟', '💎', '🎵', '📖', '📒', '📓', '🔖', '🏷️', '✏️', '🖊️', '💼', '💸', '💳', '🧶', '🪚', '🧪', '🔭', '🛏️', '♻️', '🧭', '🏕️', '🏖️', '🚲', '🛹', '🛼', '⚽', '⚾', '🥎', '🏀', '🏐', '🏈', '🏉', '🎾', '🥏', '🎳', '🏏', '🏑', '🏒', '🥍', '🏓', '🏸', '🥊', '🥋', '🥅', '⛳', '⛸️', '🎣', '🤿', '🎿', '🛷', '🥌', '🎯', '🏹', '🪀', '🪁', '🪄', '🎮', '🕹️', '🎲', '🧩', '♟️', '🃏', '🀄', '🎴', '🎭', '🖼️', '🎨', '🍳', '🥘', '🍲', '🥗', '🍱', '🍜', '🍻', '🥂', '🍽️', '☀️', '🌙', '⭐', '🌈', '⚡', '❄️', '🔥', '💧', '✍️', '💅', '💪', '🧠', '🐈', '🐕', '🐱', '🐶', '🐰', '🐾', '🐹', '🐇', '🐈‍⬛', '🦎', '🦔', '🐠', '🐦',
    ];

    function getRandomColor(): string {
      const letters = '0123456789ABCDEF';
      let color = '#';
      for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
      }
      return color;
    }

    const pin = PinCatalogCreateAndAddPinToCategory(pinCatalog, parent.id, {
      displayName: 'New pin',
      description: '',
      icon: {
        type: 'emoji',
        emoji: {
          emoji: DEFAULT_EMOJIS[Math.floor(Math.random() * DEFAULT_EMOJIS.length)]!,
          scale: 1,
        },
        image: {
          base64: '',
          scale: 1,
        },
      },
      backgroundColor: getRandomColor(),
    });
    id = pin?.id;
  });

  if (id !== undefined) editPin(id, undefined);
}

function onClickArchive(item: Rop<PinDescriptor | PinCategoryDescriptor>, archive: boolean) {
  item[changeSubtree]((item: PinDescriptor | PinCategoryDescriptor) => {
    item.archived = archive;
  });
}

function onClickEditClose() {
  editing.value = undefined;
}

function onClickDeletePinCategory(pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>) {
  pinCatalog.value[changeSubtree]((pinCatalog) => {
    PinCatalogRemovePinCategory(pinCatalog, pinCategory.id);
  });
}

function onClickDeletePin(pin: Pin) {
  pinCatalog.value[changeSubtree]((pinCatalog) => {
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
              PinCatalogGetRootCategories(pinCatalog),
            )"
            :key="rootCategory.id.key"
            class="flex flex-row items-center w-full gap-1"
          >
            <SettingsPinCategory
              @event="onSettingsPinCategoryEvent"
              :depth="0"
              :pin-catalog="pinCatalog"
              :pin-category="rootCategory"
            />
          </li>
          <li
            v-if="
              R.any(
                (pinCategory) => !!pinCategory.value.archived,
                PinCatalogGetRootCategories(pinCatalog),
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
                  PinCatalogGetRootCategories(pinCatalog),
                )"
                :key="rootCategory.id.key"
                class="flex flex-row items-center w-full gap-1"
              >
                <SettingsPinCategory
                  @event="onSettingsPinCategoryEvent"
                  :depth="0"
                  :pin-catalog="pinCatalog"
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
                :value="editing.elementId.key"
                type="text"
                class="input input-bordered w-full max-w-xs !cursor-auto"
                disabled
              />
            </label>
            <template v-if="editingPinCategory === null"
              ><div>This category was deleted.</div></template
            >
            <template v-else>
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
            </template>
          </template>
          <template v-if="editing.kind === 'pin'">
            <label class="form-control w-full max-w-xs">
              <div class="label">
                <span class="label-text">Unique ID</span>
              </div>
              <input
                :value="editing.elementId.key"
                type="text"
                class="input input-bordered w-full max-w-xs !cursor-auto"
                disabled
              />
            </label>
            <template v-if="editingPin === null"><div>This pin was deleted.</div></template
            ><template v-else>
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
                  :original="editing.original?.icon.emoji"
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
                  :original="editing.original?.icon.emoji"
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
            </template>
          </template>
          <button @click="onClickEditClose" class="btn btn-secondary mt-3">Close</button>
        </template>
      </div>
    </div>
  </div>
</template>

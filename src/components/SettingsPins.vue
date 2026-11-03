<script setup lang="ts">
import type { App } from '../app';
import * as feather from 'feather-icons';
import { ref, watch, computed, toRaw } from 'vue';
import type { Ref } from 'vue';
import {
  PIN_CATEGORY_ID_SYMBOL,
  PinCatalogAddPinToCategory,
  PinCatalogChange,
  PinCatalogCreateAndAddPinToCategory,
  PinCatalogCreateAndAddSubcategoryToCategory,
  PinCatalogGetOrphanedPins,
  PinCatalogGetPinById,
  PinCatalogGetPinCategories,
  PinCatalogGetPinCategoryById,
  PinCatalogGetRootCategories,
  PinCatalogRemovePin,
  PinCatalogRemovePinCategory,
  type Pin,
  type PinCategoryDescriptor,
  type PinCategoryId,
  type PinCategoryRop,
  type PinDescriptor,
  type PinId,
  type PinRop,
} from '../pins/pinCatalog';
import emojiRegex from 'emoji-regex';
import SettingsPinCategory, { type SettingsPinCategoryEvent } from './SettingsPinCategory.vue';
import PinCard from './PinCard.vue';
import { keyToId } from '@/pins/util';
import * as R from 'ramda';
import { changeSubtree, type Ro, type Rop } from 'automerge-diy-vue-hooks';
import ValidatedInput from './ValidatedInput.vue';
import { assignProperty, parseText, updateTextProperty } from '@/util/validatedInput';

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
const docData = computed(() => app.value!.docShared.data.value);
const pinCatalog = computed(() => docData.value!.pinCatalog);

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

function onClickEditPinCategory(pinCategory: PinCategoryRop) {
  editPinCategory(pinCategory.id, pinCategory.value);
}

function onClickEditPin(pin: PinRop) {
  editPin(pin.id, pin.value);
}

function onClickAddPinCategory(parent: PinCategoryRop | undefined) {
  let id: PinCategoryId | undefined;

  PinCatalogChange(pinCatalog.value, (pinCatalog) => {
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

function onClickAddPin(parent: PinCategoryRop) {
  let id: PinId | undefined;

  PinCatalogChange(pinCatalog.value, (pinCatalog) => {
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

function onClickDeletePinCategory(pinCategory: PinCategoryRop) {
  PinCatalogChange(pinCatalog.value, (pinCatalog) => {
    PinCatalogRemovePinCategory(pinCatalog, pinCategory.id);
  });
}

function onClickDeletePin(pin: Pin) {
  PinCatalogChange(pinCatalog.value, (pinCatalog) => {
    PinCatalogRemovePin(pinCatalog, pin.id);
  });
}

const orphanedPins = computed(() => PinCatalogGetOrphanedPins(pinCatalog.value));
// The categories that pins without a category can be moved to, by name.
const categoriesToMoveTo = computed(() =>
  PinCatalogGetPinCategories(pinCatalog.value)
    .filter((pinCategory) => !pinCategory.value.archived)
    .toSorted((a, b) => a.value.displayName.localeCompare(b.value.displayName)),
);

// Add a pin without a category to the category chosen in the event's `select`.
function onChangeOrphanedPinCategory(pin: PinRop, event: Event) {
  if (app.value!.docShared.readOnly.value) return;

  const target = event.target;

  if (!(target instanceof HTMLSelectElement) || target.value === '') return;

  const pinCategoryId = keyToId(target.value, PIN_CATEGORY_ID_SYMBOL);

  PinCatalogChange(pinCatalog.value, (pinCatalog) => {
    const writablePin = PinCatalogGetPinById(pinCatalog, pin.id);

    if (writablePin !== null) PinCatalogAddPinToCategory(pinCatalog, pinCategoryId, writablePin);
  });
}

watch(editing, () => {
  isDrawerOpen.value = editing.value !== undefined;
});

function onSettingsPinCategoryEvent(event: SettingsPinCategoryEvent) {
  // Editing only shows the values, see the editor's `fieldset`.
  if (
    app.value!.docShared.readOnly.value &&
    event.kind !== 'pinEdit' &&
    event.kind !== 'categoryEdit'
  )
    return;

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
              :read-only="app!.docShared.readOnly.value"
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
                  :read-only="app!.docShared.readOnly.value"
                />
              </li>
            </ul>
          </li>
          <!-- Pins are otherwise only shown among their categories. -->
          <li v-if="orphanedPins.length > 0" class="w-full">
            <div class="divider my-1">Pins Without a Category</div>
            <ul class="flex flex-col">
              <li
                v-for="pin of orphanedPins"
                :key="pin.id.key"
                class="flex flex-row flex-wrap items-center gap-1 px-4 py-1 odd:bg-base-200"
              >
                <PinCard :pin="pin" :details="true" class="flex-1" />
                <select
                  class="select select-sm w-auto"
                  aria-label="Move to category"
                  :disabled="app!.docShared.readOnly.value"
                  @change="onChangeOrphanedPinCategory(pin, $event)"
                >
                  <option value="" selected disabled>Move to…</option>
                  <option
                    v-for="pinCategory of categoriesToMoveTo"
                    :key="pinCategory.id.key"
                    :value="pinCategory.id.key"
                  >
                    {{ pinCategory.value.displayName }}
                  </option>
                </select>
                <template v-if="!pin.value.archived">
                  <button
                    @click="onSettingsPinCategoryEvent({ kind: 'pinEdit', pin })"
                    class="btn btn-sm btn-neutral max-sm:btn-square"
                  >
                    <div v-html="feather.icons['edit'].toSvg()" />
                    <div class="max-sm:hidden">Edit</div>
                  </button>
                  <button
                    :disabled="app!.docShared.readOnly.value"
                    @click="onSettingsPinCategoryEvent({ kind: 'pinArchive', pin, archive: true })"
                    class="btn btn-sm max-sm:btn-square btn-warning"
                  >
                    <div v-html="feather.icons['archive'].toSvg()" />
                    <div class="max-sm:hidden">Archive</div>
                  </button>
                </template>
                <template v-else>
                  <button
                    :disabled="app!.docShared.readOnly.value"
                    @click="onSettingsPinCategoryEvent({ kind: 'pinArchive', pin, archive: false })"
                    class="btn btn-sm max-sm:btn-square btn-neutral"
                  >
                    <div v-html="feather.icons['upload'].toSvg()" />
                    <div class="max-sm:hidden">Restore</div>
                  </button>
                  <button
                    :disabled="app!.docShared.readOnly.value"
                    @click="onSettingsPinCategoryEvent({ kind: 'pinDelete', pin })"
                    class="btn btn-sm max-sm:btn-square btn-error"
                  >
                    <div v-html="feather.icons['trash-2'].toSvg()" />
                    <div class="max-sm:hidden">Delete</div>
                  </button>
                </template>
              </li>
            </ul>
          </li>
          <li>
            <button
              @click="onSettingsPinCategoryEvent({ kind: 'categoryAdd' })"
              class="btn btn-primary max-sm:btn-square"
              :disabled="app!.docShared.readOnly.value"
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
        <!-- `contents`, so that the fields keep their layout. -->
        <fieldset
          v-if="editing !== undefined"
          class="contents"
          :disabled="app!.docShared.readOnly.value"
        >
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
                  :disabled="app!.docShared.readOnly.value"
                  :subtree="editingPinCategory.value"
                  :original="editing.original"
                  property="displayName"
                  label="Display Name"
                  :validate="
                    (value) => {
                      if (value.length === 0) return 'The display name is empty.';
                    }
                  "
                  :parse="parseText"
                  :change="updateTextProperty"
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
                  :disabled="app!.docShared.readOnly.value"
                  :subtree="editingPinCategory.value"
                  :original="editing.original"
                  property="description"
                  label="Description"
                  :validate="
                    (value) => {
                      if (value.length === 0) return 'The description is empty.';
                    }
                  "
                  :parse="parseText"
                  :change="updateTextProperty"
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
                  :disabled="app!.docShared.readOnly.value"
                  :subtree="editingPinCategory.value"
                  :original="editing.original"
                  :default-value="''"
                  property="details"
                  label="Details"
                  :parse="parseText"
                  :change="updateTextProperty"
                >
                  <textarea
                    type="text"
                    placeholder="Example Details"
                    class="textarea w-full max-w-xs"
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
                  :disabled="app!.docShared.readOnly.value"
                  :subtree="editingPin.value"
                  :original="editing.original"
                  property="displayName"
                  label="Display Name"
                  :validate="
                    (value) => {
                      if (value.length === 0) return 'The display name is empty.';
                    }
                  "
                  :parse="parseText"
                  :change="updateTextProperty"
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
                  :disabled="app!.docShared.readOnly.value"
                  :subtree="editingPin.value"
                  :original="editing.original"
                  property="description"
                  label="Description"
                  :validate="
                    (value) => {
                      if (value.length === 0) return 'The description is empty.';
                    }
                  "
                  :parse="parseText"
                  :change="updateTextProperty"
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
                  :disabled="app!.docShared.readOnly.value"
                  :subtree="editingPin.value"
                  :original="editing.original"
                  :default-value="''"
                  property="details"
                  label="Details"
                  :parse="parseText"
                  :change="updateTextProperty"
                >
                  <textarea
                    type="text"
                    placeholder="Example Details"
                    class="textarea w-full max-w-xs"
                    :value="slot.value"
                    @input="slot.onChange"
                    :class="slot.class"
                  />
                </ValidatedInput>
              </label>
              <label class="form-control w-full max-w-xs">
                <ValidatedInput
                  v-slot="slot"
                  :disabled="app!.docShared.readOnly.value"
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
                  :parse="parseText"
                  :change="assignProperty"
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
                  :disabled="app!.docShared.readOnly.value"
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
                  :change="assignProperty"
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
                  :disabled="app!.docShared.readOnly.value"
                  :subtree="editingPin.value"
                  :original="editing.original"
                  property="backgroundColor"
                  label="Background Color"
                  :parse="parseText"
                  :change="assignProperty"
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
        </fieldset>
        <button
          v-if="editing !== undefined"
          @click="onClickEditClose"
          class="btn btn-secondary mt-3"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

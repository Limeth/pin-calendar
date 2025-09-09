<script setup lang="ts">
import * as feather from 'feather-icons';
import { ref } from 'vue';
import {
  PinCatalogGetPinsInCategory,
  PinCatalogGetSubcategoriesInCategory,
  type PinCatalog,
  type PinCategoryTypeOf,
  type PinTypeOf,
} from '../pins/pinCatalog';
import PinCard from './PinCard.vue';
import * as R from 'ramda';
import type { Rop } from 'automerge-diy-vue-hooks';

const { depth, pinCategory, predecessorArchived } = defineProps<{
  depth: number;
  predecessorArchived?: boolean;
  pinCatalog: Rop<PinCatalog>;
  pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>;
}>();

export type SettingsPinCategoryEvent =
  | {
      kind: 'pinAdd';
      parent: PinCategoryTypeOf<Rop<PinCatalog>>;
    }
  | {
      kind: 'pinEdit';
      pin: PinTypeOf<Rop<PinCatalog>>;
    }
  | {
      kind: 'pinArchive';
      pin: PinTypeOf<Rop<PinCatalog>>;
      archive: boolean;
    }
  | {
      kind: 'pinDelete';
      pin: PinTypeOf<Rop<PinCatalog>>;
    }
  | {
      kind: 'categoryAdd';
      parent?: PinCategoryTypeOf<Rop<PinCatalog>>;
    }
  | {
      kind: 'categoryEdit';
      pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>;
    }
  | {
      kind: 'categoryArchive';
      pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>;
      archive: boolean;
    }
  | {
      kind: 'categoryDelete';
      pinCategory: PinCategoryTypeOf<Rop<PinCatalog>>;
    };

const emit = defineEmits<{
  event: [SettingsPinCategoryEvent];
}>();

const isArchiveOpen = ref(false);
const isCollapsed = ref(true);
</script>

<template>
  <div class="flex justify-center flex-col w-full">
    <ul
      class="flex flex-col gap-2 px-4 py-2 rounded-lg overflow-hidden"
      :class="depth % 2 == 0 ? 'bg-base-100' : 'bg-base-200'"
    >
      <li class="flex-grow flex flex-row gap-1 text-lg relative z-0 -mx-4 -my-2 px-4 py-2">
        <div
          class="hover:bg-base-300 w-full absolute top-0 left-0 bottom-0 cursor-pointer z-0"
          @click="isCollapsed = !isCollapsed"
        ></div>
        <div class="flex-grow flex flex-row items-center z-10 pointer-events-none">
          <div>{{ pinCategory.value.displayName }}</div>
          <div
            class="px-2"
            v-html="feather.icons[isCollapsed ? 'chevron-up' : 'chevron-down'].toSvg()"
          />
        </div>
        <div
          v-if="!isCollapsed && !predecessorArchived"
          class="flex flex-row gap-1 text-lg px-4 py-2 -mx-4 -my-2 z-10"
        >
          <template v-if="!pinCategory.value.archived">
            <button
              @click="emit('event', { kind: 'categoryAdd', parent: pinCategory })"
              class="btn btn-sm btn-primary max-sm:btn-square"
            >
              <div v-html="feather.icons['plus-square'].toSvg()" />
              <div class="max-sm:hidden">Add Subcategory</div>
            </button>
            <button
              @click="emit('event', { kind: 'pinAdd', parent: pinCategory })"
              class="btn btn-sm btn-primary max-sm:btn-square"
            >
              <div v-html="feather.icons['plus'].toSvg()" />
              <div class="max-sm:hidden">Add Pin</div>
            </button>
            <button
              @click="emit('event', { kind: 'categoryEdit', pinCategory })"
              class="btn btn-sm btn-neutral max-sm:btn-square"
            >
              <div v-html="feather.icons['edit'].toSvg()" />
              <div class="max-sm:hidden">Edit</div>
            </button>
            <button
              @click="emit('event', { kind: 'categoryArchive', pinCategory, archive: true })"
              class="btn btn-sm max-sm:btn-square btn-warning"
            >
              <div v-html="feather.icons['archive'].toSvg()" />
              <div class="max-sm:hidden">Archive</div>
            </button>
          </template>
          <template v-else>
            <button
              @click="emit('event', { kind: 'categoryArchive', pinCategory, archive: false })"
              class="btn btn-sm max-sm:btn-square btn-neutral"
            >
              <div v-html="feather.icons['upload'].toSvg()" />
              <div class="max-sm:hidden">Restore</div>
            </button>
            <button
              @click="emit('event', { kind: 'categoryDelete', pinCategory })"
              class="btn btn-sm max-sm:btn-square btn-error"
            >
              <div v-html="feather.icons['trash-2'].toSvg()" />
              <div class="max-sm:hidden">Delete</div>
            </button>
          </template>
        </div>
      </li>
      <template v-if="!isCollapsed">
        <li class="text-sm" v-if="pinCategory.value.description">
          {{ pinCategory.value.description }}
        </li>
        <li class="-mx-4 w-[inherit]">
          <ul class="flex flex-col">
            <li
              v-for="pin of R.filter(
                (pin) => !pin.value.archived,
                PinCatalogGetPinsInCategory(pinCatalog, pinCategory.id),
              )"
              :key="pin.id.key"
              class="flex flex-row items-center gap-1 px-4 py-1"
              :class="depth % 2 == 0 ? 'odd:bg-base-200' : 'odd:bg-base-300'"
            >
              <PinCard :pin="pin" class="flex-1" />
              <template v-if="!predecessorArchived && !pinCategory.value.archived">
                <button
                  @click="emit('event', { kind: 'pinEdit', pin })"
                  class="btn btn-sm btn-neutral max-sm:btn-square"
                >
                  <div v-html="feather.icons['edit'].toSvg()" />
                  <div class="max-sm:hidden">Edit</div>
                </button>
                <button
                  @click="emit('event', { kind: 'pinArchive', pin, archive: true })"
                  class="btn btn-sm max-sm:btn-square btn-warning"
                >
                  <div v-html="feather.icons['archive'].toSvg()" />
                  <div class="max-sm:hidden">Archive</div>
                </button>
              </template>
            </li>
          </ul>
        </li>
        <li
          v-for="subcategory of R.filter(
            (subcategory) => !subcategory.value.archived,
            PinCatalogGetSubcategoriesInCategory(pinCatalog, pinCategory.id),
          )"
          :key="subcategory.id.key"
          class="flex flex-row items-center w-full gap-1"
        >
          <SettingsPinCategory
            :predecessor-archived="predecessorArchived || pinCategory.value.archived"
            @event="emit('event', $event)"
            :depth="depth + 1"
            :pin-catalog
            :pin-category="subcategory"
          />
        </li>

        <li
          v-if="
            R.any(
              (item) => !!item.value.archived,
              R.flatten([
                PinCatalogGetSubcategoriesInCategory(pinCatalog, pinCategory.id),
                PinCatalogGetPinsInCategory(pinCatalog, pinCategory.id),
              ]),
            )
          "
          class="collapse collapse-arrow -mx-4 w-[inherit]"
        >
          <input type="checkbox" v-model="isArchiveOpen" />
          <div class="collapse-title flex flex-row items-center pl-0">
            <div class="divider flex-1 my-0 mr-4 h-auto" />
            <div>{{ isArchiveOpen ? 'Hide' : 'Show' }} Archived</div>
          </div>
          <ul class="collapse-content flex flex-col !py-0">
            <li
              v-for="pin of R.filter(
                (pin) => !!pin.value.archived,
                PinCatalogGetPinsInCategory(pinCatalog, pinCategory.id),
              )"
              :key="pin.id.key"
              class="flex flex-row items-center gap-1 px-4 py-1 -mx-4"
              :class="depth % 2 == 0 ? 'odd:bg-base-200' : 'odd:bg-base-300'"
            >
              <PinCard :pin="pin" class="flex-1" />
              <template v-if="!predecessorArchived && !pinCategory.value.archived">
                <button
                  @click="emit('event', { kind: 'pinArchive', pin, archive: false })"
                  class="btn btn-sm max-sm:btn-square btn-neutral"
                >
                  <div v-html="feather.icons['upload'].toSvg()" />
                  <div class="max-sm:hidden">Restore</div>
                </button>
                <button
                  @click="emit('event', { kind: 'pinDelete', pin })"
                  class="btn btn-sm max-sm:btn-square btn-error"
                >
                  <div v-html="feather.icons['trash-2'].toSvg()" />
                  <div class="max-sm:hidden">Delete</div>
                </button>
              </template>
            </li>
            <li
              v-for="subcategory of R.filter(
                (subcategory) => !!subcategory.value.archived,
                PinCatalogGetSubcategoriesInCategory(pinCatalog, pinCategory.id),
              )"
              :key="subcategory.id.key"
              class="flex flex-row items-center w-full gap-1 pt-2"
            >
              <SettingsPinCategory
                @event="emit('event', $event)"
                :depth="depth + 1"
                :predecessor-archived="predecessorArchived || pinCategory.value.archived"
                :pin-catalog
                :pin-category="subcategory"
              />
            </li>
          </ul>
        </li>
      </template>
    </ul>
  </div>
</template>

<script setup lang="ts" generic="T extends object, P extends Property & keyof T">
import type { Doc } from '@automerge/automerge-repo';
import { updateText } from '@automerge/automerge';
import { changeSubtree, type Property, type Ro, type Rop } from 'automerge-diy-vue-hooks';
import { ref, type Ref } from 'vue';
import feather from 'feather-icons';

const {
  subtree,
  original,
  property,
  defaultValue,
  parse,
  validate,
  change: changeInner,
} = defineProps<{
  subtree: Rop<T>;
  original?: Ro<T>;
  defaultValue?: T[P];
  property: P;
  label?: string;
  parse?: (value: string) => T[P]; // TODO: Make mandatory if T[P] !== string
  validate?: (value: T[P]) => string | undefined;
  change: 'assign' | 'updateText' | ((subtree: T, property: P, value: T[P]) => void);
}>();

let change: (subtree: T, property: P, value: T[P]) => void;

if (changeInner === 'assign') {
  change = (subtree: T, property: P, value: T[P]) => {
    (subtree[property] as unknown) = value;
  };
} else if (changeInner === 'updateText') {
  change = (subtree: T, property: P, value: T[P]) => {
    updateText(subtree as Doc<T>, [property], value as string); // TODO: unsafe
  };
} else {
  change = changeInner;
}

// const emit = defineEmits<{
//   update: [subtree: T, property: P, value: string];
// }>();
const warning: Ref<string | undefined> = ref(undefined);

function onChange(event: Event) {
  const string = (event.target! as HTMLInputElement).value;
  const value = parse !== undefined ? parse(string) : (string as T[P]); // TODO: unsafe
  warning.value = validate?.(value);
  subtree[changeSubtree]((subtreeMut) => {
    if (property in subtreeMut) change(subtreeMut, property, value ?? (defaultValue as T[P]));
    else subtreeMut[property] = value;
  });
}

function onRevert() {
  if (original !== undefined) {
    const value = original[property] as T[P];
    warning.value = validate?.(value);
    subtree[changeSubtree]((subtreeMut) => {
      if (property in subtreeMut) change(subtreeMut, property, value ?? (defaultValue as T[P]));
      else subtreeMut[property] = value;
    });
  }
}
</script>
<template>
  <div class="label" v-if="label !== undefined">
    <span class="label-text">{{ label }}</span>
  </div>
  <div class="flex gap-2 items-center">
    <slot
      :value="subtree?.[property] ?? defaultValue"
      :onChange="onChange"
      :class="'flex-1 ' + (warning !== undefined ? 'input-warning' : '')"
    />
    <div v-if="original !== undefined" class="tooltip tooltip-left" data-tip="Revert changes">
      <button
        class="btn btn-square btn-ghost"
        v-html="feather.icons['rotate-ccw'].toSvg()"
        :disabled="(subtree[property] ?? defaultValue) === (original[property] ?? defaultValue)"
        @click="onRevert"
      />
    </div>
  </div>
  <div v-if="warning !== undefined" class="label">
    <span class="label-text-alt text-warning">{{ warning }}</span>
  </div>
</template>

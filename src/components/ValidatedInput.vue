<script setup lang="ts" generic="T, P extends Property & keyof T">
import type { Doc } from '@automerge/automerge-repo';
import { updateText } from '@automerge/automerge/next';
import { changeSubtree, type Property, type Rop } from 'automerge-diy-vue-hooks';
import { ref, type Ref } from 'vue';

const {
  subtree,
  property,
  parse,
  validate,
  change: changeInner,
} = defineProps<{
  subtree: Rop<T>;
  property: P;
  label?: string;
  parse?: (value: string) => T[P]; // Make mandatory if T[P] !== string
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
console.log(validate);

function onChange(event: Event) {
  const string = (event.target! as HTMLInputElement).value;
  const value = parse !== undefined ? parse(string) : (string as T[P]); // TODO: unsafe
  warning.value = validate?.(value);
  subtree[changeSubtree]((subtreeMut) => {
    change(subtreeMut, property, value);
  });
}
</script>
<template>
  <div class="label" v-if="label !== undefined">
    <span class="label-text">{{ label }}</span>
  </div>
  <slot
    :value="subtree?.[property]"
    :onChange="onChange"
    :class="warning !== undefined ? 'input-warning' : ''"
  />
  <div v-if="warning !== undefined" class="label">
    <span class="label-text-alt text-warning">{{ warning }}</span>
  </div>
</template>

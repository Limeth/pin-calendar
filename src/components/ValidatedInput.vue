<script setup lang="ts" generic="T extends object, P extends Property & keyof T">
import { changeSubtree, type Property, type Rop } from 'automerge-diy-vue-hooks';
import { ref, type Ref } from 'vue';
import feather from 'feather-icons';

const { subtree, original, property, defaultValue, parse, validate, change, disabled } =
  defineProps<{
    subtree: Rop<T>;
    // Holds the value to revert to.
    original?: { [K in P]?: T[P] };
    defaultValue?: T[P];
    property: P;
    label?: string;
    // The value of the input's text, e.g. `parseText` for a string property, see
    // `util/validatedInput.ts`.
    parse: (text: string) => T[P];
    validate?: (value: T[P]) => string | undefined;
    // Writes the value to an existing property, e.g. `assignProperty`, or `updateTextProperty` for a
    // string property.
    change: (subtree: T, property: P, value: NonNullable<T[P]>) => void;
    // The value cannot be changed, e.g. as the calendar is read-only. The slot's input is disabled by
    // its parent, e.g. via a `fieldset`.
    disabled?: boolean;
  }>();

const warning: Ref<string | undefined> = ref(undefined);

// Write the value, or the default value if there is none. Without either, e.g. when reverting an
// optional property that has no default value, nothing is written.
function write(value: T[P] | undefined) {
  const resolved = value ?? defaultValue;

  if (resolved === undefined || resolved === null) return;

  warning.value = validate?.(resolved);
  subtree[changeSubtree]((subtreeMut) => {
    if (property in subtreeMut) change(subtreeMut, property, resolved);
    else subtreeMut[property] = resolved;
  });
}

function onChange(event: Event) {
  if (disabled) return;

  const target = event.target;

  // The slot's element is an input or a text area.
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    write(parse(target.value));
}

function onRevert() {
  if (disabled) return;

  if (original !== undefined) write(original[property]);
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
        :disabled="
          disabled || (subtree[property] ?? defaultValue) === (original[property] ?? defaultValue)
        "
        @click="onRevert"
      />
    </div>
  </div>
  <div v-if="warning !== undefined" class="label">
    <span class="label-text-alt text-warning">{{ warning }}</span>
  </div>
</template>

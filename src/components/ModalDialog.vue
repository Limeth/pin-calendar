<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef, watch } from 'vue';

// A modal dialog, shown while `open`. Pressing Escape, or clicking outside of the dialog if
// `cancelOnBackdrop`, emits `cancel` rather than closing it: the parent closes it by no longer
// setting `open`, unless it cannot be cancelled at the moment.
const { open, cancelOnBackdrop = false } = defineProps<{
  open: boolean;
  cancelOnBackdrop?: boolean;
}>();
const emit = defineEmits<{ cancel: [] }>();
const dialog = useTemplateRef('dialog');

function update() {
  if (dialog.value === null) return;

  if (open && !dialog.value.open) dialog.value.showModal();
  // eslint-disable-next-line no-restricted-syntax -- A dialog, not a PeerJS connection.
  else if (!open && dialog.value.open) dialog.value.close();
}

onMounted(update);
watch(() => open, update, { flush: 'post' });

function onCancel(event: Event) {
  event.preventDefault();
  emit('cancel');
}

// The browser may close the dialog anyway, e.g. when Escape is pressed repeatedly. It is shown again
// if the parent keeps it open.
function onClose() {
  void nextTick(update);
}
</script>

<template>
  <dialog ref="dialog" class="modal" @cancel="onCancel" @close="onClose">
    <slot />
    <div v-if="cancelOnBackdrop" class="modal-backdrop" @click="emit('cancel')" />
  </dialog>
</template>

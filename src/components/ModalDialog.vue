<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef, watch } from 'vue';

// A modal dialog, shown while `open`. Pressing Escape emits `cancel` rather than closing it: the
// parent closes it by no longer setting `open`, unless it cannot be cancelled at the moment.
// Clicking outside of the dialog does nothing, as cancelling some dialogs loses data, e.g. an invite.
const { open } = defineProps<{ open: boolean }>();
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
  </dialog>
</template>

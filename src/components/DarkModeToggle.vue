<script setup lang="ts">
  import { ref, watch } from "vue";

  const darkModeEnabled = ref(localStorage.getItem("dark-mode") === "true");

  watch(darkModeEnabled, () => {
    localStorage.setItem("dark-mode", darkModeEnabled.value ? "true" : "false");
    const colorTheme = darkModeEnabled.value ? "dark" : "light";
    if (darkModeEnabled.value) {
        document.documentElement.classList.add("dark");
    } else {
        document.documentElement.classList.remove("dark");
    }
    console.log(darkModeEnabled.value);
  })
</script>

<template>
  <input type="checkbox" class="toggle" v-model="darkModeEnabled" />
</template>

import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  server: {
    // A workaround for Firefox's inability to find ICE candidates on the `localhost` host.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1672145
    host: '0.0.0.0',
  },
  root: 'src',
  base: '/pin-calendar/',
  plugins: [vue(), vueDevTools(), wasm(), topLevelAwait(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
});

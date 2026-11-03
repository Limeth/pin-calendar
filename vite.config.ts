import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import wasm from 'vite-plugin-wasm';
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
  plugins: [vue(), vueDevTools(), wasm(), tailwindcss()],
  worker: {
    // The worker's code awaits the Automerge WASM module when it is imported (a top-level `await`),
    // which the default `iife` format does not support.
    format: 'es',
    plugins: () => [wasm()],
  },
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

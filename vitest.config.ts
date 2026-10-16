import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Separate from `vite.config.ts`, whose `root` and browser-only plugins are not needed for tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Provides `window`, `document`, `localStorage` and their events.
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    server: {
      deps: {
        // Published as TypeScript, which has to be compiled.
        inline: ['automerge-diy-vue-hooks'],
      },
    },
  },
});

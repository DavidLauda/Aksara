import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'chrome124',
    // Vite's HTML preload helper uses document; MV3 service workers have no DOM.
    modulePreload: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve('src/background.ts'),
        popup: resolve('popup.html'),
        options: resolve('options.html'),
        offscreen: resolve('offscreen.html'),
      },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
  worker: { format: 'es' },
});

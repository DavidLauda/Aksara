import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A separate IIFE build can share source helpers without emitting runtime
// imports, which Chrome's classic content scripts cannot execute.
export const buildContent = (watch = false) => Promise.all([
  ['src/content.ts', 'AksaraContent', 'content.js'],
  ['src/page-menu.ts', 'AksaraPageMenu', 'page-menu.js'],
].map(([entry, name, file]) => build({
  configFile: false,
  build: {
    target: 'chrome124', emptyOutDir: false, sourcemap: true,
    ...(watch ? { watch: {} } : {}),
    lib: { entry: resolve(entry), name, formats: ['iife'], fileName: () => file },
  },
})));
if (import.meta.url === pathToFileURL(process.argv[1]).href) await buildContent(process.argv.includes('--watch'));

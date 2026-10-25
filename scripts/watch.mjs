import { build } from 'vite';
import { buildContent } from './build-content.mjs';
await Promise.all([build({ build: { emptyOutDir: false, watch: {} } }), buildContent(true)]);

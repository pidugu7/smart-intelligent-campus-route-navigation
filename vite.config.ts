import { defineConfig } from 'vite';

// Phase 1 ships the DSA engine only. The dev server (`npm run dev`) and the
// `vite build` script become meaningful in Phase 4 when index.html and the
// Three.js UI land; keeping the config now makes later phases zero-config.
export default defineConfig({});

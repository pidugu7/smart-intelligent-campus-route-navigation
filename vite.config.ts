import { defineConfig } from 'vite';

// Phase 4: static Three.js front end over the Phase 1–3 engine + dataset.
// No backend — the dev server only serves this static app. `host: true`
// binds 0.0.0.0 so the app is reachable through any proxy/preview host.
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    // Static demo app (no backend, no auth, no user data): accept any proxied
    // preview host. On a laptop the app is reached via localhost anyway.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
});

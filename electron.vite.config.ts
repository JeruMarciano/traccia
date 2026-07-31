import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// `ssr.external` is needed in main and preload because the installed Vite (8.x, rolldown) resolves
// externals for an SSR build from `ssr.external` and ignores electron-vite's own
// `build.rollupOptions.external`. Without it the npm `electron` package -- a development shim that
// can spawn a binary downloader -- is inlined into both bundles, and `app`, `session` and
// `contextBridge` are undefined at runtime.

export default defineConfig({
  main: {
    ssr: { external: ['electron'] },
    build: { rollupOptions: { input: 'src/main/index.ts' } },
  },
  preload: {
    ssr: { external: ['electron'] },
    build: {
      rollupOptions: {
        input: 'src/preload/index.ts',
        // A sandboxed preload cannot be an ES module, but package.json's "type": "module" makes
        // electron-vite default to one. Emit CommonJS as index.cjs, the file src/main/index.ts
        // loads.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    // index.html is in the repo root, not the src/renderer directory electron-vite looks in, so
    // the entry has to be named explicitly.
    build: { rollupOptions: { input: 'index.html' } },
    plugins: [react()],
  },
})

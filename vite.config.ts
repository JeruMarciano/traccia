import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// index.html lives in the repo root and loads /src/renderer/main.tsx, which is where the
// React app has always been. Nothing about the Electron layout survives here except that.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
})

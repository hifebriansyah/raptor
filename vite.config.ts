import { defineConfig } from 'vite';

// BASE_PATH: where the build is served. Relative by default; `npm run build:local` uses /for-fun/raptor/ (local Apache, see .htaccess).
export default defineConfig({
  base: process.env.BASE_PATH || './',
  server: { port: 5195, strictPort: true, host: true },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: { output: { manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'] } } },
  },
});

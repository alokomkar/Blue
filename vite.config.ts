import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Standalone web build of the game page: no Reddit wrapper, no server of its own. The model
// calls (added during the hackathon) go through serverless functions under /api.
export default defineConfig({
  root: 'src/client',
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: { game: resolve(import.meta.dirname, 'src/client/game.html') } },
  },
});

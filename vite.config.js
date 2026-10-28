import { defineConfig } from 'vite';

// base './' makes the built game work from any folder, e.g. GitHub Pages at /aliensurvivor/
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});

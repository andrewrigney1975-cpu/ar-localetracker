// The standalone course Viewer: a static site (viewer/index.html) that opens shared courses
// in any browser. `npm run viewer` serves it; `npm run viewer:build` writes dist-viewer/,
// which can be hosted anywhere static (GitHub Pages, Netlify, a plain web server).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./viewer', import.meta.url)),
  base: './',
  publicDir: false,
  // Its own dependency cache, so it can run beside the app's dev server.
  cacheDir: fileURLToPath(new URL('./node_modules/.vite-viewer', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist-viewer', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});

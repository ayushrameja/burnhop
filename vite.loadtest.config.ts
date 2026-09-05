import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'scripts/loadtest.ts', target: 'node22', outDir: 'dist-tools', copyPublicDir: false,
    rollupOptions: { output: { entryFileNames: 'loadtest.mjs' } },
  },
});

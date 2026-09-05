import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'src/server/index.ts',
    target: 'node22',
    outDir: 'dist-server',
    copyPublicDir: false,
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'index.mjs' } },
  },
});

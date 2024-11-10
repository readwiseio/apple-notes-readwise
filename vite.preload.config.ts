import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    outDir: path.resolve(__dirname, '.vite/preload'),
    lib: {
      entry: path.resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
  plugins: [],
});

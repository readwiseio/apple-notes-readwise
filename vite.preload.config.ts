import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@preload': path.resolve(__dirname, 'src/preload'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '.vite/preload'),
    lib: {
      entry: path.resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],  // CommonJS format, as Electron expects this for preload
    },
    rollupOptions: {
      external: ['electron'],  // Keeps Electron modules external
    },
  },
  plugins: [],
});

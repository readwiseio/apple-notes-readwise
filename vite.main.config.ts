import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main/index.ts'),
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
  plugins: [],
});

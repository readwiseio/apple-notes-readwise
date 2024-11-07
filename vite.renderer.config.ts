import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/confi
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@hooks': path.resolve(__dirname, 'src/renderer/hooks'),
      '@lib': path.resolve(__dirname, 'src/renderer/lib'),
    },
  },
  plugins: [react()],
});


import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        screen: resolve(__dirname, 'index.html'),
        controller: resolve(__dirname, 'controller.html'),
      },
    },
  },
});

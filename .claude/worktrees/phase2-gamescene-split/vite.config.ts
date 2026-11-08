import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        // AirConsole вимагає саме screen.html + controller.html у корені dist/
        screen: resolve(__dirname, 'screen.html'),
        controller: resolve(__dirname, 'controller.html'),
      },
    },
  },
});

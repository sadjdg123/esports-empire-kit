import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built game also works from a sub-folder or a hosted page.
  base: './',
  // Phaser (~1.4 MB) is loaded on demand by the match page only.
  build: { chunkSizeWarningLimit: 1600 },
});

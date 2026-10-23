import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Phaser (~1.4 MB) is loaded on demand by the match page only.
  build: { chunkSizeWarningLimit: 1600 },
});

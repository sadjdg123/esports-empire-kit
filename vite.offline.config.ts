// The offline build (P4, T42): one classic script instead of modules, so the game runs when
// index.html is opened straight from a folder on a computer (file://), with no server.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'release/esports-empire-offline',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'game.js', assetFileNames: 'game.[ext]' } },
  },
});

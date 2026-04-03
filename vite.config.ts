import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@toast-ui/editor')) {
            return 'toastui';
          }
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});

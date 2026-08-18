import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Tum /api istekleri yerel backend'e proxy'lenir; disariya cikis yoktur.
    proxy: {
      '/api': {
        target: 'http://localhost:5273',
        changeOrigin: false,
      },
    },
  },
});

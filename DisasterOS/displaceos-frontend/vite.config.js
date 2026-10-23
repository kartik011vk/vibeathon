import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API and Socket.IO are proxied, so the browser talks to one origin and the
// httpOnly refresh cookie works without cross-site configuration.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_DEV_PROXY_TARGET || 'http://localhost:4000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/socket.io': { target, ws: true, changeOrigin: true },
      },
    },
    // three.js and Leaflet are reached only through lazy imports, so they load on demand.
    build: { chunkSizeWarningLimit: 1000 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.js'],
      globals: true,
      css: false,
    },
  };
});

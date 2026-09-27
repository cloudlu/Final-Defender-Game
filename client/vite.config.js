import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 30000,
    proxy: {
      '/api': 'http://localhost:30001',
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});

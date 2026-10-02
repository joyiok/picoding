import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { config } from './server/config';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: { '^/api/': { target: `http://127.0.0.1:${config.port}`, ws: true, changeOrigin: true } },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
});

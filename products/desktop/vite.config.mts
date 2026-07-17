import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// renderer public 资产由 scripts/sync-assets.mjs 从仓库根 assets/ 同步而来。
// 配置保持 ESM 入口，避免 Vite 5 在 dev/build 时回退到已弃用的 CJS Node API。
export default defineConfig({
  root: path.resolve(__dirname, 'src', 'renderer'),
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        presence: path.resolve(__dirname, 'src', 'renderer', 'presence.html'),
        'control-center': path.resolve(__dirname, 'src', 'renderer', 'control-center.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});

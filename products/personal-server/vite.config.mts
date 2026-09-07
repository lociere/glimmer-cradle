import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(packageRoot, 'public'),
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: { '/src': path.join(packageRoot, 'src') },
  },
  build: {
    emptyOutDir: false,
    outDir: path.join(packageRoot, 'dist', 'public'),
    assetsDir: 'assets',
  },
});

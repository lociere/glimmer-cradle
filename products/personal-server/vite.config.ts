import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const packageRoot = __dirname;

export default defineConfig({
  root: path.join(packageRoot, 'public'),
  publicDir: false,
  plugins: [react()],
  build: {
    emptyOutDir: false,
    outDir: path.join(packageRoot, 'dist', 'public'),
    assetsDir: 'assets',
  },
});

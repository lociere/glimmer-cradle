import path from 'node:path';
import { defineConfig } from 'vite';

const packageRoot = __dirname;

export default defineConfig({
  root: path.join(packageRoot, 'public'),
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: path.join(packageRoot, 'dist', 'public'),
    assetsDir: 'assets',
  },
});

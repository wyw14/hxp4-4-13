import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5113,
    strictPort: true,
    open: true
  }
});
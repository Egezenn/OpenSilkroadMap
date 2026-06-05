import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    watch: {
      ignored: ['**/assets/img/silkroad/minimap/**']
    },
    fs: {
      cachedChecks: true
    }
  },
  build: {
    outDir: 'dist'
  }
});

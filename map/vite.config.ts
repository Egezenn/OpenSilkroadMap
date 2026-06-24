import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    watch: {
      ignored: ["**/public/assets/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

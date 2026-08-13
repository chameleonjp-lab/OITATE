import { defineConfig } from "vite";

export default defineConfig({
  build: {
    manifest: true,
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});

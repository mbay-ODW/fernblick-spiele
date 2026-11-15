import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:8000";

export default defineConfig({
  server: { proxy: { "/api": api } },
  build: { chunkSizeWarningLimit: 4000 },
});

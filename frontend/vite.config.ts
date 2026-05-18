import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev server proxies /api and /ws to a locally-running Go backend so
// `npm run dev` works without CORS gymnastics. Production serves both from
// the Go binary on the same origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
  },
});

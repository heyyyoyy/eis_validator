import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// When running inside Docker (Vite dev server container), the backend is
// reachable by its service name on the internal network, not localhost.
// Set VITE_PROXY_TARGET in the environment to override (e.g. http://backend:3000).
const proxyTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/parse": { target: proxyTarget, changeOrigin: true },
      "/validate": { target: proxyTarget, changeOrigin: true },
      "/query": { target: proxyTarget, changeOrigin: true },
      "/health": { target: proxyTarget, changeOrigin: true },
    },
  },
});

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_PROXY_BACKEND || "http://127.0.0.1:8000";
  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        "/triage": { target: backend, changeOrigin: true },
        "/export": { target: backend, changeOrigin: true },
        "/health": { target: backend, changeOrigin: true },
        "/voice": { target: backend, changeOrigin: true },
      },
    },
  };
});

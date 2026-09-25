import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { demoBackend } from "./dev/demo-backend";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const demo = process.env.KIVIDAS_DEMO === "1";
  const target = env.BACKEND_ORIGIN || "http://127.0.0.1:8080";
  return {
    plugins: [react(), ...(demo ? [demoBackend()] : [])],
    server: {
      port: 5180,
      strictPort: true,
      proxy: demo
        ? undefined
        : {
            "/api": { target, changeOrigin: true },
            "/ws": { target, ws: true, changeOrigin: true },
            "/oauth": { target, changeOrigin: true },
          },
    },
    build: { sourcemap: false },
  };
});

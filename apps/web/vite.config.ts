import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.BASEER_API_PROXY_TARGET?.trim() || "http://127.0.0.1:5200";

export default defineConfig({
  plugins: [react()],
  build: { target: "esnext", manifest: true, minify: "terser", terserOptions: { compress: { passes: 3 }, format: { comments: false } } },
  server: {
    proxy: {
      "/v1": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});

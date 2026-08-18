import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    build: { target: "esnext", minify: "terser", terserOptions: { compress: { passes: 2 }, format: { comments: false } } },
    server: {
        proxy: {
            "/v1": {
                target: "http://127.0.0.1:5200",
                changeOrigin: true,
            },
        },
    },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.BASEER_API_PROXY_TARGET?.trim() || "http://127.0.0.1:5200";
const releaseId = process.env.BASEER_RELEASE_ID?.trim() || process.env.GITHUB_SHA?.trim() || "development";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "baseer-release-marker",
      transformIndexHtml(html) {
        return html.replace("</head>", `    <meta name="baseer-release-id" content="${releaseId}" />\n  </head>`);
      },
    },
  ],
  build: {
    target: "esnext",
    manifest: true,
    // `/assets/*` belongs to the shared Hostinger edge before a request reaches
    // Baseer's private Caddy route.  Keep every hashed Vite asset in Baseer's
    // own public namespace so the shell and its resources always travel
    // through the same reverse-proxy boundary.
    assetsDir: "baseer-static",
    minify: "terser",
    terserOptions: { compress: { passes: 3 }, format: { comments: false } },
  },
  server: {
    // Tailscale Serve is authenticated at the network edge and forwards its
    // tailnet host header unchanged. Permit that trusted reverse proxy.
    allowedHosts: true,
    // The externally viewed development instance must never leave a mobile
    // browser with an earlier UI module after a theme change.
    headers: { "Cache-Control": "no-store" },
    proxy: {
      "/v1": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});

var _a, _b, _c;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var apiProxyTarget = ((_a = process.env.BASEER_API_PROXY_TARGET) === null || _a === void 0 ? void 0 : _a.trim()) || "http://127.0.0.1:5200";
var releaseId = ((_b = process.env.BASEER_RELEASE_ID) === null || _b === void 0 ? void 0 : _b.trim()) || ((_c = process.env.GITHUB_SHA) === null || _c === void 0 ? void 0 : _c.trim()) || "development";
export default defineConfig({
    plugins: [
        react(),
        {
            name: "baseer-release-marker",
            transformIndexHtml: function (html) {
                return html.replace("</head>", "    <meta name=\"baseer-release-id\" content=\"".concat(releaseId, "\" />\n  </head>"));
            },
        },
    ],
    build: { target: "esnext", manifest: true, minify: "terser", terserOptions: { compress: { passes: 3 }, format: { comments: false } } },
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

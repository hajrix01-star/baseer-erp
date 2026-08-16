import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const assets = "apps/web/dist/assets";
const files = readdirSync(assets).map((name) => ({ name, size: statSync(join(assets, name)).size }));
const total = (extension) => files.filter((file) => file.name.endsWith(extension)).reduce((sum, file) => sum + file.size, 0);
// CSS is measured as the full shared application stylesheet; 55 KB funds the shared responsive period filter and leaves explicit headroom for central primitives, not per-page CSS.
const limits = { js: 300_000, css: 55_000 };
const sizes = { js: total(".js"), css: total(".css") };
for (const [kind, limit] of Object.entries(limits)) {
  if (sizes[kind] > limit) throw new Error(`Web ${kind.toUpperCase()} bundle is ${sizes[kind]} bytes; release limit is ${limit}.`);
}
console.log(`Web release budget verified (JS ${sizes.js} B / ${limits.js} B; CSS ${sizes.css} B / ${limits.css} B).`);
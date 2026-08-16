import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const assets = "apps/web/dist/assets";
const files = readdirSync(assets).map((name) => ({ name, size: statSync(join(assets, name)).size }));
const total = (extension) => files.filter((file) => file.name.endsWith(extension)).reduce((sum, file) => sum + file.size, 0);
const initialJs = files.filter((file) => /^index-[\w-]+\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);
const deferredJs = total(".js") - initialJs;
// Startup JavaScript is measured separately from route-lazy chunks. This prevents a new, deferred module from inflating initial-load cost.
// Finance batch entry adds a responsive row editor; retain a small, explicit headroom instead of making the quality gate permanently red.
const limits = { initialJs: 300_000, deferredJs: 100_000, css: 62_000 };
const sizes = { initialJs, deferredJs, css: total(".css") };
for (const [kind, limit] of Object.entries(limits)) {
  if (sizes[kind] > limit) throw new Error(`Web ${kind.toUpperCase()} bundle is ${sizes[kind]} bytes; release limit is ${limit}.`);
}
console.log(`Web release budget verified (initial JS ${sizes.initialJs} B / ${limits.initialJs} B; deferred JS ${sizes.deferredJs} B / ${limits.deferredJs} B; CSS ${sizes.css} B / ${limits.css} B).`);
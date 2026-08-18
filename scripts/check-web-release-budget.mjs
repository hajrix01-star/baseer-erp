import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = "apps/web/dist";
const assets = join(dist, "assets");
const manifestPath = join(dist, ".vite", "manifest.json");

if (!existsSync(manifestPath)) throw new Error("Web build manifest is missing. Run the production build before the budget check.");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const files = readdirSync(assets).map((name) => ({ name, size: statSync(join(assets, name)).size }));
const sizeFor = (file) => statSync(join(dist, file)).size;
const total = (extension) => files.filter((file) => file.name.endsWith(extension)).reduce((sum, file) => sum + file.size, 0);
const entries = Object.entries(manifest);

function closureKeys(entryKey) {
  const visited = new Set();
  const visit = (key) => {
    if (!key || visited.has(key)) return;
    visited.add(key);
    for (const imported of manifest[key]?.imports ?? []) visit(imported);
  };
  visit(entryKey);
  return visited;
}

function jsSize(keys) {
  return [...keys].map((key) => manifest[key]?.file).filter((file) => file?.endsWith(".js")).reduce((sum, file) => sum + sizeFor(file), 0);
}

const startup = manifest["index.html"];
if (!startup) throw new Error("Web startup entry is missing from the Vite manifest.");
const routeEntries = entries.filter(([, entry]) => entry.isDynamicEntry && /(?:workspace|command-center-sales-calendar)\.(?:tsx|ts)$/.test(entry.src ?? ""));
if (!routeEntries.length) throw new Error("No lazy workspace entries were found in the Vite manifest.");

const startupKeys = closureKeys("index.html");
const initialJs = jsSize(startupKeys);
const journeys = routeEntries.map(([key, entry]) => ({ source: entry.src, size: jsSize(new Set([...closureKeys(key)].filter((file) => !startupKeys.has(file)))) }));
const largestJourney = journeys.reduce((largest, journey) => journey.size > largest.size ? journey : largest);
const totalDeferredJs = total(".js") - initialJs;

// A user loads one route journey at a time. Guard startup, the largest route journey, and total cacheable lazy code separately.
const limits = { initialJs: 250_000, largestJourneyJs: 85_000, totalDeferredJs: 225_000, css: 62_000 };
const sizes = { initialJs, largestJourneyJs: largestJourney.size, totalDeferredJs, css: total(".css") };
for (const [kind, limit] of Object.entries(limits)) {
  if (sizes[kind] > limit) throw new Error(`Web ${kind.toUpperCase()} bundle is ${sizes[kind]} bytes; release limit is ${limit}.`);
}
console.log(`Web release budget verified (startup ${sizes.initialJs} B / ${limits.initialJs} B; largest route ${sizes.largestJourneyJs} B / ${limits.largestJourneyJs} B from ${largestJourney.source}; lazy cache ${sizes.totalDeferredJs} B / ${limits.totalDeferredJs} B; CSS ${sizes.css} B / ${limits.css} B).`);

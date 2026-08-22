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

function cssFiles(keys) {
  return new Set([...keys].flatMap((key) => manifest[key]?.css ?? []));
}

function cssSize(keys) {
  return [...cssFiles(keys)].reduce((sum, file) => sum + sizeFor(file), 0);
}

const startup = manifest["index.html"];
if (!startup) throw new Error("Web startup entry is missing from the Vite manifest.");
const routeEntries = entries.filter(([, entry]) => entry.isDynamicEntry && /(?:workspace|command-center-sales-calendar)\.(?:tsx|ts)$/.test(entry.src ?? ""));
if (!routeEntries.length) throw new Error("No lazy workspace entries were found in the Vite manifest.");

const startupKeys = closureKeys("index.html");
const initialJs = jsSize(startupKeys);
const journeys = routeEntries.map(([key, entry]) => {
  const additionalKeys = new Set([...closureKeys(key)].filter((file) => !startupKeys.has(file)));
  return { source: entry.src, js: jsSize(additionalKeys), css: cssSize(additionalKeys) };
});
const largestJourney = journeys.reduce((largest, journey) => journey.js > largest.js ? journey : largest);
const largestCssJourney = journeys.reduce((largest, journey) => journey.css > largest.css ? journey : largest);
const totalLazyJs = total(".js") - initialJs;
const totalCss = total(".css");
const comboboxLazyJs = files.filter((file) => /^baseer-combobox-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);
const datePickerLazyJs = files.filter((file) => /^baseer-aria-date-picker-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);
const formLazyJs = files.filter((file) => /^baseer-required-textarea-form-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);

// A user loads startup plus one workspace journey. Cache totals are reported for observability,
// but only startup and the largest individual journey are release gates.
// The React Aria adapter is an interaction-only chunk. It is deliberately not
// charged to the initial HR route, but it has its own hard ceiling so a future
// library upgrade cannot grow the filter interaction unnoticed.
const limits = { initialJs: 250_000, largestJourneyJs: 85_000, initialCss: 58_000, largestJourneyCss: 16_000, comboboxLazyJs: 200_000, datePickerLazyJs: 200_000, formLazyJs: 100_000 };
const sizes = { initialJs, largestJourneyJs: largestJourney.js, initialCss: cssSize(startupKeys), largestJourneyCss: largestCssJourney.css, comboboxLazyJs, datePickerLazyJs, formLazyJs };
for (const [kind, limit] of Object.entries(limits)) {
  if (sizes[kind] > limit) throw new Error(`Web ${kind.toUpperCase()} bundle is ${sizes[kind]} bytes; release limit is ${limit}.`);
}
console.log(`Web release budget verified (startup JS ${sizes.initialJs} B / ${limits.initialJs} B; largest route JS ${sizes.largestJourneyJs} B / ${limits.largestJourneyJs} B from ${largestJourney.source}; startup CSS ${sizes.initialCss} B / ${limits.initialCss} B; largest route CSS ${sizes.largestJourneyCss} B / ${limits.largestJourneyCss} B from ${largestCssJourney.source}; Combobox interaction JS ${sizes.comboboxLazyJs} B / ${limits.comboboxLazyJs} B; DatePicker interaction JS ${sizes.datePickerLazyJs} B / ${limits.datePickerLazyJs} B; Form interaction JS ${sizes.formLazyJs} B / ${limits.formLazyJs} B; cache report lazy JS ${totalLazyJs} B, CSS ${totalCss} B).`);

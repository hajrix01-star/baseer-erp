import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const sourceRoot = resolve("apps/web/src");
const walk = (directory) => readdirSync(directory).flatMap((entry) => {
  const path = resolve(directory, entry);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
});
const files = walk(sourceRoot).map((path) => ({ path: relative(process.cwd(), path).replaceAll("\\", "/"), source: readFileSync(path, "utf8") }));

const nativeSelectCentralComponents = new Set([
  "apps/web/src/baseer-filter-controls.tsx",
  "apps/web/src/baseer-period-filter.tsx",
  "apps/web/src/baseer-static-select.tsx",
]);
const nativeButtonCentralComponents = new Set([
  "apps/web/src/baseer-button.tsx",
  "apps/web/src/baseer-combobox.tsx",
  "apps/web/src/baseer-data-grid.tsx",
]);

const categories = [
  ["Raw buttons", /<button\b/g],
  ["Raw selects", /<select\b/g],
  ["Raw inputs", /<input\b/g],
  ["Raw textareas", /<textarea\b/g],
  ["Raw tables", /<table\b/g],
  ["BaseerButton", /<BaseerButton\b/g],
  ["BaseerCard", /<BaseerCard\b/g],
  ["BaseerDialog", /<BaseerDialog\b/g],
  ["BaseerFormDialog", /<BaseerFormDialog\b/g],
  ["BaseerDataGrid / DataTable", /<(?:BaseerDataGrid|DataTable)\b/g],
  ["BaseerFilterBar", /<BaseerFilterBar\b/g],
  ["BaseerFilterSelect", /<BaseerFilterSelect\b/g],
  ["BaseerStaticSelect", /<BaseerStaticSelect\b/g],
  ["BaseerIntegerInput", /<BaseerIntegerInput\b/g],
  ["BaseerTextInput", /<BaseerTextInput\b/g],
  ["BaseerMonthPicker", /<BaseerMonthPicker\b/g],
  ["BaseerCheckbox", /<BaseerCheckbox\b/g],
  ["BaseerTextArea", /<BaseerTextArea\b/g],
  ["BaseerFileInput", /<BaseerFileInput\b/g],
  ["BaseerCombobox / BaseerSelect", /<(?:BaseerCombobox|BaseerSelect)\b/g],
  ["Legacy dialog contract", /daily-sales-dialog/g],
];

const count = (source, pattern) => [...source.matchAll(pattern)].length;
const has = (source, pattern) => { pattern.lastIndex = 0; const result = pattern.test(source); pattern.lastIndex = 0; return result; };
const rawInputs = files.flatMap((file) => [...file.source.matchAll(/<input\b[^>]*>/g)].map((match) => ({ path: file.path, tag: match[0] })));
const inputType = (tag) => {
  const match = tag.match(/\btype\s*=\s*["']([^"']+)["']/i);
  return match?.[1].toLowerCase() ?? "text/default";
};
const inputTypeInventory = [...new Set(rawInputs.map(({ tag }) => inputType(tag)))].sort().map((type) => ({
  type,
  occurrences: rawInputs.filter((input) => inputType(input.tag) === type).length,
  files: new Set(rawInputs.filter((input) => inputType(input.tag) === type).map((input) => input.path)).size,
}));
const inputTypeCandidates = inputTypeInventory.map(({ type }) => ({
  type,
  files: [...new Set(rawInputs.filter((input) => inputType(input.tag) === type).map((input) => input.path))],
}));
const inventory = categories.map(([name, pattern]) => ({
  element: name,
  occurrences: files.reduce((total, file) => total + count(file.source, pattern), 0),
  files: files.filter((file) => has(file.source, pattern)).length,
}));
const candidates = [
  ["Native button review", /<button\b/g, (file) => !nativeButtonCentralComponents.has(file.path)],
  ["Native select review", /<select\b/g, (file) => !nativeSelectCentralComponents.has(file.path)],
  ["Native table review", /<table\b/g],
  ["Legacy dialog review", /daily-sales-dialog/g],
].map(([name, pattern, include = () => true]) => ({ category: name, files: files.filter((file) => include(file) && has(file.source, pattern)).map((file) => file.path) }));

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ sourceFiles: files.length, inventory, inputTypeInventory, inputTypeCandidates, candidates }, null, 2)}\n`);
} else {
  console.log(`Baseer UI component inventory · ${files.length} TSX files`);
  console.table(inventory);
  console.log("\nRaw input types");
  console.table(inputTypeInventory);
  for (const candidate of inputTypeCandidates) {
    console.log(`\nRaw input review · ${candidate.type} (${candidate.files.length} files)`);
    for (const file of candidate.files) console.log(`- ${file}`);
  }
  for (const candidate of candidates) {
    console.log(`\n${candidate.category} (${candidate.files.length} files)`);
    for (const file of candidate.files) console.log(`- ${file}`);
  }
  console.log("\nCounts identify review candidates only. A specialized report, chart, or line editor is not a migration target unless its behavior can be preserved by a central pattern.");
}

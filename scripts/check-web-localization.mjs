import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "apps", "web", "src");
const copyFiles = ["app-copy.ts", "baseer-ui-copy.ts", "administration-copy.ts", "daily-sales-copy.ts", "finance-copy.ts"];
const arabic = /[\u0600-\u06ff]/u;
const jsxText = />([^<{]*[\u0600-\u06ff][^<{]*)</gu;
const textAttribute = /(?:aria-label|placeholder|title|alt)=(?:"([^"\n]*[\u0600-\u06ff][^"\n]*)"|'([^'\n]*[\u0600-\u06ff][^'\n]*)')/gu;

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

const failures = [];
for (const copyFile of copyFiles) {
  const source = readFileSync(join(root, copyFile), "utf8");
  if (!source.includes("defineLocalizedCopy")) failures.push(`${copyFile}: must use defineLocalizedCopy().`);
}
for (const file of files(root).filter((candidate) => candidate.endsWith(".tsx"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(jsxText)) failures.push(`${file}: visible Arabic JSX text must come from a copy dictionary: ${match[1].trim()}`);
  for (const match of source.matchAll(textAttribute)) failures.push(`${file}: visible Arabic attribute must come from a copy dictionary: ${(match[1] ?? match[2]).trim()}`);
}
if (failures.length) {
  console.error("Web localization guard failed:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(`Web localization guard passed: ${copyFiles.length} typed dictionaries and no direct visible Arabic JSX literals.`);

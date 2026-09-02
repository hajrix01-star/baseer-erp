import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = "apps/web/src";
const allowedBaseDefinition = new Set(["daily-sales-client.ts"]);

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collect(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const violations = collect(root).flatMap((file) => {
  const normalized = relative(root, file).replaceAll("\\", "/");
  if (allowedBaseDefinition.has(normalized)) return [];
  return /["'`]\/v1(?:\/|["'`])/.test(readFileSync(file, "utf8"))
    ? [normalized]
    : [];
});

if (violations.length) {
  console.error(`Hard-coded API base path outside the central transport: ${violations.join(", ")}`);
  process.exit(1);
}

console.log("PASS: web API base paths use the central transport.");

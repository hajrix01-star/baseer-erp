import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const repositoryRoot = process.cwd();
const sourceRoot = resolve(repositoryRoot, "apps/web/src");
const manifestPath = resolve(repositoryRoot, "docs/ui-parity/modern-theme-literal-manifest.json");
const extensions = new Set([".css", ".ts", ".tsx"]);
const literalPattern = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/giu;

function fail(message) {
  console.error(`Modern theme literal gate failed: ${message}`);
  process.exitCode = 1;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : extensions.has(path.slice(path.lastIndexOf("."))) ? [path] : [];
  });
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function lineAndColumn(source, index) {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

function lineAt(source, index) {
  const start = source.lastIndexOf("\n", index) + 1;
  const end = source.indexOf("\n", index);
  return source.slice(start, end < 0 ? source.length : end);
}

function readManifest() {
  if (!existsSync(manifestPath)) throw new Error(`missing ${repositoryPath(manifestPath)}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.classifications) || !Array.isArray(manifest.productSwatches)) {
    throw new Error("manifest must declare schemaVersion 1 plus classifications and productSwatches arrays");
  }
  const classificationIds = new Set(manifest.classifications.map((entry) => entry.id));
  for (const entry of manifest.classifications) {
    if (typeof entry.id !== "string" || typeof entry.role !== "string" || typeof entry.owner !== "string" || typeof entry.rationale !== "string") {
      throw new Error("each manifest classification needs id, role, owner, and rationale");
    }
  }
  for (const entry of manifest.productSwatches) {
    if (typeof entry.literal !== "string" || !/^#[\da-f]{3,8}$/iu.test(entry.literal) || typeof entry.contextPattern !== "string" || typeof entry.role !== "string" || typeof entry.owner !== "string" || typeof entry.rationale !== "string") {
      throw new Error("each product swatch needs literal, contextPattern, role, owner, and rationale");
    }
    if (!classificationIds.has("product-swatch")) throw new Error("manifest needs a product-swatch classification");
  }
  return manifest;
}

function classify({ path, line, literal }, manifest) {
  const lowerLiteral = literal.toLowerCase();
  const product = manifest.productSwatches.find((entry) => entry.literal.toLowerCase() === lowerLiteral && new RegExp(entry.contextPattern, "u").test(line));
  if (product) return { kind: "product-swatch", manifestId: product.literal.toLowerCase() };
  if (path.endsWith(".css") && /--[\w-]+\s*:\s*$/u.test(line.slice(0, line.indexOf(literal)))) {
    return { kind: "semantic-token", manifestId: "semantic-token" };
  }
  return { kind: "unclassified", manifestId: null };
}

function inventory(manifest) {
  return walk(sourceRoot).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(literalPattern)].map((match) => {
      const literal = match[0];
      const index = match.index ?? 0;
      const line = lineAt(source, index);
      return {
        path: repositoryPath(path),
        ...lineAndColumn(source, index),
        literal: literal.toLowerCase(),
        context: line.trim(),
        ...classify({ path: repositoryPath(path), line, literal }, manifest),
      };
    });
  });
}

function changedLiteralLocations() {
  const diff = execFileSync("git", ["diff", "--unified=0", "HEAD", "--", "apps/web/src"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const locations = new Set();
  let currentPath = null;
  let nextLine = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) currentPath = line.slice(6);
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) { nextLine = Number(hunk[1]); continue; }
    if (nextLine === null || !currentPath || line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      for (const match of line.slice(1).matchAll(literalPattern)) locations.add(`${currentPath}:${nextLine}:${(match.index ?? 0) + 1}`);
      nextLine += 1;
    } else if (!line.startsWith("-")) nextLine += 1;
  }
  return locations;
}

function selfTest() {
  const manifest = { productSwatches: [{ literal: "#526d87", contextPattern: "label" }] };
  const token = classify({ path: "sample.css", line: "  --brand: #0b8060;", literal: "#0b8060" }, manifest);
  const swatch = classify({ path: "sample.tsx", line: 'const label = "#526d87";', literal: "#526d87" }, manifest);
  const leak = classify({ path: "sample.css", line: ".card { color: #0b8060; }", literal: "#0b8060" }, manifest);
  if (token.kind !== "semantic-token" || swatch.kind !== "product-swatch" || leak.kind !== "unclassified") throw new Error("classification fixture did not enforce the literal policy");
  console.log("Modern theme literal scanner self-test passed.");
}

try {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const manifest = readManifest();
    const records = inventory(manifest);
    const totals = Object.groupBy(records, ({ kind }) => kind);
    const summary = {
      total: records.length,
      semanticToken: totals["semantic-token"]?.length ?? 0,
      productSwatch: totals["product-swatch"]?.length ?? 0,
      unclassified: totals.unclassified?.length ?? 0,
      files: new Set(records.map(({ path }) => path)).size,
    };
    if (process.argv.includes("--json")) console.log(JSON.stringify({ summary, records }, null, 2));
    else console.log(`Modern theme literal inventory: ${summary.total} literals in ${summary.files} files (${summary.semanticToken} semantic-token, ${summary.productSwatch} product-swatch, ${summary.unclassified} unclassified).`);
    if (process.argv.includes("--check-new")) {
      const changed = changedLiteralLocations();
      const newUnclassified = records.filter((record) => record.kind === "unclassified" && changed.has(`${record.path}:${record.line}:${record.column}`));
      if (newUnclassified.length) fail(`new unclassified literals require a semantic token or reviewed product-swatch manifest entry:\n${newUnclassified.map((record) => `${record.path}:${record.line}:${record.column} ${record.literal} — ${record.context}`).join("\n")}`);
      else console.log("Modern theme literal ratchet passed: no new unclassified literals.");
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

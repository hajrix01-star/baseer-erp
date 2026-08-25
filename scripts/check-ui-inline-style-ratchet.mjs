import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import postcss from "postcss";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = resolve(root, "apps/web/src");
const ratchetPath = "docs/governance/UI_INLINE_STYLE_RATCHET.json";

function walk(directory, extension) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory()
      ? walk(path, extension)
      : path.endsWith(extension) ? [path] : [];
  });
}

function repoPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function unwrapped(expression) {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isOverlayToken(expression) {
  const current = unwrapped(expression);
  return ts.isPropertyAccessExpression(current)
    && ts.isIdentifier(current.expression)
    && current.expression.text === "BASEER_OVERLAY_LAYER";
}

function propertyName(property) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return null;
}

function inspectTsx(path) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let styleAttributes = 0;
  let legacyZIndex = 0;
  let namedOverlayZIndex = 0;

  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === "style") styleAttributes += 1;
    if (ts.isPropertyAssignment(node) && propertyName(node) === "zIndex") {
      if (isOverlayToken(node.initializer)) namedOverlayZIndex += 1;
      else legacyZIndex += 1;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { styleAttributes, legacyZIndex, namedOverlayZIndex };
}

function inspectCss(path) {
  const rootNode = postcss.parse(readFileSync(path, "utf8"), { from: path });
  let zIndexDeclarations = 0;
  rootNode.walkDecls((declaration) => {
    if (declaration.prop.toLowerCase() === "z-index") zIndexDeclarations += 1;
  });
  return { zIndexDeclarations };
}

function currentBaseline() {
  const tsx = Object.fromEntries(
    walk(sourceRoot, ".tsx")
      .map((path) => [repoPath(path), inspectTsx(path)])
      .filter(([, values]) => values.styleAttributes || values.legacyZIndex || values.namedOverlayZIndex),
  );
  const css = Object.fromEntries(
    walk(sourceRoot, ".css")
      .map((path) => [repoPath(path), inspectCss(path)])
      .filter(([, values]) => values.zIndexDeclarations),
  );
  return { tsx, css };
}

function fail(message) {
  console.error(`UI inline-style ratchet failed: ${message}`);
  process.exitCode = 1;
}

if (process.argv.includes("--print-baseline")) {
  console.log(JSON.stringify(currentBaseline(), null, 2));
  process.exit(0);
}

if (!existsSync(resolve(root, ratchetPath))) {
  fail(`missing ${ratchetPath}; create a reviewed baseline with node scripts/check-ui-inline-style-ratchet.mjs --print-baseline.`);
  process.exit(1);
}

let ratchet;
try {
  ratchet = JSON.parse(readFileSync(resolve(root, ratchetPath), "utf8"));
} catch (error) {
  fail(`cannot parse ${ratchetPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (ratchet.schemaVersion !== 1 || !ratchet.tsx || !ratchet.css || typeof ratchet.tsx !== "object" || typeof ratchet.css !== "object") {
  fail(`${ratchetPath} must define schemaVersion 1 plus tsx and css cap maps.`);
  process.exit(1);
}

const actual = currentBaseline();
const compareCaps = (kind, records, expectedFields) => {
  for (const [path, values] of Object.entries(records)) {
    const cap = ratchet[kind][path];
    if (!cap) {
      fail(`${path} introduces governed inline visual styling or z-index without a reviewed ratchet entry.`);
      continue;
    }
    for (const field of expectedFields) {
      if (!Number.isInteger(cap[field]) || cap[field] < 0) {
        fail(`${ratchetPath}.${kind}[${JSON.stringify(path)}].${field} must be a non-negative integer.`);
      } else if (values[field] > cap[field]) {
        fail(`${path} has ${values[field]} ${field}; its reviewed ceiling is ${cap[field]}. Move presentation to a central CSS/token contract or update the ratchet with a UI-ADR.`);
      }
    }
  }
};

compareCaps("tsx", actual.tsx, ["styleAttributes", "legacyZIndex", "namedOverlayZIndex"]);
compareCaps("css", actual.css, ["zIndexDeclarations"]);

for (const [path, cap] of Object.entries(ratchet.tsx)) {
  if (!actual.tsx[path] && (!Number.isInteger(cap.styleAttributes) || !Number.isInteger(cap.legacyZIndex) || !Number.isInteger(cap.namedOverlayZIndex))) {
    fail(`${ratchetPath}.tsx[${JSON.stringify(path)}] has an invalid dormant cap.`);
  }
}
for (const [path, cap] of Object.entries(ratchet.css)) {
  if (!actual.css[path] && !Number.isInteger(cap.zIndexDeclarations)) {
    fail(`${ratchetPath}.css[${JSON.stringify(path)}] has an invalid dormant cap.`);
  }
}

if (!process.exitCode) {
  const totals = {
    styleAttributes: Object.values(actual.tsx).reduce((total, values) => total + values.styleAttributes, 0),
    legacyZIndex: Object.values(actual.tsx).reduce((total, values) => total + values.legacyZIndex, 0),
    namedOverlayZIndex: Object.values(actual.tsx).reduce((total, values) => total + values.namedOverlayZIndex, 0),
    cssZIndexDeclarations: Object.values(actual.css).reduce((total, values) => total + values.zIndexDeclarations, 0),
  };
  console.log(`UI inline-style ratchet verified (${totals.styleAttributes} JSX style attributes; ${totals.legacyZIndex} legacy and ${totals.namedOverlayZIndex} named JSX z-index declarations; ${totals.cssZIndexDeclarations} CSS z-index declarations).`);
}

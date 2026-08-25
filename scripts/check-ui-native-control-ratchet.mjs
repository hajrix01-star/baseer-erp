import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const sourceRoot = resolve("apps/web/src");
const ratchetPath = "docs/governance/UI_NATIVE_CONTROL_RATCHET.json";
const registryPath = "docs/governance/UI_COMPONENT_REGISTRY.json";
const root = process.cwd();

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

function fail(message) {
  console.error(`UI native-control ratchet failed: ${message}`);
  process.exitCode = 1;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    fail(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function countNativeControls(file, controls) {
  const source = readFileSync(file, "utf8");
  const counts = Object.fromEntries(controls.map((control) => [control, 0]));
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (Object.hasOwn(counts, tag)) counts[tag] += 1;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return counts;
}

const ratchet = readJson(ratchetPath);
const registry = readJson(registryPath);
if (!ratchet || !registry) process.exit(1);

const controls = ratchet.controls;
if (ratchet.schemaVersion !== 1 || !Array.isArray(controls) || controls.length === 0 || controls.some((control) => typeof control !== "string" || !control)) {
  fail(`${ratchetPath} must have schemaVersion 1 and a non-empty controls array.`);
} else if (!ratchet.sourceCaps || typeof ratchet.sourceCaps !== "object" || Array.isArray(ratchet.sourceCaps)) {
  fail(`${ratchetPath}.sourceCaps must be an object.`);
} else {
  const totals = Object.fromEntries(controls.map((control) => [control, 0]));
  const registeredInteractiveSources = new Set(
    Array.isArray(registry.components)
      ? registry.components
        .filter((component) => component?.lifecycle !== "planned")
        .flatMap((component) => [component.source, ...(Array.isArray(component.implementationSources) ? component.implementationSources : [])])
        .filter((source) => typeof source === "string")
      : [],
  );
  let registeredUncappedSources = 0;

  for (const [path, caps] of Object.entries(ratchet.sourceCaps)) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || !path.startsWith("apps/web/src/") || !path.endsWith(".tsx")) {
      fail(`${ratchetPath}.sourceCaps contains an invalid source path: ${path}`);
      continue;
    }
    if (!Array.isArray(caps) || caps.length !== controls.length || caps.some((cap) => !Number.isInteger(cap) || cap < 0)) {
      fail(`${ratchetPath}.sourceCaps[${JSON.stringify(path)}] must be ${controls.length} non-negative integer caps in controls order.`);
    }
  }

  for (const file of walk(sourceRoot)) {
    const path = relative(root, file).replaceAll("\\", "/");
    const actual = countNativeControls(file, controls);
    const hasControls = controls.some((control) => actual[control] > 0);
    if (!hasControls) continue;
    const caps = ratchet.sourceCaps[path];
    if (!caps) {
      if (registeredInteractiveSources.has(path)) {
        registeredUncappedSources += 1;
        controls.forEach((control) => { totals[control] += actual[control]; });
        continue;
      }
      fail(`${path} introduces raw native interactive controls without a ratchet entry. Use a registered Baseer primitive/pattern, or add a reviewed UI-ADR and a capped migration entry.`);
      continue;
    }
    controls.forEach((control, index) => {
      totals[control] += actual[control];
      if (actual[control] > caps[index]) {
        fail(`${path} has ${actual[control]} raw <${control}> elements; its migration ceiling is ${caps[index]}. Replace the new control with a registered contract, or obtain a reviewed UI-ADR before changing the cap.`);
      }
    });
  }

  // A removed source is a successful migration. Its dormant cap stays visible until
  // the register is deliberately tightened, so a later reintroduction still fails.
  if (!process.exitCode) {
    console.log(`UI native-control ratchet verified (${Object.values(totals).reduce((total, value) => total + value, 0)} raw controls across ${Object.keys(ratchet.sourceCaps).length} capped source files and ${registeredUncappedSources} registered implementations; decreases only outside a registered contract).`);
  }
}

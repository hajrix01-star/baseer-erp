import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const contractPath = resolve(root, "docs/ui-parity/card-container-variant-contract.json");
const layoutPath = resolve(root, "apps/web/src/baseer-modern-theme-layouts.css");
const foundationPath = resolve(root, "apps/web/src/workspace-foundation.css");
const stylesPath = resolve(root, "apps/web/src/styles.css");

function fail(message) {
  console.error(`Modern theme variant contract failed: ${message}`);
  process.exitCode = 1;
}

function text(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return readFileSync(path, "utf8");
}

try {
  const contract = JSON.parse(text(contractPath));
  if (contract.schemaVersion !== 1 || !Array.isArray(contract.variants) || !Array.isArray(contract.exceptions)) {
    throw new Error("contract must declare schemaVersion 1 plus variants and exceptions arrays");
  }
  const matrix = contract.acceptanceMatrix;
  for (const required of ["presentations", "viewports", "directions", "appearances"]) {
    if (!Array.isArray(matrix?.[required]) || matrix[required].length === 0) fail(`acceptanceMatrix.${required} must be a non-empty array`);
  }
  for (const presentation of ["modern-1", "modern-2"]) {
    if (!matrix.presentations.includes(presentation)) fail(`acceptance matrix must include ${presentation}`);
  }
  for (const viewport of ["desktop-chromium", "mobile-chromium"]) {
    if (!matrix.viewports.includes(viewport)) fail(`acceptance matrix must include ${viewport}`);
  }
  if (!matrix.directions.includes("rtl") || !matrix.appearances.includes("dark")) fail("acceptance matrix must include RTL and dark");

  const css = [text(layoutPath), text(foundationPath), text(stylesPath)].join("\n");
  const ids = new Set();
  let measured = 0;
  let pending = 0;
  for (const variant of contract.variants) {
    for (const field of ["id", "role", "centralUsage", "referenceArchetype", "owner"]) {
      if (typeof variant[field] !== "string" || variant[field].trim() === "") fail(`variant needs ${field}`);
    }
    if (ids.has(variant.id)) fail(`duplicate variant id ${variant.id}`);
    ids.add(variant.id);
    if (!Array.isArray(variant.selectors) || variant.selectors.length === 0) fail(`${variant.id} needs central selectors`);
    for (const selector of variant.selectors) {
      if (typeof selector !== "string" || !css.includes(selector)) fail(`${variant.id} selector ${selector} is not found in central CSS`);
    }
    const evidence = variant.evidence;
    if (!evidence || !["measured", "partial", "pending"].includes(evidence.status)) fail(`${variant.id} needs an evidence status`);
    if (evidence.status === "measured") {
      if (typeof evidence.test !== "string" || !existsSync(resolve(root, evidence.test))) fail(`${variant.id} marks measured evidence but its test is missing`);
      measured += 1;
    } else pending += 1;
  }
  for (const exception of contract.exceptions) {
    for (const field of ["id", "scope", "owner", "rationale", "evidenceStatus"]) {
      if (typeof exception[field] !== "string" || exception[field].trim() === "") fail(`exception needs ${field}`);
    }
  }
  const layout = text(layoutPath);
  for (const presentation of ["modern-1", "modern-2"]) {
    if (!layout.includes(`body[data-ui-theme="${presentation}"]`)) fail(`presentation layout is missing ${presentation}`);
  }
  console.log(`Modern theme variant contract verified: ${contract.variants.length} central variants (${measured} measured, ${pending} partial/pending); ${contract.exceptions.length} explicit domain exceptions. This is a governance check, not full visual acceptance.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

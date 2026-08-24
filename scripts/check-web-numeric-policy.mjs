import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Presentation-number policy gate.
 *
 * UI code must use the Baseer formatters in `number-format.ts`; localized
 * `Intl`/`toLocale*` calls are not permitted in screen components. Native
 * decimal/numeric inputs must remain LTR and normalise Arabic/Persian digits
 * through the shared normaliser before they reach application state.
 *
 * `toFixed` is deliberately not a general presentation tool. The very small
 * allow-list below is limited to Decimal-string calculations that are sent to
 * an API/preview; any new use fails this gate and must be reviewed.
 */
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repositoryRoot, "apps", "web", "src");
const FORMATTER_IMPLEMENTATION = join(sourceRoot, "number-format.ts");
const DATE_CALCULATION_UTILITIES = new Set([
  join(sourceRoot, "baseer-period-values.ts"),
  join(sourceRoot, "daily-sales-client.ts"),
]);
const CALCULATION_ONLY_TO_FIXED = new Map([
  [join(sourceRoot, "hr-payroll-create-dialog.tsx"), new Set([126])],
  [join(sourceRoot, "operations-recipe-editor.tsx"), new Set([77, 80, 81])],
]);
// These are controlled legacy identity/policy fields. Their values are still
// normalised centrally by their enclosing form logic; the exact indexes make
// this a reviewable, non-expandable exception rather than a file-wide bypass.
const CENTRALLY_MANAGED_NUMERIC_INPUTS = new Map([
  [join(sourceRoot, "decision-intelligence-workspace-content.tsx"), new Set([0, 1, 2, 3, 4])],
  [join(sourceRoot, "hr-employee-onboarding-dialog.tsx"), new Set([0])],
  [join(sourceRoot, "hr-workspace-content.tsx"), new Set([0])],
]);

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? listFiles(join(directory, entry.name))
    : [join(directory, entry.name)]);
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function relative(file) {
  return file.slice(repositoryRoot.length + 1).replaceAll("\\", "/");
}

function findInputEnd(source, start) {
  let braces = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") braces += 1;
    else if (character === "}") braces = Math.max(0, braces - 1);
    else if (character === ">" && braces === 0) return index + 1;
  }
  return -1;
}

function numericInputs(source) {
  const inputs = [];
  for (let start = source.indexOf("<input"); start >= 0; start = source.indexOf("<input", start + 6)) {
    const end = findInputEnd(source, start);
    if (end < 0) break;
    const tag = source.slice(start, end);
    if (/\btype\s*=\s*["']number["']|\binputMode\s*=\s*["'](?:decimal|numeric)["']/.test(tag)) {
      inputs.push({ tag, offset: start });
    }
  }
  return inputs;
}

const failures = [];
for (const file of listFiles(sourceRoot).filter((candidate) => [".ts", ".tsx"].includes(extname(candidate)))) {
  const source = readFileSync(file, "utf8");
  const isFormatter = file === FORMATTER_IMPLEMENTATION;
  const isDateCalculationUtility = DATE_CALCULATION_UTILITIES.has(file);
  const visibleFormatter = /\bIntl\.(?:NumberFormat|DateTimeFormat)\b|\.toLocale(?:String|DateString|TimeString)\s*\(/gu;
  if (!isFormatter && !isDateCalculationUtility) {
    for (const match of source.matchAll(visibleFormatter)) {
      failures.push(`${relative(file)}:${lineNumber(source, match.index)} must use the central number/date formatter, not ${match[0]}.`);
    }
  }
  for (const match of source.matchAll(/\.toFixed\s*\(/gu)) {
    const line = lineNumber(source, match.index);
    if (!CALCULATION_ONLY_TO_FIXED.get(file)?.has(line)) {
      failures.push(`${relative(file)}:${line} must use a central display formatter; toFixed() is calculation-only and needs an explicit reviewed allow-list entry.`);
    }
  }
  for (const [inputIndex, input] of numericInputs(source).entries()) {
    const line = lineNumber(source, input.offset);
    const centrallyManaged = CENTRALLY_MANAGED_NUMERIC_INPUTS.get(file)?.has(inputIndex) ?? false;
    if (!centrallyManaged && !/\bdir\s*=\s*["']ltr["']/.test(input.tag)) {
      failures.push(`${relative(file)}:${line} numeric input must declare dir="ltr".`);
    }
    if (!centrallyManaged && !/normalizeBaseer(?:NumericInput|Amount)\s*\(/.test(input.tag)) {
      failures.push(`${relative(file)}:${line} numeric input must normalize through normalizeBaseerNumericInput() or normalizeBaseerAmount().`);
    }
  }
}

if (failures.length) {
  console.error(`Web numeric policy gate failed (${failures.length}):\n${failures.join("\n")}`);
  process.exit(1);
}

console.log("Web numeric policy gate passed: formatting and numeric inputs use Baseer standards.");

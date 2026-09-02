import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const sourceRoot = 'apps/web/src';
const manifestPath = 'docs/governance/LIBRARY_MIGRATION_MANIFEST.json';
const writeManifest = process.argv.includes('--write');
const collect = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? collect(join(directory, entry.name)) : entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []);
const files = collect(sourceRoot);
const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const matches = (pattern) => files.filter((file) => pattern.test(contents.get(file)));
const display = (file) => relative(sourceRoot, file).replaceAll('\\', '/');
const targetsFor = (kind, pattern) => matches(pattern).map((file) => ({ id: `${kind}:${display(file)}`, kind, file: display(file) }));

const targetEntries = [
  ...targetsFor('form', /<form\b|BaseerValidatedForm/),
  ...targetsFor('searchable-selector', /BaseerSearchSelect|BaseerCombobox|BaseerSelect/),
  ...targetsFor('editable-date', /BaseerDatePicker|BaseerAriaDatePicker/),
  ...targetsFor('table', /DataTable|BaseerDataGrid|data-baseer-report-table/),
  ...targetsFor('query', /useQuery|useMutation|BaseerCompanyReadQuery/),
  // A chart target is either the central public component or a prohibited
  // direct library import. Theme/output helpers are implementation details,
  // not parallel chart integrations.
  ...targetsFor('chart', /BaseerChart\b|from ["']echarts(?:\/|["'])/),
].sort((left, right) => left.id.localeCompare(right.id));

// Classifications are reviewed decisions, not generated data.  Preserve them
// when refreshing the inventory so that adding one discovered target cannot
// silently reset already-approved module closure decisions to "pending".
const existingManifestForWrite = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const existingTargetDecisions = existingManifestForWrite?.targets ?? {};
const legacyRuntimeTargetIds = (entry) => entry.file.endsWith('-runtime.tsx')
  ? [`${entry.kind}:${entry.file.replace(/-runtime\.tsx$/, '.tsx')}`]
  : [];
const reviewedDecisionFor = (entry) => {
  const direct = existingTargetDecisions[entry.id]?.decision;
  if (direct) return direct;
  // Runtime facades replaced an identically named former workspace. Carry
  // forward only that exact, reviewed decision; a renamed or newly discovered
  // file remains unclassified for a human decision.
  return legacyRuntimeTargetIds(entry)
    .map((id) => existingTargetDecisions[id]?.decision)
    .find(Boolean)
    ?? defaultDecision(entry);
};

const inventory = {
  manifestVersion: 1,
  sourceRoot,
  totals: {
    files: files.length,
    forms: targetsFor('form', /<form\b|BaseerValidatedForm/).length,
    formLibraryConsumers: matches(/react-hook-form|zodResolver/).length,
    searchableSelectors: targetsFor('searchable-selector', /BaseerSearchSelect|BaseerCombobox|BaseerSelect/).length,
    editableDates: targetsFor('editable-date', /BaseerDatePicker|BaseerAriaDatePicker/).length,
    tables: targetsFor('table', /DataTable|BaseerDataGrid|data-baseer-report-table/).length,
    queries: targetsFor('query', /useQuery|useMutation|BaseerCompanyReadQuery/).length,
    charts: targetsFor('chart', /BaseerChart|echarts/).length,
  },
  targets: targetEntries,
};

const libraryPolicies = [
  ['react-aria-components', new Set(['baseer-combobox.tsx', 'baseer-aria-date-picker.tsx'])],
  ['@tanstack/react-query', new Set(['baseer-company-read-query.tsx'])],
  ['@tanstack/react-table', new Set(['baseer-data-grid.tsx'])],
  ['echarts', new Set(['baseer-chart.tsx'])],
  ['react-hook-form', new Set(['baseer-form-state.ts', 'baseer-validated-form.tsx'])],
  ['@hookform/resolvers/zod', new Set(['baseer-form-state.ts'])],
  ['zod', new Set(['baseer-form-state.ts', 'baseer-validated-form.tsx'])],
];
const directLibraryImports = libraryPolicies.flatMap(([library, allowed]) => {
  const escaped = library.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return matches(new RegExp(`from ["']${escaped}(?:/[^"']+)?["']`)).filter((file) => !allowed.has(file.split(/[\\/]/).at(-1))).map((file) => `${library} -> ${display(file)}`);
});

const defaultDecision = (entry) => entry.file.startsWith('baseer-') ? 'central-adapter' : 'pending-module-closure';
const generatedManifest = {
  manifestVersion: 1,
  generatedBy: 'scripts/check-library-migration-inventory.mjs',
  targets: Object.fromEntries(targetEntries.map((entry) => [entry.id, {
    kind: entry.kind,
    file: entry.file,
    decision: reviewedDecisionFor(entry),
  }])),
};

if (writeManifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(generatedManifest, null, 2)}\n`);
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const manifestTargets = manifest?.targets ?? {};
const targetIds = new Set(targetEntries.map((entry) => entry.id));
const unclassified = targetEntries.filter((entry) => !manifestTargets[entry.id]).map((entry) => entry.id);
const legacyRuntimeIds = new Set(targetEntries.flatMap(legacyRuntimeTargetIds));
const staleManifestTargets = Object.keys(manifestTargets).filter((id) => !targetIds.has(id) && !legacyRuntimeIds.has(id));
const pendingModuleClosures = Object.entries(manifestTargets)
  .filter(([id, entry]) => targetIds.has(id) && entry.decision === 'pending-module-closure')
  .map(([id]) => id);

if (directLibraryImports.length || !manifest || unclassified.length || staleManifestTargets.length || pendingModuleClosures.length) {
  if (directLibraryImports.length) console.error(`Library architecture violation(s): ${directLibraryImports.join(', ')}`);
  if (!manifest) console.error(`Missing library migration manifest: ${manifestPath}. Run this command with --write and review the result.`);
  if (unclassified.length) console.error(`Unclassified migration target(s): ${unclassified.join(', ')}`);
  if (staleManifestTargets.length) console.error(`Stale migration manifest target(s): ${staleManifestTargets.join(', ')}`);
  if (pendingModuleClosures.length) console.error(`Pending module closure decision(s): ${pendingModuleClosures.join(', ')}`);
  process.exit(1);
}

console.log(JSON.stringify({
  manifestVersion: inventory.manifestVersion,
  sourceRoot: inventory.sourceRoot,
  totals: inventory.totals,
  unclassified: 0,
  staleManifestTargets: 0,
}, null, 2));

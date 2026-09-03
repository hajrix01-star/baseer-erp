import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDirectory = resolve(import.meta.dirname, '..');
const baselinePath = resolve(import.meta.dirname, 'dead-code-files-baseline.json');
const knipCliPath = resolve(rootDirectory, 'node_modules', 'knip', 'bin', 'knip.js');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const allowedFiles = new Set(baseline.allowedFiles);

function findUnusedFiles(workspace) {
  const result = spawnSync(
    process.execPath,
    [
      knipCliPath,
      '--config',
      'knip.json',
      '--workspace',
      workspace,
      '--include',
      'files',
      '--no-exit-code',
      '--reporter',
      'json',
    ],
    { cwd: rootDirectory, encoding: 'utf8' },
  );

  if (result.error || result.status !== 0 || result.stderr.trim()) {
    const detail = result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`;
    throw new Error(`Knip failed for ${workspace}: ${detail}`);
  }

  const report = JSON.parse(result.stdout || '{"issues":[]}');
  return report.issues.flatMap((issue) => issue.files?.map(({ name }) => name) ?? []);
}

const observedFiles = [...new Set(baseline.workspaces.flatMap(findUnusedFiles))].sort();
const newFiles = observedFiles.filter((file) => !allowedFiles.has(file));
const resolvedFiles = baseline.allowedFiles.filter((file) => !observedFiles.includes(file));

console.log(
  `dead-code baseline: observed=${observedFiles.length} known=${baseline.allowedFiles.length} new=${newFiles.length} resolved=${resolvedFiles.length}`,
);

if (resolvedFiles.length > 0) {
  console.log('Resolved candidates (remove them from the baseline after review):');
  resolvedFiles.forEach((file) => console.log(`  - ${file}`));
}

if (newFiles.length > 0) {
  console.error('New unused-file candidates must be reviewed before merge:');
  newFiles.forEach((file) => console.error(`  - ${file}`));
  process.exitCode = 1;
}

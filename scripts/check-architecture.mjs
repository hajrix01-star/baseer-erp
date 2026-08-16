import { existsSync, readFileSync } from 'node:fs';

const required = [
  'docs/architecture/ADR-001-GREENFIELD-BASEER-ERP.md',
  'docs/governance/MODULE_DELIVERY_RULEBOOK.md',
  'docs/migration/CUTOVER_GATES.md',
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`Missing Baseer ERP foundation documents: ${missing.join(', ')}`);
  process.exit(1);
}

const qualityStandard = 'docs/governance/TECHNICAL_CONTRACTS_AND_QUALITY_STANDARD.md';
const engineeringStandard = 'docs/governance/BASEER_ERP_ENGINEERING_STANDARD.md';
const requiredPolicyMarkers = [
  [qualityStandard, 'request budget'],
  [qualityStandard, 'post-write request count'],
  [engineeringStandard, 'request budget'],
];
const missingPolicy = requiredPolicyMarkers.filter(([path, marker]) =>
  !readFileSync(path, 'utf8').includes(marker),
);
if (missingPolicy.length) {
  console.error(`Missing mandatory request-budget policy marker(s): ${missingPolicy.map(([path, marker]) => `${path} -> ${marker}`).join(', ')}`);
  process.exit(1);
}

console.log('PASS: Baseer ERP architecture foundation and request-budget policy are present.');

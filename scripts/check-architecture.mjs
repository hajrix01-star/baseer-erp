import { existsSync } from 'node:fs';

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

console.log('PASS: Baseer ERP architecture foundation is present.');

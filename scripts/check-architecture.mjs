import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

const registryFiles = [
  'docs/architecture/registry/INDEX.md',
  'docs/architecture/registry/modules.json',
  'docs/architecture/registry/data-ownership.md',
  'docs/architecture/registry/adr-index.md',
  'docs/architecture/registry/change-impact/README.md',
  'docs/architecture/registry/intelligent-orchestration.md',
];
const missingRegistry = registryFiles.filter((path) => !existsSync(path));
if (missingRegistry.length) {
  console.error(`Missing architecture registry document(s): ${missingRegistry.join(', ')}`);
  process.exit(1);
}

let registry;
try {
  registry = JSON.parse(readFileSync('docs/architecture/registry/modules.json', 'utf8'));
} catch (error) {
  console.error(`Architecture registry JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!registry || registry.application !== 'Baseer ERP' || typeof registry.registryVersion !== 'string' || !registry.lastVerified || !Array.isArray(registry.modules) || registry.modules.length === 0) {
  console.error('Architecture registry must declare its application, version, last verification, and at least one module.');
  process.exit(1);
}

const declaredPaths = registry.modules.flatMap((module) => [...(module.owners ?? []), ...(module.verification ?? [])]);
const unresolvedPaths = declaredPaths.filter((path) => typeof path !== 'string' || !existsSync(path.includes('*') ? dirname(path) : path));
if (unresolvedPaths.length) {
  console.error(`Architecture registry points to missing path(s): ${unresolvedPaths.join(', ')}`);
  process.exit(1);
}

const agentInstructions = readFileSync('AGENTS.md', 'utf8');
const requiredAgentMarkers = ['$alpha-architects-team', '$alpha-efficient-orchestration'];
const missingAgentMarkers = requiredAgentMarkers.filter((marker) => !agentInstructions.includes(marker));
if (missingAgentMarkers.length) {
  console.error(`AGENTS.md is missing automatic orchestration marker(s): ${missingAgentMarkers.join(', ')}`);
  process.exit(1);
}

console.log(`PASS: Baseer ERP architecture foundation, request-budget policy, ${registry.modules.length}-module architecture registry, and automatic orchestration policy are present.`);

import { readFileSync } from 'node:fs';

const exporter = readFileSync('apps/api/src/backup/company-archive-exporter.ts', 'utf8');
const storage = readFileSync('apps/api/src/backup/archive-storage.ts', 'utf8');
const packager = readFileSync('apps/api/src/backup/archive-packager.ts', 'utf8');
const container = readFileSync('apps/api/src/backup/archive-container.ts', 'utf8');
const keyProvider = readFileSync('apps/api/src/backup/archive-key-provider.ts', 'utf8');
const controller = readFileSync('apps/api/src/backup/backup.controller.ts', 'utf8');
const database = readFileSync('apps/api/src/database/database.service.ts', 'utf8');

for (const requirement of [
  "sourceTable: 'Company'",
  "sourceTable: 'CompanyFinanceProfile'",
  "id: 'company-finance-profile'",
  "dependsOn: ['company-profile']",
  'COMPANY_FINANCE_PROFILE_DUPLICATE',
  'assertCompanyScopeRows',
  "sourceTable: 'FinanceAccount'",
  "sourceTable: 'FinanceCategory'",
  "sourceTable: 'FinanceFiscalPeriod'",
  "sourceTable: 'FinanceRecurringExpenseProfile'",
  "sourceTable: 'FinanceSupplier'",
  "sourceTable: 'FinanceVault'",
  "id: 'finance-recurring-expense-profiles'",
  "dependsOn: ['finance-categories', 'finance-suppliers', 'finance-vaults']",
  "dependsOn: ['finance-accounts']",
  "restoreGroup: 'finance-category-supplier'",
  'assertForeignKeysPresent',
  'presentIds',
  'REGISTRY_CYCLE_GROUP_INVALID',
  'FINANCE_CATEGORY_PARENT_NOT_ARCHIVED',
  'assertFinanceCategoryParentGraph',
  'FINANCE_CATEGORY_PARENT_CYCLE',
  'FINANCE_CATEGORY_ACCOUNT_NOT_ARCHIVED',
  'FINANCE_CATEGORY_SUGGESTED_SUPPLIER_NOT_ARCHIVED',
  'FINANCE_SUPPLIER_CATEGORY_NOT_ARCHIVED',
  'FINANCE_VAULT_ACCOUNT_NOT_ARCHIVED',
  'FINANCE_RECURRING_EXPENSE_PROFILE_SCOPE_INVALID',
  'FINANCE_RECURRING_EXPENSE_PROFILE_CATEGORY_NOT_ARCHIVED',
  'FINANCE_RECURRING_EXPENSE_PROFILE_SUPPLIER_NOT_ARCHIVED',
  'FINANCE_RECURRING_EXPENSE_PROFILE_VAULT_NOT_ARCHIVED',
  'inTenantReadSnapshot',
  'verifyArchivePayloadDirectory',
  'recordPublishedCompanyArchive',
  'finalizePrivateStage',
  'packageFinalizedPrivateStage',
  "stage: 'PUBLISHED'",
  'BASEER_ARCHIVE_APPLICATION_VERSION',
  'BASEER_ARCHIVE_SCHEMA_VERSION',
]) {
  if (!exporter.includes(requirement)) throw new Error(`Company archive exporter control is missing: ${requirement}`);
}

// Transactional financial records carry mandatory creator/approver identities.
// They stay out of the partial archive until a separately reviewed restore
// provenance mapping can verify every source user before any target write.
for (const forbidden of ['pg_dump', 'pg_restore', '$queryRaw', 'Prisma.dmmf', 'findMany({ where: {}', 'information_schema.', 'tx.financeRecurringExpenseCoverage', 'tx.financeOutflowDocument', 'tx.financeOutflowAllocation', 'tx.financeOutflowDocumentRevision', 'tx.financeJournalEntry', 'tx.financeJournalLine', 'tx.financeSupplierDue', 'tx.financeSupplierDuePayment']) {
  if (exporter.includes(forbidden)) throw new Error(`Company archive exporter must not use: ${forbidden}`);
}

for (const requirement of ['BASEER_BACKUP_ARCHIVE_STORAGE_ROOT', 'assertNoSymlinkComponents', 'finalizePrivateStage', 'prepareEncryptedArtifact', 'publishEncryptedArtifact', 'encryptedStorageKey', 'await link(pending.temporaryPath, pending.artifactPath)', 'has no replace semantics']) {
  if (!storage.includes(requirement)) throw new Error(`Archive storage control is missing: ${requirement}`);
}

for (const requirement of ['ArchiveKeyProvider', 'verifyEncryptedArchiveContainer', 'writeEncryptedArchiveContainer', 'AES-256-GCM', 'createGzip', 'createGunzip', 'MAX_HEADER_BYTES', 'MAX_ARTIFACT_BYTES']) {
  if (!container.includes(requirement) && !packager.includes(requirement)) throw new Error(`Encrypted archive container control is missing: ${requirement}`);
}

for (const requirement of ['BASEER_ARCHIVE_KEK_KEYRING_V1', 'activeKeyId', 'canonicalBase64', 'wrapDataEncryptionKey', 'unwrapDataEncryptionKey']) {
  if (!keyProvider.includes(requirement)) throw new Error(`Archive keyring control is missing: ${requirement}`);
}

if (!storage.includes('Plaintext archive publication is disabled') || !storage.includes('throw new Error')) {
  throw new Error('Plaintext archive publication must fail closed after encrypted packaging is introduced.');
}

const verifier = readFileSync('apps/api/src/backup/archive-verifier.ts', 'utf8');
if (!verifier.includes('UNDECLARED_PAYLOAD') || !verifier.includes('listRegularArchiveFiles')) {
  throw new Error('Archive verification must reject undeclared payload files.');
}

if (controller.includes('CompanyArchiveExporter') || controller.includes('/import')) {
  throw new Error('The worker-only export slice must not expose exporter internals or an import route.');
}

// The encrypted artifact has a deliberately narrow download route. It must
// remain separate from the exporter and require the sensitive capability.
for (const requirement of ["@Get('jobs/:jobId/download')", "@Get('jobs/:jobId/archive-metadata')", "'backup.download'", 'BackupDownloadService', "'x-baseer-archive-coverage-ack'", "'PARTIAL_CONFIGURATION_ONLY'", "'accept-ranges', 'none'", "'cache-control', 'private, no-store, max-age=0'"]) {
  if (!controller.includes(requirement)) throw new Error(`Encrypted archive download control is missing: ${requirement}`);
}

if (!database.includes('inTenantReadSnapshot') || !database.includes('RepeatableRead') || !database.includes('SET TRANSACTION READ ONLY')) {
  throw new Error('Company archive exporter requires a tenant-scoped repeatable, read-only snapshot.');
}

console.log('Company archive controlled-export controls verified.');

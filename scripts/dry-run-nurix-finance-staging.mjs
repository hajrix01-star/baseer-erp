/**
 * Read-only, fail-closed financial migration rehearsal for the isolated Noorix
 * staging database. It accepts JSONL emitted from a verified archive query,
 * reads immutable Baseer mapping records, and never creates a document,
 * journal, map, category, or account.
 *
 * Expected rows use `{ entity, ...payload }`, where entity is one of:
 * account, category, supplier, vault, invoice, allocation, ledger.
 */
import { createHash } from 'node:crypto';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { dryRunNurixFinanceMigration } from '../apps/api/dist/nurix-migration/nurix-finance-dry-run.js';

const tenantId = process.env.BASEER_MIGRATION_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('BASEER_MIGRATION_TENANT_ID must be a UUID.');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const parsed = new URL(databaseUrl);
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5433' || parsed.pathname !== '/baseer_migration_staging') {
  throw new Error('This script only permits the local baseer_migration_staging database on 127.0.0.1:5433.');
}

let standardInput = '';
for await (const chunk of process.stdin) standardInput += chunk;
const rows = standardInput.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
if (!rows.length || rows.length > 20_000) throw new Error('Between one and 20,000 archive rows are required.');

const supportedEntities = new Set(['account', 'category', 'supplier', 'vault', 'invoice', 'allocation', 'ledger']);
for (const row of rows) {
  if (!row || typeof row !== 'object' || !supportedEntities.has(row.entity) || typeof row.id !== 'string' || !row.id || (row.entity !== 'allocation' && (typeof row.companyId !== 'string' || !row.companyId))) {
    throw new Error('Invalid source row shape.');
  }
}

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourceEntityForSupplier(sourceCompanyId) { return `SUPPLIER_${hash({ sourceCompanyId }).slice(0, 24)}`; }
function sourceEntityForVault(sourceCompanyId) { return `VAULT_${hash({ sourceCompanyId }).slice(0, 24)}`; }
function scalar(value) { return value === null || value === undefined ? null : String(value); }
function arrayFor(byCompany, companyId) {
  const current = byCompany.get(companyId);
  if (current) return current;
  const created = [];
  byCompany.set(companyId, created);
  return created;
}
function sumRejected(receipts) {
  const result = {};
  for (const receipt of receipts) {
    for (const [code, count] of Object.entries(receipt.rejectedByCode)) result[code] = (result[code] ?? 0) + count;
  }
  return result;
}

const accountsByCompany = new Map();
const categoriesByCompany = new Map();
const suppliersByCompany = new Map();
const vaultsByCompany = new Map();
const invoicesByCompany = new Map();
const ledgerByCompany = new Map();
const allocationsByInvoice = new Map();
for (const row of rows) {
  switch (row.entity) {
    case 'account': arrayFor(accountsByCompany, row.companyId).push({ id: row.id, companyId: row.companyId, code: scalar(row.code) ?? '' }); break;
    case 'category': arrayFor(categoriesByCompany, row.companyId).push({ id: row.id, companyId: row.companyId, code: scalar(row.code) ?? '' }); break;
    case 'supplier': arrayFor(suppliersByCompany, row.companyId).push({ id: row.id, companyId: row.companyId }); break;
    case 'vault': arrayFor(vaultsByCompany, row.companyId).push({ id: row.id, companyId: row.companyId }); break;
    case 'invoice': arrayFor(invoicesByCompany, row.companyId).push({
      id: row.id, companyId: row.companyId, kind: scalar(row.kind) ?? '', status: scalar(row.status) ?? '',
      totalAmount: scalar(row.totalAmount) ?? '', netAmount: scalar(row.netAmount) ?? '', taxAmount: scalar(row.taxAmount) ?? '',
      categoryId: scalar(row.categoryId), supplierId: scalar(row.supplierId), vaultId: scalar(row.vaultId),
    }); break;
    case 'allocation': {
      if (typeof row.invoiceId !== 'string' || typeof row.vaultId !== 'string') throw new Error('Invalid allocation row.');
      const list = allocationsByInvoice.get(row.invoiceId) ?? [];
      list.push({ invoiceId: row.invoiceId, vaultId: row.vaultId, amount: scalar(row.amount) ?? '' });
      allocationsByInvoice.set(row.invoiceId, list);
      break;
    }
    case 'ledger': arrayFor(ledgerByCompany, row.companyId).push({
      id: row.id, companyId: row.companyId, status: scalar(row.status) ?? '', debitAccountId: scalar(row.debitAccountId) ?? '', creditAccountId: scalar(row.creditAccountId) ?? '', amount: scalar(row.amount) ?? '',
    }); break;
  }
}

const approvedInvoiceKinds = (process.env.BASEER_APPROVED_NURIX_INVOICE_KINDS ?? '')
  .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
const database = new DatabaseService();
try {
  const plan = await database.inTenantReadSnapshot(tenantId, async (tx) => {
    const run = await tx.legacyMigrationRun.findFirst({
      where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: { in: ['DISCOVERY', 'DRY_RUN'] } },
      orderBy: { startedAt: 'desc' }, select: { id: true, sourceFingerprint: true },
    });
    if (!run) throw new Error('No open Noorix migration run exists in staging.');
    const [companyMaps, recordMaps] = await Promise.all([
      tx.legacyMigrationCompanyMap.findMany({ where: { tenantId, runId: run.id, state: 'PLANNED' }, select: { sourceCompanyId: true, targetCompanyId: true } }),
      tx.legacyMigrationRecordMap.findMany({ where: { tenantId, runId: run.id }, select: { sourceCompanyId: true, sourceEntity: true, sourceId: true, targetCompanyId: true, targetId: true, transformVersion: true } }),
    ]);
    const targetCompanyBySource = new Map(companyMaps.map((item) => [item.sourceCompanyId, item.targetCompanyId]));
    const targetBySource = new Map();
    for (const map of recordMaps) {
      const key = `${map.sourceCompanyId}:${map.sourceEntity}:${map.sourceId}`;
      if (targetBySource.has(key)) throw new Error('Duplicate immutable source map found.');
      targetBySource.set(key, map.targetId);
    }
    const companies = [...targetCompanyBySource.keys()].sort();
    const receipts = [];
    for (const sourceCompanyId of companies) {
      const targetCompanyId = targetCompanyBySource.get(sourceCompanyId);
      const targetIdBySourceId = {};
      const mapId = (entity, sourceId) => targetBySource.get(`${sourceCompanyId}:${entity}:${sourceId}`);
      for (const row of accountsByCompany.get(sourceCompanyId) ?? []) {
        const targetId = mapId('accounts', row.id);
        if (targetId) targetIdBySourceId[row.id] = targetId;
      }
      for (const row of categoriesByCompany.get(sourceCompanyId) ?? []) {
        const targetId = mapId('categories', row.id);
        if (targetId) targetIdBySourceId[row.id] = targetId;
      }
      for (const row of suppliersByCompany.get(sourceCompanyId) ?? []) {
        const targetId = mapId(sourceEntityForSupplier(sourceCompanyId), row.id);
        if (targetId) targetIdBySourceId[row.id] = targetId;
      }
      for (const row of vaultsByCompany.get(sourceCompanyId) ?? []) {
        const targetId = mapId(sourceEntityForVault(sourceCompanyId), row.id);
        if (targetId) targetIdBySourceId[row.id] = targetId;
      }
      // These are deterministic plan references only, not database records.
      // They allow the pure gate to assess source documents after master data
      // resolution without pretending a document or journal has been created.
      for (const row of invoicesByCompany.get(sourceCompanyId) ?? []) targetIdBySourceId[row.id] = `plan:invoice:${row.id}`;
      for (const row of ledgerByCompany.get(sourceCompanyId) ?? []) targetIdBySourceId[row.id] = `plan:ledger:${row.id}`;
      const invoiceRows = invoicesByCompany.get(sourceCompanyId) ?? [];
      const allocations = invoiceRows.flatMap((row) => allocationsByInvoice.get(row.id) ?? []);
      receipts.push(dryRunNurixFinanceMigration({
        sourceCompanyId, targetCompanyId, targetIdBySourceId, approvedInvoiceKinds,
        accounts: accountsByCompany.get(sourceCompanyId) ?? [], categories: categoriesByCompany.get(sourceCompanyId) ?? [], suppliers: suppliersByCompany.get(sourceCompanyId) ?? [], vaults: vaultsByCompany.get(sourceCompanyId) ?? [],
        invoices: invoiceRows, invoiceAllocations: allocations, ledgerEntries: ledgerByCompany.get(sourceCompanyId) ?? [],
      }));
    }
    return { runId: run.id, sourceFingerprint: run.sourceFingerprint, approvedInvoiceKinds, receipts };
  });
  console.log(JSON.stringify({
    mode: 'DRY_RUN', readOnly: true, runId: plan.runId, sourceFingerprint: plan.sourceFingerprint,
    approvedInvoiceKinds: plan.approvedInvoiceKinds,
    companyCount: plan.receipts.length,
    canStage: plan.receipts.every((receipt) => receipt.canStage),
    rejectedByCode: sumRejected(plan.receipts),
    companies: plan.receipts.map((receipt) => ({ sourceCompanyId: receipt.sourceCompanyId, canStage: receipt.canStage, acceptedByEntity: receipt.acceptedByEntity, rejectedByCode: receipt.rejectedByCode, financialTotals: receipt.financialTotals })),
  }));
} finally {
  await database.onModuleDestroy();
}

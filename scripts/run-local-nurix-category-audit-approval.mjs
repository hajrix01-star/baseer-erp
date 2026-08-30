import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import * as XLSX from 'xlsx';

const [workbookPath, packageId, tenantId, companyId, actorUserId] = process.argv.slice(2);
const uuid = /^[0-9a-f-]{36}$/i;
if (!workbookPath || ![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? ''))) throw new Error('Usage: node scripts/run-local-nurix-category-audit-approval.mjs <xlsx-path> <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid>');
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('Refusing category-audit approval outside the canonical local Baseer test database.');
const bytes = await fs.readFile(resolve(workbookPath));
const workbookSha256 = createHash('sha256').update(bytes).digest('hex');
const rows = XLSX.utils.sheet_to_json(XLSX.read(bytes, { type: 'buffer', raw: true }).Sheets.CategoryAudit, { defval: '', raw: true });
const checksum = (row) => createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
const planSha = createHash('sha256').update(JSON.stringify(rows.map((row) => [row.source_category_id, checksum(row), row.baseer_category_code]))).digest('hex');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
    const pkg = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, status: 'READY_FOR_RECONCILIATION' }, select: { workbookSha256: true, company: { select: { migrationReviewLocked: true } } } });
    if (!pkg || !pkg.company.migrationReviewLocked || pkg.workbookSha256 !== workbookSha256) throw new Error('The locked company or verified workbook evidence does not match this approval run.');
    const staged = await tx.nurixExcelStagingRow.findMany({ where: { packageId, tenantId, sheet: 'CategoryAudit', status: 'ACCEPTED' }, select: { sourceId: true, sourceChecksum: true } });
    const stagedById = new Map(staged.map((row) => [row.sourceId, row.sourceChecksum]));
    const categories = await tx.financeCategory.findMany({ where: { tenantId, companyId, code: { in: rows.map((row) => String(row.baseer_category_code)) }, status: 'ACTIVE' }, select: { id: true, code: true } });
    const categoryByCode = new Map(categories.map((row) => [row.code, row.id]));
    if (staged.length !== rows.length || rows.some((row) => stagedById.get(String(row.source_category_id)) !== checksum(row) || !categoryByCode.get(String(row.baseer_category_code)))) throw new Error('A category decision is missing verified staging evidence or an active target category.');
    const existingExecution = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: 'nurix-excel-category-audit-approval/v1' } }, select: { financialPlanSha256: true } });
    if (existingExecution && existingExecution.financialPlanSha256 !== planSha) throw new Error('Refusing to overwrite a completed category-approval audit with a different verified decision plan.');
    const execution = await tx.nurixExcelFinancialExecution.upsert({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: 'nurix-excel-category-audit-approval/v1' } }, create: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: 'nurix-excel-category-audit-approval/v1', financialPlanSha256: planSha, status: 'COMPLETED', reason: 'Owner-authorized explicit approval of verified Noorix category mappings.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(), waveSequence: 1 }, update: { approvedByUserId: actorUserId, approvedAt: new Date(), status: 'COMPLETED', waveSequence: 1 }, select: { id: true } });
    const wave = await tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'COMMITTED', plannedItems: rows.length, postedItems: rows.length, committedAt: new Date(), reconciliationHash: planSha }, update: { status: 'COMMITTED', postedItems: rows.length, committedAt: new Date(), reconciliationHash: planSha }, select: { id: true } });
    for (const row of rows) await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'CategoryAudit', sourceId: String(row.source_category_id) } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'CategoryAudit', sourceId: String(row.source_category_id), sourceChecksum: checksum(row), targetEntity: 'FinanceCategory', targetId: categoryByCode.get(String(row.baseer_category_code)), state: 'APPLIED' }, update: { sourceChecksum: checksum(row), targetId: categoryByCode.get(String(row.baseer_category_code)), state: 'APPLIED' } });
    return { executionId: execution.id, approvedCategoryMappings: rows.length, waveId: wave.id };
  });
  console.log(JSON.stringify({ status: 'COMPLETED', ...receipt }));
} finally { await app.close(); }

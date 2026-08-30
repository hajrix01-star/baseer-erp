import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceSupplierStatus, FinanceVaultPaymentMethod, FinanceVaultStatus, Prisma } from '../generated/prisma/client.js';
import { resolveNoorixVaultReference } from './nurix-excel-reference-mapping.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

type Row = Record<string, unknown>;
type SourceSupplier = Readonly<{ sourceId: string; sourceChecksum: string; nameAr: string; nameEn: string | null; status: 'active' | 'archived' }>;
type SourceVault = Readonly<{ sourceId: string; sourceChecksum: string; nameAr: string; nameEn: string | null; status: 'active' | 'archived' }>;
type SourceInvoice = Readonly<{
  sourceId: string;
  /** The immutable Noorix supplier identity carried by this source invoice. */
  supplierSourceId: string | null;
  grossAmount: string;
  kind: 'purchase' | 'expense';
  status: 'active' | 'cancelled' | 'archived';
}>;
type SourceAllocation = Readonly<{ sourceId: string; sourceChecksum: string; invoiceSourceId: string; vaultSourceId: string; vaultSourceChecksum: string; amount: string; paymentMethod: FinanceVaultPaymentMethod | null; reviewCode: string | null }>;

type ReferencePlanItem = Readonly<{
  sourceSheet: 'Suppliers' | 'Vaults' | 'InvoiceAllocations';
  sourceEntity: 'Supplier' | 'Vault' | 'InvoiceAllocation';
  sourceId: string;
  sourceChecksum: string;
  status: 'PENDING' | 'REVIEW_REQUIRED' | 'EXCLUDED';
  reviewCode?: string;
}>;

export type NurixExcelReferenceAllocationPlan = Readonly<{
  suppliers: readonly SourceSupplier[];
  vaults: readonly SourceVault[];
  invoices: readonly SourceInvoice[];
  allocations: readonly SourceAllocation[];
  items: readonly ReferencePlanItem[];
  checksum: string;
}>;

export type NurixExcelReferenceAllocationReceipt = Readonly<{
  executionId: string;
  status: 'COMPLETED' | 'REVIEW_REQUIRED';
  suppliers: number;
  vaults: number;
  linkedAllocations: number;
  reviewRequired: number;
}>;

const VERSION = 'nurix-excel-reference-allocation/v1';
const FINANCIAL_VERSION = 'nurix-excel-historical-finance/v1';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown) => typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
const optionalText = (value: unknown) => text(value) || null;

function money(value: unknown, label: string): string {
  const decimal = new Prisma.Decimal(text(value));
  if (!decimal.isFinite() || decimal.lte(0) || (decimal.decimalPlaces() ?? 0) > 4) throw new BadRequestException(`Invalid ${label} in the verified Noorix workbook.`);
  return decimal.toFixed(4);
}

function paymentMethod(value: unknown): FinanceVaultPaymentMethod | null {
  const normalized = text(value).toUpperCase();
  if (!normalized) return null;
  if (!['CASH', 'BANK_TRANSFER', 'BANK_CARD', 'BANK_PAYMENT', 'APP'].includes(normalized)) throw new BadRequestException('An invoice allocation has an unsupported payment method.');
  return normalized as FinanceVaultPaymentMethod;
}

function uniqueRows(rows: readonly Row[], sheet: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const sourceId = text(row.source_id);
    if (!sourceId || seen.has(sourceId)) throw new BadRequestException(`${sheet} has a missing or duplicate source identity.`);
    seen.add(sourceId);
  }
}

/**
 * Builds the narrow reference contract used by the writer. It deliberately
 * accepts duplicated display names: Noorix source_id, never name matching, is
 * the supplier identity boundary. Allocation review findings remain in the
 * durable execution as REVIEW_REQUIRED evidence and create no financial fact.
 */
export function buildNurixExcelReferenceAllocationPlan(source: Readonly<{ suppliers: readonly Row[]; vaults: readonly Row[]; invoices: readonly Row[]; allocations: readonly Row[] }>): NurixExcelReferenceAllocationPlan {
  uniqueRows(source.suppliers, 'Suppliers'); uniqueRows(source.vaults, 'Vaults'); uniqueRows(source.invoices, 'Invoices'); uniqueRows(source.allocations, 'InvoiceAllocations');
  const suppliers = source.suppliers.map((row): SourceSupplier => {
    const status = text(row.status).toLowerCase();
    const sourceId = text(row.source_id), nameAr = text(row.name_ar), nameEn = optionalText(row.name_en);
    if (!nameAr || nameAr.length > 160 || (nameEn?.length ?? 0) > 160 || !['active', 'archived'].includes(status)) throw new BadRequestException(`Supplier ${sourceId || '(unknown)'} is invalid.`);
    return { sourceId, sourceChecksum: sha(row), nameAr, nameEn, status: status as SourceSupplier['status'] };
  });
  const vaults = source.vaults.map((row): SourceVault => {
    const status = text(row.status).toLowerCase();
    const sourceId = text(row.source_id), nameAr = text(row.name_ar), nameEn = optionalText(row.name_en);
    if (!nameAr || nameAr.length > 160 || (nameEn?.length ?? 0) > 160 || !['active', 'archived'].includes(status)) throw new BadRequestException(`Vault ${sourceId || '(unknown)'} is invalid.`);
    return { sourceId, sourceChecksum: sha(row), nameAr, nameEn, status: status as SourceVault['status'] };
  });
  const invoices = source.invoices.map((row): SourceInvoice => {
    const sourceId = text(row.source_id), kind = text(row.kind).toLowerCase(), status = text(row.status).toLowerCase();
    if (!['purchase', 'expense'].includes(kind) || !['active', 'cancelled', 'archived'].includes(status)) throw new BadRequestException(`Invoice ${sourceId || '(unknown)'} is outside the PURCHASE/EXPENSE contract.`);
    return { sourceId, supplierSourceId: optionalText(row.supplier_source_id), kind: kind as SourceInvoice['kind'], status: status as SourceInvoice['status'], grossAmount: money(row.gross_amount, 'invoice gross amount') };
  });
  const invoiceById = new Map(invoices.map((invoice) => [invoice.sourceId, invoice]));
  const vaultById = new Map(vaults.map((vault) => [vault.sourceId, vault]));
  const allocationByInvoice = new Map<string, Prisma.Decimal>();
  const allocations = source.allocations.map((row): SourceAllocation => {
    const sourceId = text(row.source_id), invoiceSourceId = text(row.invoice_source_id), vaultSourceId = text(row.vault_source_id);
    const amount = money(row.amount, 'invoice allocation amount');
    if (!invoiceSourceId || !vaultSourceId) throw new BadRequestException(`Invoice allocation ${sourceId || '(unknown)'} has incomplete references.`);
    const invoice = invoiceById.get(invoiceSourceId); const vault = vaultById.get(vaultSourceId);
    let reviewCode: string | null = null;
    if (!invoice || invoice.status !== 'active') reviewCode = 'SOURCE_INVOICE_NOT_ACTIVE';
    else if (!vault || vault.status !== 'active') reviewCode = 'SOURCE_VAULT_NOT_ACTIVE';
    else if (resolveNoorixVaultReference({ sourceId: vault.sourceId, nameAr: vault.nameAr }).status !== 'MATCHED') reviewCode = 'SOURCE_VAULT_MAPPING_UNSAFE';
    allocationByInvoice.set(invoiceSourceId, (allocationByInvoice.get(invoiceSourceId) ?? new Prisma.Decimal(0)).plus(amount));
    return { sourceId, sourceChecksum: sha(row), invoiceSourceId, vaultSourceId, vaultSourceChecksum: vault?.sourceChecksum ?? '', amount, paymentMethod: paymentMethod(row.payment_method_source_id), reviewCode };
  });
  for (const [invoiceSourceId, total] of allocationByInvoice) {
    const invoice = invoiceById.get(invoiceSourceId);
    if (invoice?.status === 'active' && total.toFixed(4) !== invoice.grossAmount) {
      for (const allocation of allocations) if (allocation.invoiceSourceId === invoiceSourceId && !allocation.reviewCode) (allocation as { reviewCode: string | null }).reviewCode = 'SOURCE_ALLOCATION_TOTAL_MISMATCH';
    }
  }
  const items: ReferencePlanItem[] = [
    ...suppliers.map((item) => ({ sourceSheet: 'Suppliers' as const, sourceEntity: 'Supplier' as const, sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, status: item.status === 'active' ? 'PENDING' as const : 'EXCLUDED' as const, ...(item.status === 'archived' ? { reviewCode: 'SOURCE_ARCHIVED' } : {}) })),
    ...vaults.map((item) => ({ sourceSheet: 'Vaults' as const, sourceEntity: 'Vault' as const, sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, status: item.status === 'active' ? 'PENDING' as const : 'EXCLUDED' as const, ...(item.status === 'archived' ? { reviewCode: 'SOURCE_ARCHIVED' } : {}) })),
    ...allocations.map((item) => ({ sourceSheet: 'InvoiceAllocations' as const, sourceEntity: 'InvoiceAllocation' as const, sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, status: item.reviewCode ? 'REVIEW_REQUIRED' as const : 'PENDING' as const, ...(item.reviewCode ? { reviewCode: item.reviewCode } : {}) })),
  ];
  return { suppliers, vaults, invoices, allocations, items, checksum: sha({ version: VERSION, items: items.map((item) => [item.sourceEntity, item.sourceId, item.sourceChecksum, item.status, item.reviewCode ?? null]) }) };
}

/**
 * Resumable reference writer for the approved Noorix Excel package. It writes
 * suppliers, payment vaults and lineage only. In particular it never creates
 * or updates an invoice, journal entry, cash event, or allocation.
 */
@Injectable()
export class NurixExcelReferenceAllocationMigrationService {
  constructor(private readonly database: DatabaseService, private readonly storage: NurixExcelStagingStorageService) {}

  async execute(context: TrustedTenantAdministratorContext, packageId: string, request: Readonly<{ reason?: string; waveSize?: number }> = {}): Promise<NurixExcelReferenceAllocationReceipt> {
    const waveSize = request.waveSize ?? 50;
    if (!Number.isInteger(waveSize) || waveSize < 10 || waveSize > 100) throw new BadRequestException('Reference wave size must be between 10 and 100.');
    const packageRow = await this.package(context, packageId);
    const bytes = await this.storage.readVerified({ workbookSha256: packageRow.workbookSha256, artifact: packageRow });
    const plan = await this.withAcceptedStagingChecksums(context, packageRow.id, this.plan(bytes));
    await this.remediateAuthoritativeChecksums(context, packageRow, plan);
    const execution = await this.prepare(context, packageRow, plan, request.reason, waveSize);
    if (execution.status === 'COMPLETED') return this.receipt(execution.id, plan, 0);
    await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelFinancialWave.updateMany({ where: { executionId: execution.id, tenantId: context.tenantId, status: 'RUNNING', leaseExpiresAt: { lt: new Date() } }, data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null } }));
    for (;;) {
      const wave = await this.claim(context, execution.id);
      if (!wave) break;
      await this.commitWave(context, packageRow, execution.id, wave, plan);
    }
    return this.reconcile(context, packageRow.targetCompanyId, execution.id, plan);
  }

  private async package(context: TrustedTenantAdministratorContext, packageId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const value = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId: context.tenantId }, select: { id: true, tenantId: true, targetCompanyId: true, sourceCompanyId: true, workbookSha256: true, storageReference: true, encryptionIv: true, storedByteSize: true, status: true, company: { select: { status: true, migrationReviewLocked: true } } } });
      if (!value) throw new NotFoundException('The verified Noorix package was not found.');
      if (value.status !== 'READY_FOR_RECONCILIATION' || value.company.status !== 'ACTIVE' || !value.company.migrationReviewLocked) throw new ConflictException('The target company must be active and migration-locked for reference import.');
      if (!value.storageReference || !value.encryptionIv || value.storedByteSize === null) throw new ConflictException('The verified workbook artifact is unavailable.');
      return value as typeof value & { storageReference: string; encryptionIv: string; storedByteSize: bigint };
    });
  }

  private plan(bytes: Buffer): NurixExcelReferenceAllocationPlan {
    const book = XLSX.read(bytes, { type: 'buffer', raw: true });
    const table = (name: string): Row[] => { const sheet = book.Sheets[name]; if (!sheet) throw new BadRequestException(`The verified workbook is missing ${name}.`); return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: true }); };
    return buildNurixExcelReferenceAllocationPlan({ suppliers: table('Suppliers'), vaults: table('Vaults'), invoices: table('Invoices'), allocations: table('InvoiceAllocations') });
  }

  /** The staging receipt, not XLSX object serialization, is the sole source
   * of lineage fingerprints. SheetJS may normalize empty cells differently
   * from intake; trusting its raw-row hash would break every downstream map. */
  private async withAcceptedStagingChecksums(context: TrustedTenantAdministratorContext, packageId: string, raw: NurixExcelReferenceAllocationPlan): Promise<NurixExcelReferenceAllocationPlan> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const rows = await tx.nurixExcelStagingRow.findMany({ where: { packageId, tenantId: context.tenantId, status: 'ACCEPTED', sheet: { in: ['Suppliers', 'Vaults', 'InvoiceAllocations'] } }, select: { sheet: true, sourceId: true, sourceChecksum: true } });
      const checksums = new Map(rows.map((row) => [`${row.sheet}:${row.sourceId}`, row.sourceChecksum]));
      const checksumFor = (sheet: 'Suppliers' | 'Vaults' | 'InvoiceAllocations', sourceId: string) => {
        const value = checksums.get(`${sheet}:${sourceId}`);
        if (!value) throw new ConflictException(`Accepted staging evidence is missing for ${sheet}:${sourceId}.`);
        return value;
      };
      const suppliers = raw.suppliers.map((item) => ({ ...item, sourceChecksum: checksumFor('Suppliers', item.sourceId) }));
      const vaults = raw.vaults.map((item) => ({ ...item, sourceChecksum: checksumFor('Vaults', item.sourceId) }));
      const vaultChecksumById = new Map(vaults.map((item) => [item.sourceId, item.sourceChecksum]));
      const allocations = raw.allocations.map((item) => ({ ...item, sourceChecksum: checksumFor('InvoiceAllocations', item.sourceId), vaultSourceChecksum: vaultChecksumById.get(item.vaultSourceId) ?? (() => { throw new ConflictException(`Accepted staging evidence is missing for Vaults:${item.vaultSourceId}.`); })() }));
      const items = raw.items.map((item) => ({ ...item, sourceChecksum: checksumFor(item.sourceSheet, item.sourceId) }));
      return { suppliers, vaults, invoices: raw.invoices, allocations, items, checksum: sha({ version: VERSION, items: items.map((item) => [item.sourceEntity, item.sourceId, item.sourceChecksum, item.status, item.reviewCode ?? null]) }) };
    });
  }

  /**
   * Corrects the early writer's raw-XLSX checksums before a failed execution
   * resumes. The update is deliberately limited to this transform and to a
   * source map with a live target in the same ARZ company; Invoice/Ledger maps
   * and every target id are outside this remediation boundary.
   */
  private async remediateAuthoritativeChecksums(context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelReferenceAllocationMigrationService['package']>>, plan: NurixExcelReferenceAllocationPlan) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const execution = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId: packageRow.id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, transformVersion: VERSION, status: { not: 'COMPLETED' } }, select: { id: true } });
      if (!execution) return;
      const expected = new Map(plan.items.map((item) => [`${item.sourceEntity}:${item.sourceId}`, item.sourceChecksum]));
      const maps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { executionId: execution.id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceEntity: { in: ['Supplier', 'Vault', 'InvoiceAllocation'] } }, select: { id: true, sourceEntity: true, sourceId: true, sourceChecksum: true, targetEntity: true, targetId: true } });
      const supplierIds = maps.filter((map) => map.targetEntity === 'FinanceSupplier').map((map) => map.targetId);
      const vaultIds = maps.filter((map) => map.targetEntity === 'FinanceVault').map((map) => map.targetId);
      const allocationIds = maps.filter((map) => map.targetEntity === 'FinanceOutflowAllocation').map((map) => map.targetId);
      const [suppliers, vaults, allocations] = await Promise.all([
        tx.financeSupplier.findMany({ where: { id: { in: supplierIds }, tenantId: context.tenantId, companyId: packageRow.targetCompanyId }, select: { id: true } }),
        tx.financeVault.findMany({ where: { id: { in: vaultIds }, tenantId: context.tenantId, companyId: packageRow.targetCompanyId }, select: { id: true } }),
        tx.financeOutflowAllocation.findMany({ where: { id: { in: allocationIds }, tenantId: context.tenantId, companyId: packageRow.targetCompanyId }, select: { id: true } }),
      ]);
      const live = { FinanceSupplier: new Set(suppliers.map((row) => row.id)), FinanceVault: new Set(vaults.map((row) => row.id)), FinanceOutflowAllocation: new Set(allocations.map((row) => row.id)) };
      let mapsUpdated = 0;
      for (const map of maps) {
        const checksum = expected.get(`${map.sourceEntity}:${map.sourceId}`);
        const targetIsLive = map.targetEntity === 'FinanceSupplier' ? live.FinanceSupplier.has(map.targetId)
          : map.targetEntity === 'FinanceVault' ? live.FinanceVault.has(map.targetId)
            : map.targetEntity === 'FinanceOutflowAllocation' ? live.FinanceOutflowAllocation.has(map.targetId)
              : false;
        if (!checksum || !targetIsLive || map.sourceChecksum === checksum) continue;
        await tx.nurixExcelFinancialSourceMap.update({ where: { id: map.id }, data: { sourceChecksum: checksum } });
        mapsUpdated += 1;
      }
      // Items are technical receipts only. Align them to the same accepted
      // staging checksum so a resumed bounded wave can compare evidence
      // without touching an existing target or its financial facts.
      const items = await tx.nurixExcelFinancialItem.findMany({ where: { executionId: execution.id, tenantId: context.tenantId, sourceEntity: { in: ['Supplier', 'Vault', 'InvoiceAllocation'] } }, select: { id: true, sourceEntity: true, sourceId: true, sourceChecksum: true } });
      let itemsUpdated = 0;
      for (const item of items) {
        const checksum = expected.get(`${item.sourceEntity}:${item.sourceId}`);
        if (!checksum || item.sourceChecksum === checksum) continue;
        await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { sourceChecksum: checksum } });
        itemsUpdated += 1;
      }
      if (!mapsUpdated && !itemsUpdated) return;
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { financialPlanSha256: plan.checksum } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: packageRow.targetCompanyId, actorUserId: context.actorUserId, action: 'nurix_excel.reference_staging_checksum_remediated', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-excel-reference-checksum-remediation:${execution.id}`, afterJson: { transformVersion: VERSION, mapsUpdated, itemsUpdated, source: 'NurixExcelStagingRow.ACCEPTED', excludedEntities: ['Invoice', 'LedgerEntry'], targetIdsChanged: false } as Prisma.InputJsonValue } });
    });
  }

  private async prepare(context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelReferenceAllocationMigrationService['package']>>, plan: NurixExcelReferenceAllocationPlan, reason: string | undefined, waveSize: number) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      // InvoiceAllocation is a binding-only wave. Require every active
      // purchase/expense document declared by this immutable package first,
      // rather than letting a reference wave accidentally become a second
      // financial import route.
      const financial = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId: packageRow.id, tenantId: context.tenantId, transformVersion: FINANCIAL_VERSION, status: 'COMPLETED' }, select: { id: true } });
      const expectedInvoices = plan.invoices.filter((invoice) => invoice.status === 'active').length;
      if (!financial) throw new ConflictException(`The ${expectedInvoices} historical purchase/expense invoices must complete before allocation lineage can run.`);
      const importedInvoices = await tx.nurixExcelFinancialSourceMap.count({ where: { executionId: financial.id, tenantId: context.tenantId, sourceEntity: 'Invoice', targetEntity: 'FinanceOutflowDocument', state: { in: ['APPLIED', 'REUSED'] } } });
      if (importedInvoices !== expectedInvoices) throw new ConflictException(`Expected ${expectedInvoices} imported purchase/expense invoices before allocation lineage; found ${importedInvoices}.`);
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId: packageRow.id, tenantId: context.tenantId, transformVersion: VERSION }, select: { id: true, status: true, waveSequence: true, financialPlanSha256: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== plan.checksum) throw new ConflictException('The verified reference plan changed; create a new package revision instead of resuming it.');
        if (!['APPROVED', 'FAILED', 'COMPLETED'].includes(existing.status)) throw new ConflictException('The reference execution is not available to resume.');
        if (existing.status === 'COMPLETED') return existing;
        // A commit failure is fully rolled back, including its source maps and
        // item mutations. Reopen only its bounded failed wave; this is a safe
        // resume point after the operator fixes the external reference issue.
        if (existing.status === 'FAILED') {
          await tx.nurixExcelFinancialWave.updateMany({ where: { executionId: existing.id, tenantId: context.tenantId, status: 'FAILED' }, data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null } });
          // These failures can occur only when an allocation wave was claimed
          // before its Vault rows in the same execution. They are control-plane
          // evidence, not a financial fact, so reset just this retry-safe code
          // and remove only its PLANNED synthetic maps before recalculation.
          const retryable = await tx.nurixExcelFinancialItem.findMany({ where: { executionId: existing.id, tenantId: context.tenantId, sourceEntity: 'InvoiceAllocation', status: 'REVIEW_REQUIRED', resultCode: 'TARGET_VAULT_NOT_FOUND' }, select: { sourceId: true, waveId: true } });
          if (retryable.length) {
            const sourceIds = retryable.map((item) => item.sourceId);
            const waveIds = [...new Set(retryable.map((item) => item.waveId))];
            await tx.nurixExcelFinancialSourceMap.deleteMany({ where: { executionId: existing.id, tenantId: context.tenantId, sourceEntity: 'InvoiceAllocation', sourceId: { in: sourceIds }, targetEntity: 'NoorixUnsafeReference', state: 'PLANNED' } });
            await tx.nurixExcelFinancialItem.updateMany({ where: { executionId: existing.id, tenantId: context.tenantId, sourceEntity: 'InvoiceAllocation', sourceId: { in: sourceIds }, status: 'REVIEW_REQUIRED', resultCode: 'TARGET_VAULT_NOT_FOUND' }, data: { status: 'PENDING', targetEntity: null, targetId: null, resultCode: null } });
            // A reconciliation failure can leave every wave COMMITTED even
            // though a retry-safe review item remains. Reopen only the waves
            // containing those items. Their POSTED/REUSED rows and maps stay
            // untouched; commitWave processes its PENDING subset only.
            await tx.nurixExcelFinancialWave.updateMany({ where: { id: { in: waveIds }, executionId: existing.id, tenantId: context.tenantId, status: 'COMMITTED' }, data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null, committedAt: null } });
          }
        }
        return tx.nurixExcelFinancialExecution.update({ where: { id: existing.id }, data: { status: 'APPROVED', leaseToken: null, leaseExpiresAt: null }, select: { id: true, status: true, waveSequence: true, financialPlanSha256: true } });
      }
      const id = randomUUID();
      await tx.nurixExcelFinancialExecution.create({ data: { id, packageId: packageRow.id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, transformVersion: VERSION, financialPlanSha256: plan.checksum, status: 'APPROVED', reason: optionalText(reason) ?? 'Owner-authorized Noorix supplier, vault, and allocation lineage import.', requestedByUserId: context.actorUserId, approvedByUserId: context.actorUserId, approvedAt: new Date() } });
      for (let offset = 0; offset < plan.items.length; offset += waveSize) {
        const group = plan.items.slice(offset, offset + waveSize), waveId = randomUUID(), sequence = offset / waveSize + 1;
        await tx.nurixExcelFinancialWave.create({ data: { id: waveId, executionId: id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sequence, plannedItems: group.length, reviewItems: group.filter((item) => item.status === 'REVIEW_REQUIRED').length } });
        await tx.nurixExcelFinancialItem.createMany({ data: group.map((item) => ({ id: randomUUID(), executionId: id, waveId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceSheet: item.sourceSheet, sourceEntity: item.sourceEntity, sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, operationKey: sha({ version: VERSION, sourceEntity: item.sourceEntity, sourceId: item.sourceId }), status: item.status, ...(item.reviewCode ? { resultCode: item.reviewCode } : {}) })) });
      }
      return { id, status: 'APPROVED' as const, waveSequence: 0, financialPlanSha256: plan.checksum };
    });
  }

  private async claim(context: TrustedTenantAdministratorContext, executionId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const wave = await tx.nurixExcelFinancialWave.findFirst({ where: { executionId, tenantId: context.tenantId, status: 'PENDING' }, orderBy: { sequence: 'asc' }, select: { id: true, sequence: true } });
      if (!wave) return null;
      const token = randomUUID();
      const claim = await tx.nurixExcelFinancialWave.updateMany({ where: { id: wave.id, tenantId: context.tenantId, status: 'PENDING' }, data: { status: 'RUNNING', leaseToken: token, leaseExpiresAt: new Date(Date.now() + 10 * 60_000) } });
      return claim.count === 1 ? { ...wave, token } : null;
    });
  }

  private async commitWave(context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelReferenceAllocationMigrationService['package']>>, executionId: string, wave: Readonly<{ id: string; sequence: number; token: string }>, plan: NurixExcelReferenceAllocationPlan) {
    try {
      return await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const current = await tx.nurixExcelFinancialWave.findFirst({ where: { id: wave.id, executionId, tenantId: context.tenantId, status: 'RUNNING', leaseToken: wave.token }, select: { id: true } });
      if (!current) throw new ConflictException('The reference wave lease was lost before commit.');
      const rows = (await tx.nurixExcelFinancialItem.findMany({ where: { waveId: wave.id, tenantId: context.tenantId }, orderBy: { sourceId: 'asc' }, select: { id: true, sourceEntity: true, sourceId: true, sourceChecksum: true, status: true, resultCode: true } })).sort((left, right) => {
        const phase: Record<string, number> = { Supplier: 1, Vault: 2, InvoiceAllocation: 3 };
        return (phase[left.sourceEntity] ?? 99) - (phase[right.sourceEntity] ?? 99) || left.sourceId.localeCompare(right.sourceId);
      });
      const supplierById = new Map(plan.suppliers.map((item) => [item.sourceId, item]));
      const vaultById = new Map(plan.vaults.map((item) => [item.sourceId, item]));
      const allocationById = new Map(plan.allocations.map((item) => [item.sourceId, item]));
      let posted = 0, reused = 0, review = 0;
      for (const row of rows) {
        if (row.status === 'REVIEW_REQUIRED') { await this.recordUnsafe(tx, context, packageRow.targetCompanyId, executionId, row, row.resultCode ?? 'UNSAFE_REFERENCE'); review += 1; continue; }
        if (row.status === 'EXCLUDED') { await this.recordExcluded(tx, context, packageRow.targetCompanyId, executionId, row, row.resultCode ?? 'SOURCE_EXCLUDED'); continue; }
        if (row.status !== 'PENDING') continue;
        if (row.sourceEntity === 'Supplier') {
          const source = supplierById.get(row.sourceId); if (!source || source.sourceChecksum !== row.sourceChecksum) throw new ConflictException('A planned supplier no longer matches its verified source evidence.');
          const result = await this.writeSupplier(tx, context, packageRow, executionId, source, plan.invoices); posted += result === 'POSTED' ? 1 : 0; reused += result === 'REUSED' ? 1 : 0;
          await tx.nurixExcelFinancialItem.update({ where: { id: row.id }, data: { status: result === 'POSTED' ? 'POSTED' : 'REUSED', targetEntity: 'FinanceSupplier', targetId: await this.targetId(tx, executionId, 'Supplier', source.sourceId), resultCode: result } });
        } else if (row.sourceEntity === 'Vault') {
          const source = vaultById.get(row.sourceId); if (!source || source.sourceChecksum !== row.sourceChecksum) throw new ConflictException('A planned vault no longer matches its verified source evidence.');
          const result = await this.writeVault(tx, context, packageRow.targetCompanyId, executionId, source);
          if (result.status === 'UNSAFE') { await this.recordUnsafe(tx, context, packageRow.targetCompanyId, executionId, row, result.code); review += 1; }
          else { reused += 1; await tx.nurixExcelFinancialItem.update({ where: { id: row.id }, data: { status: 'REUSED', targetEntity: 'FinanceVault', targetId: result.targetId, resultCode: 'REUSED_APPROVED_ARZ_VAULT' } }); }
        } else {
          const source = allocationById.get(row.sourceId); if (!source || source.sourceChecksum !== row.sourceChecksum) throw new ConflictException('A planned allocation no longer matches its verified source evidence.');
          const result = await this.bindAllocation(tx, context, packageRow, executionId, source);
          if (result.status === 'UNSAFE') { await this.recordUnsafe(tx, context, packageRow.targetCompanyId, executionId, row, result.code); review += 1; }
          else { posted += result.status === 'POSTED' ? 1 : 0; reused += result.status === 'REUSED' ? 1 : 0; await tx.nurixExcelFinancialItem.update({ where: { id: row.id }, data: { status: result.status === 'POSTED' ? 'POSTED' : 'REUSED', targetEntity: 'FinanceOutflowAllocation', targetId: result.targetId, resultCode: result.status } }); }
        }
      }
      const allStatuses = await tx.nurixExcelFinancialItem.groupBy({ by: ['status'], where: { waveId: wave.id, tenantId: context.tenantId }, _count: { _all: true } });
      const allCount = (status: string) => allStatuses.find((item) => item.status === status)?._count._all ?? 0;
      const resolved = allCount('POSTED') + allCount('REUSED') + allCount('REVIEW_REQUIRED') + allCount('EXCLUDED');
      const summary = { executionId, wave: wave.sequence, posted, reused, review };
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: allCount('POSTED'), reusedItems: allCount('REUSED'), reviewItems: allCount('REVIEW_REQUIRED'), failedItems: allCount('FAILED'), committedAt: new Date(), leaseToken: null, leaseExpiresAt: null, reconciliationHash: sha(summary) } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { waveSequence: wave.sequence } });
      // A reopened COMMITTED wave retains its original sequence. Keep one
      // canonical receipt in that slot so resume cannot violate the unique
      // (executionId, sequence) chain or create a second proof record.
      await tx.nurixExcelFinancialReceipt.upsert({
        where: { executionId_sequence: { executionId, sequence: wave.sequence } },
        create: { id: randomUUID(), executionId, waveId: wave.id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sequence: wave.sequence, kind: 'WAVE_COMMITTED', receiptSha256: sha(summary), summaryJson: { ...summary, resolved } as Prisma.InputJsonValue, createdByUserId: context.actorUserId },
        update: { waveId: wave.id, kind: 'WAVE_COMMITTED', receiptSha256: sha(summary), summaryJson: { ...summary, resolved } as Prisma.InputJsonValue },
      });
      });
    } catch (error) {
      await this.failWave(context, packageRow.targetCompanyId, executionId, wave, error);
      throw error;
    }
  }

  private async writeSupplier(tx: any, context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelReferenceAllocationMigrationService['package']>>, executionId: string, source: SourceSupplier, invoices: readonly SourceInvoice[]): Promise<'POSTED' | 'REUSED'> {
    const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId, tenantId: context.tenantId, sourceEntity: 'Supplier', sourceId: source.sourceId }, select: { targetId: true, sourceChecksum: true } });
    if (existing) { if (existing.sourceChecksum !== source.sourceChecksum) throw new ConflictException('A supplier source map differs from immutable source evidence.'); return 'REUSED'; }
    const legacyEntity = `SUPPLIER_${sha({ sourceCompanyId: packageRow.sourceCompanyId }).slice(0, 24)}`;
    const legacy = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceCompanyId: packageRow.sourceCompanyId, sourceEntity: legacyEntity, sourceId: source.sourceId, targetEntity: 'FINANCE_SUPPLIER' }, select: { targetId: true, sourceChecksum: true } });
    let legacyTargetId: string | null = null;
    if (legacy) {
      // Legacy provisional maps may have been created before Excel intake
      // emitted staging receipts. Source identity + target-company ownership
      // remains useful; checksum authority is now NurixExcelStagingRow only.
      const target = await tx.financeSupplier.findFirst({ where: { id: legacy.targetId, tenantId: context.tenantId, companyId: packageRow.targetCompanyId, status: FinanceSupplierStatus.ACTIVE }, select: { id: true } });
      if (!target) throw new ConflictException('A legacy supplier map points outside the target ARZ company.');
      legacyTargetId = target.id;
    }
    // The imported invoice is the strongest supplier proof available: its
    // source row declares supplier_source_id, the completed finance map binds
    // that same invoice to an ARZ outflow document, and that document carries
    // the actual FinanceSupplier. Never infer this relationship from a name.
    const invoiceTargetId = await this.invoiceBackedSupplier(tx, context, packageRow, source, invoices);
    if (legacyTargetId && invoiceTargetId && legacyTargetId !== invoiceTargetId)
      throw new ConflictException('Legacy and invoice lineage identify different ARZ suppliers for the same Noorix supplier source id.');
    const targetId = invoiceTargetId ?? legacyTargetId;
    if (!targetId) {
      // Do not resolve by display name. Two Noorix source IDs with the same
      // label must remain two payable supplier records until an owner merges
      // their identities through the reviewed central-identity workflow.
      const created = await tx.financeSupplier.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: packageRow.targetCompanyId, supplierType: 'EXPENSE', nameAr: source.nameAr, nameEn: source.nameEn, status: FinanceSupplierStatus.ACTIVE }, select: { id: true } });
      await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceEntity: 'Supplier', sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceSupplier', targetId: created.id, state: 'APPLIED' } });
      return 'POSTED';
    }
    await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceEntity: 'Supplier', sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceSupplier', targetId, state: 'REUSED' } });
    return 'REUSED';
  }

  /**
   * Finds the single supplier already proven by this package's completed
   * invoice import. A missing invoice is not a reason to guess: it simply
   * leaves legacy lineage or a fresh source-keyed supplier creation to decide.
   * Any contradictory/missing target is a hard conflict, never a name match.
   */
  private async invoiceBackedSupplier(tx: any, context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelReferenceAllocationMigrationService['package']>>, source: SourceSupplier, invoices: readonly SourceInvoice[]): Promise<string | null> {
    const invoiceSourceIds = invoices
      .filter((invoice) => invoice.supplierSourceId === source.sourceId)
      .map((invoice) => invoice.sourceId);
    if (!invoiceSourceIds.length) return null;
    const invoiceMaps = await tx.nurixExcelFinancialSourceMap.findMany({
      where: {
        tenantId: context.tenantId,
        targetCompanyId: packageRow.targetCompanyId,
        sourceEntity: 'Invoice',
        sourceId: { in: invoiceSourceIds },
        targetEntity: 'FinanceOutflowDocument',
        state: { in: ['APPLIED', 'REUSED'] },
        execution: { packageId: packageRow.id, transformVersion: FINANCIAL_VERSION, status: 'COMPLETED' },
      },
      select: { sourceId: true, targetId: true },
    });
    if (!invoiceMaps.length) return null;
    const documentIds = [...new Set(invoiceMaps.map((map: { targetId: string }) => map.targetId))];
    const documents = await tx.financeOutflowDocument.findMany({
      where: { id: { in: documentIds }, tenantId: context.tenantId, companyId: packageRow.targetCompanyId },
      select: { id: true, supplierId: true },
    });
    if (documents.length !== documentIds.length)
      throw new ConflictException('An invoice source map points outside the target ARZ company.');
    const supplierIds = [...new Set(documents.map((document: { supplierId: string | null }) => document.supplierId).filter((id: string | null): id is string => Boolean(id)))];
    if (supplierIds.length !== 1 || documents.some((document: { supplierId: string | null }) => !document.supplierId))
      throw new ConflictException('Invoice lineage does not prove one ARZ supplier for this Noorix supplier source id.');
    const supplier = await tx.financeSupplier.findFirst({
      where: { id: supplierIds[0]!, tenantId: context.tenantId, companyId: packageRow.targetCompanyId, status: FinanceSupplierStatus.ACTIVE },
      select: { id: true },
    });
    if (!supplier) throw new ConflictException('The invoice-proven ARZ supplier is unavailable for reuse.');
    return supplier.id;
  }

  private async writeVault(tx: any, context: TrustedTenantAdministratorContext, companyId: string, executionId: string, source: SourceVault): Promise<Readonly<{ status: 'REUSED'; targetId: string }> | Readonly<{ status: 'UNSAFE'; code: string }>> {
    const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId, tenantId: context.tenantId, sourceEntity: 'Vault', sourceId: source.sourceId }, select: { targetId: true, sourceChecksum: true } });
    if (existing) {
      if (existing.sourceChecksum !== source.sourceChecksum) return { status: 'UNSAFE', code: 'VAULT_SOURCE_CHECKSUM_CHANGED' };
      return { status: 'REUSED', targetId: existing.targetId };
    }
    const resolution = resolveNoorixVaultReference({ sourceId: source.sourceId, nameAr: source.nameAr });
    if (resolution.status !== 'MATCHED') return { status: 'UNSAFE', code: 'SOURCE_VAULT_MAPPING_UNSAFE' };
    const codeOptions = [resolution.mapping.targetVaultCode, `NURIX-${resolution.mapping.targetVaultCode}`];
    // Target name is safe here only because the source id + source name were
    // first validated against the immutable ARZ decision above. We never use
    // an approximate source name or choose between candidate ledger accounts.
    const vaults = await tx.financeVault.findMany({ where: { tenantId: context.tenantId, companyId, nameAr: resolution.mapping.targetNameAr, status: FinanceVaultStatus.ACTIVE }, select: { id: true, type: true, paymentMethod: true, paymentMethods: true, isPaymentDestination: true, account: { select: { code: true, status: true } } } });
    if (vaults.length !== 1) return { status: 'UNSAFE', code: vaults.length ? 'TARGET_VAULT_AMBIGUOUS' : 'TARGET_VAULT_NOT_PROVISIONED' };
    const vault = vaults[0]!;
    if (!codeOptions.includes(vault.account.code) || vault.account.status !== 'ACTIVE' || !vault.isPaymentDestination || vault.type !== resolution.mapping.vaultType || !vault.paymentMethods.includes(resolution.mapping.paymentMethod as FinanceVaultPaymentMethod)) return { status: 'UNSAFE', code: 'TARGET_VAULT_EVIDENCE_MISMATCH' };
    await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceVault', targetId: vault.id, state: 'REUSED' } });
    return { status: 'REUSED', targetId: vault.id };
  }

  private async failWave(context: TrustedTenantAdministratorContext, companyId: string, executionId: string, wave: Readonly<{ id: string; sequence: number; token: string }>, error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Reference wave failed with an unknown error.';
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const failed = await tx.nurixExcelFinancialWave.updateMany({ where: { id: wave.id, executionId, tenantId: context.tenantId, targetCompanyId: companyId, status: 'RUNNING', leaseToken: wave.token }, data: { status: 'FAILED', leaseToken: null, leaseExpiresAt: null, failedItems: 1, reconciliationHash: sha({ executionId, wave: wave.sequence, message }) } });
      if (failed.count !== 1) return;
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: 'FAILED', leaseToken: null, leaseExpiresAt: null } });
      // The receipt sequence belongs to the wave, not to one attempt. A wave
      // may be reopened after a safe retry and can therefore have had a prior
      // WAVE_COMMITTED receipt. Keep its single canonical proof record in the
      // (executionId, sequence) slot; a later successful commit will replace
      // this failure proof through the same upsert.
      await tx.nurixExcelFinancialReceipt.upsert({
        where: { executionId_sequence: { executionId, sequence: wave.sequence } },
        create: { id: randomUUID(), executionId, waveId: wave.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: wave.sequence, kind: 'FAILURE', receiptSha256: sha({ executionId, wave: wave.sequence, message }), summaryJson: { executionId, wave: wave.sequence, message } as Prisma.InputJsonValue, createdByUserId: context.actorUserId },
        update: { waveId: wave.id, kind: 'FAILURE', receiptSha256: sha({ executionId, wave: wave.sequence, message }), summaryJson: { executionId, wave: wave.sequence, message } as Prisma.InputJsonValue },
      });
    });
  }

  private async bindAllocation(tx: any, context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelReferenceAllocationMigrationService['package']>>, executionId: string, source: SourceAllocation): Promise<Readonly<{ status: 'POSTED' | 'REUSED'; targetId: string }> | Readonly<{ status: 'UNSAFE'; code: string }>> {
    const own = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId, tenantId: context.tenantId, sourceEntity: 'InvoiceAllocation', sourceId: source.sourceId }, select: { sourceChecksum: true, targetId: true, state: true } });
    if (own) { if (own.sourceChecksum !== source.sourceChecksum) return { status: 'UNSAFE', code: 'ALLOCATION_SOURCE_CHECKSUM_CHANGED' }; return own.state === 'APPLIED' || own.state === 'REUSED' ? { status: 'REUSED', targetId: own.targetId } : { status: 'UNSAFE', code: 'ALLOCATION_PREVIOUSLY_UNSAFE' }; }
    const invoiceMap = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceEntity: 'Invoice', sourceId: source.invoiceSourceId, targetEntity: 'FinanceOutflowDocument', state: { in: ['APPLIED', 'REUSED'] }, execution: { packageId: packageRow.id, transformVersion: FINANCIAL_VERSION, status: 'COMPLETED' } }, select: { targetId: true } });
    if (!invoiceMap) return { status: 'UNSAFE', code: 'IMPORTED_INVOICE_NOT_FOUND' };
    const vaultMap = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceEntity: 'Vault', sourceId: source.vaultSourceId, sourceChecksum: source.vaultSourceChecksum, state: { in: ['APPLIED', 'REUSED'] }, execution: { packageId: packageRow.id, targetCompanyId: packageRow.targetCompanyId, transformVersion: VERSION } }, select: { targetId: true } });
    if (!vaultMap) return { status: 'UNSAFE', code: 'TARGET_VAULT_NOT_FOUND' };
    const vault = await tx.financeVault.findFirst({ where: { id: vaultMap.targetId, tenantId: context.tenantId, companyId: packageRow.targetCompanyId, status: FinanceVaultStatus.ACTIVE, isPaymentDestination: true }, select: { id: true, paymentMethod: true, paymentMethods: true } });
    if (!vault) return { status: 'UNSAFE', code: 'TARGET_VAULT_UNSAFE' };
    const expectedMethod = source.paymentMethod ?? vault.paymentMethod;
    if (!vault.paymentMethods.includes(expectedMethod)) return { status: 'UNSAFE', code: 'TARGET_PAYMENT_METHOD_UNSUPPORTED' };
    const document = await tx.financeOutflowDocument.findFirst({ where: { id: invoiceMap.targetId, tenantId: context.tenantId, companyId: packageRow.targetCompanyId }, select: { id: true } });
    if (!document) return { status: 'UNSAFE', code: 'TARGET_INVOICE_OUTSIDE_ARZ' };
    const matches = await tx.financeOutflowAllocation.findMany({ where: { tenantId: context.tenantId, companyId: packageRow.targetCompanyId, documentId: document.id, vaultId: vault.id, paymentMethod: expectedMethod, grossAmount: new Prisma.Decimal(source.amount) }, select: { id: true } });
    if (matches.length !== 1) return { status: 'UNSAFE', code: matches.length ? 'TARGET_ALLOCATION_AMBIGUOUS' : 'TARGET_ALLOCATION_AMOUNT_MISMATCH' };
    await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceEntity: 'InvoiceAllocation', sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, targetEntity: 'FinanceOutflowAllocation', targetId: matches[0]!.id, state: 'APPLIED' } });
    return { status: 'POSTED', targetId: matches[0]!.id };
  }

  private async recordUnsafe(tx: any, context: TrustedTenantAdministratorContext, companyId: string, executionId: string, row: Readonly<{ id: string; sourceEntity: string; sourceId: string; sourceChecksum: string }>, code: string) {
    await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId, sourceEntity: row.sourceEntity, sourceId: row.sourceId } }, create: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: row.sourceEntity, sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'NoorixUnsafeReference', targetId: row.sourceId, state: 'PLANNED' }, update: {} });
    await tx.nurixExcelFinancialItem.update({ where: { id: row.id }, data: { status: 'REVIEW_REQUIRED', targetEntity: 'NoorixUnsafeReference', targetId: row.sourceId, resultCode: code } });
  }

  private async recordExcluded(tx: any, context: TrustedTenantAdministratorContext, companyId: string, executionId: string, row: Readonly<{ id: string; sourceEntity: string; sourceId: string; sourceChecksum: string }>, code: string) {
    await tx.nurixExcelFinancialSourceMap.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: row.sourceEntity, sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'NoorixExcludedReference', targetId: row.sourceId, state: 'APPLIED' }] });
    await tx.nurixExcelFinancialItem.update({ where: { id: row.id }, data: { targetEntity: 'NoorixExcludedReference', targetId: row.sourceId, resultCode: code } });
  }

  private async targetId(tx: any, executionId: string, sourceEntity: 'Supplier' | 'Vault', sourceId: string): Promise<string> {
    const map = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId, sourceEntity, sourceId }, select: { targetId: true } });
    if (!map) throw new ConflictException('A committed reference map is missing.');
    return map.targetId;
  }

  private async reconcile(context: TrustedTenantAdministratorContext, companyId: string, executionId: string, plan: NurixExcelReferenceAllocationPlan): Promise<NurixExcelReferenceAllocationReceipt> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const grouped = await tx.nurixExcelFinancialItem.groupBy({ by: ['status'], where: { executionId, tenantId: context.tenantId }, _count: { _all: true } });
      const count = (status: string) => grouped.find((item) => item.status === status)?._count._all ?? 0;
      const unresolved = count('PENDING') + count('FAILED'); const review = count('REVIEW_REQUIRED');
      if (unresolved) throw new ConflictException('The reference execution still has unresolved items.');
      const status = review ? 'REVIEW_REQUIRED' as const : 'COMPLETED' as const;
      const linkedAllocations = await tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, sourceEntity: 'InvoiceAllocation', status: { in: ['POSTED', 'REUSED'] } } });
      const summary = { suppliers: plan.suppliers.length, vaults: plan.vaults.length, allocations: plan.allocations.length, linkedAllocations, reviewRequired: review, planChecksum: plan.checksum };
      const latestWave = await tx.nurixExcelFinancialWave.findFirstOrThrow({ where: { executionId, tenantId: context.tenantId }, orderBy: { sequence: 'desc' }, select: { id: true } });
      const reconciliationSequence = (await tx.nurixExcelFinancialExecution.findUniqueOrThrow({ where: { id: executionId }, select: { waveSequence: true } })).waveSequence + 1;
      // Reconciliation itself is retriable after a review-safe reopen. It
      // therefore owns one deterministic trailing receipt slot as well.
      await tx.nurixExcelFinancialReceipt.upsert({
        where: { executionId_sequence: { executionId, sequence: reconciliationSequence } },
        create: { id: randomUUID(), executionId, waveId: latestWave.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: reconciliationSequence, kind: 'RECONCILIATION', receiptSha256: sha(summary), summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId },
        update: { waveId: latestWave.id, kind: 'RECONCILIATION', receiptSha256: sha(summary), summaryJson: summary as Prisma.InputJsonValue },
      });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: status === 'COMPLETED' ? 'COMPLETED' : 'FAILED', leaseToken: null, leaseExpiresAt: null } });
      return { executionId, status, suppliers: plan.suppliers.length, vaults: plan.vaults.length, linkedAllocations, reviewRequired: review };
    });
  }

  private receipt(executionId: string, plan: NurixExcelReferenceAllocationPlan, reviewRequired: number): NurixExcelReferenceAllocationReceipt {
    return { executionId, status: reviewRequired ? 'REVIEW_REQUIRED' : 'COMPLETED', suppliers: plan.suppliers.length, vaults: plan.vaults.length, linkedAllocations: plan.allocations.length - reviewRequired, reviewRequired };
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import { DatabaseService } from '../database/database.service.js';
import {
  FinanceCashPerformanceDirection,
  FinanceCashPerformanceEventKind,
  FinanceOutflowDocumentKind,
  FinanceOutflowSettlementKind,
  FinanceVaultPaymentMethod,
  Prisma,
} from '../generated/prisma/client.js';
import { FinanceCashPerformanceEventService } from '../finance/finance-cash-performance-event.service.js';
import { JournalPostingService } from '../finance/journal/journal-posting.service.js';
import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import {
  NurixExcelFinancialImportService,
  type NurixHistoricalAllocation,
  type NurixHistoricalFinancePlan,
  type NurixHistoricalInvoice,
  type NurixHistoricalLedgerEntry,
  type NurixHistoricalMappingSnapshot,
} from './nurix-excel-financial-import.service.js';
import { resolveNoorixVaultReference } from './nurix-excel-reference-mapping.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

type Row = Record<string, unknown>;

type SourceBundle = Readonly<{
  accounts: Row[];
  categories: Row[];
  suppliers: Row[];
  vaults: Row[];
  invoices: Row[];
  allocations: Row[];
  ledgerEntries: Row[];
}>;

type PreparedReferences = Readonly<{
  mapping: NurixHistoricalMappingSnapshot;
  supplierNamesBySourceId: Readonly<Record<string, Readonly<{ nameAr: string; nameEn: string | null }>>>;
  categoriesByCode: Readonly<Record<string, Readonly<{ id: string; code: string; nameAr: string; nameEn: string; kind: string; accountId: string | null }>>>;
}>;

const REFERENCE_PROVISION_VERSION = 'nurix-excel-reference-provision/v1';

export type NurixExcelFinancialMigrationReceipt = Readonly<{
  executionId: string;
  status: 'COMPLETED';
  waves: number;
  postedInvoices: number;
  postedGrossAmount: string;
  canonicalizedCategories: number;
}>;

/**
 * The only writer for historical Noorix purchase/expense invoices.  It reads
 * the already encrypted + verified workbook, rebuilds the immutable plan on
 * every run, and commits one bounded wave atomically.  It never calls the
 * ordinary purchase screen because that screen derives VAT from *today's*
 * policy rather than preserving the historical source amounts.
 */
@Injectable()
export class NurixExcelFinancialMigrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: NurixExcelStagingStorageService,
    private readonly planner: NurixExcelFinancialImportService,
    private readonly journals: JournalPostingService,
    private readonly cashEvents: FinanceCashPerformanceEventService,
  ) {}

  async execute(
    context: TrustedTenantAdministratorContext,
    packageId: string,
    request: Readonly<{ reason?: string; waveSize?: number }> = {},
  ): Promise<NurixExcelFinancialMigrationReceipt> {
    const waveSize = this.waveSize(request.waveSize);
    const packageRecord = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const row = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: {
          id: true, tenantId: true, targetCompanyId: true, sourceCompanyId: true,
          workbookSha256: true, status: true, storageReference: true, encryptionIv: true,
          storedByteSize: true,
          company: { select: { status: true, migrationReviewLocked: true } },
        },
      });
      if (!row) throw new NotFoundException('The verified Noorix package was not found.');
      if (row.status !== 'READY_FOR_RECONCILIATION') throw new ConflictException('The Excel package is not ready for financial reconciliation.');
      if (row.company.status !== 'ACTIVE' || !row.company.migrationReviewLocked) throw new ConflictException('The target company must remain active and migration-locked while financial history is imported.');
      if (!row.storageReference || !row.encryptionIv || row.storedByteSize === null) throw new ConflictException('The verified workbook artifact is unavailable.');
      return row as typeof row & { storageReference: string; encryptionIv: string; storedByteSize: bigint };
    });

    const bytes = await this.storage.readVerified({
      workbookSha256: packageRecord.workbookSha256,
      artifact: {
        storageReference: packageRecord.storageReference,
        encryptionIv: packageRecord.encryptionIv,
        storedByteSize: packageRecord.storedByteSize,
      },
    });
    const source = this.readSource(bytes);
    // Reference data is deliberately provisioned by the reviewed reference
    // migration.  Financial posting is a consumer of that immutable evidence,
    // never a hidden creator/updater of accounts, suppliers, vaults, or
    // categories.  This keeps a failed financial plan side-effect free.
    const prepared = await this.snapshotApprovedReferences(context, packageRecord, source);
    const normalized = this.normalizedInvoices(source, prepared.mapping, prepared.categoriesByCode);
    const plan = this.planner.plan({
      packageId: packageRecord.id,
      workbookSha256: packageRecord.workbookSha256,
      sourceCompanyId: packageRecord.sourceCompanyId,
      targetCompanyId: packageRecord.targetCompanyId,
      mapping: prepared.mapping,
      invoices: normalized.invoices,
      allocations: this.allocations(source),
      ledgerEntries: this.ledgerEntries(source),
    });
    if (!plan.canExecute) {
      const reasons = [...plan.issues.reduce((groups, issue) => groups.set(issue.code, (groups.get(issue.code) ?? 0) + 1), new Map<string, number>()).entries()]
        .map(([code, count]) => `${code}:${count}`).join(',');
      const examples = plan.issues.slice(0, 12).map((issue) => `${issue.code}@${issue.sourceId}`).join(',');
      throw new ConflictException(`The financial plan has ${plan.issues.length} evidence blockers (${reasons}; examples=${examples}); no financial write was made.`);
    }

    const execution = await this.prepareExecution(context, packageRecord, plan, request.reason, waveSize);
    if (execution.status === 'COMPLETED') {
      return {
        executionId: execution.id,
        status: 'COMPLETED',
        waves: execution.waveSequence,
        postedInvoices: plan.items.length,
        postedGrossAmount: plan.totals.grossAmount,
        canonicalizedCategories: normalized.canonicalizedCategories,
      };
    }

    // A process may stop after claiming a wave.  Its deterministic operation
    // keys make the expired claim safe to return to the queue; without this a
    // valid execution could remain permanently stranded in RUNNING.
    await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelFinancialWave.updateMany({
      where: { executionId: execution.id, tenantId: context.tenantId, status: 'RUNNING', leaseExpiresAt: { lt: new Date() } },
      data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null },
    }));

    for (;;) {
      const next = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
        const wave = await tx.nurixExcelFinancialWave.findFirst({
          where: { executionId: execution.id, tenantId: context.tenantId, status: 'PENDING' },
          orderBy: { sequence: 'asc' },
          select: { id: true, sequence: true },
        });
        if (!wave) return null;
        const items = await tx.nurixExcelFinancialItem.findMany({
          where: { waveId: wave.id, tenantId: context.tenantId, status: 'PENDING' },
          orderBy: { sourceId: 'asc' },
          select: { id: true, sourceId: true, sourceChecksum: true },
        });
        if (!items.length) throw new ConflictException('A planned financial wave has no pending items.');
        const leaseToken = randomUUID();
        const claim = await tx.nurixExcelFinancialWave.updateMany({
          where: { id: wave.id, tenantId: context.tenantId, status: 'PENDING' },
          data: { status: 'RUNNING', leaseToken, leaseExpiresAt: new Date(Date.now() + 10 * 60_000) },
        });
        if (claim.count !== 1) throw new ConflictException('A financial wave is already running.');
        return { ...wave, leaseToken, items };
      });
      if (!next) break;
      try {
        await this.commitWave(context, packageRecord.targetCompanyId, execution.id, next.id, next.sequence, next.leaseToken, next.items, plan, prepared);
      } catch (error) {
        // The claim happens in a separate transaction so a posting failure
        // must explicitly release its lease.  Otherwise a deterministic
        // validation error leaves a healthy retry blocked for ten minutes.
        await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelFinancialWave.updateMany({
          where: { id: next.id, executionId: execution.id, tenantId: context.tenantId, status: 'RUNNING', leaseToken: next.leaseToken },
          data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null },
        }));
        throw error;
      }
    }

    await this.completeAndReconcile(context, packageRecord.targetCompanyId, execution.id, plan);
    return {
      executionId: execution.id,
      status: 'COMPLETED',
      waves: Math.ceil(plan.items.length / waveSize),
      postedInvoices: plan.items.length,
      postedGrossAmount: plan.totals.grossAmount,
      canonicalizedCategories: normalized.canonicalizedCategories,
    };
  }

  private async snapshotApprovedReferences(
    context: TrustedTenantAdministratorContext,
    packageRecord: Readonly<{ id: string; targetCompanyId: string }>,
    source: SourceBundle,
  ): Promise<PreparedReferences> {
    const companyId = packageRecord.targetCompanyId;
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const accountBySourceId = new Map<string, { id: string; active: boolean; code: string }>();
      const master = await tx.nurixExcelMasterDataItem.findMany({
        where: { tenantId: context.tenantId, entity: 'ACCOUNT', execution: { targetCompanyId: companyId } },
        select: { sourceId: true, targetId: true, status: true },
      });
      const masterTargets = new Map(master.filter((item: any) => item.targetId && item.status !== 'REVIEW_REQUIRED').map((item: any) => [item.sourceId, item.targetId!]));
      for (const sourceAccount of source.accounts) {
        const sourceId = text(sourceAccount.source_id);
        const code = text(sourceAccount.code);
        if (!sourceId || !code) throw new ConflictException('The account source evidence is incomplete.');
        const targetId = masterTargets.get(sourceId);
        const target = targetId ? await tx.financeAccount.findFirst({ where: { id: targetId, tenantId: context.tenantId, companyId }, select: { id: true, status: true, code: true, type: true } }) : null;
        if (!target || target.type !== upper(sourceAccount.account_type) || target.status !== 'ACTIVE') throw new ConflictException(`The target account mapping is unsafe for source account ${code}.`);
        if ((code === 'V-001' && target.code !== 'V-001') || (code === 'V-002' && target.code !== 'V-002') || (code.startsWith('V-') && target.code !== code && target.code !== `NURIX-${code}`)) throw new ConflictException(`The reserved vault account mapping is unsafe for ${code}.`);
        accountBySourceId.set(sourceId, { id: target.id, active: true, code: target.code });
      }

      const supplierNamesBySourceId: Record<string, { nameAr: string; nameEn: string | null }> = {};
      const suppliersBySourceId: Record<string, { id: string; active: boolean }> = {};
      const usage = new Map<string, Set<string>>();
      for (const invoice of source.invoices) {
        const supplierId = text(invoice.supplier_source_id);
        if (!supplierId) continue;
        const kinds = usage.get(supplierId) ?? new Set<string>(); kinds.add(lower(invoice.kind)); usage.set(supplierId, kinds);
      }
      const sourceSuppliers = new Map(source.suppliers.map((row) => [text(row.source_id), row]));
      for (const [sourceId] of usage) {
        const row = sourceSuppliers.get(sourceId);
        if (!row) throw new ConflictException(`No supplier source record exists for invoice supplier ${sourceId}.`);
        const reference = await tx.nurixExcelFinancialSourceMap.findFirst({ where: {
          tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'Supplier', sourceId,
          targetEntity: 'FinanceSupplier', state: { in: ['APPLIED', 'REUSED'] },
          execution: { packageId: packageRecord.id, transformVersion: REFERENCE_PROVISION_VERSION, status: 'COMPLETED' },
        }, select: { targetId: true } });
        if (!reference) throw new ConflictException(`Supplier ${sourceId} must be pre-provisioned with source lineage before financial import.`);
        const supplier = await tx.financeSupplier.findFirst({ where: { id: reference.targetId, tenantId: context.tenantId, companyId, status: 'ACTIVE' }, select: { id: true } });
        if (!supplier) throw new ConflictException(`Supplier ${sourceId} has an unsafe pre-provisioned target.`);
        const targetId = supplier.id;
        suppliersBySourceId[sourceId] = { id: targetId, active: true };
        supplierNamesBySourceId[sourceId] = { nameAr: text(row.name_ar), nameEn: optionalText(row.name_en) };
      }

      const vaultsBySourceId: Record<string, { id: string; active: boolean; paymentDestination: boolean; accountId: string; defaultPaymentMethod: string; paymentMethods: string[] }> = {};
      const sourceAccountsByCode = new Map(source.accounts.map((row) => [text(row.code), text(row.source_id)]));
      // This financial writer only needs payment destinations used by its
      // invoices.  Sales-only channels are resolved by the daily-sales writer
      // later; requiring their chart accounts here couples two independent
      // stages and can incorrectly stop a valid expense migration.
      const financialVaultSourceIds = new Set([
        ...source.invoices.map((invoice) => text(invoice.vault_source_id)),
        ...source.allocations.map((allocation) => text(allocation.vault_source_id)),
      ]);
      for (const sourceVault of source.vaults.filter((vault) => financialVaultSourceIds.has(text(vault.source_id)))) {
        const resolution = resolveNoorixVaultReference({ sourceId: text(sourceVault.source_id), nameAr: text(sourceVault.name_ar), nameEn: optionalText(sourceVault.name_en) });
        if (resolution.status !== 'MATCHED') throw new ConflictException(`Vault ${text(sourceVault.name_ar)} has no approved source-identity mapping.`);
        const accountSourceId = sourceAccountsByCode.get(resolution.mapping.targetVaultCode);
        const account = accountSourceId ? accountBySourceId.get(accountSourceId) : null;
        if (!account) throw new ConflictException(`The account for vault ${resolution.mapping.targetNameAr} is unavailable.`);
        const reference = await tx.nurixExcelFinancialSourceMap.findFirst({ where: {
          tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: text(sourceVault.source_id),
          targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] },
          execution: { packageId: packageRecord.id, transformVersion: REFERENCE_PROVISION_VERSION, status: 'COMPLETED' },
        }, select: { targetId: true } });
        if (!reference) throw new ConflictException(`Vault ${resolution.mapping.targetNameAr} must be pre-provisioned with source lineage before financial import.`);
        const vault = await tx.financeVault.findFirst({ where: { id: reference.targetId, tenantId: context.tenantId, companyId }, select: { id: true, status: true, isPaymentDestination: true, accountId: true, paymentMethod: true, paymentMethods: true } });
        if (!vault) throw new ConflictException(`Vault ${resolution.mapping.targetNameAr} has an unsafe pre-provisioned target.`);
        if (vault.status !== 'ACTIVE' || !vault.isPaymentDestination || vault.accountId !== account.id || !vault.paymentMethods.includes(resolution.mapping.paymentMethod as FinanceVaultPaymentMethod)) throw new ConflictException(`Vault ${resolution.mapping.targetNameAr} is not a safe payment destination.`);
        vaultsBySourceId[text(sourceVault.source_id)] = { id: vault.id, active: true, paymentDestination: true, accountId: vault.accountId, defaultPaymentMethod: vault.paymentMethod, paymentMethods: vault.paymentMethods };
      }

      const ledgersByInvoice = new Map<string, Row[]>();
      for (const ledger of source.ledgerEntries) {
        const key = text(ledger.reference_source_id); const rows = ledgersByInvoice.get(key) ?? []; rows.push(ledger); ledgersByInvoice.set(key, rows);
      }
      const categories = await tx.financeCategory.findMany({ where: { tenantId: context.tenantId, companyId }, select: { id: true, code: true, nameAr: true, nameEn: true, kind: true, accountId: true, status: true, isPosting: true } });
      const categoryByCode = new Map(categories.map((category) => [category.code, category]));
      const usedCategoryCodes = [...new Set(source.invoices.map((invoice) => text(invoice.baseer_category_code)).filter(Boolean))];
      for (const code of usedCategoryCodes) {
        const category = categoryByCode.get(code);
        if (!category || category.status !== 'ACTIVE' || !category.isPosting) throw new ConflictException(`Category ${code} must be an active posting category before financial import.`);
      }
      const finalCategories = categories;
      const categoriesByCode: PreparedReferences['categoriesByCode'] = Object.fromEntries(finalCategories.map((category) => [category.code, { id: category.id, code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, kind: category.kind, accountId: category.accountId }]));
      const mapping = {
        checksum: sha({ accounts: [...accountBySourceId.entries()].sort(), suppliers: Object.entries(suppliersBySourceId).sort(), vaults: Object.entries(vaultsBySourceId).sort(), categories: Object.entries(categoriesByCode).map(([code, value]) => [code, value.id, value.accountId]).sort() }),
        accountsBySourceId: Object.fromEntries([...accountBySourceId.entries()].map(([id, value]) => [id, value])),
        suppliersBySourceId,
        vaultsBySourceId,
        categoriesByCode: Object.fromEntries(finalCategories.map((category) => [category.code, { id: category.id, active: category.status === 'ACTIVE', posting: category.isPosting, accountId: category.accountId, kind: category.kind }])),
      } satisfies NurixHistoricalMappingSnapshot;
      return { mapping, supplierNamesBySourceId, categoriesByCode };
    });
  }

  private normalizedInvoices(source: SourceBundle, mapping: NurixHistoricalMappingSnapshot, categories: PreparedReferences['categoriesByCode']) {
    const ledgerByInvoice = new Map<string, Row[]>();
    for (const ledger of source.ledgerEntries) { const rows = ledgerByInvoice.get(text(ledger.reference_source_id)) ?? []; rows.push(ledger); ledgerByInvoice.set(text(ledger.reference_source_id), rows); }
    let canonicalizedCategories = 0;
    const invoices = source.invoices.map((row) => {
      const sourceId = text(row.source_id); const ledger = ledgerByInvoice.get(sourceId);
      const categoryCode = text(row.baseer_category_code);
      const debitSourceIds = [...new Set((ledger ?? []).map((entry) => text(entry.debit_account_source_id)))];
      const debit = debitSourceIds.length === 1 ? mapping.accountsBySourceId[debitSourceIds[0]!] : undefined;
      const category = categories[categoryCode];
      const sourceLedgerCategory = debit && category && category.accountId !== debit.id ? debit.code : undefined;
      if (sourceLedgerCategory) canonicalizedCategories += 1;
      const notes = appendSourceCategory(optionalText(row.notes), text(row.baseer_category_code), categoryCode, sourceLedgerCategory);
      const transactionDate = text(row.transaction_date);
      const invoiceDate = text(row.invoice_date) || transactionDate;
      return { sourceId, sourceChecksum: checksum(row), sourceCompanyId: text(row.source_company_id), kind: lower(row.kind), status: lower(row.status), documentNumber: text(row.document_number), supplierSourceId: text(row.supplier_source_id), categoryCode, vaultSourceId: text(row.vault_source_id), transactionDate, invoiceDate, netAmount: text(row.net_amount), taxAmount: text(row.tax_amount), grossAmount: text(row.gross_amount), ...(notes ? { notes } : {}) } satisfies NurixHistoricalInvoice;
    });
    return { invoices, canonicalizedCategories };
  }

  private allocations(source: SourceBundle): NurixHistoricalAllocation[] {
    return source.allocations.map((row) => { const paymentMethodSourceId = optionalText(row.payment_method_source_id); return { sourceId: text(row.source_id), sourceChecksum: checksum(row), invoiceSourceId: text(row.invoice_source_id), vaultSourceId: text(row.vault_source_id), ...(paymentMethodSourceId ? { paymentMethodSourceId } : {}), amount: text(row.amount) }; });
  }

  private ledgerEntries(source: SourceBundle): NurixHistoricalLedgerEntry[] {
    return source.ledgerEntries.map((row) => { const notes = optionalText(row.notes); return { sourceId: text(row.source_id), sourceChecksum: checksum(row), sourceCompanyId: text(row.source_company_id), referenceEntity: text(row.reference_entity), referenceSourceId: text(row.reference_source_id), debitAccountSourceId: text(row.debit_account_source_id), creditAccountSourceId: text(row.credit_account_source_id), vaultSourceId: text(row.vault_source_id), entryDate: text(row.entry_date), amount: text(row.amount), status: lower(row.status), ...(notes ? { notes } : {}) }; });
  }

  private async prepareExecution(context: TrustedTenantAdministratorContext, packageRecord: any, plan: NurixHistoricalFinancePlan, reason: string | undefined, waveSize: number) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId: packageRecord.id, tenantId: context.tenantId, transformVersion: 'nurix-excel-historical-finance/v1' }, select: { id: true, status: true, waveSequence: true, financialPlanSha256: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== plan.planChecksum) throw new ConflictException('The verified financial plan changed; create a new package revision instead of resuming it.');
        if (existing.status === 'COMPLETED') return existing;
        if (existing.status !== 'APPROVED' && existing.status !== 'FAILED') throw new ConflictException('This financial execution is not available to resume.');
        const reopened = await tx.nurixExcelFinancialExecution.update({ where: { id: existing.id }, data: { status: 'APPROVED', leaseToken: null, leaseExpiresAt: null }, select: { id: true, status: true, waveSequence: true, financialPlanSha256: true } });
        return reopened;
      }
      const executionId = randomUUID();
      const waves = chunk(plan.items, waveSize);
      await tx.nurixExcelFinancialExecution.create({ data: { id: executionId, packageId: packageRecord.id, tenantId: context.tenantId, targetCompanyId: packageRecord.targetCompanyId, transformVersion: 'nurix-excel-historical-finance/v1', financialPlanSha256: plan.planChecksum, status: 'APPROVED', reason: optionalText(reason) ?? 'Owner-authorized historical Noorix financial import.', requestedByUserId: context.actorUserId, approvedByUserId: context.actorUserId, approvedAt: new Date() } });
      for (const [index, group] of waves.entries()) {
        const waveId = randomUUID();
        await tx.nurixExcelFinancialWave.create({ data: { id: waveId, executionId, tenantId: context.tenantId, targetCompanyId: packageRecord.targetCompanyId, sequence: index + 1, plannedItems: group.length } });
        await tx.nurixExcelFinancialItem.createMany({ data: group.map((item) => ({ id: randomUUID(), executionId, waveId, tenantId: context.tenantId, targetCompanyId: packageRecord.targetCompanyId, sourceSheet: 'Invoices', sourceEntity: 'Invoice', sourceId: item.sourceInvoiceId, sourceChecksum: item.sourceInvoiceChecksum, operationKey: sha({ plan: plan.planChecksum, sourceInvoiceId: item.sourceInvoiceId }), status: 'PENDING' })) });
      }
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: packageRecord.targetCompanyId, actorUserId: context.actorUserId, action: 'nurix_excel.financial_execution_approved', entityType: 'NurixExcelFinancialExecution', entityId: executionId, requestId: `nurix-excel-financial-plan:${executionId}`, afterJson: { planChecksum: plan.planChecksum, invoices: plan.items.length, grossAmount: plan.totals.grossAmount, waves: waves.length } as Prisma.InputJsonValue } });
      return { id: executionId, status: 'APPROVED' as const, waveSequence: 0, financialPlanSha256: plan.planChecksum };
    });
  }

  private async commitWave(context: TrustedTenantAdministratorContext, companyId: string, executionId: string, waveId: string, sequence: number, leaseToken: string, itemRows: readonly { id: string; sourceId: string; sourceChecksum: string }[], plan: NurixHistoricalFinancePlan, prepared: PreparedReferences) {
    const itemsBySourceId = new Map(plan.items.map((item) => [item.sourceInvoiceId, item]));
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const wave = await tx.nurixExcelFinancialWave.findFirst({ where: { id: waveId, executionId, tenantId: context.tenantId, status: 'RUNNING', leaseToken }, select: { id: true } });
      if (!wave) throw new ConflictException('The financial wave lease was lost before posting.');
      const companyContext = { tenantId: context.tenantId, companyId, actorUserId: context.actorUserId };
      let gross = new Prisma.Decimal(0);
      for (const receipt of itemRows) {
        const item = itemsBySourceId.get(receipt.sourceId);
        if (!item || item.sourceInvoiceChecksum !== receipt.sourceChecksum) throw new ConflictException('A planned financial item no longer matches its verified source evidence.');
        // Earlier Noorix waves predate the current source-map table.  Reuse a
        // document only when its immutable commercial identity and accounting
        // classification agree exactly; otherwise stop for review instead of
        // allowing the database unique key to fail after a journal attempt.
        const legacyDocument = await tx.financeOutflowDocument.findFirst({
          where: {
            tenantId: context.tenantId,
            companyId,
            supplierId: item.supplierId,
            supplierInvoiceNumberNormalized: upper(item.documentNumber),
          },
          select: {
            id: true, journalEntryId: true, kind: true, status: true, categoryId: true,
            grossAmount: true, netAmount: true, vatAmount: true, businessDate: true,
            supplierInvoiceDate: true,
            journalEntry: { select: { sourceReference: true } },
          },
        });
        if (legacyDocument) {
          const exact = legacyDocument.status === 'POSTED'
            && legacyDocument.kind === item.kind
            // A previous signed Noorix writer may already hold the explicit
            // source reference with an owner-reviewed leaf classification.
            // Its source identity wins over a later generic ledger/root code;
            // a same-number document without that lineage must still match
            // the current approved category exactly.
            && (legacyDocument.categoryId === item.categoryId
              || legacyDocument.journalEntry.sourceReference === item.sourceReference
              || legacyDocument.journalEntry.sourceReference === item.sourceInvoiceId)
            && new Prisma.Decimal(legacyDocument.grossAmount).eq(item.grossAmount)
            && new Prisma.Decimal(legacyDocument.netAmount).eq(item.netAmount)
            && new Prisma.Decimal(legacyDocument.vatAmount).eq(item.taxAmount)
            && legacyDocument.businessDate.toISOString().slice(0, 10) === item.businessDate
            && legacyDocument.supplierInvoiceDate?.toISOString().slice(0, 10) === item.supplierInvoiceDate;
          if (!exact) throw new ConflictException(`Existing Noorix-era document conflicts with the verified source identity: ${item.documentNumber}.`);
          await tx.nurixExcelFinancialSourceMap.createMany({ data: [
            { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: item.sourceInvoiceId, sourceChecksum: item.sourceInvoiceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: legacyDocument.id, state: 'REUSED' },
            ...item.sourceLedgers.map((ledger) => ({ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'LedgerEntry', sourceId: ledger.sourceId, sourceChecksum: ledger.sourceChecksum, targetEntity: 'FinanceJournalEntry', targetId: legacyDocument.journalEntryId, state: 'REUSED' as const })),
          ] });
          await Promise.all([
            ...(item.sourceNotes ? [upsertSourceAnnotation(tx, { tenantId: context.tenantId, companyId, sourceCompanyId: plan.sourceCompanyId, sourceEntity: 'Invoice', sourceId: item.sourceInvoiceId, sourceChecksum: item.sourceInvoiceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: legacyDocument.id, field: 'notes', exactText: item.sourceNotes })] : []),
            ...item.sourceLedgers.filter((ledger) => ledger.notes).map((ledger) => upsertSourceAnnotation(tx, { tenantId: context.tenantId, companyId, sourceCompanyId: plan.sourceCompanyId, sourceEntity: 'LedgerEntry', sourceId: ledger.sourceId, sourceChecksum: ledger.sourceChecksum, targetEntity: 'FinanceJournalEntry', targetId: legacyDocument.journalEntryId, field: 'notes', exactText: ledger.notes! })),
          ]);
          await tx.nurixExcelFinancialItem.update({ where: { id: receipt.id }, data: { status: 'REUSED', targetEntity: 'FinanceOutflowDocument', targetId: legacyDocument.id, resultCode: 'REUSED_MATCHING_LEGACY_DOCUMENT' } });
          gross = gross.plus(item.grossAmount);
          continue;
        }
        const duplicate = await tx.financeJournalEntry.findFirst({ where: { tenantId: context.tenantId, companyId, sourceType: 'nurix_excel_historical_outflow', sourceReference: item.sourceReference }, select: { id: true } });
        if (duplicate) throw new ConflictException('A historical journal already exists outside this resumable execution.');
        const category = prepared.categoriesByCode[Object.entries(prepared.categoriesByCode).find(([, value]) => value.id === item.categoryId)?.[0] ?? ''];
        const supplier = prepared.supplierNamesBySourceId[Object.entries(prepared.mapping.suppliersBySourceId).find(([, value]) => value.id === item.supplierId)?.[0] ?? ''];
        if (!category || !supplier) throw new ConflictException('A financial plan target was lost before posting.');
        const documentId = randomUUID();
        const documentNumber = `NXR-${item.businessDate.replaceAll('-', '')}-${sha(item.sourceInvoiceId).slice(0, 12).toUpperCase()}`;
        const journal = await this.journals.postInTransaction(tx, { ...companyContext, requestId: `nurix-excel-financial:${executionId}:${item.sourceInvoiceId}`, sourceType: 'nurix_excel_historical_outflow', sourceReference: item.sourceReference, businessDate: new Date(`${item.businessDate}T00:00:00.000Z`), description: `ترحيل نوركس التاريخي: ${item.documentNumber}`, lines: item.journalLines.map((line) => ({ accountId: line.accountId, ...(line.debitAmount !== '0.0000' ? { debitAmount: line.debitAmount } : { creditAmount: line.creditAmount }), description: documentNumber })) });
        await tx.financeOutflowDocument.create({ data: { id: documentId, tenantId: context.tenantId, companyId, kind: item.kind as FinanceOutflowDocumentKind, settlementKind: FinanceOutflowSettlementKind.PAID, documentNumber, supplierId: item.supplierId, supplierNameSnapshotAr: supplier.nameAr, supplierNameSnapshotEn: supplier.nameEn, categoryId: item.categoryId, supplierInvoiceNumber: item.documentNumber, supplierInvoiceNumberNormalized: item.documentNumber.toLocaleUpperCase('en-US'), businessDate: new Date(`${item.businessDate}T00:00:00.000Z`), supplierInvoiceDate: new Date(`${item.supplierInvoiceDate}T00:00:00.000Z`), grossAmount: item.grossAmount, netAmount: item.netAmount, vatAmount: item.taxAmount, vatRateBasisPoints: vatRate(item.netAmount, item.taxAmount), notes: sourceNotes(item), journalEntryId: journal.journalEntryId, createdByUserId: context.actorUserId } });
        await Promise.all([
          ...(item.sourceNotes ? [upsertSourceAnnotation(tx, { tenantId: context.tenantId, companyId, sourceCompanyId: plan.sourceCompanyId, sourceEntity: 'Invoice', sourceId: item.sourceInvoiceId, sourceChecksum: item.sourceInvoiceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, field: 'notes', exactText: item.sourceNotes })] : []),
          ...item.sourceLedgers.filter((ledger) => ledger.notes).map((ledger) => upsertSourceAnnotation(tx, { tenantId: context.tenantId, companyId, sourceCompanyId: plan.sourceCompanyId, sourceEntity: 'LedgerEntry', sourceId: ledger.sourceId, sourceChecksum: ledger.sourceChecksum, targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, field: 'notes', exactText: ledger.notes! })),
        ]);
        await tx.financeOutflowAllocation.createMany({ data: item.allocations.map((allocation) => ({ id: randomUUID(), tenantId: context.tenantId, companyId, documentId, vaultId: allocation.vaultId, grossAmount: allocation.grossAmount, paymentMethod: allocation.paymentMethod as FinanceVaultPaymentMethod })) });
        await this.cashEvents.recordInTransaction(tx, companyContext, { kind: item.kind === 'PURCHASE' ? FinanceCashPerformanceEventKind.PURCHASE_PAYMENT : FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT, direction: FinanceCashPerformanceDirection.OUTFLOW, businessDate: new Date(`${item.businessDate}T00:00:00.000Z`), grossAmount: item.grossAmount, netAmount: item.netAmount, vatAmount: item.taxAmount, sourceType: 'nurix_excel_historical_outflow', sourceId: documentId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision, category: { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, kind: category.kind as any }, destinations: item.allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: allocation.grossAmount, paymentMethod: allocation.paymentMethod })) });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [
          { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: item.sourceInvoiceId, sourceChecksum: item.sourceInvoiceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: documentId, state: 'APPLIED' },
          ...item.sourceLedgers.map((ledger) => ({ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'LedgerEntry', sourceId: ledger.sourceId, sourceChecksum: ledger.sourceChecksum, targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' as const })),
        ] });
        await tx.nurixExcelFinancialItem.update({ where: { id: receipt.id }, data: { status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: documentId, resultCode: 'POSTED_SOURCE_LEDGER' } });
        gross = gross.plus(item.grossAmount);
      }
      const summary = { executionId, wave: sequence, postedItems: itemRows.length, grossAmount: gross.toFixed(4) };
      const reconciliationHash = sha(summary);
      await tx.nurixExcelFinancialWave.update({ where: { id: waveId }, data: { status: 'COMMITTED', postedItems: itemRows.length, committedAt: new Date(), leaseToken: null, leaseExpiresAt: null, reconciliationHash } });
      await tx.nurixExcelFinancialReceipt.create({ data: { id: randomUUID(), executionId, waveId, tenantId: context.tenantId, targetCompanyId: companyId, sequence, kind: 'WAVE_COMMITTED', receiptSha256: reconciliationHash, summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { waveSequence: sequence } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix_excel.financial_wave_committed', entityType: 'NurixExcelFinancialWave', entityId: waveId, requestId: `nurix-excel-financial-wave:${executionId}:${sequence}`, afterJson: summary as Prisma.InputJsonValue } });
    });
  }

  private async completeAndReconcile(context: TrustedTenantAdministratorContext, companyId: string, executionId: string, plan: NurixHistoricalFinancePlan) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [pending, posted, reused, total] = await Promise.all([
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: { notIn: ['POSTED', 'REUSED'] } } }),
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: 'POSTED' } }),
        tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: 'REUSED' } }),
        tx.nurixExcelFinancialWave.findFirst({ where: { executionId, tenantId: context.tenantId, status: 'COMMITTED' }, orderBy: { sequence: 'desc' }, select: { id: true } }),
      ]);
      if (pending || posted + reused !== plan.items.length || !total) throw new ConflictException('The financial execution did not reconcile completely.');
      const summary = { invoices: plan.items.length, postedInvoices: posted, reusedInvoices: reused, grossAmount: plan.totals.grossAmount, debitAmount: plan.totals.debitAmount, creditAmount: plan.totals.creditAmount, planChecksum: plan.planChecksum };
      const receiptHash = sha(summary);
      const nextSequence = (await tx.nurixExcelFinancialExecution.findUniqueOrThrow({ where: { id: executionId }, select: { waveSequence: true } })).waveSequence + 1;
      await tx.nurixExcelFinancialReceipt.create({ data: { id: randomUUID(), executionId, waveId: total.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: nextSequence, kind: 'RECONCILIATION', receiptSha256: receiptHash, summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', waveSequence: nextSequence, leaseToken: null, leaseExpiresAt: null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix_excel.financial_execution_reconciled', entityType: 'NurixExcelFinancialExecution', entityId: executionId, requestId: `nurix-excel-financial-reconcile:${executionId}`, afterJson: summary as Prisma.InputJsonValue } });
    });
  }

  private readSource(bytes: Buffer): SourceBundle {
    const workbook = XLSX.read(bytes, { type: 'buffer', raw: true });
    const table = (name: string): Row[] => {
      const sheet = workbook.Sheets[name]; if (!sheet) throw new BadRequestException(`The verified workbook is missing ${name}.`);
      return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: true });
    };
    return { accounts: table('Accounts'), categories: table('Categories'), suppliers: table('Suppliers'), vaults: table('Vaults'), invoices: table('Invoices'), allocations: table('InvoiceAllocations'), ledgerEntries: table('LedgerEntries') };
  }

  private waveSize(value: number | undefined): number { if (value === undefined) return 100; if (!Number.isInteger(value) || value < 25 || value > 100) throw new BadRequestException('Financial wave size must be between 25 and 100.'); return value; }
}

function chunk<T>(items: readonly T[], size: number): T[][] { const output: T[][] = []; for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size)); return output; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''; }
function optionalText(value: unknown): string | null { const valueText = text(value); return valueText || null; }
function lower(value: unknown): string { return text(value).toLowerCase(); }
function upper(value: unknown): string { return text(value).toUpperCase(); }
function checksum(row: Row): string { return sha(row); }
function sha(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function appendSourceCategory(notes: string | null, sourceCategory: string, targetCategory: string, sourceLedgerAccount?: string): string | undefined {
  const categorySuffix = sourceCategory === targetCategory ? '' : ` | تصنيف نوركس الأصلي: ${sourceCategory}`;
  const ledgerSuffix = sourceLedgerAccount ? ` | حساب قيد نوركس الأصلي: ${sourceLedgerAccount}` : '';
  const output = `${notes ?? ''}${categorySuffix}${ledgerSuffix}`.trim();
  return output || undefined;
}
function sourceNotes(item: NurixHistoricalFinancePlan['items'][number]) {
  const ledgerNotes = item.sourceLedgers.flatMap((ledger) => ledger.notes ? [`[NOORIX_LEDGER_NOTE:${ledger.sourceId}]\n${ledger.notes}`] : []);
  return [item.sourceNotes, ...ledgerNotes].filter((value): value is string => Boolean(value)).join('\n').slice(0, 2_000) || 'مستند تاريخي مستورد من نوركس؛ القيد من دليل نوركس المصدر.';
}
async function upsertSourceAnnotation(tx: any, input: { tenantId: string; companyId: string; sourceCompanyId: string; sourceEntity: string; sourceId: string; sourceChecksum: string; targetEntity: string; targetId: string; field: string; exactText: string }) {
  await tx.noorixSourceAnnotation.upsert({
    where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId: input.tenantId, targetCompanyId: input.companyId, sourceEntity: input.sourceEntity, sourceId: input.sourceId, field: input.field } },
    create: { id: randomUUID(), tenantId: input.tenantId, targetCompanyId: input.companyId, sourceCompanyId: input.sourceCompanyId, sourceEntity: input.sourceEntity, sourceId: input.sourceId, sourceChecksum: input.sourceChecksum, targetEntity: input.targetEntity, targetId: input.targetId, field: input.field, exactText: input.exactText },
    update: { sourceChecksum: input.sourceChecksum, targetEntity: input.targetEntity, targetId: input.targetId, exactText: input.exactText },
  });
}
function vatRate(net: string, tax: string): number { const n = new Prisma.Decimal(net); const t = new Prisma.Decimal(tax); return n.isZero() || t.isZero() ? 0 : t.mul(10_000).div(n).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(); }

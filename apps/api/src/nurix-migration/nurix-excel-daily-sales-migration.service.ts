import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceDailySalesClosingScope, Prisma } from '../generated/prisma/client.js';
import { DailySalesService } from '../finance/daily-sales.service.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';
import { resolveNoorixVaultReference } from './nurix-excel-reference-mapping.js';

type Row = Record<string, unknown>;
type Allocation = Readonly<{ sourceId: string; sourceChecksum: string; vaultSourceId: string; vaultNameAr: string; amount: string }>;
type SalesItem = Readonly<{
  sourceId: string; sourceChecksum: string; status: 'active' | 'cancelled' | 'merged'; date: string; scope: FinanceDailySalesClosingScope;
  customerCount: number; cashOnHand: string | null; total: string; notes: string | undefined; allocations: readonly Allocation[];
}>;

const VERSION = 'nurix-excel-historical-daily-sales/v1';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown) => typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
const money = (value: unknown, label: string) => {
  const result = new Prisma.Decimal(text(value));
  if (!result.isFinite() || result.lt(0) || (result.decimalPlaces() ?? 0) > 4) throw new BadRequestException(`Invalid ${label} in the verified Noorix workbook.`);
  return result.toFixed(4);
};

/**
 * Historical daily sales are written through Baseer's dedicated sales writer,
 * never through an outflow document. Each source close and allocation receives
 * immutable lineage; cancelled source closes are preserved as excluded evidence.
 */
@Injectable()
export class NurixExcelDailySalesMigrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: NurixExcelStagingStorageService,
    private readonly dailySales: DailySalesService,
  ) {}

  async execute(context: TrustedTenantAdministratorContext, packageId: string, input: Readonly<{ reason?: string; waveSize?: number }> = {}) {
    const waveSize = input.waveSize === undefined ? 25 : input.waveSize;
    if (!Number.isInteger(waveSize) || waveSize < 10 || waveSize > 50) throw new BadRequestException('Daily-sales wave size must be between 10 and 50.');
    const packageRow = await this.package(context, packageId);
    const bytes = await this.storage.readVerified({ workbookSha256: packageRow.workbookSha256, artifact: packageRow });
    const plan = this.plan(bytes);
    const execution = await this.prepare(context, packageRow, plan, input.reason, waveSize);
    if (execution.status === 'COMPLETED') return this.receipt(execution.id, plan, execution.waveSequence);
    await this.reverseOwnerApprovedMergedSource(context, execution.id, packageRow.targetCompanyId, plan);

    // A stopped local worker leaves only the current row unresolved. The same
    // deterministic idempotency key makes a resumed worker safe.
    await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelFinancialWave.updateMany({
      where: { executionId: execution.id, tenantId: context.tenantId, status: 'RUNNING', leaseExpiresAt: { lt: new Date() } },
      data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null },
    }));
    for (;;) {
      const wave = await this.claim(context, execution.id);
      if (!wave) break;
      await this.commitWave(context, execution.id, packageRow.targetCompanyId, wave, plan);
    }
    await this.reconcile(context, execution.id, packageRow.targetCompanyId, plan);
    return this.receipt(execution.id, plan, Math.ceil(plan.length / waveSize));
  }

  private async package(context: TrustedTenantAdministratorContext, packageId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const value = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: { id: true, tenantId: true, targetCompanyId: true, sourceCompanyId: true, workbookSha256: true, storageReference: true, encryptionIv: true, storedByteSize: true, status: true, company: { select: { status: true, migrationReviewLocked: true } } },
      });
      if (!value) throw new NotFoundException('The verified Noorix package was not found.');
      if (value.status !== 'READY_FOR_RECONCILIATION' || value.company.status !== 'ACTIVE' || !value.company.migrationReviewLocked) throw new ConflictException('The target company must be active and migration-locked for historical sales import.');
      if (!value.storageReference || !value.encryptionIv || value.storedByteSize === null) throw new ConflictException('The verified workbook artifact is unavailable.');
      return value as typeof value & { storageReference: string; encryptionIv: string; storedByteSize: bigint };
    });
  }

  private plan(bytes: Buffer): readonly SalesItem[] {
    const book = XLSX.read(bytes, { type: 'buffer', raw: true });
    const table = (name: string) => {
      const sheet = book.Sheets[name]; if (!sheet) throw new BadRequestException(`The verified workbook is missing ${name}.`);
      return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: true });
    };
    const vaults = new Map(table('Vaults').map((row) => [text(row.source_id), text(row.name_ar)]));
    const allocationByClosing = new Map<string, Allocation[]>();
    for (const row of table('DailySalesAllocations')) {
      const sourceId = text(row.source_id), closingId = text(row.closing_source_id), vaultSourceId = text(row.vault_source_id);
      if (!sourceId || !closingId || !vaultSourceId) throw new BadRequestException('A sales allocation source identity is incomplete.');
      const vault = resolveNoorixVaultReference({ sourceId: vaultSourceId, nameAr: vaults.get(vaultSourceId) ?? '' });
      if (vault.status !== 'MATCHED') throw new ConflictException(`Sales allocation vault ${vaultSourceId} needs an approved identity map.`);
      const item = { sourceId, sourceChecksum: sha(row), vaultSourceId, vaultNameAr: vaults.get(vaultSourceId) ?? '', amount: money(row.amount, 'sales allocation amount') };
      const values = allocationByClosing.get(closingId) ?? []; values.push(item); allocationByClosing.set(closingId, values);
    }
    const scope = (value: string) => {
      const normalized = value.toLowerCase();
      if (normalized === 'all') return FinanceDailySalesClosingScope.ALL;
      if (normalized === 'morning') return FinanceDailySalesClosingScope.MORNING;
      if (normalized === 'evening') return FinanceDailySalesClosingScope.EVENING;
      throw new BadRequestException(`Unsupported historical sales shift: ${value}.`);
    };
    const sourceItems: SalesItem[] = table('DailySalesClosings').map((row): SalesItem => {
      const sourceId = text(row.source_id), sourceStatus = text(row.status).toLowerCase();
      if (!sourceId || !['active', 'cancelled'].includes(sourceStatus)) throw new BadRequestException('A sales closing has an unsupported source state.');
      const rawDate = row.transaction_date;
      const parsed = typeof rawDate === 'number' ? XLSX.SSF.parse_date_code(rawDate) : null;
      const date = parsed ? `${parsed.y.toString().padStart(4, '0')}-${parsed.m.toString().padStart(2, '0')}-${parsed.d.toString().padStart(2, '0')}` : text(rawDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException(`Invalid sales closing date for ${sourceId}.`);
      const itemScope = scope(text(row.shift));
      const allocations = allocationByClosing.get(sourceId) ?? [];
      const total = money(row.total_amount, 'sales closing amount');
      const sum = allocations.reduce((value, allocation) => value.plus(allocation.amount), new Prisma.Decimal(0)).toFixed(4);
      if (sourceStatus === 'active' && (allocations.length === 0 || sum !== total || new Prisma.Decimal(total).lte(0))) throw new ConflictException(`Sales closing ${sourceId} does not reconcile with its allocations.`);
      const customers = Number(text(row.customer_count) || '0');
      if (!Number.isSafeInteger(customers) || customers < 0) throw new BadRequestException(`Invalid customer count for sales closing ${sourceId}.`);
      const cash = money(row.cash_on_hand || '0', 'cash-on-hand amount');
      return { sourceId, sourceChecksum: sha(row), status: sourceStatus as 'active' | 'cancelled', date, scope: itemScope, customerCount: customers, cashOnHand: cash === '0.0000' ? null : cash, total, notes: text(row.notes) || undefined, allocations };
    });
    // Noorix occasionally exported multiple ALL closings for one business
    // date.  They are separate source facts (often with different customer
    // counts), not duplicates to discard.  Consolidate only same-date ALL
    // records whose allocation distribution is identical; preserve every
    // source row/allocation as lineage by attaching them all to one target.
    const byDateAndScope = new Map<string, SalesItem[]>();
    for (const item of sourceItems) if (item.status === 'active') (byDateAndScope.get(`${item.date}:${item.scope}`) ?? byDateAndScope.set(`${item.date}:${item.scope}`, []).get(`${item.date}:${item.scope}`)!).push(item);
    for (const [key, entries] of byDateAndScope) {
      if (entries.length < 2) continue;
      if (entries[0]!.scope !== FinanceDailySalesClosingScope.ALL) throw new ConflictException(`More than one historical sales close has the same date and scope (${key}); owner review is required.`);
      const signature = (item: SalesItem) => JSON.stringify(item.allocations
        .map((allocation) => ({ vaultSourceId: allocation.vaultSourceId, amount: allocation.amount }))
        .sort((left, right) => left.vaultSourceId.localeCompare(right.vaultSourceId)));
      const expected = signature(entries[0]!);
      if (entries.some((item) => signature(item) !== expected)) throw new ConflictException(`Same-date ALL sales closes have different allocation evidence (${key}); owner review is required.`);
      const primary = entries[0]!;
      const combined = entries.slice(1).reduce((value, item) => ({
        ...value,
        total: new Prisma.Decimal(value.total).plus(item.total).toFixed(4),
        customerCount: value.customerCount + item.customerCount,
        cashOnHand: (() => { const total = new Prisma.Decimal(value.cashOnHand ?? '0').plus(item.cashOnHand ?? '0').toFixed(4); return total === '0.0000' ? null : total; })(),
        allocations: [...value.allocations, ...item.allocations],
        notes: `${value.notes ?? ''}${value.notes ? ' — ' : ''}دمج تقفيلات ALL تاريخية متطابقة التوزيع: ${item.sourceId}`,
      }), primary);
      sourceItems[sourceItems.indexOf(primary)] = combined;
      for (const secondary of entries.slice(1)) sourceItems[sourceItems.indexOf(secondary)] = { ...secondary, status: 'merged', notes: `${secondary.notes ?? ''}${secondary.notes ? ' — ' : ''}مُدمج في تقفيل ALL التاريخي ${primary.sourceId}; محفوظ في السلسلة ولا يُستبعد مالياً.` };
    }
    // Explicit owner-approved reconciliation rule. Noorix marked a morning
    // close and an "all" (evening-labelled) close as active on this one day.
    // Baseer stores one daily close, so the ALL record carries their summed
    // revenue and allocations while the morning record remains immutable
    // lineage marked MERGED, never a second posting.
    const byDate = new Map<string, SalesItem[]>();
    for (const item of sourceItems) if (item.status === 'active') (byDate.get(item.date) ?? byDate.set(item.date, []).get(item.date)!).push(item);
    for (const [date, entries] of byDate) {
      const all = entries.find((item) => item.scope === FinanceDailySalesClosingScope.ALL);
      const shifts = entries.filter((item) => item.scope !== FinanceDailySalesClosingScope.ALL);
      if (!all || shifts.length === 0) continue;
      if (date !== '2026-05-26' || shifts.length !== 1 || shifts[0]!.scope !== FinanceDailySalesClosingScope.MORNING) throw new ConflictException(`Unapproved mixed daily-sales scopes exist on ${date}.`);
      const merged = shifts[0]!;
      const allIndex = sourceItems.indexOf(all), mergedIndex = sourceItems.indexOf(merged);
      sourceItems[allIndex] = { ...all, total: new Prisma.Decimal(all.total).plus(merged.total).toFixed(4), customerCount: all.customerCount + merged.customerCount, allocations: [...all.allocations, ...merged.allocations], notes: `${all.notes ?? ''}${all.notes ? ' — ' : ''}دمج مع تقفيل صباحي مصدره ${merged.sourceId} بإذن المالك.` };
      sourceItems[mergedIndex] = { ...merged, status: 'merged', notes: `${merged.notes ?? ''}${merged.notes ? ' — ' : ''}مُدمج في تقفيل اليوم ${all.sourceId} بإذن المالك.` };
    }
    return sourceItems;
  }

  private async prepare(context: TrustedTenantAdministratorContext, packageRow: Awaited<ReturnType<NurixExcelDailySalesMigrationService['package']>>, plan: readonly SalesItem[], reason: string | undefined, waveSize: number) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId: packageRow.id, tenantId: context.tenantId, transformVersion: VERSION }, select: { id: true, status: true, waveSequence: true } });
      if (existing) return existing;
      const id = randomUUID(), checksum = sha({ version: VERSION, items: plan.map((item) => [item.sourceId, item.sourceChecksum]) });
      await tx.nurixExcelFinancialExecution.create({ data: { id, packageId: packageRow.id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, transformVersion: VERSION, financialPlanSha256: checksum, status: 'APPROVED', reason: reason?.trim() || 'Owner-authorized historical Noorix daily-sales import.', requestedByUserId: context.actorUserId, approvedByUserId: context.actorUserId, approvedAt: new Date() } });
      for (let offset = 0; offset < plan.length; offset += waveSize) {
        const waveId = randomUUID(), group = plan.slice(offset, offset + waveSize), sequence = offset / waveSize + 1;
        await tx.nurixExcelFinancialWave.create({ data: { id: waveId, executionId: id, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sequence, plannedItems: group.length } });
        await tx.nurixExcelFinancialItem.createMany({ data: group.map((item) => ({ id: randomUUID(), executionId: id, waveId, tenantId: context.tenantId, targetCompanyId: packageRow.targetCompanyId, sourceSheet: 'DailySalesClosings', sourceEntity: 'DailySalesClosing', sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, operationKey: sha({ version: VERSION, sourceId: item.sourceId }), status: 'PENDING' })) });
      }
      return { id, status: 'APPROVED' as const, waveSequence: 0 };
    });
  }

  private async claim(context: TrustedTenantAdministratorContext, executionId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const wave = await tx.nurixExcelFinancialWave.findFirst({ where: { executionId, tenantId: context.tenantId, status: 'PENDING' }, orderBy: { sequence: 'asc' }, select: { id: true, sequence: true } });
      if (!wave) return null;
      const token = randomUUID();
      const changed = await tx.nurixExcelFinancialWave.updateMany({ where: { id: wave.id, status: 'PENDING' }, data: { status: 'RUNNING', leaseToken: token, leaseExpiresAt: new Date(Date.now() + 10 * 60_000) } });
      if (changed.count !== 1) return null;
      return { ...wave, token };
    });
  }

  /** Corrects the one partially written source row created before the owner
   * approved the 26-May merge. Reversal is append-only and retains its source
   * map, which is marked REVERSED before the combined ALL close is posted. */
  private async reverseOwnerApprovedMergedSource(context: TrustedTenantAdministratorContext, executionId: string, companyId: string, plan: readonly SalesItem[]) {
    const merged = plan.find((item) => item.status === 'merged');
    if (!merged) return;
    const row = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelFinancialItem.findFirst({
      where: { executionId, tenantId: context.tenantId, sourceEntity: 'DailySalesClosing', sourceId: merged.sourceId },
      select: { id: true, status: true, targetId: true },
    }));
    if (!row || row.status !== 'POSTED' || !row.targetId) return;
    const targetId = row.targetId;
    const closing = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.financeDailySalesClosing.findFirst({
      where: { id: targetId, tenantId: context.tenantId, companyId }, select: { id: true, status: true },
    }));
    if (!closing) throw new ConflictException('The partially imported daily-sales closing is unavailable for its approved reconciliation.');
    if (closing.status === 'POSTED') {
      await this.dailySales.reverse({
        context: { tenantId: context.tenantId, companyId, actorUserId: context.actorUserId },
        idempotencyKey: sha({ version: VERSION, executionId, sourceId: merged.sourceId, action: 'owner-approved-merge-reversal' }),
        request: { closingId: closing.id, businessDate: new Date(`${merged.date}T00:00:00.000Z`), reason: `دمج تقفيل صباحي نوركس مع تقفيل اليوم بإذن المالك: ${merged.sourceId}` },
      });
    }
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await tx.nurixExcelFinancialSourceMap.updateMany({
        where: { executionId, tenantId: context.tenantId, sourceEntity: 'DailySalesClosing', sourceId: merged.sourceId, state: 'APPLIED' },
        data: { state: 'REVERSED' },
      });
      await tx.nurixExcelFinancialItem.update({ where: { id: row.id }, data: { status: 'EXCLUDED', resultCode: 'SOURCE_MERGED_AND_REVERSED' } });
    });
  }

  private async commitWave(context: TrustedTenantAdministratorContext, executionId: string, companyId: string, wave: Readonly<{ id: string; sequence: number; token: string }>, plan: readonly SalesItem[]) {
    const rows = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelFinancialItem.findMany({ where: { waveId: wave.id, tenantId: context.tenantId, status: 'PENDING' }, orderBy: { sourceId: 'asc' }, select: { id: true, sourceId: true } }));
    const bySource = new Map(plan.map((item) => [item.sourceId, item]));
    for (const row of rows) {
      const item = bySource.get(row.sourceId); if (!item) throw new ConflictException('A planned daily-sales source row is unavailable.');
      if (item.status !== 'active') { await this.excludeNonPosting(context, executionId, companyId, row.id, item); continue; }
      const target = await this.resolveVaults(context, companyId, item);
      const receipt = await this.dailySales.create({
        context: { tenantId: context.tenantId, companyId, actorUserId: context.actorUserId },
        idempotencyKey: sha({ version: VERSION, executionId, sourceId: item.sourceId }),
        request: { businessDate: new Date(`${item.date}T00:00:00.000Z`), scope: item.scope, customerCount: item.customerCount, allocations: target.allocations, ...(item.cashOnHand ? { cashHandoverAmount: item.cashOnHand } : {}), notes: `مستورد تاريخياً من نوركس: ${item.sourceId}${item.notes ? ` — ${item.notes}` : ''}` },
      });
      await this.database.inTenantTransaction(context.tenantId, async (tx) => {
        const allocations = await tx.financeDailySalesAllocation.findMany({ where: { tenantId: context.tenantId, companyId, closingId: receipt.closingId }, select: { id: true, vaultId: true } });
        const allocationIdByVault = new Map(allocations.map((value) => [value.vaultId, value.id]));
        const existingAllocationMaps = new Set((await tx.nurixExcelFinancialSourceMap.findMany({
          where: { executionId, tenantId: context.tenantId, sourceEntity: 'DailySalesAllocation', sourceId: { in: item.allocations.map((allocation) => allocation.sourceId) } },
          select: { sourceId: true },
        })).map((value) => value.sourceId));
        await tx.financeDailySalesClosing.update({ where: { id: receipt.closingId }, data: { sourceSystem: 'NOORIX', sourceReference: item.sourceId, sourceChecksum: item.sourceChecksum } });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [
          { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'DailySalesClosing', sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, targetEntity: 'FinanceDailySalesClosing', targetId: receipt.closingId, state: 'APPLIED' },
          ...item.allocations.filter((allocation) => !existingAllocationMaps.has(allocation.sourceId)).map((allocation) => ({ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'DailySalesAllocation', sourceId: allocation.sourceId, sourceChecksum: allocation.sourceChecksum, targetEntity: 'FinanceDailySalesAllocation', targetId: allocationIdByVault.get(target.vaultIdBySource.get(allocation.vaultSourceId) ?? '') ?? '', state: 'APPLIED' as const })),
        ] });
        await tx.nurixExcelFinancialItem.update({ where: { id: row.id }, data: { status: 'POSTED', targetEntity: 'FinanceDailySalesClosing', targetId: receipt.closingId, resultCode: 'POSTED_DAILY_SALES' } });
      });
    }
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const count = await tx.nurixExcelFinancialItem.count({ where: { waveId: wave.id, status: { in: ['POSTED', 'REUSED', 'EXCLUDED'] } } });
      const summary = { executionId, wave: wave.sequence, resolvedItems: count };
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: count, committedAt: new Date(), leaseToken: null, leaseExpiresAt: null, reconciliationHash: sha(summary) } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { waveSequence: wave.sequence } });
    });
  }

  private async resolveVaults(context: TrustedTenantAdministratorContext, companyId: string, item: SalesItem) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const vaults = await tx.financeVault.findMany({ where: { tenantId: context.tenantId, companyId, status: 'ACTIVE', isSalesChannel: true, isPaymentDestination: true }, select: { id: true, nameAr: true, type: true, paymentMethods: true, account: { select: { code: true } } } });
      const vaultIdBySource = new Map<string, string>();
      for (const allocation of item.allocations) {
        const source = resolveNoorixVaultReference({ sourceId: allocation.vaultSourceId, nameAr: allocation.vaultNameAr });
        if (source.status !== 'MATCHED') throw new ConflictException('A daily-sales vault mapping is not approved.');
        const matches = vaults.filter((vault) => (vault.account.code === source.mapping.targetVaultCode || vault.account.code === `NURIX-${source.mapping.targetVaultCode}`) && vault.nameAr === source.mapping.targetNameAr && vault.type === source.mapping.vaultType && vault.paymentMethods.includes(source.mapping.paymentMethod as any));
        if (matches.length !== 1) throw new ConflictException(`Sales vault ${source.mapping.targetNameAr} must be uniquely pre-provisioned as a sales channel.`);
        vaultIdBySource.set(allocation.vaultSourceId, matches[0]!.id);
      }
      const grouped = new Map<string, Prisma.Decimal>();
      for (const allocation of item.allocations) {
        const vaultId = vaultIdBySource.get(allocation.vaultSourceId)!;
        grouped.set(vaultId, (grouped.get(vaultId) ?? new Prisma.Decimal(0)).plus(allocation.amount));
      }
      return { vaultIdBySource, allocations: [...grouped].map(([vaultId, grossAmount]) => ({ vaultId, grossAmount: grossAmount.toFixed(4) })) };
    });
  }

  private async excludeNonPosting(context: TrustedTenantAdministratorContext, executionId: string, companyId: string, itemId: string, item: SalesItem) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const merged = item.status === 'merged';
      const closingEntity = merged ? 'NoorixMergedDailySalesClosing' : 'NoorixCancelledDailySalesClosing';
      const allocationEntity = merged ? 'NoorixMergedDailySalesAllocation' : 'NoorixCancelledDailySalesAllocation';
      await tx.nurixExcelFinancialSourceMap.createMany({ data: [
        { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'DailySalesClosing', sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, targetEntity: closingEntity, targetId: item.sourceId, state: 'APPLIED' },
        ...item.allocations.map((allocation) => ({ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: 'DailySalesAllocation', sourceId: allocation.sourceId, sourceChecksum: allocation.sourceChecksum, targetEntity: allocationEntity, targetId: allocation.sourceId, state: 'APPLIED' as const })),
      ] });
      await tx.nurixExcelFinancialItem.update({ where: { id: itemId }, data: { status: 'EXCLUDED', targetEntity: closingEntity, targetId: item.sourceId, resultCode: merged ? 'SOURCE_MERGED' : 'SOURCE_CANCELLED' } });
    });
  }

  private async reconcile(context: TrustedTenantAdministratorContext, executionId: string, companyId: string, plan: readonly SalesItem[]) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const resolved = await tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: { in: ['POSTED', 'REUSED', 'EXCLUDED'] } } });
      if (resolved !== plan.length) throw new ConflictException('Daily-sales execution did not reconcile completely.');
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', leaseToken: null, leaseExpiresAt: null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix_excel.daily_sales_reconciled', entityType: 'NurixExcelFinancialExecution', entityId: executionId, requestId: `nurix-excel-daily-sales:${executionId}`, afterJson: { activeClosings: plan.filter((item) => item.status === 'active').length, mergedClosings: plan.filter((item) => item.status === 'merged').length, cancelledClosings: plan.filter((item) => item.status === 'cancelled').length, grossAmount: plan.filter((item) => item.status === 'active').reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0)).toFixed(4) } } });
    });
  }

  private receipt(executionId: string, plan: readonly SalesItem[], waves: number) {
    return { executionId, status: 'COMPLETED' as const, waves, postedClosings: plan.filter((item) => item.status === 'active').length, mergedClosings: plan.filter((item) => item.status === 'merged').length, cancelledClosings: plan.filter((item) => item.status === 'cancelled').length, allocations: plan.reduce((count, item) => count + item.allocations.length, 0), grossAmount: plan.filter((item) => item.status === 'active').reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0)).toFixed(4) };
  }
}

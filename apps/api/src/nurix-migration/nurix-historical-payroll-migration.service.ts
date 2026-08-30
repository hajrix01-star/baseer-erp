import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  NurixExcelFinancialExecutionStatus,
  NurixExcelFinancialItemStatus,
  NurixExcelFinancialReceiptKind,
  NurixExcelFinancialSourceMapState,
  NurixExcelFinancialWaveStatus,
  Prisma,
} from '../generated/prisma/client.js';

/**
 * Historical payroll evidence only. It deliberately never creates an
 * HrPayrollRun/Line because a payroll draft is later approvable and could post
 * a journal. Dates and totals live in migration receipts and audit evidence.
 */
const VERSION = 'nurix-historical-payroll-evidence/v1';
const ACCOUNTING_ENRICHMENT_VERSION = 'nurix-historical-payroll-accounting-evidence/v2';
const ACCOUNTING_ENRICHMENT_SEQUENCE = 2;
const RUN = 'PayrollRun';
const LINE = 'PayrollRunItem';
const INVOICE = 'PayrollInvoiceEvidence';
const JOURNAL = 'PayrollJournalEvidence';
const VAULT = 'PayrollVaultAllocation';
const MONEY = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type NurixHistoricalPayrollItem = Readonly<{ sourceId: string; employeeSourceId: string; grossSalary: string; allowancesAdd: string; deductions: string; advancesDeduct: string; netSalary: string }>;
export type NurixHistoricalPayrollAccountingDocument = Readonly<{ evidenceKind: 'PAYROLL_INVOICE' | 'JOURNAL_ENTRY'; sourceId: string; sourceNumber: string | null; sourceDate: string | null; amount: string | null }>;
export type NurixHistoricalPayrollVaultAllocation = Readonly<{ sourceId: string; vaultSourceId: string; amount: string }>;
export type NurixHistoricalPayrollRun = Readonly<{ sourceId: string; runNumber: string; payrollMonth: string; payrollAccruedAt: string; status: string; totalAmount: string; employeeCount: number; paymentEvidenceKind: 'NONE' | 'AMOUNT_ONLY'; paymentEvidenceAmount: string | null; paymentEvidenceAt: string | null; sourceInvoiceEvidence?: 'NONE' | 'PRESENT'; sourceJournalEvidence?: 'NONE' | 'PRESENT'; accountingDocuments?: readonly NurixHistoricalPayrollAccountingDocument[]; vaultAllocations?: readonly NurixHistoricalPayrollVaultAllocation[]; items: readonly NurixHistoricalPayrollItem[] }>;
export type NurixHistoricalPayrollInput = Readonly<{ packageId: string; sourceCompanyId: string; runs: readonly NurixHistoricalPayrollRun[] }>;

type Line = NurixHistoricalPayrollItem & Readonly<{ sourceChecksum: string; gross: string; appliedAdvance: string; advanceCarryoverEvidence: string }>;
type AccountingDocument = NurixHistoricalPayrollAccountingDocument & Readonly<{ sourceChecksum: string }>;
type VaultAllocation = NurixHistoricalPayrollVaultAllocation & Readonly<{ sourceChecksum: string }>;
type Run = Omit<NurixHistoricalPayrollRun, 'items' | 'accountingDocuments' | 'vaultAllocations' | 'sourceInvoiceEvidence' | 'sourceJournalEvidence'> & Readonly<{ sourceChecksum: string; sourceInvoiceEvidence: 'NONE' | 'PRESENT'; sourceJournalEvidence: 'NONE' | 'PRESENT'; accountingDocuments: readonly AccountingDocument[]; vaultAllocations: readonly VaultAllocation[]; items: readonly Line[]; grossAmount: string; deductionsAmount: string; appliedAdvancesAmount: string; sourceAdvancesAmount: string; advanceCarryoverEvidenceAmount: string; netAmount: string }>;
export type NurixHistoricalPayrollPlan = Readonly<{ checksum: string; packageId: string; sourceCompanyId: string; runs: readonly Run[]; totals: Readonly<{ runs: number; lines: number; invoiceEvidence: number; journalEvidence: number; vaultAllocations: number; gross: string; deductions: string; appliedAdvances: string; sourceAdvances: string; advanceCarryoverEvidence: string; net: string; financialWrites: 0 }> }>;
export type NurixHistoricalPayrollReceipt = Readonly<{ executionId: string; status: 'COMPLETED'; archivedRuns: number; archivedLines: number; archivedAccountingEvidence: number; sourceMaps: number; financialWrites: 0 }>;
export type NurixHistoricalPayrollAccountingEnrichmentReceipt = Readonly<{ executionId: string; status: 'COMPLETED'; enrichedRuns: number; archivedAccountingEvidence: number; sourceMaps: number; financialWrites: 0 }>;
export type NurixHistoricalPayrollDryRunReceipt = Readonly<{ planChecksum: string; targetCompanyId: string; runs: number; lines: number; mappedEmployees: number; paymentEvidence: Readonly<Record<'NONE' | 'AMOUNT_ONLY', number>>; totals: NurixHistoricalPayrollPlan['totals']; financialWrites: 0 }>;
export type NurixHistoricalPayrollEvidenceReceipt = Readonly<{ companyId: string; runs: readonly Readonly<{ sourceRunNumber: string; payrollMonth: string; sourceAccruedAt: string; employeeCount: number; lineCount: number; grossAmount: string; deductionsAmount: string; sourceAdvancesAmount: string; appliedAdvancesAmount: string; advanceCarryoverEvidenceAmount: string; netAmount: string; paymentEvidenceKind: 'NONE' | 'AMOUNT_ONLY'; paymentEvidenceAmount: string | null; status: 'EVIDENCE_ONLY' }>[] }>;

@Injectable()
export class NurixHistoricalPayrollMigrationService {
  constructor(private readonly database?: DatabaseService) {}

  /** Owner-only read model. These rows are archival evidence, not payroll actions. */
  async listEvidence(context: TrustedTenantAdministratorContext, companyId: string): Promise<NurixHistoricalPayrollEvidenceReceipt> {
    if (!uuid(companyId)) throw new ConflictException('Historical payroll evidence requires a company identifier.');
    const rows = await this.requireDatabase().inTenantTransaction(context.tenantId, (tx) => tx.nurixHistoricalPayrollEvidence.findMany({
      where: { tenantId: context.tenantId, companyId, status: 'EVIDENCE_ONLY' },
      orderBy: [{ payrollMonth: 'asc' }, { sourceRunNumber: 'asc' }],
      select: { sourceRunNumber: true, payrollMonth: true, sourceAccruedAt: true, employeeCount: true, grossAmount: true, deductionsAmount: true, sourceAdvancesAmount: true, appliedAdvancesAmount: true, advanceCarryoverEvidenceAmount: true, netAmount: true, paymentEvidenceKind: true, paymentEvidenceAmount: true, status: true, _count: { select: { lines: true } } },
    }));
    return Object.freeze({ companyId, runs: Object.freeze(rows.map((row) => Object.freeze({
      sourceRunNumber: row.sourceRunNumber,
      payrollMonth: row.payrollMonth.toISOString(),
      sourceAccruedAt: row.sourceAccruedAt.toISOString(),
      employeeCount: row.employeeCount,
      lineCount: row._count.lines,
      grossAmount: fixed(row.grossAmount),
      deductionsAmount: fixed(row.deductionsAmount),
      sourceAdvancesAmount: fixed(row.sourceAdvancesAmount),
      appliedAdvancesAmount: fixed(row.appliedAdvancesAmount),
      advanceCarryoverEvidenceAmount: fixed(row.advanceCarryoverEvidenceAmount),
      netAmount: fixed(row.netAmount),
      paymentEvidenceKind: row.paymentEvidenceKind,
      paymentEvidenceAmount: row.paymentEvidenceAmount ? fixed(row.paymentEvidenceAmount) : null,
      status: 'EVIDENCE_ONLY' as const,
    }))) });
  }

  plan(input: NurixHistoricalPayrollInput): NurixHistoricalPayrollPlan {
    if (!uuid(input.packageId) || !input.sourceCompanyId.trim()) throw new ConflictException('Historical payroll evidence requires a package and Noorix source company.');
    const runIds = new Set<string>(); const runNumbers = new Set<string>();
    const runs = input.runs.map((run) => this.planRun(run, runIds, runNumbers));
    if (!runs.length) throw new ConflictException('No Noorix historical payroll runs were supplied.');
    const sum = (values: readonly string[]) => fixed(values.reduce((total, value) => total.plus(decimal(value)), new Prisma.Decimal(0)));
    return Object.freeze({
      checksum: sha({ version: VERSION, packageId: input.packageId, sourceCompanyId: input.sourceCompanyId, runs: runs.map((run) => ({ id: run.sourceId, checksum: run.sourceChecksum, lines: run.items.map((line) => ({ id: line.sourceId, checksum: line.sourceChecksum })), accounting: run.accountingDocuments.map((document) => ({ kind: document.evidenceKind, id: document.sourceId, checksum: document.sourceChecksum })), vaults: run.vaultAllocations.map((allocation) => ({ id: allocation.sourceId, checksum: allocation.sourceChecksum })) })) }),
      packageId: input.packageId, sourceCompanyId: input.sourceCompanyId, runs: Object.freeze(runs),
      totals: Object.freeze({ runs: runs.length, lines: runs.reduce((total, run) => total + run.items.length, 0), invoiceEvidence: runs.reduce((total, run) => total + run.accountingDocuments.filter((document) => document.evidenceKind === 'PAYROLL_INVOICE').length, 0), journalEvidence: runs.reduce((total, run) => total + run.accountingDocuments.filter((document) => document.evidenceKind === 'JOURNAL_ENTRY').length, 0), vaultAllocations: runs.reduce((total, run) => total + run.vaultAllocations.length, 0), gross: sum(runs.map((run) => run.grossAmount)), deductions: sum(runs.map((run) => run.deductionsAmount)), appliedAdvances: sum(runs.map((run) => run.appliedAdvancesAmount)), sourceAdvances: sum(runs.map((run) => run.sourceAdvancesAmount)), advanceCarryoverEvidence: sum(runs.map((run) => run.advanceCarryoverEvidenceAmount)), net: sum(runs.map((run) => run.netAmount)), financialWrites: 0 as const }),
    });
  }

  async execute(context: TrustedTenantAdministratorContext, input: NurixHistoricalPayrollInput): Promise<NurixHistoricalPayrollReceipt> {
    // Do not permit an alternate caller to bypass the same read-only gate the
    // local script runs. No execution/control-plane row is created before it.
    const admission = await this.dryRun(context, input);
    const plan = this.plan(input);
    const employeeTargets = await this.employeeTargets(context.tenantId, admission.targetCompanyId, plan);
    const prepared = await this.prepare(context, admission.targetCompanyId, plan);
    if (prepared.pending) await this.commit(context, admission.targetCompanyId, prepared.id, plan, employeeTargets);
    return Object.freeze({ executionId: prepared.id, status: 'COMPLETED', archivedRuns: plan.runs.length, archivedLines: plan.totals.lines, archivedAccountingEvidence: plan.totals.invoiceEvidence + plan.totals.journalEvidence + plan.totals.vaultAllocations, sourceMaps: plan.runs.length + plan.totals.lines + plan.totals.invoiceEvidence + plan.totals.journalEvidence + plan.totals.vaultAllocations, financialWrites: 0 as const });
  }

  /**
   * V2 enriches already-archived V1 headers with source invoice, ledger, and
   * vault-allocation evidence. It never creates a header or line, and never
   * changes a V1 source checksum: the V2 checksum covers only the newly
   * discovered accounting proof. This is deliberately separate from execute
   * because completed V1 executions have an immutable old plan checksum.
   */
  async enrichAccountingEvidence(context: TrustedTenantAdministratorContext, input: NurixHistoricalPayrollInput): Promise<NurixHistoricalPayrollAccountingEnrichmentReceipt> {
    const admission = await this.dryRun(context, input);
    const plan = this.plan(input);
    if (plan.runs.some((run) => run.sourceInvoiceEvidence !== 'PRESENT' || run.sourceJournalEvidence !== 'PRESENT')) throw new ConflictException('V2 historical payroll enrichment requires invoice and journal source evidence for every run.');
    return this.requireDatabase().inTenantTransaction(context.tenantId, async (tx) => {
      const sourceRunIds = plan.runs.map((run) => run.sourceId);
      const headers = await tx.nurixHistoricalPayrollEvidence.findMany({ where: { tenantId: context.tenantId, companyId: admission.targetCompanyId, sourceCompanyId: plan.sourceCompanyId, sourceRunId: { in: sourceRunIds } }, select: { id: true, executionId: true, sourceRunId: true, sourceRunNumber: true, payrollMonth: true, netAmount: true, sourceChecksum: true, sourceInvoiceEvidence: true, sourceJournalEvidence: true } });
      const headersByRun = new Map<string, typeof headers[number]>();
      for (const header of headers) {
        if (headersByRun.has(header.sourceRunId)) throw new ConflictException(`Noorix payroll ${header.sourceRunId} has more than one V1 evidence header; V2 will not guess which header to enrich.`);
        headersByRun.set(header.sourceRunId, header);
      }
      if (headersByRun.size !== plan.runs.length) throw new NotFoundException('Every V2 accounting-evidence run must already have exactly one V1 historical payroll header.');
      const executionIds = new Set(headers.map((header) => header.executionId));
      if (executionIds.size !== 1) throw new ConflictException('The five V1 payroll headers are not from one immutable execution; V2 enrichment is blocked.');
      const executionId = headers[0]!.executionId;
      for (const run of plan.runs) {
        const header = headersByRun.get(run.sourceId)!;
        if (header.sourceRunNumber !== run.runNumber || header.payrollMonth.toISOString().slice(0, 10) !== run.payrollMonth || !decimal(header.netAmount.toFixed(4)).eq(decimal(run.netAmount))) throw new ConflictException(`V1 payroll evidence ${run.runNumber} does not match the frozen V2 accounting-evidence source.`);
      }
      const enrichmentChecksum = sha({ version: ACCOUNTING_ENRICHMENT_VERSION, packageId: plan.packageId, sourceCompanyId: plan.sourceCompanyId, executionId, runs: plan.runs.map((run) => ({ sourceRunId: run.sourceId, invoice: run.accountingDocuments.filter((document) => document.evidenceKind === 'PAYROLL_INVOICE').map((document) => ({ id: document.sourceId, checksum: document.sourceChecksum })), journals: run.accountingDocuments.filter((document) => document.evidenceKind === 'JOURNAL_ENTRY').map((document) => ({ id: document.sourceId, checksum: document.sourceChecksum })), allocations: run.vaultAllocations.map((allocation) => ({ id: allocation.sourceId, checksum: allocation.sourceChecksum })) })) });
      const summary = { version: ACCOUNTING_ENRICHMENT_VERSION, enrichmentChecksum, enrichedRuns: plan.runs.length, invoiceEvidence: plan.totals.invoiceEvidence, journalEvidence: plan.totals.journalEvidence, vaultAllocations: plan.totals.vaultAllocations, financialWrites: 0 as const };
      const receiptHash = sha(summary);
      let wave = await tx.nurixExcelFinancialWave.findUnique({ where: { executionId_sequence: { executionId, sequence: ACCOUNTING_ENRICHMENT_SEQUENCE } }, select: { id: true, status: true, reconciliationHash: true } });
      if (wave?.status === NurixExcelFinancialWaveStatus.COMMITTED) {
        if (wave.reconciliationHash !== receiptHash) throw new ConflictException('The completed V2 accounting-evidence receipt has a different source checksum.');
        return Object.freeze({ executionId, status: 'COMPLETED' as const, enrichedRuns: plan.runs.length, archivedAccountingEvidence: plan.totals.invoiceEvidence + plan.totals.journalEvidence + plan.totals.vaultAllocations, sourceMaps: plan.totals.invoiceEvidence + plan.totals.journalEvidence + plan.totals.vaultAllocations, financialWrites: 0 as const });
      }
      if (!wave) {
        wave = await tx.nurixExcelFinancialWave.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: admission.targetCompanyId, sequence: ACCOUNTING_ENRICHMENT_SEQUENCE, plannedItems: plan.totals.invoiceEvidence + plan.totals.journalEvidence + plan.totals.vaultAllocations }, select: { id: true, status: true, reconciliationHash: true } });
      }
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: NurixExcelFinancialWaveStatus.RUNNING, failedItems: 0 } });
      const rows = plan.runs.flatMap((run) => {
        const header = headersByRun.get(run.sourceId)!;
        return [
          ...run.accountingDocuments.map((document) => ({ id: deterministicUuid({ executionId, kind: document.evidenceKind, sourceId: document.sourceId }), runEvidenceId: header.id, evidenceKind: document.evidenceKind, sourceId: document.sourceId, sourceChecksum: document.sourceChecksum, sourceNumber: document.sourceNumber, sourceDate: document.sourceDate, vaultSourceId: null, amount: document.amount, sourceEntity: document.evidenceKind === 'PAYROLL_INVOICE' ? INVOICE : JOURNAL })),
          ...run.vaultAllocations.map((allocation) => ({ id: deterministicUuid({ executionId, kind: 'VAULT_ALLOCATION', sourceId: allocation.sourceId }), runEvidenceId: header.id, evidenceKind: 'VAULT_ALLOCATION' as const, sourceId: allocation.sourceId, sourceChecksum: allocation.sourceChecksum, sourceNumber: null, sourceDate: null, vaultSourceId: allocation.vaultSourceId, amount: allocation.amount, sourceEntity: VAULT })),
        ];
      });
      const existingEvidence = await tx.nurixHistoricalPayrollAccountingEvidence.findMany({ where: { tenantId: context.tenantId, executionId, OR: rows.map((row) => ({ evidenceKind: row.evidenceKind, sourceRecordId: row.sourceId })) }, select: { id: true, runEvidenceId: true, evidenceKind: true, sourceRecordId: true, sourceChecksum: true } });
      const existingByKey = new Map(existingEvidence.map((row) => [`${row.evidenceKind}:${row.sourceRecordId}`, row]));
      for (const row of rows) {
        const existing = existingByKey.get(`${row.evidenceKind}:${row.sourceId}`);
        if (existing && (existing.id !== row.id || existing.runEvidenceId !== row.runEvidenceId || existing.sourceChecksum !== row.sourceChecksum)) throw new ConflictException(`V2 accounting evidence ${row.evidenceKind}:${row.sourceId} conflicts with an existing immutable proof.`);
      }
      const missingEvidence = rows.filter((row) => !existingByKey.has(`${row.evidenceKind}:${row.sourceId}`));
      if (missingEvidence.length) await tx.nurixHistoricalPayrollAccountingEvidence.createMany({ data: missingEvidence.map((row) => ({ id: row.id, tenantId: context.tenantId, companyId: admission.targetCompanyId, executionId, runEvidenceId: row.runEvidenceId, evidenceKind: row.evidenceKind, sourceRecordId: row.sourceId, sourceChecksum: row.sourceChecksum, sourceNumber: row.sourceNumber, sourceDate: row.sourceDate ? new Date(row.sourceDate) : null, vaultSourceId: row.vaultSourceId, amount: row.amount ? decimal(row.amount) : null })) });
      const existingMaps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { executionId, OR: rows.map((row) => ({ sourceEntity: row.sourceEntity, sourceId: row.sourceId })) }, select: { sourceEntity: true, sourceId: true, sourceChecksum: true, targetEntity: true, targetId: true } });
      const mapsByKey = new Map(existingMaps.map((map) => [`${map.sourceEntity}:${map.sourceId}`, map]));
      for (const row of rows) {
        const existing = mapsByKey.get(`${row.sourceEntity}:${row.sourceId}`);
        if (existing && (existing.sourceChecksum !== row.sourceChecksum || existing.targetEntity !== 'NurixHistoricalPayrollAccountingEvidence' || existing.targetId !== row.id)) throw new ConflictException(`V2 source map ${row.sourceEntity}:${row.sourceId} conflicts with the accounting-evidence proof.`);
      }
      const missingMaps = rows.filter((row) => !mapsByKey.has(`${row.sourceEntity}:${row.sourceId}`));
      if (missingMaps.length) await tx.nurixExcelFinancialSourceMap.createMany({ data: missingMaps.map((row) => ({ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: admission.targetCompanyId, sourceEntity: row.sourceEntity, sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'NurixHistoricalPayrollAccountingEvidence', targetId: row.id, state: NurixExcelFinancialSourceMapState.APPLIED })) });
      await Promise.all(headers.map((header) => tx.nurixHistoricalPayrollEvidence.update({ where: { id: header.id }, data: { sourceInvoiceEvidence: 'PRESENT', sourceJournalEvidence: 'PRESENT' } })));
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: NurixExcelFinancialWaveStatus.COMMITTED, postedItems: 0, committedAt: new Date(), reconciliationHash: receiptHash } });
      await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId, sequence: ACCOUNTING_ENRICHMENT_SEQUENCE } }, create: { id: randomUUID(), executionId, waveId: wave.id, tenantId: context.tenantId, targetCompanyId: admission.targetCompanyId, sequence: ACCOUNTING_ENRICHMENT_SEQUENCE, kind: NurixExcelFinancialReceiptKind.RECONCILIATION, receiptSha256: receiptHash, summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId }, update: { waveId: wave.id, kind: NurixExcelFinancialReceiptKind.RECONCILIATION, receiptSha256: receiptHash, summaryJson: summary as Prisma.InputJsonValue } });
      // AuditEvent text fields are capped at 120 chars. Keep the complete V2
      // checksum in afterJson while using a stable, bounded request key.
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: admission.targetCompanyId, actorUserId: context.actorUserId, action: 'nurix.hist_payroll.accounting_evidence_v2', entityType: 'NurixExcelFinancialExecution', entityId: executionId, requestId: `nurix-hp-ae2:${executionId}:${enrichmentChecksum}`, afterJson: summary as Prisma.InputJsonValue } });
      return Object.freeze({ executionId, status: 'COMPLETED' as const, enrichedRuns: plan.runs.length, archivedAccountingEvidence: rows.length, sourceMaps: rows.length, financialWrites: 0 as const });
    });
  }

  /** Read-only admission gate used by the local runner before every write. */
  async dryRun(context: TrustedTenantAdministratorContext, input: NurixHistoricalPayrollInput): Promise<NurixHistoricalPayrollDryRunReceipt> {
    const plan = this.plan(input); const database = this.requireDatabase();
    const packageRow = await database.inTenantTransaction(context.tenantId, async (tx) => {
      const row = await tx.nurixExcelStagingPackage.findFirst({ where: { id: input.packageId, tenantId: context.tenantId, sourceCompanyId: input.sourceCompanyId, status: 'READY_FOR_RECONCILIATION' }, select: { targetCompanyId: true } });
      if (!row) throw new NotFoundException('The approved Excel package does not belong to this Noorix company.');
      return row;
    });
    const employees = await this.employeeTargets(context.tenantId, packageRow.targetCompanyId, plan);
    const paymentEvidence = { NONE: 0, AMOUNT_ONLY: 0 };
    for (const run of plan.runs) paymentEvidence[run.paymentEvidenceKind] += 1;
    return Object.freeze({ planChecksum: plan.checksum, targetCompanyId: packageRow.targetCompanyId, runs: plan.runs.length, lines: plan.totals.lines, mappedEmployees: employees.size, paymentEvidence: Object.freeze(paymentEvidence), totals: plan.totals, financialWrites: 0 as const });
  }

  private planRun(run: NurixHistoricalPayrollRun, runIds: Set<string>, runNumbers: Set<string>): Run {
    if (!sourceKey(run.sourceId) || runIds.has(run.sourceId) || !run.runNumber.trim() || runNumbers.has(run.runNumber)) throw new ConflictException('A Noorix payroll run source identity is empty or duplicated.');
    if (!DATE.test(run.payrollMonth) || run.payrollMonth.slice(8) !== '01') throw new ConflictException('Noorix payroll_month must be the first day of its actual month.');
    if (!timestamp(run.payrollAccruedAt) || run.payrollAccruedAt.slice(0, 10) < run.payrollMonth) throw new ConflictException('Noorix payroll approval evidence cannot predate its payroll period.');
    if (run.status.toLowerCase() !== 'completed') throw new ConflictException(`Noorix payroll ${run.runNumber} is not completed.`);
    if (!Number.isInteger(run.employeeCount) || run.employeeCount < 1 || run.employeeCount !== run.items.length) throw new ConflictException(`Noorix payroll ${run.runNumber} has an invalid employee count.`);
    if (run.paymentEvidenceKind === 'NONE' && (run.paymentEvidenceAmount !== null || run.paymentEvidenceAt !== null)) throw new ConflictException('NONE payroll payment evidence cannot carry an amount or date.');
    if (run.paymentEvidenceKind === 'AMOUNT_ONLY' && (!run.paymentEvidenceAmount || nonNegative(run.paymentEvidenceAmount, 'payment_evidence_amount').lte(0) || run.paymentEvidenceAt !== null)) throw new ConflictException('AMOUNT_ONLY payroll payment evidence requires only a positive source amount.');
    const sourceInvoiceEvidence = run.sourceInvoiceEvidence ?? 'NONE';
    const sourceJournalEvidence = run.sourceJournalEvidence ?? 'NONE';
    const documentIds = new Set<string>();
    const accountingDocuments = (run.accountingDocuments ?? []).map((document) => {
      if (!sourceKey(document.sourceId) || documentIds.has(`${document.evidenceKind}:${document.sourceId}`)) throw new ConflictException(`Noorix payroll ${run.runNumber} has an incomplete or duplicate accounting evidence source.`);
      documentIds.add(`${document.evidenceKind}:${document.sourceId}`);
      if ((document.sourceDate !== null && !timestamp(document.sourceDate)) || (document.amount !== null && nonNegative(document.amount, 'accounting_evidence_amount').lt(0))) throw new ConflictException(`Noorix payroll ${run.runNumber} accounting evidence is malformed.`);
      return Object.freeze({ ...document, sourceChecksum: sha({ kind: document.evidenceKind, id: document.sourceId, number: document.sourceNumber, date: document.sourceDate, amount: document.amount }) });
    });
    if ((sourceInvoiceEvidence === 'PRESENT') !== accountingDocuments.some((document) => document.evidenceKind === 'PAYROLL_INVOICE')) throw new ConflictException(`Noorix payroll ${run.runNumber} invoice-evidence availability does not match its source records.`);
    if ((sourceJournalEvidence === 'PRESENT') !== accountingDocuments.some((document) => document.evidenceKind === 'JOURNAL_ENTRY')) throw new ConflictException(`Noorix payroll ${run.runNumber} journal-evidence availability does not match its source records.`);
    const allocationIds = new Set<string>();
    const vaultAllocations = (run.vaultAllocations ?? []).map((allocation) => {
      if (!sourceKey(allocation.sourceId) || allocationIds.has(allocation.sourceId) || !sourceKey(allocation.vaultSourceId)) throw new ConflictException(`Noorix payroll ${run.runNumber} has an incomplete or duplicate vault allocation source.`);
      allocationIds.add(allocation.sourceId);
      const amount = positive(allocation.amount, 'vault_allocation_amount');
      return Object.freeze({ ...allocation, amount: fixed(amount), sourceChecksum: sha({ id: allocation.sourceId, vault: allocation.vaultSourceId, amount: fixed(amount) }) });
    });
    if (run.paymentEvidenceKind === 'NONE' && vaultAllocations.length) throw new ConflictException(`Noorix payroll ${run.runNumber} has vault allocations without payment evidence.`);
    runIds.add(run.sourceId); runNumbers.add(run.runNumber);
    const itemIds = new Set<string>(); const employees = new Set<string>();
    const items = run.items.map((item) => {
      if (!sourceKey(item.sourceId) || itemIds.has(item.sourceId) || !sourceKey(item.employeeSourceId) || employees.has(item.employeeSourceId)) throw new ConflictException(`Noorix payroll ${run.runNumber} has a duplicate or incomplete source line.`);
      itemIds.add(item.sourceId); employees.add(item.employeeSourceId);
      const basic = positive(item.grossSalary, 'gross_salary'); const allowances = nonNegative(item.allowancesAdd, 'allowances_add'); const deductions = nonNegative(item.deductions, 'deductions'); const sourceAdvance = nonNegative(item.advancesDeduct, 'advances_deduct'); const net = nonNegative(item.netSalary, 'net_salary');
      const gross = basic.plus(allowances); const beforeAdvance = gross.minus(deductions);
      if (beforeAdvance.lt(0)) throw new ConflictException(`Noorix payroll ${run.runNumber} has deductions greater than gross salary.`);
      // Noorix caps the final payable at zero. Preserve any excess advance as
      // historical evidence rather than producing a negative salary or debt.
      const appliedAdvance = Prisma.Decimal.min(sourceAdvance, beforeAdvance); const carryover = sourceAdvance.minus(appliedAdvance);
      if (!beforeAdvance.minus(appliedAdvance).eq(net)) throw new ConflictException(`Noorix payroll ${run.runNumber} line ${item.sourceId} does not reconcile to item.net_salary.`);
      return Object.freeze({ ...item, gross: fixed(gross), appliedAdvance: fixed(appliedAdvance), advanceCarryoverEvidence: fixed(carryover), sourceChecksum: sha({ id: item.sourceId, employee: item.employeeSourceId, basic: fixed(basic), allowances: fixed(allowances), deductions: fixed(deductions), sourceAdvance: fixed(sourceAdvance), net: fixed(net) }) });
    });
    const sum = (values: readonly string[]) => values.reduce((total, value) => total.plus(decimal(value)), new Prisma.Decimal(0));
    const grossAmount = sum(items.map((item) => item.gross)); const deductionsAmount = sum(items.map((item) => item.deductions)); const appliedAdvancesAmount = sum(items.map((item) => item.appliedAdvance)); const sourceAdvancesAmount = sum(items.map((item) => item.advancesDeduct)); const advanceCarryoverEvidenceAmount = sum(items.map((item) => item.advanceCarryoverEvidence)); const netAmount = sum(items.map((item) => item.netSalary));
    if (!netAmount.eq(decimal(run.totalAmount))) throw new ConflictException(`Noorix payroll ${run.runNumber} total does not reconcile to source item.net_salary.`);
    if (run.paymentEvidenceKind === 'AMOUNT_ONLY' && !decimal(run.paymentEvidenceAmount!).eq(netAmount)) throw new ConflictException(`Noorix payroll ${run.runNumber} payment evidence does not match its source net amount.`);
    // When Noorix has an actual salary invoice and active ledger evidence, it
    // is not enough to merely archive a flag. Require the exact SAL run
    // invoice, its amount, every source journal amount, and the allocation
    // split to reconcile to the immutable payroll net. This is still evidence
    // only: no Baseer invoice, journal, payment, or vault movement is made.
    if (sourceInvoiceEvidence === 'PRESENT') {
      const invoices = accountingDocuments.filter((document) => document.evidenceKind === 'PAYROLL_INVOICE');
      if (invoices.length !== 1 || invoices[0]?.sourceNumber !== `SAL-${run.runNumber}` || !invoices[0].sourceDate || !invoices[0].amount || !decimal(invoices[0].amount).eq(netAmount)) throw new ConflictException(`Noorix payroll ${run.runNumber} salary invoice evidence must be one active SAL-${run.runNumber} invoice matching the source net amount.`);
    }
    if (sourceJournalEvidence === 'PRESENT') {
      const journals = accountingDocuments.filter((document) => document.evidenceKind === 'JOURNAL_ENTRY');
      if (!journals.length || journals.some((document) => !document.sourceDate || !document.amount) || !sum(journals.map((document) => document.amount!)).eq(netAmount)) throw new ConflictException(`Noorix payroll ${run.runNumber} active source ledger evidence does not reconcile to its source net amount.`);
      const journalAmounts = new Map(journals.map((document) => [document.sourceId, document.amount!]));
      if (vaultAllocations.length !== journals.length || vaultAllocations.some((allocation) => !journalAmounts.has(allocation.sourceId) || !decimal(journalAmounts.get(allocation.sourceId)!).eq(decimal(allocation.amount)))) throw new ConflictException(`Noorix payroll ${run.runNumber} ledger allocation evidence must preserve every source journal split exactly.`);
    }
    // Older evidence fixtures can assert AMOUNT_ONLY without source allocation
    // rows. A real local run always provides the rows; when present they must
    // reconcile exactly and are then archived as isolated evidence.
    if (run.paymentEvidenceKind === 'AMOUNT_ONLY' && vaultAllocations.length && !vaultAllocations.reduce((sum, allocation) => sum.plus(decimal(allocation.amount)), new Prisma.Decimal(0)).eq(decimal(run.paymentEvidenceAmount!))) throw new ConflictException(`Noorix payroll ${run.runNumber} vault allocations do not reconcile to source payment evidence.`);
    return Object.freeze({ ...run, sourceInvoiceEvidence, sourceJournalEvidence, accountingDocuments: Object.freeze(accountingDocuments), vaultAllocations: Object.freeze(vaultAllocations), items: Object.freeze(items), grossAmount: fixed(grossAmount), deductionsAmount: fixed(deductionsAmount), appliedAdvancesAmount: fixed(appliedAdvancesAmount), sourceAdvancesAmount: fixed(sourceAdvancesAmount), advanceCarryoverEvidenceAmount: fixed(advanceCarryoverEvidenceAmount), netAmount: fixed(netAmount), sourceChecksum: sha({ id: run.sourceId, number: run.runNumber, payrollMonth: run.payrollMonth, sourceAccruedAt: run.payrollAccruedAt, status: run.status, total: fixed(decimal(run.totalAmount)), employees: run.employeeCount, paymentEvidenceKind: run.paymentEvidenceKind, paymentEvidenceAmount: run.paymentEvidenceAmount, paymentEvidenceAt: run.paymentEvidenceAt, sourceInvoiceEvidence, sourceJournalEvidence, accounting: accountingDocuments.map((document) => ({ kind: document.evidenceKind, id: document.sourceId, checksum: document.sourceChecksum })), vaults: vaultAllocations.map((allocation) => ({ id: allocation.sourceId, checksum: allocation.sourceChecksum })), lines: items.map((item) => ({ id: item.sourceId, checksum: item.sourceChecksum })) }) });
  }

  private async employeeTargets(tenantId: string, companyId: string, plan: NurixHistoricalPayrollPlan) {
    const sourceIds = [...new Set(plan.runs.flatMap((run) => run.items.map((item) => item.employeeSourceId)))];
    return this.requireDatabase().inTenantTransaction(tenantId, async (tx) => {
      const rows = await tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: sourceIds }, status: { in: ['CREATED', 'REUSED'] }, execution: { targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
      const targets = new Map<string, Set<string>>();
      for (const row of rows) if (row.targetId) targets.set(row.sourceId, new Set([...(targets.get(row.sourceId) ?? []), row.targetId]));
      if (targets.size !== sourceIds.length || [...targets.values()].some((ids) => ids.size !== 1)) throw new ConflictException('All Noorix historical payroll employees need one unambiguous Baseer lineage map before evidence can be closed.');
      return new Map([...targets.entries()].map(([sourceId, ids]) => [sourceId, [...ids][0]! ]));
    });
  }

  private async prepare(context: TrustedTenantAdministratorContext, companyId: string, plan: NurixHistoricalPayrollPlan) {
    return this.requireDatabase().inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId: plan.packageId, tenantId: context.tenantId, transformVersion: VERSION }, select: { id: true, status: true, financialPlanSha256: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== plan.checksum) throw new ConflictException('The historical payroll source snapshot changed; create a new package revision instead of resuming it.');
        if (existing.status === NurixExcelFinancialExecutionStatus.COMPLETED) return { id: existing.id, pending: false };
        if (existing.status !== NurixExcelFinancialExecutionStatus.APPROVED && existing.status !== NurixExcelFinancialExecutionStatus.FAILED) throw new ConflictException('The historical payroll evidence execution is not safely resumable.');
        return { id: existing.id, pending: true };
      }
      const id = randomUUID(); const waveId = randomUUID();
      await tx.nurixExcelFinancialExecution.create({ data: { id, packageId: plan.packageId, tenantId: context.tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: plan.checksum, status: NurixExcelFinancialExecutionStatus.APPROVED, reason: 'Noorix historical payroll evidence only; no payroll, payment, journal, or employee movement is created.', requestedByUserId: context.actorUserId, approvedByUserId: context.actorUserId, approvedAt: new Date() } });
      await tx.nurixExcelFinancialWave.create({ data: { id: waveId, executionId: id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: 1, plannedItems: plan.runs.length } });
      await tx.nurixExcelFinancialItem.createMany({ data: plan.runs.map((run) => ({ id: randomUUID(), executionId: id, waveId, tenantId: context.tenantId, targetCompanyId: companyId, sourceSheet: 'HistoricalPayrollRuns', sourceEntity: RUN, sourceId: run.sourceId, sourceChecksum: run.sourceChecksum, operationKey: sha({ version: VERSION, sourceId: run.sourceId, checksum: run.sourceChecksum }), status: NurixExcelFinancialItemStatus.PENDING })) });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix.historical_payroll_evidence_prepared', entityType: 'NurixExcelFinancialExecution', entityId: id, requestId: `nurix-historical-payroll-evidence:${id}`, afterJson: { planChecksum: plan.checksum, ...plan.totals } as Prisma.InputJsonValue } });
      return { id, pending: true };
    });
  }

  private async commit(context: TrustedTenantAdministratorContext, companyId: string, executionId: string, plan: NurixHistoricalPayrollPlan, employeeTargets: ReadonlyMap<string, string>) {
    try {
      await this.requireDatabase().inTenantTransaction(context.tenantId, async (tx) => {
        const wave = await tx.nurixExcelFinancialWave.findFirstOrThrow({ where: { executionId, tenantId: context.tenantId, targetCompanyId: companyId, sequence: 1 }, select: { id: true } });
        const pending = await tx.nurixExcelFinancialItem.findMany({ where: { executionId, tenantId: context.tenantId, status: NurixExcelFinancialItemStatus.PENDING }, select: { id: true, sourceId: true, sourceChecksum: true } });
        const planned = new Map(plan.runs.map((run) => [run.sourceId, run]));
        for (const item of pending) {
          const run = planned.get(item.sourceId);
          if (!run || item.sourceChecksum !== run.sourceChecksum) throw new ConflictException('A historical payroll receipt differs from its immutable source plan.');
          const existing = await tx.nurixHistoricalPayrollEvidence.findUnique({ where: { tenantId_executionId_sourceRunId: { tenantId: context.tenantId, executionId, sourceRunId: run.sourceId } }, select: { id: true, sourceChecksum: true } });
          if (existing && existing.sourceChecksum !== run.sourceChecksum) throw new ConflictException('A historical payroll evidence header has a different checksum.');
          const evidenceId = existing?.id ?? randomUUID();
          if (!existing) {
            const lineRows = run.items.map((line) => ({ id: randomUUID(), line }));
            await tx.nurixHistoricalPayrollEvidence.create({ data: { id: evidenceId, tenantId: context.tenantId, companyId, executionId, sourceCompanyId: plan.sourceCompanyId, sourceRunId: run.sourceId, sourceChecksum: run.sourceChecksum, sourceRunNumber: run.runNumber, payrollMonth: new Date(`${run.payrollMonth}T00:00:00.000Z`), sourceAccruedAt: new Date(run.payrollAccruedAt), sourceStatus: run.status, employeeCount: run.employeeCount, grossAmount: decimal(run.grossAmount), deductionsAmount: decimal(run.deductionsAmount), appliedAdvancesAmount: decimal(run.appliedAdvancesAmount), sourceAdvancesAmount: decimal(run.sourceAdvancesAmount), advanceCarryoverEvidenceAmount: decimal(run.advanceCarryoverEvidenceAmount), netAmount: decimal(run.netAmount), paymentEvidenceKind: run.paymentEvidenceKind, paymentEvidenceAmount: run.paymentEvidenceAmount ? decimal(run.paymentEvidenceAmount) : null, paymentEvidenceAt: run.paymentEvidenceAt ? new Date(run.paymentEvidenceAt) : null, sourceInvoiceEvidence: run.sourceInvoiceEvidence, sourceJournalEvidence: run.sourceJournalEvidence, status: 'EVIDENCE_ONLY', notes: 'Noorix historical payroll evidence only. This record cannot be approved, paid, posted, or treated as an employee balance.', createdByUserId: context.actorUserId } });
            await tx.nurixHistoricalPayrollLineEvidence.createMany({ data: lineRows.map(({ id, line }) => ({ id, tenantId: context.tenantId, companyId, executionId, runEvidenceId: evidenceId, sourceItemId: line.sourceId, sourceChecksum: line.sourceChecksum, employeeSourceId: line.employeeSourceId, employeeId: employeeTargets.get(line.employeeSourceId) ?? null, grossSalary: decimal(line.grossSalary), allowancesAdd: decimal(line.allowancesAdd), deductionsAmount: decimal(line.deductions), sourceAdvancesAmount: decimal(line.advancesDeduct), appliedAdvancesAmount: decimal(line.appliedAdvance), advanceCarryoverEvidence: decimal(line.advanceCarryoverEvidence), netSalary: decimal(line.netSalary) })) });
            await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: RUN, sourceId: run.sourceId, sourceChecksum: run.sourceChecksum, targetEntity: 'NurixHistoricalPayrollEvidence', targetId: evidenceId, state: NurixExcelFinancialSourceMapState.APPLIED } });
            await tx.nurixExcelFinancialSourceMap.createMany({ data: lineRows.map(({ id, line }) => ({ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: LINE, sourceId: line.sourceId, sourceChecksum: line.sourceChecksum, targetEntity: 'NurixHistoricalPayrollLineEvidence', targetId: id, state: NurixExcelFinancialSourceMapState.APPLIED })) });
            await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId, actorUserId: context.actorUserId, action: 'nurix.historical_payroll_evidence_archived', entityType: 'NurixHistoricalPayrollEvidence', entityId: evidenceId, requestId: `nurix-historical-payroll-evidence:${executionId}:${run.sourceId}`, afterJson: { sourceId: run.sourceId, sourceChecksum: run.sourceChecksum, sourceRunNumber: run.runNumber, payrollMonth: run.payrollMonth, sourceAccruedAt: run.payrollAccruedAt, paymentEvidenceKind: run.paymentEvidenceKind, paymentEvidenceAmount: run.paymentEvidenceAmount, paymentEvidenceAt: run.paymentEvidenceAt, employees: run.employeeCount, gross: run.grossAmount, deductions: run.deductionsAmount, appliedAdvances: run.appliedAdvancesAmount, sourceAdvances: run.sourceAdvancesAmount, advanceCarryoverEvidence: run.advanceCarryoverEvidenceAmount, net: run.netAmount, treatment: 'EVIDENCE_ONLY_NO_HR_PAYROLL_OR_FINANCIAL_WRITE', financialWrites: 0 } as Prisma.InputJsonValue } });
          }
          // These are real standalone source-evidence rows, never target
          // invoices, journals, payment allocations, or vault movements. The
          // deterministic IDs make a resumed execution enrich, not duplicate.
          const accountingRows = [
            ...run.accountingDocuments.map((document) => ({ evidenceKind: document.evidenceKind, sourceId: document.sourceId, sourceChecksum: document.sourceChecksum, sourceNumber: document.sourceNumber, sourceDate: document.sourceDate, vaultSourceId: null, amount: document.amount, sourceEntity: document.evidenceKind === 'PAYROLL_INVOICE' ? INVOICE : JOURNAL })),
            ...run.vaultAllocations.map((allocation) => ({ evidenceKind: 'VAULT_ALLOCATION' as const, sourceId: allocation.sourceId, sourceChecksum: allocation.sourceChecksum, sourceNumber: null, sourceDate: null, vaultSourceId: allocation.vaultSourceId, amount: allocation.amount, sourceEntity: VAULT })),
          ];
          if (accountingRows.length) {
            const rows = accountingRows.map((row) => ({ ...row, id: deterministicUuid({ executionId, kind: row.evidenceKind, sourceId: row.sourceId }) }));
            await tx.nurixHistoricalPayrollAccountingEvidence.createMany({ skipDuplicates: true, data: rows.map((row) => ({ id: row.id, tenantId: context.tenantId, companyId, executionId, runEvidenceId: evidenceId, evidenceKind: row.evidenceKind, sourceRecordId: row.sourceId, sourceChecksum: row.sourceChecksum, sourceNumber: row.sourceNumber, sourceDate: row.sourceDate ? new Date(row.sourceDate) : null, vaultSourceId: row.vaultSourceId, amount: row.amount ? decimal(row.amount) : null })) });
            await tx.nurixExcelFinancialSourceMap.createMany({ skipDuplicates: true, data: rows.map((row) => ({ id: randomUUID(), executionId, tenantId: context.tenantId, targetCompanyId: companyId, sourceEntity: row.sourceEntity, sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'NurixHistoricalPayrollAccountingEvidence', targetId: row.id, state: NurixExcelFinancialSourceMapState.APPLIED })) });
          }
          await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: NurixExcelFinancialItemStatus.EXCLUDED, targetEntity: 'NurixHistoricalPayrollEvidence', targetId: evidenceId, resultCode: 'HISTORICAL_EVIDENCE_ARCHIVED' } });
        }
        if (await tx.nurixExcelFinancialItem.count({ where: { executionId, tenantId: context.tenantId, status: NurixExcelFinancialItemStatus.PENDING } })) throw new ConflictException('Historical payroll evidence did not commit every planned run.');
        const summary = { ...plan.totals, sourceMaps: plan.runs.length + plan.totals.lines + plan.totals.invoiceEvidence + plan.totals.journalEvidence + plan.totals.vaultAllocations };
        await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: NurixExcelFinancialWaveStatus.COMMITTED, postedItems: 0, committedAt: new Date(), reconciliationHash: sha(summary) } });
        await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId, sequence: 1 } }, create: { id: randomUUID(), executionId, waveId: wave.id, tenantId: context.tenantId, targetCompanyId: companyId, sequence: 1, kind: NurixExcelFinancialReceiptKind.RECONCILIATION, receiptSha256: sha(summary), summaryJson: summary as Prisma.InputJsonValue, createdByUserId: context.actorUserId }, update: { waveId: wave.id, kind: NurixExcelFinancialReceiptKind.RECONCILIATION, receiptSha256: sha(summary), summaryJson: summary as Prisma.InputJsonValue } });
        await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: NurixExcelFinancialExecutionStatus.COMPLETED, waveSequence: 1, reason: null } });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : 'Historical payroll evidence failed.';
      await this.requireDatabase().inTenantTransaction(context.tenantId, async (tx) => {
        await tx.nurixExcelFinancialWave.updateMany({ where: { executionId, tenantId: context.tenantId, targetCompanyId: companyId, status: { in: [NurixExcelFinancialWaveStatus.PENDING, NurixExcelFinancialWaveStatus.RUNNING] } }, data: { status: NurixExcelFinancialWaveStatus.FAILED, failedItems: 1 } });
        await tx.nurixExcelFinancialExecution.updateMany({ where: { id: executionId, tenantId: context.tenantId, targetCompanyId: companyId }, data: { status: NurixExcelFinancialExecutionStatus.FAILED, reason } });
      });
      throw error;
    }
  }

  private requireDatabase() { if (!this.database) throw new ConflictException('The historical payroll evidence writer is not connected to the database service.'); return this.database; }
}

function sha(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function deterministicUuid(value: unknown) {
  const hash = sha(value);
  // RFC 4122 variant/version bits make this a stable UUID accepted by Prisma;
  // it is an evidence identity only, not a source or target financial ID.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function uuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function sourceKey(value: string) { return Boolean(value?.trim()) && value.length <= 160; }
function decimal(value: string) { if (!MONEY.test(value)) throw new ConflictException('A Noorix payroll amount is malformed.'); return new Prisma.Decimal(value); }
function positive(value: string, field: string) { const parsed = decimal(value); if (parsed.lte(0)) throw new ConflictException(`Noorix ${field} must be positive.`); return parsed; }
function nonNegative(value: string, field: string) { const parsed = decimal(value); if (parsed.lt(0)) throw new ConflictException(`Noorix ${field} must not be negative.`); return parsed; }
function fixed(value: Prisma.Decimal) { return value.toFixed(4); }
function timestamp(value: string) { return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(new Date(value).getTime()); }

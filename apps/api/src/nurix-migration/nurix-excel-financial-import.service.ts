import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Historical Noorix finance import boundary.
 *
 * This is intentionally a service skeleton, not an HTTP path and not a
 * database writer yet.  The control-plane tables and the atomic writer are
 * deliberately separate follow-up work.  Keeping the planner here lets us
 * prove the exact financial shape before connecting it to a controller.
 *
 * Important: the normal PurchaseExpenseService derives VAT from the current
 * company configuration.  This planner instead preserves the source net, VAT
 * and gross amounts and uses the source ledger as the accounting truth.
 */

const SCALE = 10_000n;
const MONEY = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type NurixHistoricalInvoice = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  sourceCompanyId: string;
  kind: 'purchase' | 'expense' | string;
  status: 'active' | 'cancelled' | string;
  documentNumber: string;
  supplierSourceId: string;
  categoryCode: string;
  vaultSourceId: string;
  transactionDate: string;
  invoiceDate: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  notes?: string;
}>;

export type NurixHistoricalAllocation = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  invoiceSourceId: string;
  vaultSourceId: string;
  paymentMethodSourceId?: string;
  amount: string;
}>;

export type NurixHistoricalLedgerEntry = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  sourceCompanyId: string;
  referenceEntity: string;
  referenceSourceId: string;
  debitAccountSourceId: string;
  creditAccountSourceId: string;
  vaultSourceId: string;
  entryDate: string;
  amount: string;
  status: 'active' | 'cancelled' | string;
  notes?: string;
}>;

export type NurixHistoricalTargetAccount = Readonly<{ id: string; active: boolean; code: string }>;
export type NurixHistoricalTargetSupplier = Readonly<{ id: string; active: boolean }>;
export type NurixHistoricalTargetVault = Readonly<{
  id: string;
  active: boolean;
  paymentDestination: boolean;
  accountId: string;
  defaultPaymentMethod: string;
  paymentMethods: readonly string[];
}>;
export type NurixHistoricalTargetCategory = Readonly<{
  id: string;
  active: boolean;
  posting: boolean;
  accountId: string | null;
  kind: 'PURCHASE' | 'EXPENSE' | string;
}>;

/** A frozen mapping snapshot, supplied only after the master-data gate. */
export type NurixHistoricalMappingSnapshot = Readonly<{
  checksum: string;
  accountsBySourceId: Readonly<Record<string, NurixHistoricalTargetAccount>>;
  suppliersBySourceId: Readonly<Record<string, NurixHistoricalTargetSupplier>>;
  vaultsBySourceId: Readonly<Record<string, NurixHistoricalTargetVault>>;
  categoriesByCode: Readonly<Record<string, NurixHistoricalTargetCategory>>;
}>;

export type NurixHistoricalFinancePlanInput = Readonly<{
  packageId: string;
  workbookSha256: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  mapping: NurixHistoricalMappingSnapshot;
  invoices: readonly NurixHistoricalInvoice[];
  allocations: readonly NurixHistoricalAllocation[];
  ledgerEntries: readonly NurixHistoricalLedgerEntry[];
}>;

export type NurixHistoricalFinanceIssueCode =
  | 'PACKAGE_EVIDENCE_INVALID'
  | 'SOURCE_ID_DUPLICATE'
  | 'SOURCE_COMPANY_MISMATCH'
  | 'INVOICE_STATUS_UNSUPPORTED'
  | 'INVOICE_KIND_UNSUPPORTED'
  | 'AMOUNT_INVALID'
  | 'INVOICE_TOTAL_MISMATCH'
  | 'ALLOCATION_ORPHAN'
  | 'ALLOCATION_TOTAL_MISMATCH'
  | 'LEDGER_ORPHAN'
  | 'LEDGER_CARDINALITY_INVALID'
  | 'LEDGER_REFERENCE_INVALID'
  | 'LEDGER_STATUS_UNSUPPORTED'
  | 'LEDGER_AMOUNT_MISMATCH'
  | 'LEDGER_DATE_MISMATCH'
  | 'LEDGER_VAULT_MISMATCH'
  | 'MAPPING_MISSING'
  | 'MAPPING_INACTIVE'
  | 'CATEGORY_DEFINITION_INVALID'
  | 'CATEGORY_POSTING_ACCOUNT_MISMATCH'
  | 'VAULT_ACCOUNT_MISMATCH'
  | 'PAYMENT_METHOD_UNSUPPORTED'
  | 'DATE_INVALID';

export type NurixHistoricalFinanceIssue = Readonly<{
  code: NurixHistoricalFinanceIssueCode;
  sourceEntity: 'Invoice' | 'InvoiceAllocation' | 'LedgerEntry' | 'Package';
  sourceId: string;
}>;

export type NurixHistoricalFinancialPlanItem = Readonly<{
  sourceInvoiceId: string;
  sourceInvoiceChecksum: string;
  /** Every accepted source ledger row remains independently traceable. */
  sourceLedgers: readonly Readonly<{ sourceId: string; sourceChecksum: string; notes?: string }> [];
  sourceReference: string;
  businessDate: string;
  supplierInvoiceDate: string;
  kind: 'PURCHASE' | 'EXPENSE';
  documentNumber: string;
  supplierId: string;
  categoryId: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  /** Original Noorix text; it is payload, not a migration annotation. */
  sourceNotes?: string;
  journalLines: readonly Readonly<{ accountId: string; debitAmount: string; creditAmount: string }>[];
  allocations: readonly Readonly<{ sourceAllocationId: string; sourceChecksum: string; vaultId: string; grossAmount: string; paymentMethod: string }>[];
}>;

export type NurixHistoricalFinancePlan = Readonly<{
  packageId: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  mappingChecksum: string;
  planChecksum: string;
  issues: readonly NurixHistoricalFinanceIssue[];
  items: readonly NurixHistoricalFinancialPlanItem[];
  totals: Readonly<{ invoices: number; allocations: number; ledgerEntries: number; grossAmount: string; debitAmount: string; creditAmount: string }>;
  canExecute: boolean;
}>;

/**
 * Port to be implemented only after a durable financial execution/item schema
 * exists. `commitWave` MUST own one DB transaction containing: source receipts,
 * LegacyMigrationRecordMap rows, FinanceOutflowDocument, allocations, journal,
 * cash projection, audit event, and final item status.  It is explicitly not a
 * best-effort loop of independent database writes.
 */
export type NurixHistoricalFinancialWavePort = Readonly<{
  claim: (input: Readonly<{ packageId: string; planChecksum: string; leaseToken: string }>) => Promise<Readonly<{ executionId: string }> | null>;
  pendingSourceInvoiceIds: (executionId: string, limit: number) => Promise<readonly string[]>;
  commitWave: (input: Readonly<{ executionId: string; leaseToken: string; items: readonly NurixHistoricalFinancialPlanItem[] }>) => Promise<Readonly<{ processed: number; remaining: number; completed: boolean }>>;
  release: (input: Readonly<{ executionId: string; leaseToken: string; failed: boolean }>) => Promise<void>;
}>;

export type NurixHistoricalFinancialExecutionReceipt = Readonly<{
  executionId: string;
  processed: number;
  remaining: number;
  waves: number;
  completed: boolean;
}>;

@Injectable()
export class NurixExcelFinancialImportService {
  /** Pure, fail-closed plan. It does not read or write the database. */
  plan(input: NurixHistoricalFinancePlanInput): NurixHistoricalFinancePlan {
    const issues: NurixHistoricalFinanceIssue[] = [];
    if (!input.packageId || !SHA256.test(input.workbookSha256) || !SHA256.test(input.mapping.checksum)) {
      this.issue(issues, 'PACKAGE_EVIDENCE_INVALID', 'Package', input.packageId || 'package');
    }

    const invoicesById = this.unique(input.invoices, 'Invoice', issues);
    const allocationsByInvoice = new Map<string, NurixHistoricalAllocation[]>();
    for (const allocation of input.allocations) {
      if (!this.acceptSourceId(allocation.sourceId, allocation.sourceChecksum, 'InvoiceAllocation', issues)) continue;
      if (!invoicesById.has(allocation.invoiceSourceId)) {
        this.issue(issues, 'ALLOCATION_ORPHAN', 'InvoiceAllocation', allocation.sourceId);
        continue;
      }
      const list = allocationsByInvoice.get(allocation.invoiceSourceId) ?? [];
      list.push(allocation);
      allocationsByInvoice.set(allocation.invoiceSourceId, list);
    }

    const ledgersByInvoice = new Map<string, NurixHistoricalLedgerEntry[]>();
    for (const ledger of this.unique(input.ledgerEntries, 'LedgerEntry', issues).values()) {
      if (ledger.sourceCompanyId !== input.sourceCompanyId) this.issue(issues, 'SOURCE_COMPANY_MISMATCH', 'LedgerEntry', ledger.sourceId);
      if (ledger.referenceEntity.trim().toLowerCase() !== 'invoice' || !invoicesById.has(ledger.referenceSourceId)) {
        this.issue(issues, 'LEDGER_ORPHAN', 'LedgerEntry', ledger.sourceId);
        continue;
      }
      const list = ledgersByInvoice.get(ledger.referenceSourceId) ?? [];
      list.push(ledger);
      ledgersByInvoice.set(ledger.referenceSourceId, list);
    }

    const items: NurixHistoricalFinancialPlanItem[] = [];
    let grossTotal = 0n;
    let debitTotal = 0n;
    let creditTotal = 0n;
    for (const invoice of [...invoicesById.values()].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.sourceId.localeCompare(b.sourceId))) {
      const before = issues.length;
      this.validateInvoiceScope(invoice, input, issues);
      const net = parseMoney(invoice.netAmount);
      const tax = parseMoney(invoice.taxAmount);
      const gross = parseMoney(invoice.grossAmount);
      if (net === null || tax === null || gross === null || gross <= 0n) this.issue(issues, 'AMOUNT_INVALID', 'Invoice', invoice.sourceId);
      else if (net + tax !== gross) this.issue(issues, 'INVOICE_TOTAL_MISMATCH', 'Invoice', invoice.sourceId);
      const businessDate = parseSourceDate(invoice.transactionDate);
      const invoiceDate = parseSourceDate(invoice.invoiceDate);
      if (!businessDate || !invoiceDate) this.issue(issues, 'DATE_INVALID', 'Invoice', invoice.sourceId);

      const category = input.mapping.categoriesByCode[invoice.categoryCode];
      const supplier = input.mapping.suppliersBySourceId[invoice.supplierSourceId];
      this.validateCategory(category, invoice, issues);
      this.validateMapped(supplier, 'Invoice', invoice.sourceId, issues);

      const allocations = allocationsByInvoice.get(invoice.sourceId) ?? [];
      const allocationPlans = this.validateAllocations(allocations, invoice, input.mapping, issues);
      const ledgers = ledgersByInvoice.get(invoice.sourceId) ?? [];
      this.validateLedgers(ledgers, invoice, gross, businessDate, input.mapping, issues);

      if (issues.length !== before || net === null || tax === null || gross === null || !businessDate || !invoiceDate || !ledgers.length || !category?.accountId || !supplier || !allocationPlans.length) continue;
      const amount = formatMoney(gross);
      items.push(Object.freeze({
        sourceInvoiceId: invoice.sourceId,
        sourceInvoiceChecksum: invoice.sourceChecksum,
        sourceLedgers: Object.freeze(ledgers.map((ledger) => Object.freeze({ sourceId: ledger.sourceId, sourceChecksum: ledger.sourceChecksum, ...(ledger.notes ? { notes: ledger.notes } : {}) }))),
        sourceReference: sourceReference(input.sourceCompanyId, invoice.sourceId),
        businessDate,
        supplierInvoiceDate: invoiceDate,
        kind: invoice.kind.trim().toLowerCase() === 'purchase' ? 'PURCHASE' : 'EXPENSE',
        documentNumber: invoice.documentNumber,
        supplierId: supplier.id,
        categoryId: category.id,
        netAmount: formatMoney(net),
        taxAmount: formatMoney(tax),
        grossAmount: amount,
        ...(invoice.notes ? { sourceNotes: invoice.notes } : {}),
        journalLines: Object.freeze([
          // Category is the canonical reporting classification.  Noorix's
          // original debit account remains source evidence in the journal
          // annotation, but cannot make cash and P&L reports disagree.
          Object.freeze({ accountId: category.accountId, debitAmount: amount, creditAmount: '0.0000' }),
          // Allocations are the cash-settlement evidence.  Their aggregate
          // must reconcile to gross, so each destination receives its own
          // credit rather than collapsing a multi-vault source settlement.
          ...allocationPlans.map((allocation) => Object.freeze({ accountId: this.vaultAccountId(input.mapping, allocation.vaultId), debitAmount: '0.0000', creditAmount: allocation.grossAmount })),
        ]),
        allocations: Object.freeze(allocationPlans),
      }));
      grossTotal += gross;
      debitTotal += gross;
      creditTotal += gross;
    }
    const planChecksum = sha({
      version: 'nurix-historical-finance-plan/v1', packageId: input.packageId, workbookSha256: input.workbookSha256,
      mappingChecksum: input.mapping.checksum, itemReceipts: items.map((item) => ({ invoice: item.sourceInvoiceId, invoiceChecksum: item.sourceInvoiceChecksum, ledgers: item.sourceLedgers, sourceReference: item.sourceReference, sourceNotes: item.sourceNotes ?? null })),
    });
    return Object.freeze({
      packageId: input.packageId, sourceCompanyId: input.sourceCompanyId, targetCompanyId: input.targetCompanyId,
      mappingChecksum: input.mapping.checksum, planChecksum, issues: Object.freeze(issues), items: Object.freeze(items),
      totals: Object.freeze({ invoices: input.invoices.length, allocations: input.allocations.length, ledgerEntries: input.ledgerEntries.length, grossAmount: formatMoney(grossTotal), debitAmount: formatMoney(debitTotal), creditAmount: formatMoney(creditTotal) }),
      canExecute: issues.length === 0 && items.length === input.invoices.length && debitTotal === creditTotal,
    });
  }

  /**
   * Resumable coordinator. It cannot write until a later adapter implements
   * the required atomic `commitWave` transaction described above.
   */
  async execute(plan: NurixHistoricalFinancePlan, port: NurixHistoricalFinancialWavePort, waveSize: number): Promise<NurixHistoricalFinancialExecutionReceipt> {
    if (!plan.canExecute) throw new ConflictException('The historical financial plan has blockers and cannot be executed.');
    if (!Number.isInteger(waveSize) || waveSize < 1 || waveSize > 100) throw new ConflictException('Financial wave size must be between 1 and 100.');
    const leaseToken = randomUUID();
    const claim = await port.claim({ packageId: plan.packageId, planChecksum: plan.planChecksum, leaseToken });
    if (!claim) throw new ConflictException('A financial migration wave is already running or its control plane is unavailable.');
    const byId = new Map(plan.items.map((item) => [item.sourceInvoiceId, item]));
    let processed = 0;
    let remaining = plan.items.length;
    try {
      for (let wave = 1; wave <= 1_000; wave += 1) {
        const pending = await port.pendingSourceInvoiceIds(claim.executionId, waveSize);
        if (!pending.length) return Object.freeze({ executionId: claim.executionId, processed, remaining: 0, waves: wave - 1, completed: true });
        const items = pending.map((sourceId) => byId.get(sourceId)).filter((item): item is NurixHistoricalFinancialPlanItem => Boolean(item));
        if (items.length !== pending.length) throw new ConflictException('A persisted financial receipt does not match the immutable plan.');
        const receipt = await port.commitWave({ executionId: claim.executionId, leaseToken, items });
        if (receipt.processed !== items.length || receipt.processed === 0) throw new ConflictException('The financial wave made no safe progress.');
        processed += receipt.processed;
        remaining = receipt.remaining;
        if (receipt.completed) return Object.freeze({ executionId: claim.executionId, processed, remaining, waves: wave, completed: true });
      }
      throw new ConflictException('Financial migration paused after 1,000 committed waves; resume the same plan.');
    } catch (error) {
      await port.release({ executionId: claim.executionId, leaseToken, failed: true });
      throw error;
    }
  }

  private unique<T extends { sourceId: string; sourceChecksum: string }>(rows: readonly T[], entity: NurixHistoricalFinanceIssue['sourceEntity'], issues: NurixHistoricalFinanceIssue[]): Map<string, T> {
    const result = new Map<string, T>();
    for (const row of rows) {
      if (!this.acceptSourceId(row.sourceId, row.sourceChecksum, entity, issues) || result.has(row.sourceId)) {
        if (result.has(row.sourceId)) this.issue(issues, 'SOURCE_ID_DUPLICATE', entity, row.sourceId);
        continue;
      }
      result.set(row.sourceId, row);
    }
    return result;
  }

  private acceptSourceId(sourceId: string, checksum: string, entity: NurixHistoricalFinanceIssue['sourceEntity'], issues: NurixHistoricalFinanceIssue[]) {
    if (sourceId.trim() && SHA256.test(checksum)) return true;
    this.issue(issues, 'PACKAGE_EVIDENCE_INVALID', entity, sourceId || 'missing');
    return false;
  }

  private validateInvoiceScope(invoice: NurixHistoricalInvoice, input: NurixHistoricalFinancePlanInput, issues: NurixHistoricalFinanceIssue[]) {
    if (invoice.sourceCompanyId !== input.sourceCompanyId) this.issue(issues, 'SOURCE_COMPANY_MISMATCH', 'Invoice', invoice.sourceId);
    if (invoice.status.trim().toLowerCase() !== 'active') this.issue(issues, 'INVOICE_STATUS_UNSUPPORTED', 'Invoice', invoice.sourceId);
    if (!['purchase', 'expense'].includes(invoice.kind.trim().toLowerCase())) this.issue(issues, 'INVOICE_KIND_UNSUPPORTED', 'Invoice', invoice.sourceId);
  }

  private validateCategory(category: NurixHistoricalTargetCategory | undefined, invoice: NurixHistoricalInvoice, issues: NurixHistoricalFinanceIssue[]) {
    this.validateMapped(category, 'Invoice', invoice.sourceId, issues);
    if (!category || !category.active || !category.posting || !category.accountId || category.kind !== (invoice.kind.trim().toLowerCase() === 'purchase' ? 'PURCHASE' : 'EXPENSE')) {
      this.issue(issues, 'CATEGORY_DEFINITION_INVALID', 'Invoice', invoice.sourceId);
    }
  }

  private validateMapped(value: { active: boolean } | undefined, entity: NurixHistoricalFinanceIssue['sourceEntity'], sourceId: string, issues: NurixHistoricalFinanceIssue[]) {
    if (!value) this.issue(issues, 'MAPPING_MISSING', entity, sourceId);
    else if (!value.active) this.issue(issues, 'MAPPING_INACTIVE', entity, sourceId);
  }

  private validateAllocations(allocations: readonly NurixHistoricalAllocation[], invoice: NurixHistoricalInvoice, mapping: NurixHistoricalMappingSnapshot, issues: NurixHistoricalFinanceIssue[]) {
    const gross = parseMoney(invoice.grossAmount);
    let total = 0n;
    const plans: Array<{ sourceAllocationId: string; sourceChecksum: string; vaultId: string; grossAmount: string; paymentMethod: string }> = [];
    if (!allocations.length) {
      this.issue(issues, 'ALLOCATION_TOTAL_MISMATCH', 'Invoice', invoice.sourceId);
      return plans;
    }
    for (const allocation of allocations) {
      const amount = parseMoney(allocation.amount);
      const vault = mapping.vaultsBySourceId[allocation.vaultSourceId];
      if (amount === null || amount <= 0n) this.issue(issues, 'AMOUNT_INVALID', 'InvoiceAllocation', allocation.sourceId);
      this.validateMapped(vault, 'InvoiceAllocation', allocation.sourceId, issues);
      if (!vault || !vault.active || !vault.paymentDestination) this.issue(issues, 'MAPPING_INACTIVE', 'InvoiceAllocation', allocation.sourceId);
      const paymentMethod = allocation.paymentMethodSourceId?.trim() || vault?.defaultPaymentMethod || '';
      if (!vault?.paymentMethods.includes(paymentMethod)) this.issue(issues, 'PAYMENT_METHOD_UNSUPPORTED', 'InvoiceAllocation', allocation.sourceId);
      if (amount !== null) total += amount;
      if (amount !== null && vault && vault.active && vault.paymentDestination && vault.paymentMethods.includes(paymentMethod)) {
        plans.push(Object.freeze({ sourceAllocationId: allocation.sourceId, sourceChecksum: allocation.sourceChecksum, vaultId: vault.id, grossAmount: formatMoney(amount), paymentMethod }));
      }
    }
    if (gross === null || total !== gross) this.issue(issues, 'ALLOCATION_TOTAL_MISMATCH', 'Invoice', invoice.sourceId);
    return plans;
  }

  private validateLedgers(ledgers: readonly NurixHistoricalLedgerEntry[], invoice: NurixHistoricalInvoice, gross: bigint | null, businessDate: string | null, mapping: NurixHistoricalMappingSnapshot, issues: NurixHistoricalFinanceIssue[]) {
    if (!ledgers.length) {
      this.issue(issues, 'LEDGER_CARDINALITY_INVALID', 'Invoice', invoice.sourceId);
      return;
    }
    let total = 0n;
    for (const ledger of ledgers) this.validateLedgerRow(ledger, invoice, businessDate, mapping, issues, (amount) => { total += amount; });
    if (gross === null || total !== gross) this.issue(issues, 'LEDGER_AMOUNT_MISMATCH', 'Invoice', invoice.sourceId);
  }

  private validateLedgerRow(ledger: NurixHistoricalLedgerEntry, invoice: NurixHistoricalInvoice, businessDate: string | null, mapping: NurixHistoricalMappingSnapshot, issues: NurixHistoricalFinanceIssue[], acceptAmount: (amount: bigint) => void) {
    if (ledger.status.trim().toLowerCase() !== 'active') this.issue(issues, 'LEDGER_STATUS_UNSUPPORTED', 'LedgerEntry', ledger.sourceId);
    if (ledger.referenceEntity.trim().toLowerCase() !== 'invoice' || ledger.referenceSourceId !== invoice.sourceId) this.issue(issues, 'LEDGER_REFERENCE_INVALID', 'LedgerEntry', ledger.sourceId);
    const amount = parseMoney(ledger.amount);
    if (amount === null || amount <= 0n) this.issue(issues, 'LEDGER_AMOUNT_MISMATCH', 'LedgerEntry', ledger.sourceId);
    else acceptAmount(amount);
    const ledgerDate = parseSourceDate(ledger.entryDate);
    if (!ledgerDate || ledgerDate !== businessDate) this.issue(issues, 'LEDGER_DATE_MISMATCH', 'LedgerEntry', ledger.sourceId);
    const debit = mapping.accountsBySourceId[ledger.debitAccountSourceId];
    const credit = mapping.accountsBySourceId[ledger.creditAccountSourceId];
    const vault = mapping.vaultsBySourceId[ledger.vaultSourceId];
    this.validateMapped(debit, 'LedgerEntry', ledger.sourceId, issues);
    this.validateMapped(credit, 'LedgerEntry', ledger.sourceId, issues);
    this.validateMapped(vault, 'LedgerEntry', ledger.sourceId, issues);
    if (credit && vault && credit.id !== vault.accountId) this.issue(issues, 'VAULT_ACCOUNT_MISMATCH', 'LedgerEntry', ledger.sourceId);
  }

  private vaultAccountId(mapping: NurixHistoricalMappingSnapshot, vaultId: string): string {
    const vault = Object.values(mapping.vaultsBySourceId).find((candidate) => candidate.id === vaultId);
    if (!vault) throw new ConflictException('A planned allocation vault lost its mapped account.');
    return vault.accountId;
  }

  private issue(target: NurixHistoricalFinanceIssue[], code: NurixHistoricalFinanceIssueCode, sourceEntity: NurixHistoricalFinanceIssue['sourceEntity'], sourceId: string) {
    if (!target.some((issue) => issue.code === code && issue.sourceEntity === sourceEntity && issue.sourceId === sourceId)) target.push(Object.freeze({ code, sourceEntity, sourceId }));
  }
}

function parseMoney(value: string): bigint | null {
  if (!MONEY.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole ?? '0') * SCALE + BigInt(`${fraction}0000`.slice(0, 4));
}

function formatMoney(value: bigint): string {
  return `${value / SCALE}.${(value % SCALE).toString().padStart(4, '0')}`;
}

/** Converts canonical ISO dates and XLSX 1900-system serial dates to YYYY-MM-DD. */
function parseSourceDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/^(?:[1-9]\d*)(?:\.0+)?$/.test(value)) return null;
  const serial = Number(value);
  if (!Number.isSafeInteger(serial) || serial < 1 || serial >= 100_000) return null;
  // Excel incorrectly includes 1900-02-29. The adjusted epoch is necessary
  // for every contemporary serial in the Noorix package.
  const epoch = serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86_400_000).toISOString().slice(0, 10);
}

function sourceReference(sourceCompanyId: string, sourceInvoiceId: string): string {
  return `NOORIX-XLSX:INV:${sha({ sourceCompanyId, sourceInvoiceId }).slice(0, 48)}`;
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

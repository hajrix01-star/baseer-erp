/**
 * Pure, fail-closed planning gate for a Noorix financial migration.
 *
 * It deliberately has no database, filesystem, HTTP, or posting dependency.
 * An orchestration layer must supply rows parsed from a verified export and
 * explicit source-to-target maps; this function only decides whether that
 * declared company scope is safe to send to a later staging writer.
 */
const MONEY_SCALE = 4;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/;

export type NurixFinanceDryRunAccount = Readonly<{ id: string; companyId: string; code: string }>;
export type NurixFinanceDryRunCategory = Readonly<{ id: string; companyId: string; code: string }>;
export type NurixFinanceDryRunSupplier = Readonly<{ id: string; companyId: string }>;
export type NurixFinanceDryRunVault = Readonly<{ id: string; companyId: string }>;
export type NurixFinanceDryRunInvoice = Readonly<{
  id: string;
  companyId: string;
  kind: string;
  status: string;
  totalAmount: string;
  netAmount: string;
  taxAmount: string;
  categoryId: string | null;
  supplierId: string | null;
  vaultId: string | null;
}>;
export type NurixFinanceDryRunInvoiceAllocation = Readonly<{ invoiceId: string; vaultId: string; amount: string }>;
export type NurixFinanceDryRunLedgerEntry = Readonly<{
  id: string;
  companyId: string;
  status: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
}>;

export type NurixFinanceDryRunInput = Readonly<{
  sourceCompanyId: string;
  targetCompanyId: string;
  accounts: readonly NurixFinanceDryRunAccount[];
  categories: readonly NurixFinanceDryRunCategory[];
  suppliers: readonly NurixFinanceDryRunSupplier[];
  vaults: readonly NurixFinanceDryRunVault[];
  invoices: readonly NurixFinanceDryRunInvoice[];
  invoiceAllocations: readonly NurixFinanceDryRunInvoiceAllocation[];
  ledgerEntries: readonly NurixFinanceDryRunLedgerEntry[];
  /** Every referenced source ID must be intentionally mapped to a target ID. */
  targetIdBySourceId: Readonly<Record<string, string>>;
  /** No source invoice kind may pass until it has a signed transformation rule. */
  approvedInvoiceKinds: readonly string[];
}>;

export type NurixFinanceDryRunFailureCode =
  | 'ACCOUNT_COMPANY_MISMATCH'
  | 'CATEGORY_COMPANY_MISMATCH'
  | 'SUPPLIER_COMPANY_MISMATCH'
  | 'VAULT_COMPANY_MISMATCH'
  | 'INVOICE_COMPANY_MISMATCH'
  | 'LEDGER_COMPANY_MISMATCH'
  | 'SOURCE_ID_DUPLICATE'
  | 'SOURCE_ID_UNMAPPED'
  | 'INVOICE_KIND_UNAPPROVED'
  | 'INVOICE_STATUS_UNSUPPORTED'
  | 'LEDGER_STATUS_UNSUPPORTED'
  | 'DECIMAL_INVALID'
  | 'INVOICE_TOTAL_MISMATCH'
  | 'INVOICE_ALLOCATION_MISMATCH'
  | 'INVOICE_ALLOCATION_ORPHAN'
  | 'INVOICE_ALLOCATION_VAULT_UNMAPPED'
  | 'INVOICE_PAYMENT_SOURCE_MISSING'
  | 'LEDGER_SELF_POSTING';

export type NurixFinanceDryRunResult = Readonly<{
  mode: 'DRY_RUN';
  sourceCompanyId: string;
  targetCompanyId: string;
  acceptedByEntity: Readonly<Record<'accounts' | 'categories' | 'suppliers' | 'vaults' | 'invoices' | 'ledgerEntries', number>>;
  rejectedByCode: Readonly<Partial<Record<NurixFinanceDryRunFailureCode, number>>>;
  financialTotals: Readonly<{
    acceptedInvoiceGross: string;
    acceptedInvoiceNet: string;
    acceptedInvoiceTax: string;
    plannedLedgerDebit: string;
    plannedLedgerCredit: string;
  }>;
  canStage: boolean;
}>;

/** Produces a deterministic validation receipt. It never writes anything. */
export function dryRunNurixFinanceMigration(input: NurixFinanceDryRunInput): NurixFinanceDryRunResult {
  assertNonBlank(input.sourceCompanyId, 'sourceCompanyId');
  assertNonBlank(input.targetCompanyId, 'targetCompanyId');
  const mapped = new Set(Object.keys(input.targetIdBySourceId).filter((sourceId) => isNonBlank(sourceId) && isNonBlank(input.targetIdBySourceId[sourceId])));
  const approvedKinds = new Set(input.approvedInvoiceKinds.map((value) => value.trim().toLowerCase()).filter(isNonBlank));
  const rejected: Partial<Record<NurixFinanceDryRunFailureCode, number>> = {};
  const accepted = { accounts: 0, categories: 0, suppliers: 0, vaults: 0, invoices: 0, ledgerEntries: 0 };

  const sourceAccountIds = validateScopedRows(input.accounts, input.sourceCompanyId, mapped, 'ACCOUNT_COMPANY_MISMATCH', rejected, () => { accepted.accounts += 1; });
  const sourceCategoryIds = validateScopedRows(input.categories, input.sourceCompanyId, mapped, 'CATEGORY_COMPANY_MISMATCH', rejected, () => { accepted.categories += 1; });
  const sourceSupplierIds = validateScopedRows(input.suppliers, input.sourceCompanyId, mapped, 'SUPPLIER_COMPANY_MISMATCH', rejected, () => { accepted.suppliers += 1; });
  const sourceVaultIds = validateScopedRows(input.vaults, input.sourceCompanyId, mapped, 'VAULT_COMPANY_MISMATCH', rejected, () => { accepted.vaults += 1; });

  const declaredInvoiceIds = new Set(input.invoices.map((invoice) => invoice.id));
  const allocationsByInvoice = new Map<string, NurixFinanceDryRunInvoiceAllocation[]>();
  for (const allocation of input.invoiceAllocations) {
    if (!declaredInvoiceIds.has(allocation.invoiceId)) {
      reject(rejected, 'INVOICE_ALLOCATION_ORPHAN');
      continue;
    }
    const list = allocationsByInvoice.get(allocation.invoiceId) ?? [];
    list.push(allocation);
    allocationsByInvoice.set(allocation.invoiceId, list);
  }

  let gross = 0n;
  let net = 0n;
  let tax = 0n;
  const seenInvoiceIds = new Set<string>();
  for (const invoice of input.invoices) {
    if (seenInvoiceIds.has(invoice.id)) {
      reject(rejected, 'SOURCE_ID_DUPLICATE');
      continue;
    }
    seenInvoiceIds.add(invoice.id);
    if (invoice.companyId !== input.sourceCompanyId) {
      reject(rejected, 'INVOICE_COMPANY_MISMATCH');
      continue;
    }
    if (!hasAllMappings(mapped, invoice.id, invoice.categoryId, invoice.supplierId, invoice.vaultId)) {
      reject(rejected, 'SOURCE_ID_UNMAPPED');
      continue;
    }
    if (!approvedKinds.has(invoice.kind.trim().toLowerCase())) {
      reject(rejected, 'INVOICE_KIND_UNAPPROVED');
      continue;
    }
    if (!['active', 'cancelled'].includes(invoice.status.trim().toLowerCase())) {
      reject(rejected, 'INVOICE_STATUS_UNSUPPORTED');
      continue;
    }
    const total = parseMoney(invoice.totalAmount);
    const netAmount = parseMoney(invoice.netAmount);
    const taxAmount = parseMoney(invoice.taxAmount);
    if (total === null || netAmount === null || taxAmount === null) {
      reject(rejected, 'DECIMAL_INVALID');
      continue;
    }
    if (netAmount + taxAmount !== total) {
      reject(rejected, 'INVOICE_TOTAL_MISMATCH');
      continue;
    }
    const allocations = allocationsByInvoice.get(invoice.id) ?? [];
    if (allocations.length > 0) {
      let allocationTotal = 0n;
      let allocationValid = true;
      for (const allocation of allocations) {
        const amount = parseMoney(allocation.amount);
        if (amount === null) {
          reject(rejected, 'DECIMAL_INVALID');
          allocationValid = false;
          break;
        }
        if (!sourceVaultIds.has(allocation.vaultId) || !mapped.has(allocation.vaultId)) {
          reject(rejected, 'INVOICE_ALLOCATION_VAULT_UNMAPPED');
          allocationValid = false;
          break;
        }
        allocationTotal += amount;
      }
      if (!allocationValid) continue;
      if (allocationTotal !== total) {
        reject(rejected, 'INVOICE_ALLOCATION_MISMATCH');
        continue;
      }
    } else if (invoice.vaultId === null) {
      reject(rejected, 'INVOICE_PAYMENT_SOURCE_MISSING');
      continue;
    }
    if ((invoice.categoryId !== null && !sourceCategoryIds.has(invoice.categoryId)) || (invoice.supplierId !== null && !sourceSupplierIds.has(invoice.supplierId)) || (invoice.vaultId !== null && !sourceVaultIds.has(invoice.vaultId))) {
      reject(rejected, 'SOURCE_ID_UNMAPPED');
      continue;
    }
    accepted.invoices += 1;
    gross += total;
    net += netAmount;
    tax += taxAmount;
  }

  let plannedDebit = 0n;
  let plannedCredit = 0n;
  const seenLedgerIds = new Set<string>();
  for (const entry of input.ledgerEntries) {
    if (seenLedgerIds.has(entry.id)) {
      reject(rejected, 'SOURCE_ID_DUPLICATE');
      continue;
    }
    seenLedgerIds.add(entry.id);
    if (entry.companyId !== input.sourceCompanyId) {
      reject(rejected, 'LEDGER_COMPANY_MISMATCH');
      continue;
    }
    if (!hasAllMappings(mapped, entry.id, entry.debitAccountId, entry.creditAccountId) || !sourceAccountIds.has(entry.debitAccountId) || !sourceAccountIds.has(entry.creditAccountId)) {
      reject(rejected, 'SOURCE_ID_UNMAPPED');
      continue;
    }
    if (!['active', 'cancelled'].includes(entry.status.trim().toLowerCase())) {
      reject(rejected, 'LEDGER_STATUS_UNSUPPORTED');
      continue;
    }
    if (entry.debitAccountId === entry.creditAccountId) {
      reject(rejected, 'LEDGER_SELF_POSTING');
      continue;
    }
    const amount = parseMoney(entry.amount);
    if (amount === null || amount <= 0n) {
      reject(rejected, 'DECIMAL_INVALID');
      continue;
    }
    accepted.ledgerEntries += 1;
    plannedDebit += amount;
    plannedCredit += amount;
  }

  return Object.freeze({
    mode: 'DRY_RUN',
    sourceCompanyId: input.sourceCompanyId,
    targetCompanyId: input.targetCompanyId,
    acceptedByEntity: Object.freeze(accepted),
    rejectedByCode: Object.freeze(rejected),
    financialTotals: Object.freeze({ acceptedInvoiceGross: formatMoney(gross), acceptedInvoiceNet: formatMoney(net), acceptedInvoiceTax: formatMoney(tax), plannedLedgerDebit: formatMoney(plannedDebit), plannedLedgerCredit: formatMoney(plannedCredit) }),
    canStage: Object.keys(rejected).length === 0 && plannedDebit === plannedCredit,
  });
}

type ScopedRow = Readonly<{ id: string; companyId: string }>;

function validateScopedRows<T extends ScopedRow>(rows: readonly T[], sourceCompanyId: string, mapped: ReadonlySet<string>, companyFailure: NurixFinanceDryRunFailureCode, rejected: Partial<Record<NurixFinanceDryRunFailureCode, number>>, accept: () => void): ReadonlySet<string> {
  const acceptedIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const row of rows) {
    if (seenIds.has(row.id)) {
      reject(rejected, 'SOURCE_ID_DUPLICATE');
      continue;
    }
    seenIds.add(row.id);
    if (row.companyId !== sourceCompanyId) {
      reject(rejected, companyFailure);
      continue;
    }
    if (!mapped.has(row.id)) {
      reject(rejected, 'SOURCE_ID_UNMAPPED');
      continue;
    }
    acceptedIds.add(row.id);
    accept();
  }
  return acceptedIds;
}

function hasAllMappings(mapped: ReadonlySet<string>, ...ids: Array<string | null>): boolean {
  return ids.every((id) => id === null || mapped.has(id));
}

function parseMoney(value: string): bigint | null {
  if (!DECIMAL.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  const padded = `${fraction}${'0'.repeat(MONEY_SCALE)}`.slice(0, MONEY_SCALE);
  return BigInt(whole) * 10n ** BigInt(MONEY_SCALE) + BigInt(padded);
}

function formatMoney(value: bigint): string {
  const divisor = 10n ** BigInt(MONEY_SCALE);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(MONEY_SCALE, '0');
  return `${whole.toString()}.${fraction}`;
}

function reject(target: Partial<Record<NurixFinanceDryRunFailureCode, number>>, code: NurixFinanceDryRunFailureCode): void {
  target[code] = (target[code] ?? 0) + 1;
}

function assertNonBlank(value: string, field: string): void {
  if (!isNonBlank(value)) throw new TypeError(`${field} must be non-blank.`);
}

function isNonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { FINANCIAL_MOVEMENT_SOURCE_TOKENS, financialMovementSemantic } from "./financial-movement-classification.js";
import { financeJournalPresentation } from "./finance-journal-presentation.js";

type Kind = "SALE" | "PURCHASE" | "EXPENSE" | "OBLIGATION" | "OTHER";
type OperationFamily = "SALES" | "PURCHASES" | "EXPENSES" | "SUPPLIER_SETTLEMENTS" | "EMPLOYEE_OPERATIONS" | "FINANCING" | "OTHER";
type OperationClass = "SALE_COLLECTION" | "PURCHASE_INVOICE" | "EXPENSE_INVOICE" | "RECURRING_EXPENSE" | "SUPPLIER_SETTLEMENT" | "PAYROLL_ACCRUAL" | "PAYROLL_PAYMENT" | "EMPLOYEE_ADVANCE" | "EMPLOYEE_ADVANCE_SETTLEMENT" | "FINAL_SETTLEMENT_ACCRUAL" | "FINAL_SETTLEMENT_PAYMENT" | "LOAN_OPENING" | "LOAN_REPAYMENT" | "GENERAL_JOURNAL";
type Query = Readonly<{ from?: Date; to?: Date; businessMonths: readonly string[]; kinds: readonly Kind[]; operationFamilies: readonly OperationFamily[]; operationClasses: readonly OperationClass[]; supplierIds: readonly string[]; categoryIds: readonly string[]; statuses: readonly ("POSTED" | "CANCELLED")[]; q?: string; cursor?: string; pageSize: number }>;
type SummaryRow = { documentCount: number; postedCount: number; cancelledCount: number; salesCount: number; purchaseCount: number; expenseCount: number; obligationCount: number; otherCount: number; paidCount: number; payableCount: number };
type CursorRow = { id: string; businessDate: Date; postedAt: Date };

@Injectable()
export class InvoiceRegisterService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Financial-register read model: one row per posted financial event with its
   * journal evidence. It is not a cash-position screen: vault balances,
   * inflows, outflows, transfers and reconciliations belong exclusively to
   * TreasuryService. Any summary here describes the filtered register rows,
   * never an available-cash balance, profit, or trial balance.
   */
  async workspace(context: TrustedCompanyActorContext, query: Query) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const cursor = query.cursor ? await tx.financeJournalEntry.findFirst({ where: { id: query.cursor, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, businessDate: true, postedAt: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException("The register cursor is not available for this company.");
      if (cursor) {
        const matchingCursor = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT j."id" ${joins()} WHERE ${registerPredicate(context, query, null)} AND j."id" = ${cursor.id}::uuid LIMIT 1`);
        if (!matchingCursor.length) throw new BadRequestException("The register cursor does not match the active filters.");
      }
      const predicate = registerPredicate(context, query, cursor);
      const [summaryRows, pageRows, suppliers, categories, classifications] = await Promise.all([
        tx.$queryRaw<SummaryRow[]>(summarySql(predicate)),
        tx.$queryRaw<Array<{ id: string }>>(pageSql(predicate, query.pageSize + 1)),
        tx.financeSupplier.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: "ACTIVE" }, orderBy: { nameAr: "asc" }, take: 1000, select: { id: true, nameAr: true, nameEn: true } }),
        tx.financeCategory.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: "ACTIVE", isPosting: true }, orderBy: { nameAr: "asc" }, take: 500, select: { id: true, nameAr: true, nameEn: true } }),
        tx.financeCategory.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: "ACTIVE" }, select: { id: true, code: true, accountId: true, parentId: true, nameAr: true, nameEn: true } }),
      ]);
      const pageIds = pageRows.slice(0, query.pageSize).map((row) => row.id);
      const entries = pageIds.length ? await tx.financeJournalEntry.findMany({ where: { id: { in: pageIds }, tenantId: context.tenantId, companyId: context.companyId }, select: entrySelect }) : [];
      const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
      const records = pageIds.map((id) => {
        const entry = entriesById.get(id);
        if (!entry) throw new BadRequestException("The register page changed while it was being read.");
        return mapEntry(entry, classificationByAccountId(classifications), classificationByCode(classifications));
      });
      const summary = summaryRows[0] ?? zeroSummary();
      return {
        companyId: context.companyId,
        appliedPeriod: { fromBusinessDate: query.from ? dateValue(query.from) : null, toBusinessDate: query.to ? dateValue(query.to) : null, businessMonths: [...query.businessMonths] },
        summary,
        filters: { suppliers, categories }, records,
        hasMore: pageRows.length > query.pageSize,
        nextCursor: pageRows.length > query.pageSize ? records.at(-1)?.journalEntryId ?? null : null,
      };
    });
  }

  /**
   * Loads one movement only when the user opens its file. The register page
   * deliberately stays small; journal lines, allocations and batch context do
   * not belong in every row of a potentially large history.
   */
  async detail(context: TrustedCompanyActorContext, journalEntryId: string) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const entry = await tx.financeJournalEntry.findFirst({
      where: {
        id: journalEntryId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        sourceType: { not: "vault_transfer" },
      },
        select: detailEntrySelect,
      });
      if (!entry) throw new BadRequestException("The financial movement is not available for this company.");
      const classifications = await tx.financeCategory.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: "ACTIVE" }, select: { id: true, code: true, accountId: true, parentId: true, nameAr: true, nameEn: true } });
      const outflow = entry.outflowDocument;
      const sourceDetail = {
        supplierInvoiceNumber: outflow?.supplierInvoiceNumber ?? null,
        supplierInvoiceMissingReason: outflow?.supplierInvoiceMissingReason ?? null,
        coverageLabel: outflow?.recurringExpenseProfileId && outflow.coverageYear && outflow.coverageStartMonth
          ? `${outflow.coverageYear}-${String(outflow.coverageStartMonth).padStart(2, "0")}${outflow.coverageMonths && outflow.coverageMonths > 1 ? ` +${outflow.coverageMonths - 1}` : ""}`
          : null,
      };
      return {
        movement: mapEntry(entry, classificationByAccountId(classifications), classificationByCode(classifications)),
        journal: {
          id: entry.id,
          sourceType: entry.sourceType,
          sourceReference: entry.sourceReference,
          displayLabelAr: financeJournalPresentation(entry).labelAr,
          displayLabelEn: financeJournalPresentation(entry).labelEn,
          displayReference: financeJournalPresentation(entry).reference,
          businessDate: dateValue(entry.businessDate),
          description: entry.description,
          status: entry.status,
          postedAt: entry.postedAt,
          reversalOfEntryId: entry.reversalOfEntryId,
          reversalEntryId: entry.reversalEntry?.id ?? null,
          lines: entry.lines.map((line) => ({
            id: line.id,
            lineNumber: line.lineNumber,
            accountCode: line.account.code,
            accountNameAr: line.account.nameAr,
            accountNameEn: line.account.nameEn,
            debitAmount: line.debitAmount.toFixed(4),
            creditAmount: line.creditAmount.toFixed(4),
            description: line.description,
          })),
        },
        allocations: detailAllocations(entry),
        batch: outflow?.batch ? {
          batchNumber: outflow.batch.batchNumber,
          documentCount: outflow.batch.documentCount,
          grossAmount: outflow.batch.grossAmount.toFixed(4),
          netAmount: outflow.batch.netAmount.toFixed(4),
          vatAmount: outflow.batch.vatAmount.toFixed(4),
          notes: outflow.batch.notes,
        } : null,
        sourceDetail,
      };
    });
  }
}

const entrySelect = {
  id: true, sourceType: true, sourceReference: true, businessDate: true, description: true, status: true, postedAt: true,
  lines: { select: { accountId: true, debitAmount: true, creditAmount: true, account: { select: { id: true, nameAr: true, nameEn: true, systemKey: true } } } },
  outflowDocument: { select: { id: true, documentNumber: true, kind: true, settlementKind: true, status: true, supplierInvoiceDate: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true, recurringExpenseProfileId: true, batch: { select: { batchNumber: true } }, supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true, parent: { select: { id: true, nameAr: true, nameEn: true } } } } } },
  dailySalesClosing: { select: { id: true, documentNumber: true, status: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true } },
  supplierDuePayment: { select: {
    id: true, amount: true,
    due: { select: {
      supplier: { select: { id: true, nameAr: true, nameEn: true } },
      category: { select: { id: true, nameAr: true, nameEn: true, kind: true, parent: { select: { id: true, nameAr: true, nameEn: true } } } },
    } },
  } },
  inclusiveLoan: { select: { id: true, originalAmount: true, notes: true } },
  inclusiveLoanPayment: { select: { id: true, amount: true, loan: { select: { sourceDocumentNumber: true, notes: true } } } },
  hrPayrollAccrual: { select: { runNumber: true, grossAmount: true, advanceSettlementAmount: true, administrativeDeductionAmount: true, netPayableAmount: true } },
  hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
  hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
  hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
  hrFinalSettlementAccrual: { select: { settlementNumber: true } },
  hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
  vatSettlement: { select: { referenceNumber: true } },
} satisfies Prisma.FinanceJournalEntrySelect;

const detailEntrySelect = {
  id: true, sourceType: true, sourceReference: true, businessDate: true, description: true, status: true, postedAt: true, reversalOfEntryId: true,
  reversalEntry: { select: { id: true } },
  lines: { orderBy: { lineNumber: "asc" }, select: { id: true, lineNumber: true, accountId: true, debitAmount: true, creditAmount: true, description: true, account: { select: { id: true, code: true, nameAr: true, nameEn: true, systemKey: true } } } },
  outflowDocument: { select: {
    id: true, documentNumber: true, kind: true, settlementKind: true, status: true, supplierInvoiceDate: true, supplierInvoiceNumber: true, supplierInvoiceMissingReason: true,
    grossAmount: true, netAmount: true, vatAmount: true, notes: true, recurringExpenseProfileId: true, coverageYear: true, coverageStartMonth: true, coverageMonths: true,
    batch: { select: { batchNumber: true, documentCount: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true } },
    supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true, parent: { select: { id: true, nameAr: true, nameEn: true } } } },
    allocations: { select: { vaultId: true, grossAmount: true, paymentMethod: true, vault: { select: { nameAr: true, nameEn: true } } } },
  } },
  dailySalesClosing: { select: { id: true, documentNumber: true, status: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true, allocations: { select: { vaultId: true, grossAmount: true, vault: { select: { nameAr: true, nameEn: true } } } } } },
  supplierDuePayment: { select: {
    id: true, amount: true, vaultId: true, vault: { select: { nameAr: true, nameEn: true } },
    due: { select: {
      supplier: { select: { id: true, nameAr: true, nameEn: true } },
      category: { select: { id: true, nameAr: true, nameEn: true, kind: true, parent: { select: { id: true, nameAr: true, nameEn: true } } } },
    } },
  } },
  inclusiveLoan: { select: { id: true, originalAmount: true, notes: true } },
  inclusiveLoanPayment: { select: { id: true, amount: true, vaultId: true, vault: { select: { nameAr: true, nameEn: true } }, loan: { select: { sourceDocumentNumber: true, notes: true } } } },
  hrPayrollAccrual: { select: { runNumber: true, grossAmount: true, advanceSettlementAmount: true, administrativeDeductionAmount: true, netPayableAmount: true } },
  hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
  hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
  hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
  hrFinalSettlementAccrual: { select: { settlementNumber: true } },
  hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
  vatSettlement: { select: { referenceNumber: true } },
  reversalOfEntry: { select: {
    sourceType: true, sourceReference: true, description: true,
    hrPayrollAccrual: { select: { runNumber: true } },
    hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
    hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
    hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
    hrFinalSettlementAccrual: { select: { settlementNumber: true } },
    hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
    vatSettlement: { select: { referenceNumber: true } },
  } },
} satisfies Prisma.FinanceJournalEntrySelect;

function registerPredicate(context: TrustedCompanyActorContext, query: Query, cursor: CursorRow | null) {
  const clauses: Prisma.Sql[] = [Prisma.sql`j."tenantId" = ${context.tenantId}::uuid`, Prisma.sql`j."companyId" = ${context.companyId}::uuid`, Prisma.sql`j."status" IN ('POSTED', 'REVERSED')`, Prisma.sql`j."sourceType" NOT IN ('vault_transfer', 'journal_reversal')`];
  const months = monthRanges(query.businessMonths);
  if (months.length) clauses.push(Prisma.sql`(${Prisma.join(months.map((range) => Prisma.sql`j."businessDate" >= ${range.from}::date AND j."businessDate" <= ${range.to}::date`), " OR ")})`);
  else if (query.from || query.to) clauses.push(Prisma.sql`${query.from ? Prisma.sql`j."businessDate" >= ${query.from}::date` : Prisma.empty}${query.from && query.to ? Prisma.sql` AND ` : Prisma.empty}${query.to ? Prisma.sql`j."businessDate" <= ${query.to}::date` : Prisma.empty}`);
  if (query.kinds.length) clauses.push(Prisma.sql`${kindExpression()} IN (${Prisma.join(query.kinds)})`);
  if (query.operationFamilies.length) clauses.push(Prisma.sql`${operationFamilyExpression()} IN (${Prisma.join(query.operationFamilies)})`);
  if (query.operationClasses.length) clauses.push(Prisma.sql`${operationClassExpression()} IN (${Prisma.join(query.operationClasses)})`);
  if (query.supplierIds.length) clauses.push(inIds(query.supplierIds, Prisma.sql`o."supplierId"`, Prisma.sql`due."supplierId"`, Prisma.sql`sales."financeSupplierId"`));
  if (query.categoryIds.length) clauses.push(inIds(query.categoryIds, Prisma.sql`o."categoryId"`, Prisma.sql`due."categoryId"`, Prisma.sql`sales."financeCategoryId"`));
  if (query.statuses.length) clauses.push(Prisma.sql`${statusExpression()} IN (${Prisma.join(query.statuses)})`);
  if (query.q) { const text = `%${query.q}%`; clauses.push(Prisma.sql`(j."sourceReference" ILIKE ${text} OR j."description" ILIKE ${text} OR o."documentNumber" ILIKE ${text} OR sales."documentNumber" ILIKE ${text} OR due."sourceDocumentNumber" ILIKE ${text})`); }
  if (cursor) clauses.push(Prisma.sql`(j."businessDate", j."postedAt", j."id") < (${cursor.businessDate}::date, ${cursor.postedAt}, ${cursor.id}::uuid)`);
  return Prisma.join(clauses, " AND ");
}

function inIds(ids: readonly string[], ...columns: Prisma.Sql[]) { return Prisma.sql`(${Prisma.join(columns.map((column) => Prisma.sql`${column} = ANY(ARRAY[${Prisma.join(ids)}]::uuid[])`), " OR ")})`; }
function joins() { return Prisma.sql`FROM "FinanceJournalEntry" j LEFT JOIN "FinanceOutflowDocument" o ON o."journalEntryId" = j."id" AND o."tenantId" = j."tenantId" AND o."companyId" = j."companyId" LEFT JOIN "FinanceDailySalesClosing" sales ON sales."journalEntryId" = j."id" AND sales."tenantId" = j."tenantId" AND sales."companyId" = j."companyId" LEFT JOIN "FinanceSupplierDuePayment" payment ON payment."journalEntryId" = j."id" AND payment."tenantId" = j."tenantId" AND payment."companyId" = j."companyId" LEFT JOIN "FinanceSupplierDue" due ON due."id" = payment."dueId" AND due."tenantId" = j."tenantId" AND due."companyId" = j."companyId" LEFT JOIN "FinanceCategory" due_category ON due_category."id" = due."categoryId" AND due_category."tenantId" = j."tenantId" AND due_category."companyId" = j."companyId" LEFT JOIN "FinanceInclusiveLoan" loan ON loan."openingJournalEntryId" = j."id" AND loan."tenantId" = j."tenantId" AND loan."companyId" = j."companyId" LEFT JOIN "FinanceInclusiveLoanPayment" loan_payment ON loan_payment."journalEntryId" = j."id" AND loan_payment."tenantId" = j."tenantId" AND loan_payment."companyId" = j."companyId"`; }
function kindExpression() { return Prisma.sql`CASE WHEN sales."id" IS NOT NULL THEN 'SALE' WHEN o."id" IS NOT NULL THEN o."kind"::text WHEN payment."id" IS NOT NULL THEN CASE WHEN due_category."kind" = 'PURCHASE' THEN 'PURCHASE' ELSE 'EXPENSE' END WHEN loan."id" IS NOT NULL OR loan_payment."id" IS NOT NULL THEN 'OBLIGATION' ELSE 'OTHER' END`; }
function operationClassExpression() { return Prisma.sql`CASE
  WHEN sales."id" IS NOT NULL THEN 'SALE_COLLECTION'
  WHEN o."id" IS NOT NULL AND o."kind" = 'PURCHASE' THEN 'PURCHASE_INVOICE'
  WHEN o."id" IS NOT NULL AND o."recurringExpenseProfileId" IS NOT NULL THEN 'RECURRING_EXPENSE'
  WHEN o."id" IS NOT NULL THEN 'EXPENSE_INVOICE'
  WHEN payment."id" IS NOT NULL THEN 'SUPPLIER_SETTLEMENT'
  WHEN LOWER(j."sourceType") LIKE ${`%${FINANCIAL_MOVEMENT_SOURCE_TOKENS.payroll}%`} AND LOWER(j."sourceType") LIKE ${`%${FINANCIAL_MOVEMENT_SOURCE_TOKENS.accrual}%`} THEN 'PAYROLL_ACCRUAL'
  WHEN LOWER(j."sourceType") LIKE ${`%${FINANCIAL_MOVEMENT_SOURCE_TOKENS.payroll}%`} THEN 'PAYROLL_PAYMENT'
  WHEN LOWER(j."sourceType") LIKE ${`%${FINANCIAL_MOVEMENT_SOURCE_TOKENS.advance}%`} AND (LOWER(j."sourceType") LIKE ${`%${FINANCIAL_MOVEMENT_SOURCE_TOKENS.settlement}%`} OR LOWER(j."sourceType") LIKE ${`%${FINANCIAL_MOVEMENT_SOURCE_TOKENS.receipt}%`}) THEN 'EMPLOYEE_ADVANCE_SETTLEMENT'
  WHEN LOWER(j."sourceType") LIKE ${`%${FINANCIAL_MOVEMENT_SOURCE_TOKENS.advance}%`} THEN 'EMPLOYEE_ADVANCE'
  WHEN j."sourceType" = 'hr_final_settlement_accrual' THEN 'FINAL_SETTLEMENT_ACCRUAL'
  WHEN j."sourceType" = 'hr_final_settlement_payment' THEN 'FINAL_SETTLEMENT_PAYMENT'
  WHEN loan."id" IS NOT NULL THEN 'LOAN_OPENING'
  WHEN loan_payment."id" IS NOT NULL THEN 'LOAN_REPAYMENT'
  ELSE 'GENERAL_JOURNAL'
END`; }
function operationFamilyExpression() { const operation = operationClassExpression(); return Prisma.sql`CASE
  WHEN ${operation} = 'SALE_COLLECTION' THEN 'SALES'
  WHEN ${operation} = 'PURCHASE_INVOICE' THEN 'PURCHASES'
  WHEN ${operation} IN ('EXPENSE_INVOICE', 'RECURRING_EXPENSE') THEN 'EXPENSES'
  WHEN ${operation} = 'SUPPLIER_SETTLEMENT' THEN 'SUPPLIER_SETTLEMENTS'
  WHEN ${operation} IN ('PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'EMPLOYEE_ADVANCE', 'EMPLOYEE_ADVANCE_SETTLEMENT', 'FINAL_SETTLEMENT_ACCRUAL', 'FINAL_SETTLEMENT_PAYMENT') THEN 'EMPLOYEE_OPERATIONS'
  WHEN ${operation} IN ('LOAN_OPENING', 'LOAN_REPAYMENT') THEN 'FINANCING'
  ELSE 'OTHER'
END`; }
function statusExpression() { return Prisma.sql`CASE WHEN o."id" IS NOT NULL THEN o."status"::text WHEN sales."id" IS NOT NULL THEN CASE WHEN sales."status" = 'REVERSED' THEN 'CANCELLED' ELSE 'POSTED' END WHEN j."status" = 'REVERSED' THEN 'CANCELLED' ELSE 'POSTED' END`; }
function summarySql(predicate: Prisma.Sql) { const kind = kindExpression(); const status = statusExpression(); return Prisma.sql`SELECT COUNT(*)::int AS "documentCount", COUNT(*) FILTER (WHERE ${status} = 'POSTED')::int AS "postedCount", COUNT(*) FILTER (WHERE ${status} = 'CANCELLED')::int AS "cancelledCount", COUNT(*) FILTER (WHERE ${kind} = 'SALE')::int AS "salesCount", COUNT(*) FILTER (WHERE ${kind} = 'PURCHASE')::int AS "purchaseCount", COUNT(*) FILTER (WHERE ${kind} = 'EXPENSE')::int AS "expenseCount", COUNT(*) FILTER (WHERE ${kind} = 'OBLIGATION')::int AS "obligationCount", COUNT(*) FILTER (WHERE ${kind} = 'OTHER')::int AS "otherCount", COUNT(*) FILTER (WHERE ${status} = 'POSTED' AND (o."settlementKind" = 'PAID' OR sales."id" IS NOT NULL OR payment."id" IS NOT NULL))::int AS "paidCount", COUNT(*) FILTER (WHERE ${status} = 'POSTED' AND o."settlementKind" = 'PAYABLE')::int AS "payableCount" ${joins()} WHERE ${predicate}`; }
function pageSql(predicate: Prisma.Sql, take: number) { return Prisma.sql`SELECT j."id" ${joins()} WHERE ${predicate} ORDER BY j."businessDate" DESC, j."postedAt" DESC, j."id" DESC LIMIT ${take}`; }
function monthRanges(months: readonly string[]) { return [...new Set(months)].sort().map((month) => { const [year, value] = month.split("-").map(Number); const last = new Date(Date.UTC(year!, value!, 0)).getUTCDate(); return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` }; }); }
function zeroSummary(): SummaryRow { return { documentCount: 0, postedCount: 0, cancelledCount: 0, salesCount: 0, purchaseCount: 0, expenseCount: 0, obligationCount: 0, otherCount: 0, paidCount: 0, payableCount: 0 }; }
type Classification = Readonly<{ id: string; nameAr: string; nameEn: string | null }>;
type ClassificationCategory = Classification & Readonly<{ code: string; accountId: string | null; parentId: string | null }>;

function classificationByAccountId(categories: readonly ClassificationCategory[]) {
  return new Map(categories.filter((category) => category.accountId && category.parentId === null).map((category) => [category.accountId!, toClassification(category)]));
}

function classificationByCode(categories: readonly ClassificationCategory[]) {
  return new Map(categories.map((category) => [category.code, toClassification(category)]));
}

function toClassification(value: Classification) { return { id: value.id, nameAr: value.nameAr, nameEn: value.nameEn }; }

function categoryParent(category: (Classification & { parent?: Classification | null }) | null | undefined) {
  return category ? toClassification(category.parent ?? category) : null;
}

function mainAccountClassification(entry: any, operationClass: OperationClass, classifications: ReadonlyMap<string, Classification>) {
  const preferredSystemKey: Partial<Record<OperationClass, string>> = {
    PAYROLL_ACCRUAL: "PAYROLL_EXPENSE",
    PAYROLL_PAYMENT: "PAYROLL_PAYABLE",
    EMPLOYEE_ADVANCE: "EMPLOYEE_ADVANCES",
    EMPLOYEE_ADVANCE_SETTLEMENT: "EMPLOYEE_ADVANCES",
    FINAL_SETTLEMENT_ACCRUAL: "EOS_EXPENSE",
    FINAL_SETTLEMENT_PAYMENT: "EOS_PAYABLE",
  };
  const preferred = preferredSystemKey[operationClass];
  const line = (preferred ? entry.lines.find((item: any) => item.account.systemKey === preferred) : null)
    ?? entry.lines.find((item: any) => item.debitAmount.gt(0))
    ?? entry.lines[0];
  if (!line) return null;
  return classifications.get(line.accountId) ?? toClassification(line.account);
}

function mapEntry(entry: any, classifications: ReadonlyMap<string, Classification>, classificationsByCode: ReadonlyMap<string, Classification>) {
  const totals = journalTotals(entry.lines); const movement = totals.debit; const payrollAccrual = payrollAccrualSummary(entry.hrPayrollAccrual); const outflow = entry.outflowDocument; const sales = entry.dailySalesClosing; const duePayment = entry.supplierDuePayment; const businessDate = dateValue(entry.businessDate);
  if (outflow) { const operationClass = operationClassForEntry(entry); return { id: outflow.id, source: "OUTFLOW_DOCUMENT" as const, sourceType: entry.sourceType, documentNumber: outflow.documentNumber, displayLabelAr: outflow.kind === "PURCHASE" ? "فاتورة مشتريات" : "فاتورة مصروف", displayLabelEn: outflow.kind === "PURCHASE" ? "Purchase invoice" : "Expense invoice", businessDate, supplierInvoiceDate: outflow.supplierInvoiceDate ? dateValue(outflow.supplierInvoiceDate) : null, kind: outflow.kind as Kind, operationFamily: operationFamilyForClass(operationClass), operationClass, settlementKind: outflow.settlementKind, status: outflow.status, supplier: outflow.supplier, category: toClassification(outflow.category), parentClassification: categoryParent(outflow.category), grossAmount: outflow.grossAmount.toFixed(4), netAmount: outflow.netAmount.toFixed(4), vatAmount: outflow.vatAmount.toFixed(4), payrollAccrual, journalEntryId: entry.id, batchNumber: outflow.batch?.batchNumber ?? null, notes: outflow.notes, recurring: outflow.recurringExpenseProfileId !== null, createdAt: entry.postedAt }; }
  if (sales) { const operationClass = operationClassForEntry(entry); return { id: sales.id, source: "DAILY_SALES" as const, sourceType: entry.sourceType, documentNumber: sales.documentNumber, displayLabelAr: "تحصيل مبيعات", displayLabelEn: "Sales collection", businessDate, supplierInvoiceDate: null, kind: "SALE" as const, operationFamily: operationFamilyForClass(operationClass), operationClass, settlementKind: "PAID" as const, status: sales.status === "POSTED" ? "POSTED" as const : "CANCELLED" as const, supplier: null, category: null, parentClassification: mainAccountClassification(entry, operationClass, classifications), grossAmount: sales.grossAmount.toFixed(4), netAmount: sales.netAmount.toFixed(4), vatAmount: sales.vatAmount.toFixed(4), payrollAccrual, journalEntryId: entry.id, batchNumber: null, notes: sales.notes, recurring: false, createdAt: entry.postedAt }; }
  if (duePayment) { const operationClass = operationClassForEntry(entry); return { id: duePayment.id, source: "SUPPLIER_DUE_PAYMENT" as const, sourceType: entry.sourceType, documentNumber: entry.sourceReference, displayLabelAr: "سداد التزام", displayLabelEn: "Payable settlement", businessDate, supplierInvoiceDate: null, kind: duePayment.due.category?.kind === "PURCHASE" ? "PURCHASE" as const : "EXPENSE" as const, operationFamily: operationFamilyForClass(operationClass), operationClass, settlementKind: "PAID" as const, status: "POSTED" as const, supplier: duePayment.due.supplier, category: toClassification(duePayment.due.category), parentClassification: categoryParent(duePayment.due.category), grossAmount: duePayment.amount.toFixed(4), netAmount: duePayment.amount.toFixed(4), vatAmount: "0.0000", payrollAccrual, journalEntryId: entry.id, batchNumber: null, notes: entry.description, recurring: false, createdAt: entry.postedAt }; }
  if (entry.inclusiveLoan) return generic(entry, "LOAN_OPENING", "OBLIGATION", entry.inclusiveLoan.originalAmount, entry.inclusiveLoan.notes, totals, payrollAccrual, classifications, classificationsByCode, { labelAr: "إثبات قرض", labelEn: "Loan opening", reference: entry.sourceReference });
  if (entry.inclusiveLoanPayment) return generic(entry, "LOAN_REPAYMENT", "OBLIGATION", entry.inclusiveLoanPayment.amount, entry.inclusiveLoanPayment.loan.notes, totals, payrollAccrual, classifications, classificationsByCode, { labelAr: "سداد قرض", labelEn: "Loan repayment", reference: entry.sourceReference });
  return generic(entry, "JOURNAL", "OTHER", movement, entry.description, totals, payrollAccrual, classifications, classificationsByCode);
}
function operationClassForEntry(entry: any): OperationClass {
  if (entry.dailySalesClosing) return "SALE_COLLECTION";
  if (entry.outflowDocument?.kind === "PURCHASE") return "PURCHASE_INVOICE";
  if (entry.outflowDocument?.recurringExpenseProfileId) return "RECURRING_EXPENSE";
  if (entry.outflowDocument) return "EXPENSE_INVOICE";
  if (entry.supplierDuePayment) return "SUPPLIER_SETTLEMENT";
  switch (entry.sourceType) {
    case "hr_payroll_accrual": return "PAYROLL_ACCRUAL";
    case "hr_payroll_payment": return "PAYROLL_PAYMENT";
    case "hr_employee_advance": return "EMPLOYEE_ADVANCE";
    case "hr_employee_advance_receipt": return "EMPLOYEE_ADVANCE_SETTLEMENT";
    case "hr_final_settlement_accrual": return "FINAL_SETTLEMENT_ACCRUAL";
    case "hr_final_settlement_payment": return "FINAL_SETTLEMENT_PAYMENT";
    default: {
      const semantic = financialMovementSemantic(entry.sourceType);
      if (semantic) return semantic.registerOperationClass;
      return entry.inclusiveLoan ? "LOAN_OPENING" : entry.inclusiveLoanPayment ? "LOAN_REPAYMENT" : "GENERAL_JOURNAL";
    }
  }
}
function operationFamilyForClass(operationClass: OperationClass): OperationFamily {
  switch (operationClass) {
    case "SALE_COLLECTION": return "SALES";
    case "PURCHASE_INVOICE": return "PURCHASES";
    case "EXPENSE_INVOICE": case "RECURRING_EXPENSE": return "EXPENSES";
    case "SUPPLIER_SETTLEMENT": return "SUPPLIER_SETTLEMENTS";
    case "PAYROLL_ACCRUAL": case "PAYROLL_PAYMENT": case "EMPLOYEE_ADVANCE": case "EMPLOYEE_ADVANCE_SETTLEMENT": case "FINAL_SETTLEMENT_ACCRUAL": case "FINAL_SETTLEMENT_PAYMENT": return "EMPLOYEE_OPERATIONS";
    case "LOAN_OPENING": case "LOAN_REPAYMENT": return "FINANCING";
    default: return "OTHER";
  }
}
function journalTotals(lines: readonly { debitAmount: Prisma.Decimal; creditAmount: Prisma.Decimal }[]) { const debit = lines.reduce((total, line) => total.plus(line.debitAmount), new Prisma.Decimal(0)); return { debit }; }
function payrollAccrualSummary(run: { grossAmount: Prisma.Decimal; advanceSettlementAmount: Prisma.Decimal; administrativeDeductionAmount: Prisma.Decimal; netPayableAmount: Prisma.Decimal } | null | undefined) { return run ? { grossExpense: run.grossAmount.toFixed(4), advanceSettlement: run.advanceSettlementAmount.toFixed(4), administrativeRecovery: run.administrativeDeductionAmount.toFixed(4), netPayable: run.netPayableAmount.toFixed(4) } : null; }
function generic(entry: any, source: "LOAN_OPENING" | "LOAN_REPAYMENT" | "JOURNAL", kind: Kind, value: Prisma.Decimal, notes: string | null, _totals: ReturnType<typeof journalTotals>, payrollAccrual: ReturnType<typeof payrollAccrualSummary>, classifications: ReadonlyMap<string, Classification>, classificationsByCode: ReadonlyMap<string, Classification>, display = financeJournalPresentation(entry)) {
  const operationClass = operationClassForEntry(entry);
  const semantic = financialMovementSemantic(entry.sourceType);
  const accountClassification = mainAccountClassification(entry, operationClass, classifications);
  const category = semantic
    ? classificationsByCode.get(semantic.categoryCode) ?? accountClassification
    : null;
  const parentClassification = semantic
    ? semantic.parentCategoryCode
      ? classificationsByCode.get(semantic.parentCategoryCode) ?? accountClassification
      : null
    : accountClassification;
  return { id: entry.id, source, sourceType: entry.sourceType, documentNumber: display.reference, displayLabelAr: display.labelAr, displayLabelEn: display.labelEn, businessDate: dateValue(entry.businessDate), supplierInvoiceDate: null, kind, operationFamily: operationFamilyForClass(operationClass), operationClass, settlementKind: null, status: entry.status === "REVERSED" ? "CANCELLED" as const : "POSTED" as const, supplier: null, category, parentClassification, grossAmount: value.toFixed(4), netAmount: value.toFixed(4), vatAmount: "0.0000", payrollAccrual, journalEntryId: entry.id, batchNumber: null, notes, recurring: false, createdAt: entry.postedAt };
}
function dateValue(value: Date) { return value.toISOString().slice(0, 10); }

function detailAllocations(entry: any) {
  if (entry.outflowDocument?.allocations?.length) return entry.outflowDocument.allocations.map((allocation: any) => ({ vaultId: allocation.vaultId, vaultNameAr: allocation.vault.nameAr, vaultNameEn: allocation.vault.nameEn, paymentMethod: allocation.paymentMethod, grossAmount: allocation.grossAmount.toFixed(4) }));
  if (entry.dailySalesClosing?.allocations?.length) return entry.dailySalesClosing.allocations.map((allocation: any) => ({ vaultId: allocation.vaultId, vaultNameAr: allocation.vault.nameAr, vaultNameEn: allocation.vault.nameEn, paymentMethod: "SALES_COLLECTION", grossAmount: allocation.grossAmount.toFixed(4) }));
  if (entry.supplierDuePayment) return [{ vaultId: entry.supplierDuePayment.vaultId, vaultNameAr: entry.supplierDuePayment.vault.nameAr, vaultNameEn: entry.supplierDuePayment.vault.nameEn, paymentMethod: "PAYABLE_PAYMENT", grossAmount: entry.supplierDuePayment.amount.toFixed(4) }];
  if (entry.inclusiveLoanPayment) return [{ vaultId: entry.inclusiveLoanPayment.vaultId, vaultNameAr: entry.inclusiveLoanPayment.vault.nameAr, vaultNameEn: entry.inclusiveLoanPayment.vault.nameEn, paymentMethod: "LOAN_REPAYMENT", grossAmount: entry.inclusiveLoanPayment.amount.toFixed(4) }];
  return [];
}

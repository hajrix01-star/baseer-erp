import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { financeJournalPresentation } from "./finance-journal-presentation.js";

type Kind = "SALE" | "PURCHASE" | "EXPENSE" | "OBLIGATION" | "OTHER";
type Query = Readonly<{ from?: Date; to?: Date; businessMonths: readonly string[]; kinds: readonly Kind[]; supplierIds: readonly string[]; categoryIds: readonly string[]; statuses: readonly ("POSTED" | "CANCELLED")[]; q?: string; cursor?: string; pageSize: number }>;
type SummaryRow = { documentCount: number; salesCount: number; purchaseCount: number; expenseCount: number; obligationCount: number; otherCount: number; paidCount: number; payableCount: number; grossAmount: string; netAmount: string; vatAmount: string };
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
      const [summaryRows, pageRows, suppliers, categories] = await Promise.all([
        tx.$queryRaw<SummaryRow[]>(summarySql(predicate)),
        tx.$queryRaw<Array<{ id: string }>>(pageSql(predicate, query.pageSize + 1)),
        tx.financeSupplier.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: "ACTIVE" }, orderBy: { nameAr: "asc" }, take: 1000, select: { id: true, nameAr: true, nameEn: true } }),
        tx.financeCategory.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: "ACTIVE", isPosting: true }, orderBy: { nameAr: "asc" }, take: 500, select: { id: true, nameAr: true, nameEn: true } }),
      ]);
      const pageIds = pageRows.slice(0, query.pageSize).map((row) => row.id);
      const entries = pageIds.length ? await tx.financeJournalEntry.findMany({ where: { id: { in: pageIds }, tenantId: context.tenantId, companyId: context.companyId }, select: entrySelect }) : [];
      const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
      const records = pageIds.map((id) => {
        const entry = entriesById.get(id);
        if (!entry) throw new BadRequestException("The register page changed while it was being read.");
        return mapEntry(entry);
      });
      const summary = summaryRows[0] ?? zeroSummary();
      return {
        companyId: context.companyId,
        appliedPeriod: { fromBusinessDate: query.from ? dateValue(query.from) : null, toBusinessDate: query.to ? dateValue(query.to) : null, businessMonths: [...query.businessMonths] },
        summary: { ...summary, grossAmount: decimalText(summary.grossAmount), netAmount: decimalText(summary.netAmount), vatAmount: decimalText(summary.vatAmount) },
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
      const outflow = entry.outflowDocument;
      const sourceDetail = {
        supplierInvoiceNumber: outflow?.supplierInvoiceNumber ?? null,
        supplierInvoiceMissingReason: outflow?.supplierInvoiceMissingReason ?? null,
        coverageLabel: outflow?.recurringExpenseProfileId && outflow.coverageYear && outflow.coverageStartMonth
          ? `${outflow.coverageYear}-${String(outflow.coverageStartMonth).padStart(2, "0")}${outflow.coverageMonths && outflow.coverageMonths > 1 ? ` +${outflow.coverageMonths - 1}` : ""}`
          : null,
      };
      return {
        movement: mapEntry(entry),
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
  lines: { select: { debitAmount: true } },
  outflowDocument: { select: { id: true, documentNumber: true, kind: true, settlementKind: true, status: true, supplierInvoiceDate: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true, recurringExpenseProfileId: true, batch: { select: { batchNumber: true } }, supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } } } },
  dailySalesClosing: { select: { id: true, documentNumber: true, status: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true } },
  supplierDuePayment: { select: { id: true, amount: true, due: { select: { supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true, kind: true } } } } } },
  inclusiveLoan: { select: { id: true, originalAmount: true, notes: true } },
  inclusiveLoanPayment: { select: { id: true, amount: true, loan: { select: { sourceDocumentNumber: true, notes: true } } } },
  hrPayrollAccrual: { select: { runNumber: true } },
  hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
  hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
  hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
  hrFinalSettlementAccrual: { select: { settlementNumber: true } },
  hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
} satisfies Prisma.FinanceJournalEntrySelect;

const detailEntrySelect = {
  id: true, sourceType: true, sourceReference: true, businessDate: true, description: true, status: true, postedAt: true, reversalOfEntryId: true,
  reversalEntry: { select: { id: true } },
  lines: { orderBy: { lineNumber: "asc" }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, description: true, account: { select: { code: true, nameAr: true, nameEn: true } } } },
  outflowDocument: { select: {
    id: true, documentNumber: true, kind: true, settlementKind: true, status: true, supplierInvoiceDate: true, supplierInvoiceNumber: true, supplierInvoiceMissingReason: true,
    grossAmount: true, netAmount: true, vatAmount: true, notes: true, recurringExpenseProfileId: true, coverageYear: true, coverageStartMonth: true, coverageMonths: true,
    batch: { select: { batchNumber: true, documentCount: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true } },
    supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } },
    allocations: { select: { vaultId: true, grossAmount: true, paymentMethod: true, vault: { select: { nameAr: true, nameEn: true } } } },
  } },
  dailySalesClosing: { select: { id: true, documentNumber: true, status: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true, allocations: { select: { vaultId: true, grossAmount: true, vault: { select: { nameAr: true, nameEn: true } } } } } },
  supplierDuePayment: { select: { id: true, amount: true, vaultId: true, vault: { select: { nameAr: true, nameEn: true } }, due: { select: { supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true, kind: true } } } } } },
  inclusiveLoan: { select: { id: true, originalAmount: true, notes: true } },
  inclusiveLoanPayment: { select: { id: true, amount: true, vaultId: true, vault: { select: { nameAr: true, nameEn: true } }, loan: { select: { sourceDocumentNumber: true, notes: true } } } },
  hrPayrollAccrual: { select: { runNumber: true } },
  hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
  hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
  hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
  hrFinalSettlementAccrual: { select: { settlementNumber: true } },
  hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
  reversalOfEntry: { select: {
    sourceType: true, sourceReference: true, description: true,
    hrPayrollAccrual: { select: { runNumber: true } },
    hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
    hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
    hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
    hrFinalSettlementAccrual: { select: { settlementNumber: true } },
    hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
  } },
} satisfies Prisma.FinanceJournalEntrySelect;

function registerPredicate(context: TrustedCompanyActorContext, query: Query, cursor: CursorRow | null) {
  const clauses: Prisma.Sql[] = [Prisma.sql`j."tenantId" = ${context.tenantId}::uuid`, Prisma.sql`j."companyId" = ${context.companyId}::uuid`, Prisma.sql`j."status" IN ('POSTED', 'REVERSED')`, Prisma.sql`j."sourceType" NOT IN ('vault_transfer', 'journal_reversal')`];
  const months = monthRanges(query.businessMonths);
  if (months.length) clauses.push(Prisma.sql`(${Prisma.join(months.map((range) => Prisma.sql`j."businessDate" >= ${range.from}::date AND j."businessDate" <= ${range.to}::date`), " OR ")})`);
  else if (query.from || query.to) clauses.push(Prisma.sql`${query.from ? Prisma.sql`j."businessDate" >= ${query.from}::date` : Prisma.empty}${query.from && query.to ? Prisma.sql` AND ` : Prisma.empty}${query.to ? Prisma.sql`j."businessDate" <= ${query.to}::date` : Prisma.empty}`);
  if (query.kinds.length) clauses.push(Prisma.sql`${kindExpression()} IN (${Prisma.join(query.kinds)})`);
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
function statusExpression() { return Prisma.sql`CASE WHEN o."id" IS NOT NULL THEN o."status"::text WHEN sales."id" IS NOT NULL THEN CASE WHEN sales."status" = 'REVERSED' THEN 'CANCELLED' ELSE 'POSTED' END WHEN j."status" = 'REVERSED' THEN 'CANCELLED' ELSE 'POSTED' END`; }
function amountExpression(column: "grossAmount" | "netAmount" | "vatAmount") {
  const value = column === "vatAmount"
    ? Prisma.sql`CASE WHEN o."id" IS NOT NULL THEN o."vatAmount" WHEN sales."id" IS NOT NULL THEN sales."vatAmount" ELSE 0 END`
    : Prisma.sql`CASE WHEN o."id" IS NOT NULL THEN ${column === "grossAmount" ? Prisma.sql`o."grossAmount"` : Prisma.sql`o."netAmount"`} WHEN sales."id" IS NOT NULL THEN ${column === "grossAmount" ? Prisma.sql`sales."grossAmount"` : Prisma.sql`sales."netAmount"`} WHEN payment."id" IS NOT NULL THEN payment."amount" WHEN loan."id" IS NOT NULL THEN loan."originalAmount" WHEN loan_payment."id" IS NOT NULL THEN loan_payment."amount" ELSE COALESCE((SELECT SUM(line."debitAmount") FROM "FinanceJournalLine" line WHERE line."journalEntryId" = j."id" AND line."tenantId" = j."tenantId" AND line."companyId" = j."companyId"), 0) END`;
  return Prisma.sql`CASE WHEN ${statusExpression()} = 'POSTED' THEN ${value} ELSE 0 END`;
}
function summarySql(predicate: Prisma.Sql) { const kind = kindExpression(); const status = statusExpression(); const gross = amountExpression("grossAmount"); const net = amountExpression("netAmount"); const vat = amountExpression("vatAmount"); return Prisma.sql`SELECT COUNT(*)::int AS "documentCount", COUNT(*) FILTER (WHERE ${kind} = 'SALE')::int AS "salesCount", COUNT(*) FILTER (WHERE ${kind} = 'PURCHASE')::int AS "purchaseCount", COUNT(*) FILTER (WHERE ${kind} = 'EXPENSE')::int AS "expenseCount", COUNT(*) FILTER (WHERE ${kind} = 'OBLIGATION')::int AS "obligationCount", COUNT(*) FILTER (WHERE ${kind} = 'OTHER')::int AS "otherCount", COUNT(*) FILTER (WHERE ${status} = 'POSTED' AND (o."settlementKind" = 'PAID' OR sales."id" IS NOT NULL OR payment."id" IS NOT NULL))::int AS "paidCount", COUNT(*) FILTER (WHERE ${status} = 'POSTED' AND o."settlementKind" = 'PAYABLE')::int AS "payableCount", COALESCE(SUM(${gross}), 0)::text AS "grossAmount", COALESCE(SUM(${net}), 0)::text AS "netAmount", COALESCE(SUM(${vat}), 0)::text AS "vatAmount" ${joins()} WHERE ${predicate}`; }
function pageSql(predicate: Prisma.Sql, take: number) { return Prisma.sql`SELECT j."id" ${joins()} WHERE ${predicate} ORDER BY j."businessDate" DESC, j."postedAt" DESC, j."id" DESC LIMIT ${take}`; }
function monthRanges(months: readonly string[]) { return [...new Set(months)].sort().map((month) => { const [year, value] = month.split("-").map(Number); const last = new Date(Date.UTC(year!, value!, 0)).getUTCDate(); return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` }; }); }
function decimalText(value: string | null | undefined) { return new Prisma.Decimal(value ?? 0).toFixed(4); }
function zeroSummary(): SummaryRow { return { documentCount: 0, salesCount: 0, purchaseCount: 0, expenseCount: 0, obligationCount: 0, otherCount: 0, paidCount: 0, payableCount: 0, grossAmount: "0", netAmount: "0", vatAmount: "0" }; }
function mapEntry(entry: any) {
  const movement = entry.lines.reduce((total: Prisma.Decimal, line: { debitAmount: Prisma.Decimal }) => total.plus(line.debitAmount), new Prisma.Decimal(0)); const outflow = entry.outflowDocument; const sales = entry.dailySalesClosing; const duePayment = entry.supplierDuePayment; const businessDate = dateValue(entry.businessDate);
  if (outflow) return { id: outflow.id, source: "OUTFLOW_DOCUMENT" as const, sourceType: entry.sourceType, documentNumber: outflow.documentNumber, displayLabelAr: outflow.kind === "PURCHASE" ? "فاتورة مشتريات" : "فاتورة مصروف", displayLabelEn: outflow.kind === "PURCHASE" ? "Purchase invoice" : "Expense invoice", businessDate, supplierInvoiceDate: outflow.supplierInvoiceDate ? dateValue(outflow.supplierInvoiceDate) : null, kind: outflow.kind as Kind, settlementKind: outflow.settlementKind, status: outflow.status, supplier: outflow.supplier, category: outflow.category, grossAmount: outflow.grossAmount.toFixed(4), netAmount: outflow.netAmount.toFixed(4), vatAmount: outflow.vatAmount.toFixed(4), journalEntryId: entry.id, batchNumber: outflow.batch?.batchNumber ?? null, notes: outflow.notes, recurring: outflow.recurringExpenseProfileId !== null, createdAt: entry.postedAt };
  if (sales) return { id: sales.id, source: "DAILY_SALES" as const, sourceType: entry.sourceType, documentNumber: sales.documentNumber, displayLabelAr: "تحصيل مبيعات", displayLabelEn: "Sales collection", businessDate, supplierInvoiceDate: null, kind: "SALE" as const, settlementKind: "PAID" as const, status: sales.status === "POSTED" ? "POSTED" as const : "CANCELLED" as const, supplier: null, category: null, grossAmount: sales.grossAmount.toFixed(4), netAmount: sales.netAmount.toFixed(4), vatAmount: sales.vatAmount.toFixed(4), journalEntryId: entry.id, batchNumber: null, notes: sales.notes, recurring: false, createdAt: entry.postedAt };
  if (duePayment) return { id: duePayment.id, source: "SUPPLIER_DUE_PAYMENT" as const, sourceType: entry.sourceType, documentNumber: entry.sourceReference, displayLabelAr: "سداد التزام", displayLabelEn: "Payable settlement", businessDate, supplierInvoiceDate: null, kind: duePayment.due.category?.kind === "PURCHASE" ? "PURCHASE" as const : "EXPENSE" as const, settlementKind: "PAID" as const, status: "POSTED" as const, supplier: duePayment.due.supplier, category: duePayment.due.category, grossAmount: duePayment.amount.toFixed(4), netAmount: duePayment.amount.toFixed(4), vatAmount: "0.0000", journalEntryId: entry.id, batchNumber: null, notes: entry.description, recurring: false, createdAt: entry.postedAt };
  if (entry.inclusiveLoan) return generic(entry, "LOAN_OPENING", "OBLIGATION", entry.inclusiveLoan.originalAmount, entry.inclusiveLoan.notes, { labelAr: "إثبات قرض", labelEn: "Loan opening", reference: entry.sourceReference });
  if (entry.inclusiveLoanPayment) return generic(entry, "LOAN_REPAYMENT", "OBLIGATION", entry.inclusiveLoanPayment.amount, entry.inclusiveLoanPayment.loan.notes, { labelAr: "سداد قرض", labelEn: "Loan repayment", reference: entry.sourceReference });
  return generic(entry, "JOURNAL", "OTHER", movement, entry.description);
}
function generic(entry: any, source: "LOAN_OPENING" | "LOAN_REPAYMENT" | "JOURNAL", kind: Kind, value: Prisma.Decimal, notes: string | null, display = financeJournalPresentation(entry)) { return { id: entry.id, source, sourceType: entry.sourceType, documentNumber: display.reference, displayLabelAr: display.labelAr, displayLabelEn: display.labelEn, businessDate: dateValue(entry.businessDate), supplierInvoiceDate: null, kind, settlementKind: null, status: entry.status === "REVERSED" ? "CANCELLED" as const : "POSTED" as const, supplier: null, category: null, grossAmount: value.toFixed(4), netAmount: value.toFixed(4), vatAmount: "0.0000", journalEntryId: entry.id, batchNumber: null, notes, recurring: false, createdAt: entry.postedAt }; }
function dateValue(value: Date) { return value.toISOString().slice(0, 10); }

function detailAllocations(entry: any) {
  if (entry.outflowDocument?.allocations?.length) return entry.outflowDocument.allocations.map((allocation: any) => ({ vaultId: allocation.vaultId, vaultNameAr: allocation.vault.nameAr, vaultNameEn: allocation.vault.nameEn, paymentMethod: allocation.paymentMethod, grossAmount: allocation.grossAmount.toFixed(4) }));
  if (entry.dailySalesClosing?.allocations?.length) return entry.dailySalesClosing.allocations.map((allocation: any) => ({ vaultId: allocation.vaultId, vaultNameAr: allocation.vault.nameAr, vaultNameEn: allocation.vault.nameEn, paymentMethod: "SALES_COLLECTION", grossAmount: allocation.grossAmount.toFixed(4) }));
  if (entry.supplierDuePayment) return [{ vaultId: entry.supplierDuePayment.vaultId, vaultNameAr: entry.supplierDuePayment.vault.nameAr, vaultNameEn: entry.supplierDuePayment.vault.nameEn, paymentMethod: "PAYABLE_PAYMENT", grossAmount: entry.supplierDuePayment.amount.toFixed(4) }];
  if (entry.inclusiveLoanPayment) return [{ vaultId: entry.inclusiveLoanPayment.vaultId, vaultNameAr: entry.inclusiveLoanPayment.vault.nameAr, vaultNameEn: entry.inclusiveLoanPayment.vault.nameEn, paymentMethod: "LOAN_REPAYMENT", grossAmount: entry.inclusiveLoanPayment.amount.toFixed(4) }];
  return [];
}

import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";

type Kind = "SALE" | "PURCHASE" | "EXPENSE" | "OBLIGATION" | "OTHER";
type Query = Readonly<{ from?: Date; to?: Date; businessMonths: readonly string[]; kinds: readonly Kind[]; supplierIds: readonly string[]; categoryIds: readonly string[]; statuses: readonly ("POSTED" | "CANCELLED")[]; q?: string; cursor?: string; pageSize: number }>;
type SummaryRow = { documentCount: number; salesCount: number; purchaseCount: number; expenseCount: number; obligationCount: number; otherCount: number; paidCount: number; payableCount: number; grossAmount: string; netAmount: string; vatAmount: string };
type CursorRow = { id: string; businessDate: Date; postedAt: Date };

@Injectable()
export class InvoiceRegisterService {
  constructor(private readonly db: DatabaseService) {}

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
}

const entrySelect = {
  id: true, sourceType: true, sourceReference: true, businessDate: true, description: true, postedAt: true,
  lines: { select: { debitAmount: true } },
  outflowDocument: { select: { id: true, documentNumber: true, kind: true, settlementKind: true, status: true, supplierInvoiceDate: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true, recurringExpenseProfileId: true, batch: { select: { batchNumber: true } }, supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } } } },
  dailySalesClosing: { select: { id: true, documentNumber: true, status: true, grossAmount: true, netAmount: true, vatAmount: true, notes: true } },
  supplierDuePayment: { select: { id: true, amount: true, due: { select: { supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true, kind: true } } } } } },
  inclusiveLoan: { select: { id: true, originalAmount: true, notes: true } },
  inclusiveLoanPayment: { select: { id: true, amount: true, loan: { select: { sourceDocumentNumber: true, notes: true } } } },
} satisfies Prisma.FinanceJournalEntrySelect;

function registerPredicate(context: TrustedCompanyActorContext, query: Query, cursor: CursorRow | null) {
  const clauses: Prisma.Sql[] = [Prisma.sql`j."tenantId" = ${context.tenantId}::uuid`, Prisma.sql`j."companyId" = ${context.companyId}::uuid`, Prisma.sql`j."status" = 'POSTED'`, Prisma.sql`j."sourceType" <> 'vault_transfer'`];
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
function statusExpression() { return Prisma.sql`CASE WHEN o."id" IS NOT NULL THEN o."status"::text WHEN sales."id" IS NOT NULL THEN sales."status"::text ELSE 'POSTED' END`; }
function amountExpression(column: "grossAmount" | "netAmount" | "vatAmount") {
  if (column === "vatAmount") return Prisma.sql`CASE WHEN o."id" IS NOT NULL THEN o."vatAmount" WHEN sales."id" IS NOT NULL THEN sales."vatAmount" ELSE 0 END`;
  const outflow = column === "grossAmount" ? Prisma.sql`o."grossAmount"` : Prisma.sql`o."netAmount"`; const daily = column === "grossAmount" ? Prisma.sql`sales."grossAmount"` : Prisma.sql`sales."netAmount"`;
  return Prisma.sql`CASE WHEN o."id" IS NOT NULL THEN ${outflow} WHEN sales."id" IS NOT NULL THEN ${daily} WHEN payment."id" IS NOT NULL THEN payment."amount" WHEN loan."id" IS NOT NULL THEN loan."originalAmount" WHEN loan_payment."id" IS NOT NULL THEN loan_payment."amount" ELSE COALESCE((SELECT SUM(line."debitAmount") FROM "FinanceJournalLine" line WHERE line."journalEntryId" = j."id" AND line."tenantId" = j."tenantId" AND line."companyId" = j."companyId"), 0) END`;
}
function summarySql(predicate: Prisma.Sql) { const kind = kindExpression(); const status = statusExpression(); const gross = amountExpression("grossAmount"); const net = amountExpression("netAmount"); const vat = amountExpression("vatAmount"); return Prisma.sql`SELECT COUNT(*)::int AS "documentCount", COUNT(*) FILTER (WHERE ${kind} = 'SALE')::int AS "salesCount", COUNT(*) FILTER (WHERE ${kind} = 'PURCHASE')::int AS "purchaseCount", COUNT(*) FILTER (WHERE ${kind} = 'EXPENSE')::int AS "expenseCount", COUNT(*) FILTER (WHERE ${kind} = 'OBLIGATION')::int AS "obligationCount", COUNT(*) FILTER (WHERE ${kind} = 'OTHER')::int AS "otherCount", COUNT(*) FILTER (WHERE ${status} = 'POSTED' AND (o."settlementKind" = 'PAID' OR sales."id" IS NOT NULL OR payment."id" IS NOT NULL))::int AS "paidCount", COUNT(*) FILTER (WHERE o."settlementKind" = 'PAYABLE')::int AS "payableCount", COALESCE(SUM(${gross}), 0)::text AS "grossAmount", COALESCE(SUM(${net}), 0)::text AS "netAmount", COALESCE(SUM(${vat}), 0)::text AS "vatAmount" ${joins()} WHERE ${predicate}`; }
function pageSql(predicate: Prisma.Sql, take: number) { return Prisma.sql`SELECT j."id" ${joins()} WHERE ${predicate} ORDER BY j."businessDate" DESC, j."postedAt" DESC, j."id" DESC LIMIT ${take}`; }
function monthRanges(months: readonly string[]) { return [...new Set(months)].sort().map((month) => { const [year, value] = month.split("-").map(Number); const last = new Date(Date.UTC(year!, value!, 0)).getUTCDate(); return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` }; }); }
function decimalText(value: string | null | undefined) { return new Prisma.Decimal(value ?? 0).toFixed(4); }
function zeroSummary(): SummaryRow { return { documentCount: 0, salesCount: 0, purchaseCount: 0, expenseCount: 0, obligationCount: 0, otherCount: 0, paidCount: 0, payableCount: 0, grossAmount: "0", netAmount: "0", vatAmount: "0" }; }
function mapEntry(entry: any) {
  const movement = entry.lines.reduce((total: Prisma.Decimal, line: { debitAmount: Prisma.Decimal }) => total.plus(line.debitAmount), new Prisma.Decimal(0)); const outflow = entry.outflowDocument; const sales = entry.dailySalesClosing; const duePayment = entry.supplierDuePayment; const businessDate = dateValue(entry.businessDate);
  if (outflow) return { id: outflow.id, source: "OUTFLOW_DOCUMENT" as const, sourceType: entry.sourceType, documentNumber: outflow.documentNumber, businessDate, supplierInvoiceDate: outflow.supplierInvoiceDate ? dateValue(outflow.supplierInvoiceDate) : null, kind: outflow.kind as Kind, settlementKind: outflow.settlementKind, status: outflow.status, supplier: outflow.supplier, category: outflow.category, grossAmount: outflow.grossAmount.toFixed(4), netAmount: outflow.netAmount.toFixed(4), vatAmount: outflow.vatAmount.toFixed(4), journalEntryId: entry.id, batchNumber: outflow.batch?.batchNumber ?? null, notes: outflow.notes, recurring: outflow.recurringExpenseProfileId !== null, createdAt: entry.postedAt };
  if (sales) return { id: sales.id, source: "DAILY_SALES" as const, sourceType: entry.sourceType, documentNumber: sales.documentNumber, businessDate, supplierInvoiceDate: null, kind: "SALE" as const, settlementKind: "PAID" as const, status: sales.status === "POSTED" ? "POSTED" as const : "CANCELLED" as const, supplier: null, category: null, grossAmount: sales.grossAmount.toFixed(4), netAmount: sales.netAmount.toFixed(4), vatAmount: sales.vatAmount.toFixed(4), journalEntryId: entry.id, batchNumber: null, notes: sales.notes, recurring: false, createdAt: entry.postedAt };
  if (duePayment) return { id: duePayment.id, source: "SUPPLIER_DUE_PAYMENT" as const, sourceType: entry.sourceType, documentNumber: entry.sourceReference, businessDate, supplierInvoiceDate: null, kind: duePayment.due.category?.kind === "PURCHASE" ? "PURCHASE" as const : "EXPENSE" as const, settlementKind: "PAID" as const, status: "POSTED" as const, supplier: duePayment.due.supplier, category: duePayment.due.category, grossAmount: duePayment.amount.toFixed(4), netAmount: duePayment.amount.toFixed(4), vatAmount: "0.0000", journalEntryId: entry.id, batchNumber: null, notes: entry.description, recurring: false, createdAt: entry.postedAt };
  if (entry.inclusiveLoan) return generic(entry, "LOAN_OPENING", "OBLIGATION", entry.inclusiveLoan.originalAmount, entry.inclusiveLoan.notes);
  if (entry.inclusiveLoanPayment) return generic(entry, "LOAN_REPAYMENT", "OBLIGATION", entry.inclusiveLoanPayment.amount, entry.inclusiveLoanPayment.loan.notes);
  return generic(entry, "JOURNAL", "OTHER", movement, entry.description);
}
function generic(entry: any, source: "LOAN_OPENING" | "LOAN_REPAYMENT" | "JOURNAL", kind: Kind, value: Prisma.Decimal, notes: string | null) { return { id: entry.id, source, sourceType: entry.sourceType, documentNumber: entry.sourceReference, businessDate: dateValue(entry.businessDate), supplierInvoiceDate: null, kind, settlementKind: null, status: "POSTED" as const, supplier: null, category: null, grossAmount: value.toFixed(4), netAmount: value.toFixed(4), vatAmount: "0.0000", journalEntryId: entry.id, batchNumber: null, notes, recurring: false, createdAt: entry.postedAt }; }
function dateValue(value: Date) { return value.toISOString().slice(0, 10); }

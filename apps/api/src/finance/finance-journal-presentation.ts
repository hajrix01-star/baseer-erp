/**
 * Human-facing journal identity.
 *
 * Journal source codes and UUID references are retained in the immutable
 * ledger for traceability, but they are not useful primary labels in an
 * operational register.  This adapter is read-only and intentionally does
 * not change a posted journal or its source reference.
 */
type Source = {
  sourceType: string;
  sourceReference: string;
  description?: string | null;
  outflowDocument?: { documentNumber: string; kind: "PURCHASE" | "EXPENSE" } | null;
  hrPayrollAccrual?: { runNumber: string } | null;
  hrPayrollPayment?: { paymentNumber: string; payrollRun: { runNumber: string } } | null;
  hrEmployeeAdvanceIssue?: { advanceNumber: string } | null;
  hrEmployeeAdvanceSettlements?: Array<{ source: string; advance: { advanceNumber: string } }>;
  hrFinalSettlementAccrual?: { settlementNumber: string } | null;
  hrFinalSettlementPayment?: { paymentNumber: string; settlement: { settlementNumber: string } } | null;
  dailySalesClosing?: { documentNumber: string } | null;
  vatSettlement?: { referenceNumber: string } | null;
  reversalOfEntry?: Source | null;
};

export type FinanceJournalPresentation = Readonly<{
  labelAr: string;
  labelEn: string;
  reference: string;
}>;

export function financeJournalPresentation(entry: Source): FinanceJournalPresentation {
  if (entry.sourceType === "journal_reversal" && entry.reversalOfEntry) {
    const original = financeJournalPresentation(entry.reversalOfEntry);
    return {
      labelAr: `إلغاء ${original.labelAr}`,
      labelEn: `Cancelled ${original.labelEn}`,
      reference: original.reference,
    };
  }

  const noorix = noorixHistoricalPresentation(entry);
  if (noorix) return noorix;

  switch (entry.sourceType) {
    case "hr_payroll_accrual":
      return { labelAr: "استحقاق مسير رواتب", labelEn: "Payroll accrual", reference: readableReference(entry, entry.hrPayrollAccrual?.runNumber) };
    case "hr_payroll_payment":
      return { labelAr: "دفع مسير رواتب", labelEn: "Payroll payment", reference: readableReference(entry, entry.hrPayrollPayment?.payrollRun.runNumber ?? entry.hrPayrollPayment?.paymentNumber) };
    case "hr_employee_advance":
      return { labelAr: "إصدار سلفة موظف", labelEn: "Employee advance issue", reference: readableReference(entry, entry.hrEmployeeAdvanceIssue?.advanceNumber) };
    case "hr_employee_advance_receipt":
      return { labelAr: "سداد سلفة موظف", labelEn: "Employee advance repayment", reference: readableReference(entry, entry.hrEmployeeAdvanceSettlements?.[0]?.advance.advanceNumber) };
    case "hr_final_settlement_accrual":
      return { labelAr: "استحقاق نهاية خدمة", labelEn: "Final settlement accrual", reference: readableReference(entry, entry.hrFinalSettlementAccrual?.settlementNumber) };
    case "hr_final_settlement_payment":
      return { labelAr: "دفع نهاية خدمة", labelEn: "Final settlement payment", reference: readableReference(entry, entry.hrFinalSettlementPayment?.settlement.settlementNumber ?? entry.hrFinalSettlementPayment?.paymentNumber) };
    case "daily_sales_closing":
      return { labelAr: "تحصيل مبيعات", labelEn: "Sales collection", reference: readableReference(entry, entry.dailySalesClosing?.documentNumber ?? dailySalesDocumentNumber(entry.description)) };
    case "finance_vat_settlement":
      return { labelAr: "سداد ضريبة", labelEn: "VAT settlement", reference: readableReference(entry, entry.vatSettlement?.referenceNumber) };
    case "vault_transfer":
      return {
        labelAr: "تحويل بين الخزائن",
        labelEn: "Vault transfer",
        // Older posted journals used an internal UUID.  Do not mutate a
        // sealed journal merely for presentation; show a stable, readable
        // legacy reference instead.  New transfers persist VTR numbers.
        reference: legacyVaultTransferReference(entry.sourceReference),
      };
    default:
      return { labelAr: "قيد أو تسوية", labelEn: "Journal or adjustment", reference: readableReference(entry) };
  }
}

/**
 * Noorix source ids are intentionally retained in the sealed journal for
 * lineage, but a CUID, UUID, or workbook hash is not an operational reference.
 * Prefer the target relation, then an explicitly numbered source description.
 */
function noorixHistoricalPresentation(entry: Source): FinanceJournalPresentation | null {
  if (!entry.sourceType.startsWith("nurix_")) return null;

  const reference = readableReference(entry, relatedReference(entry));
  switch (entry.sourceType) {
    case "nurix_excel_historical_outflow":
    case "nurix_live_historical_outflow":
      return outflowPresentation(entry, reference);
    case "nurix_excel_historical_recurring":
    case "nurix_excel_historical_recurring_evidence":
      return { labelAr: "مصروف دوري تاريخي", labelEn: "Historical recurring expense", reference };
    case "nurix_historical_employee_advance_issue":
    case "nurix_al_shami_historical_advance_issue":
      return { labelAr: "سلفة موظف تاريخية", labelEn: "Historical employee advance", reference };
    case "nurix_historical_employee_advance_settlement":
    case "nurix_al_shami_historical_advance_settlement":
      return { labelAr: "سداد سلفة موظف تاريخية", labelEn: "Historical employee advance repayment", reference };
    case "nurix_historical_paid_payroll_accrual":
      return { labelAr: "استحقاق مسير رواتب تاريخي", labelEn: "Historical payroll accrual", reference };
    case "nurix_historical_paid_payroll_payment":
    case "nurix_al_shami_historical_paid_payroll":
      return { labelAr: "سداد مسير رواتب تاريخي", labelEn: "Historical payroll payment", reference };
    default:
      return presentationFromNoorixDescription(entry, reference);
  }
}

function outflowPresentation(entry: Source, reference: string): FinanceJournalPresentation {
  const kind = entry.outflowDocument?.kind ?? inferredOutflowKind(reference, entry.description);
  return kind === "PURCHASE"
    ? { labelAr: "فاتورة مشتريات تاريخية", labelEn: "Historical purchase invoice", reference }
    : kind === "EXPENSE"
      ? { labelAr: "فاتورة مصروف تاريخية", labelEn: "Historical expense invoice", reference }
      : { labelAr: "فاتورة مالية تاريخية", labelEn: "Historical financial invoice", reference };
}

function presentationFromNoorixDescription(entry: Source, reference: string): FinanceJournalPresentation {
  const text = entry.description ?? "";
  if (/مصروف دوري|recurring/i.test(text)) return { labelAr: "مصروف دوري تاريخي", labelEn: "Historical recurring expense", reference };
  if (/سلفة|advance/i.test(text)) {
    const settled = /سداد|settlement|repay/i.test(text);
    return settled
      ? { labelAr: "سداد سلفة موظف تاريخية", labelEn: "Historical employee advance repayment", reference }
      : { labelAr: "سلفة موظف تاريخية", labelEn: "Historical employee advance", reference };
  }
  if (/مسير|راتب|payroll|salary/i.test(text)) {
    const paid = /سداد|دفع|payment|paid/i.test(text);
    return paid
      ? { labelAr: "سداد مسير رواتب تاريخي", labelEn: "Historical payroll payment", reference }
      : { labelAr: "استحقاق مسير رواتب تاريخي", labelEn: "Historical payroll accrual", reference };
  }
  return outflowPresentation(entry, reference);
}

function relatedReference(entry: Source): string | null {
  return entry.outflowDocument?.documentNumber
    ?? entry.hrPayrollAccrual?.runNumber
    ?? entry.hrPayrollPayment?.payrollRun.runNumber
    ?? entry.hrPayrollPayment?.paymentNumber
    ?? entry.hrEmployeeAdvanceIssue?.advanceNumber
    ?? entry.hrEmployeeAdvanceSettlements?.[0]?.advance.advanceNumber
    ?? null;
}

function readableReference(entry: Source, preferred?: string | null): string {
  return firstReadableReference(preferred, referenceFromDescription(entry.description), entry.sourceReference)
    ?? "مرجع نوركس تاريخي";
}

function firstReadableReference(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized && !technicalReference(normalized)) return normalized;
  }
  return null;
}

function referenceFromDescription(description: string | null | undefined): string | null {
  // Noorix commercial numbers have a stable alphabetic prefix followed by one
  // or more hyphenated segments, unlike its CUID source ids.
  return description?.match(/\b([A-Z]{2,}(?:-[A-Z0-9]{2,}){1,})\b/i)?.[1] ?? null;
}

function inferredOutflowKind(reference: string, description: string | null | undefined): "PURCHASE" | "EXPENSE" | null {
  if (/^PUR-/i.test(reference) || /مشتريات|purchase/i.test(description ?? "")) return "PURCHASE";
  if (/^EXP-/i.test(reference) || /مصروف|expense/i.test(description ?? "")) return "EXPENSE";
  return null;
}

/** Daily-sales entries keep an immutable source id/version; their document
 * number is intentionally taken from the journal description for historical
 * versions that no longer have a direct closing relation. */
function dailySalesDocumentNumber(description: string | null | undefined) {
  return description?.match(/Daily sales closing\s+([A-Z]+-\d{8}-\d{4})/i)?.[1] ?? null;
}

function legacyVaultTransferReference(sourceReference: string) {
  return technicalReference(sourceReference)
    ? `VTR-LEGACY-${sourceReference.slice(0, 8).toUpperCase()}`
    : sourceReference;
}

const UUID_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUID_REFERENCE = /^c[a-z0-9]{20,}$/i;
const NOORIX_XLSX_REFERENCE = /^NOORIX-XLSX:/i;
const HASH_REFERENCE = /^[a-f0-9]{32,}$/i;

function technicalReference(reference: string) {
  return UUID_REFERENCE.test(reference)
    || CUID_REFERENCE.test(reference)
    || NOORIX_XLSX_REFERENCE.test(reference)
    || HASH_REFERENCE.test(reference);
}

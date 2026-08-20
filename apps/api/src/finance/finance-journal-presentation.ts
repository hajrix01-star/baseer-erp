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
  hrPayrollAccrual?: { runNumber: string } | null;
  hrPayrollPayment?: { paymentNumber: string; payrollRun: { runNumber: string } } | null;
  hrEmployeeAdvanceIssue?: { advanceNumber: string } | null;
  hrEmployeeAdvanceSettlements?: Array<{ source: string; advance: { advanceNumber: string } }>;
  hrFinalSettlementAccrual?: { settlementNumber: string } | null;
  hrFinalSettlementPayment?: { paymentNumber: string; settlement: { settlementNumber: string } } | null;
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

  switch (entry.sourceType) {
    case "hr_payroll_accrual":
      return { labelAr: "استحقاق مسير رواتب", labelEn: "Payroll accrual", reference: entry.hrPayrollAccrual?.runNumber ?? entry.sourceReference };
    case "hr_payroll_payment":
      return { labelAr: "دفع مسير رواتب", labelEn: "Payroll payment", reference: entry.hrPayrollPayment?.payrollRun.runNumber ?? entry.hrPayrollPayment?.paymentNumber ?? entry.sourceReference };
    case "hr_employee_advance":
      return { labelAr: "إصدار سلفة موظف", labelEn: "Employee advance issue", reference: entry.hrEmployeeAdvanceIssue?.advanceNumber ?? entry.sourceReference };
    case "hr_employee_advance_receipt":
      return { labelAr: "سداد سلفة موظف", labelEn: "Employee advance repayment", reference: entry.hrEmployeeAdvanceSettlements?.[0]?.advance.advanceNumber ?? entry.sourceReference };
    case "hr_final_settlement_accrual":
      return { labelAr: "استحقاق نهاية خدمة", labelEn: "Final settlement accrual", reference: entry.hrFinalSettlementAccrual?.settlementNumber ?? entry.sourceReference };
    case "hr_final_settlement_payment":
      return { labelAr: "دفع نهاية خدمة", labelEn: "Final settlement payment", reference: entry.hrFinalSettlementPayment?.settlement.settlementNumber ?? entry.hrFinalSettlementPayment?.paymentNumber ?? entry.sourceReference };
    default:
      return { labelAr: "قيد أو تسوية", labelEn: "Journal or adjustment", reference: entry.sourceReference };
  }
}

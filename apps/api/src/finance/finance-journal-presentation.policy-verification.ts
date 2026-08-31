import assert from "node:assert/strict";

import { financeJournalPresentation } from "./finance-journal-presentation.js";

const technicalReferences = [
  "cmr41c4k4002xy5z0bgpqymqq",
  "4b197f64-0d22-4823-b9e2-982e6d1d2f15",
  "NOORIX-XLSX:INV:000c2ce10db0ef9fd30acb5af929b3a544d46cbeb93bbc0a",
] as const;
const [cuid, uuid, xlsxHash] = technicalReferences;

const cases = [
  {
    sourceType: "nurix_excel_historical_outflow",
    sourceReference: xlsxHash,
    description: "ترحيل نوركس التاريخي: EXP-20260304-002",
    expected: ["فاتورة مصروف تاريخية", "EXP-20260304-002"],
  },
  {
    sourceType: "nurix_live_historical_outflow",
    sourceReference: cuid,
    description: "ترحيل نوركس التاريخي: PUR-20260621-001",
    expected: ["فاتورة مشتريات تاريخية", "PUR-20260621-001"],
  },
  {
    sourceType: "nurix_excel_historical_recurring_evidence",
    sourceReference: cuid,
    description: "ترحيل مصروف دوري تاريخي من نوركس: EXP-20260419-002",
    expected: ["مصروف دوري تاريخي", "EXP-20260419-002"],
  },
  {
    sourceType: "nurix_historical_employee_advance_issue",
    sourceReference: cuid,
    description: "Noorix historical employee advance ADV-20260318-001",
    expected: ["سلفة موظف تاريخية", "ADV-20260318-001"],
  },
  {
    sourceType: "nurix_historical_employee_advance_settlement",
    sourceReference: cuid,
    description: "Noorix historical advance settlement ADV-20260318-001",
    expected: ["سداد سلفة موظف تاريخية", "ADV-20260318-001"],
  },
  {
    sourceType: "nurix_historical_paid_payroll_accrual",
    sourceReference: cuid,
    description: "ترحيل مسير رواتب نوركس: PR-2604-001",
    expected: ["استحقاق مسير رواتب تاريخي", "PR-2604-001"],
  },
  {
    sourceType: "nurix_historical_paid_payroll_payment",
    sourceReference: cuid,
    description: "سداد مسير رواتب نوركس: SAL-20260426-001",
    expected: ["سداد مسير رواتب تاريخي", "SAL-20260426-001"],
  },
  {
    sourceType: "nurix_al_shami_historical_advance_issue",
    sourceReference: cuid,
    description: "سلفة تاريخية نوركس: ADV-20260702-002",
    expected: ["سلفة موظف تاريخية", "ADV-20260702-002"],
  },
  {
    sourceType: "nurix_al_shami_historical_paid_payroll",
    sourceReference: cuid,
    description: "ترحيل سداد مسير رواتب نوركس: SAL-PR-2604-001",
    expected: ["سداد مسير رواتب تاريخي", "SAL-PR-2604-001"],
  },
] as const;

for (const item of cases) {
  const presented = financeJournalPresentation(item);
  assert.equal(presented.labelAr, item.expected[0]);
  assert.equal(presented.reference, item.expected[1]);
  for (const technical of technicalReferences) assert.equal(presented.reference.includes(technical), false);
}

// A target relation is stronger than a historical description and remains the
// visible reference even when the source id is an immutable CUID.
const linkedPurchase = financeJournalPresentation({
  sourceType: "nurix_live_historical_outflow",
  sourceReference: cuid,
  description: "ترحيل نوركس التاريخي: EXP-OLD-001",
  outflowDocument: { documentNumber: "PUR-20260621-001", kind: "PURCHASE" },
});
assert.deepEqual(linkedPurchase, {
  labelAr: "فاتورة مشتريات تاريخية",
  labelEn: "Historical purchase invoice",
  reference: "PUR-20260621-001",
});

const missingBusinessReference = financeJournalPresentation({
  sourceType: "nurix_excel_historical_outflow",
  sourceReference: uuid,
  description: "ترحيل نوركس التاريخي دون رقم ظاهر",
});
assert.equal(missingBusinessReference.reference, "مرجع نوركس تاريخي");

console.log("finance journal Noorix presentation policy verification passed");

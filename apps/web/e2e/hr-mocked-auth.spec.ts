import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const alternateCompanyId = "99999999-9999-4999-8999-999999999999";
const alternateCompany = { id: alternateCompanyId, nameAr: "شركة الاختبار الثانية", nameEn: "Second Test Company" };
const permissions = [
  "hr.employees.read", "hr.employees.write", "hr.leaves.read", "hr.leaves.manage",
  "hr.payroll.read", "hr.payroll.create", "hr.payroll.approve", "hr.payroll.pay", "hr.payroll.reverse",
  "hr.advances.read", "hr.advances.issue", "hr.advances.settle", "hr.advances.reverse", "hr.deductions.manage",
  "hr.employee_letters.read", "hr.employee_letters.issue", "hr.final_settlements.read", "hr.final_settlements.create",
  "hr.final_settlements.verify", "hr.final_settlements.approve", "hr.final_settlements.pay", "hr.final_settlements.reverse",
  "hr.employee_documents.read", "hr.employee_documents.write", "hr.employee_documents.revoke", "hr.employee_letters.revoke", "attendance.manage",
  "finance.configuration.read", "finance.purchase_expense.create", "finance.purchase_expense.cancel",
];

const employee = {
  id: "22222222-2222-4222-8222-222222222222", employeeNumber: "EMP-001", nameAr: "موظف الاختبار", nameEn: "Test Employee",
  jobTitle: "محاسب", phone: null, email: null, iqamaNumber: "1234567890", workSchedule: null, hireDate: "2024-01-01",
  currentMonthlyGross: "3000.0000", profilePhotoVersionId: null, status: "ACTIVE", terminatedAt: null, notes: null,
};
const payrollRun = {
  id: "33333333-3333-4333-8333-333333333333", runNumber: "PAY-2026-08", payrollMonth: "2026-08-01", businessDate: "2026-08-20",
  status: "DRAFT", employeeCount: 1, grossAmount: "3000.0000", advanceSettlementAmount: "0.0000",
  administrativeDeductionAmount: "0.0000", netPayableAmount: "3000.0000", paidAmount: "0.0000", notes: null, accrualJournalEntryId: null,
};
const approvedPayrollRun = { ...payrollRun, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", runNumber: "PAY-2026-06", status: "APPROVED", accrualJournalEntryId: "journal-payroll" };
const payrollPayment = { id: "payment-payroll-1", paymentNumber: "PP-001", businessDate: "2026-08-20", amount: "1000.0000", journalEntryId: "journal-payment", status: "POSTED", reversedAt: null, reversalJournalEntryId: null };
const service = {
  id: "44444444-4444-4444-8444-444444444444", employeeId: employee.id, employee: { id: employee.id, employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn },
  serviceType: "IQAMA_RENEWAL", referenceNumber: "SRV-001", issueDate: "2026-01-01", expiryDate: "2027-01-01", visaDurationMonths: null,
  renewalOfServiceId: null, supplier: { id: "supplier-1", nameAr: "مورد", nameEn: "Supplier" }, category: { id: "category-1", nameAr: "إقامة", nameEn: "Iqama" }, outflowDocumentId: null, costStatus: "NOT_ISSUED", status: "DRAFT", complianceStatus: "ACTIVE", notes: null,
};
const postedService = { ...service, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", referenceNumber: "SRV-POSTED", outflowDocumentId: "OUT-001", costStatus: "POSTED", status: "ISSUED" };
const compensationId = "77777777-7777-4777-8777-777777777777";
const compensation = {
  id: compensationId, employeeId: employee.id, effectiveFrom: "2024-01-01", effectiveTo: null,
  monthlyGross: "3000.0000", policyVersionId: null, compensationMethod: "FIXED_MONTHLY",
  foodAllowance: "0.0000", housingAllowance: "0.0000", transportAllowance: "0.0000", otherAllowance: "0.0000",
  scheduledHoursPerDay: null, scheduledWorkDays: null, notes: null,
};
const leave = {
  id: "99999999-9999-4999-8999-999999999999", employeeId: employee.id, employeeNumber: employee.employeeNumber,
  employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, leaveType: "ANNUAL", status: "APPROVED",
  startDate: "2026-08-01", endDate: "2026-08-15", actualReturnDate: null, notes: null,
};
const advance = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", employeeId: employee.id, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn,
  advanceNumber: "ADV-001", businessDate: "2026-07-01", originalAmount: "500.0000", settledAmount: "0.0000", remainingAmount: "500.0000",
  status: "ISSUED", nextSettlementDate: "2026-09-01", notes: null, journalEntryId: "je-advance", allocations: [],
};
const deduction = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", employeeId: employee.id, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn,
  deductionNumber: "DED-001", businessDate: "2026-07-02", originalAmount: "200.0000", appliedAmount: "0.0000", remainingAmount: "200.0000",
  status: "OPEN", plannedPayrollDate: "2026-09-01", description: "خصم تجريبي", cancellationReason: null,
};
const document = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", employeeId: employee.id, documentType: "EMPLOYMENT_CONTRACT", status: "ACTIVE",
  title: "عقد تجريبي", referenceNumber: "DOC-001", issueDate: "2024-01-01", expiryDate: null, notes: null, linkedServiceId: null,
  retentionUntil: null, legalHold: false, complianceStatus: "NOT_APPLICABLE", currentVersion: null,
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", revokedAt: null, revokedReason: null,
};
const letter = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", employeeId: employee.id, letterType: "SALARY_CERTIFICATE", status: "ISSUED",
  letterNumber: "LET-001", locale: "ar", recipient: "جهة الاختبار", issuedAt: "2026-08-01T00:00:00.000Z",
  revokedAt: null, revokedReason: null, outputReportCode: "hr.employee-letter",
};
const compensationPolicy = {
  id: "policy-1", code: "STD", nameAr: "سياسة الاختبار", nameEn: "Test policy",
  versions: [{ id: "policy-version-1", policyId: "policy-1", policyCode: "STD", policyNameAr: "سياسة الاختبار", policyNameEn: "Test policy", versionNumber: 1, effectiveFrom: "2026-01-01", effectiveTo: null, status: "APPROVED", formulaCode: "STANDARD_MONTHLY_V1" }],
};
const settlementBase = {
  employeeId: employee.id, terminationDate: "2026-08-01", terminationReason: "ARTICLE_80", reasonEvidenceReference: "EVIDENCE-1",
  serviceDays: 900, eosWage: "3000.0000", fullAwardAmount: "4500.0000", entitlementFactor: "1.0000", eosAmount: "4500.0000",
  otherCreditsAmount: "0.0000", recoveryAmount: "0.0000", netPayableAmount: "4500.0000", paidAmount: "0.0000",
  createdAt: "2026-08-01T00:00:00.000Z", approvedAt: null, calculationPolicyVersion: "SA-EOS-V1", outputReportCode: "hr.final-settlement",
};
const pendingSettlement = { ...settlementBase, id: "settlement-pending", settlementNumber: "EOS-PENDING", status: "DRAFT", reasonVerificationStatus: "PENDING" };
const verifiedSettlement = { ...settlementBase, id: "settlement-verified", settlementNumber: "EOS-VERIFIED", status: "DRAFT", reasonVerificationStatus: "VERIFIED" };
const approvedSettlement = { ...settlementBase, id: "settlement-approved", settlementNumber: "EOS-APPROVED", status: "APPROVED", reasonVerificationStatus: "VERIFIED", terminationReason: "RESIGNATION", approvedAt: "2026-08-10T00:00:00.000Z" };
const settlementPayment = { id: "payment-settlement-1", paymentNumber: "SP-001", businessDate: "2026-08-20", amount: "1000.0000", journalEntryId: "journal-settlement-payment", status: "POSTED", reversedAt: null, reversalJournalEntryId: null };

async function fulfill(route: Route, json: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) }); }

async function switchToAlternateCompany(page: Page, language: "ar" | "en" = "ar") {
  const currentName = language === "ar" ? "شركة الاختبار" : "Test Company";
  const nextName = language === "ar" ? alternateCompany.nameAr : alternateCompany.nameEn;
  await page.getByRole("button", { name: currentName }).click();
  await page.getByRole("button", { name: nextName }).click();
  await expect(page.getByRole("button", { name: nextName })).toBeVisible();
}

async function mockHr(page: Page, requested: string[], options: { language?: "ar" | "en"; onboarding?: "success" | "failure"; truncatedPreview?: boolean; slowPayrollDetail?: boolean; slowEmployeeSearch?: boolean; payrollPreviewFailure?: boolean; payrollSelectionFixture?: boolean; payrollOverSettlementFixture?: boolean; payrollSavedEmployeeStatus?: "ON_LEAVE" | "ACTIVE"; terminatedEmployee?: boolean; permissionCodes?: string[] } = {}) {
  const language = options.language ?? "ar";
  const grantedPermissions = options.permissionCodes ?? permissions;
  const profileEmployee = options.terminatedEmployee ? { ...employee, status: "TERMINATED", terminatedAt: "2026-08-01" } : employee;
  await page.addInitScript(({ company, locale }) => {
    if (!sessionStorage.getItem("baseer.erp.access-token")) sessionStorage.setItem("baseer.erp.access-token", "e2e-token");
    if (!sessionStorage.getItem("baseer.erp.refresh-token")) sessionStorage.setItem("baseer.erp.refresh-token", "e2e-refresh-token");
    if (!sessionStorage.getItem("baseer.erp.session-expires-at")) sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    if (!sessionStorage.getItem("baseer.erp.company-id")) sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
  }, { company: companyId, locale: language });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const requestCompanyId = route.request().headers()["x-baseer-company-id"] ?? companyId;
    const isAlternateCompany = requestCompanyId === alternateCompanyId;
    requested.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test Company", permissionCodes: grantedPermissions }, { ...alternateCompany, permissionCodes: grantedPermissions }] });
    if (url.pathname === "/v1/hr/employees/onboard" && route.request().method() === "POST") {
      if (options.onboarding === "failure") return fulfill(route, { error: { code: "VALIDATION_FAILED", message: { ar: "تعذر حفظ موظف الاختبار.", en: "The test employee could not be saved." }, correlationId: "e2e", retry: { kind: "do-not-retry" } } }, 422);
      return fulfill(route, { id: employee.id, compensationId, replayed: false });
    }
    if (url.pathname === "/v1/hr/overview") return fulfill(route, {
      companyId, businessDate: "2026-08-20", workforce: { activeEmployees: 7, employeesOnLeave: 1 }, financial: { openAdvances: 2, openAdministrativeDeductions: 1 },
      payroll: { draftCount: 1, awaitingPaymentCount: 0, recentRuns: [payrollRun] }, services: { expiredCount: 0, expiringCount: 1, attentionItems: [] },
      leaves: { openCount: 1, actionItems: [] }, finalSettlements: { openCount: 0, actionItems: [] },
    });
    if (url.pathname === "/v1/attendance/dashboard") return fulfill(route, {
      date: "2026-08-20",
      summary: { activeEmployees: 1, checkedIn: 0, checkedOut: 1, notRecorded: 0, openSessions: 0 },
      employees: [{
        employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn,
        state: "CHECKED_OUT", checkInAt: "2026-08-20T06:00:00.000Z", checkOutAt: "2026-08-20T14:00:00.000Z", workedMinutes: 480,
        evaluation: { businessDate: "2026-08-20", scheduleSource: "TEMPLATE", scheduleKind: "CUSTOM_PERIODS", state: "ON_TIME", plannedMinutes: 480, workedMinutes: 480, lateMinutes: 0, earlyLeaveMinutes: 0, extraMinutes: 0, shortageMinutes: 0, hasOpenSession: false },
      }],
    });
    if (url.pathname === "/v1/attendance/alerts") return fulfill(route, {
      date: "2026-08-20", summary: { late: 0, missingCheckIn: 0, openSessions: 0 }, alerts: [],
    });
    if (url.pathname === `/v1/attendance/employees/${employee.id}/schedule`) return fulfill(route, {
      employeeId: employee.id, workTermsReference: null, assignments: [], weeklyAdjustments: [], exceptions: [],
    });
    if (url.pathname === "/v1/attendance/schedule-templates") return fulfill(route, { templates: [] });
    if (url.pathname === `/v1/hr/employees/${employee.id}/work-terms`) return fulfill(route, { employeeId: employee.id, workTerms: [] });
    if (url.pathname === `/v1/attendance/employees/${employee.id}/pin`) return fulfill(route, { state: "NOT_SET", pin: null });
    if (url.pathname === `/v1/attendance/employees/${employee.id}/compliance`) return fulfill(route, {
      employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn,
      currentMonth: { from: "2026-08-01", to: "2026-08-20", calculatedThrough: "2026-08-20T12:00:00.000Z", status: "FINAL", plannedMinutes: 7200, coveredPlannedMinutes: 6960, shortageMinutes: 240, lateMinutes: 30, earlyLeaveMinutes: 15, extraMinutes: 45, eligibleWorkDays: 15, openSessionDays: 0, excludedLeaveDays: 0, restDays: 4, unscheduledDays: 1, ratePercent: 97 },
      aggregate: { from: "2026-01-01", to: "2026-08-20", calculatedThrough: "2026-08-20T12:00:00.000Z", status: "FINAL", plannedMinutes: 72000, coveredPlannedMinutes: 70200, shortageMinutes: 1800, lateMinutes: 240, earlyLeaveMinutes: 120, extraMinutes: 480, eligibleWorkDays: 150, openSessionDays: 0, excludedLeaveDays: 2, restDays: 36, unscheduledDays: 3, ratePercent: 98 },
    });
    if (url.pathname === "/v1/hr/employees" && route.request().method() === "GET") {
      if (options.slowEmployeeSearch && url.searchParams.has("search")) await new Promise((resolve) => setTimeout(resolve, 350));
      return fulfill(route, { companyId: requestCompanyId, employees: isAlternateCompany ? [] : [profileEmployee], hasMore: false, nextCursor: null, summary: { activeEmployees: isAlternateCompany ? 0 : 7, employeesOnLeave: isAlternateCompany ? 0 : 1, openAdvances: 2, openAdministrativeDeductions: 1 } });
    }
    if (url.pathname === `/v1/hr/employees/${employee.id}/promotions`) return fulfill(route, { promotions: [], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/employees/${employee.id}/compensation-history`) return fulfill(route, { compensationHistory: [compensation], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/employees/${employee.id}/documents`) {
      if (route.request().method() === "POST") return fulfill(route, { id: document.id, versionId: "photo-version-1", replayed: false });
      return fulfill(route, { companyId, documents: [document], hasMore: false, nextCursor: null });
    }
    if (url.pathname === `/v1/hr/employees/${employee.id}/letters`) return fulfill(route, { companyId, letters: [letter], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/employees/${employee.id}/payroll`) return fulfill(route, { companyId, lines: [], hasMore: false, nextCursor: null });
    if (url.pathname === "/v1/hr/employees/stale-employee-id") return fulfill(route, { error: { code: "NOT_FOUND", message: { ar: "السجل المطلوب غير موجود.", en: "The requested record was not found." }, correlationId: "e2e-stale-employee", retry: { kind: "do-not-retry" } } }, 404);
    if (url.pathname === `/v1/hr/employees/${employee.id}`) return fulfill(route, {
      companyId, employee: profileEmployee, compensation, compensationHistory: [], compensationHistoryCount: 14,
      profileSummary: { payrollRunCount: 12, advanceCount: 2, openAdvanceCount: 1, openAdvanceBalance: "500.0000", leaveCount: 9, documentCount: 1, promotionCount: 0 },
      services: [], serviceCount: 52, servicesHasMore: true,
      movements: [{ id: "movement-1", journalEntryId: "journal-1", movementType: "PAYROLL_ACCRUAL", businessDate: "2026-08-20", amount: "3000.0000", sourceReference: payrollRun.runNumber, description: null }], movementCount: 81, hasMoreMovements: false, nextMovementCursor: null,
    });
    if (url.pathname === `/v1/hr/services/${service.id}`) return fulfill(route, { service });
    if (url.pathname === `/v1/hr/services/${postedService.id}`) return fulfill(route, { service: postedService });
    if (url.pathname === "/v1/hr/services") {
      const more = url.searchParams.has("cursor");
      return fulfill(route, { companyId, services: more ? [{ ...service, id: "55555555-5555-4555-8555-555555555555", referenceNumber: "SRV-002" }] : [service, postedService], hasMore: !more, nextCursor: more ? null : service.id, summary: { count: 52, expired: 1, due30: 2, due90: 3 } });
    }
    if (url.pathname === `/v1/hr/leaves/${leave.id}`) return fulfill(route, { leave });
    if (url.pathname === "/v1/hr/leaves") return fulfill(route, { companyId: requestCompanyId, leaves: isAlternateCompany ? [] : [leave], hasMore: false, nextCursor: null, summary: isAlternateCompany ? { count: 0, onLeaveNow: 0, upcoming: 0, returned: 0 } : { count: 9, onLeaveNow: 1, upcoming: 2, returned: 6 } });
    if (url.pathname === `/v1/hr/advances/${advance.id}`) return fulfill(route, { advance, sourceAnnotations: [], settlements: [], hasMoreSettlements: false, nextSettlementCursor: null, deferrals: [], hasMoreDeferrals: false, nextDeferralCursor: null });
    if (url.pathname === "/v1/hr/advances/entry-references") return fulfill(route, { companyId, employees: [{ id: employee.id, employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn, status: "ACTIVE" }], vaults: [{ id: "vault-1", nameAr: "الخزينة", nameEn: "Vault", paymentMethod: "CASH", paymentMethods: ["CASH"] }] });
    if (url.pathname === "/v1/hr/advances") return fulfill(route, { companyId, advances: [advance], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/deductions/${deduction.id}`) return fulfill(route, { deduction, actions: [{ id: "action-1", actionType: "CREATED", businessDate: deduction.businessDate, amount: deduction.originalAmount, plannedPayrollDate: deduction.plannedPayrollDate, reason: null }], hasMoreActions: false, nextActionCursor: null });
    if (url.pathname === "/v1/hr/deductions") return fulfill(route, { companyId, deductions: [deduction], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/final-settlements/${pendingSettlement.id}`) return fulfill(route, { companyId, settlement: pendingSettlement, payments: [], hasMorePayments: false, nextPaymentCursor: null });
    if (url.pathname === `/v1/hr/final-settlements/${verifiedSettlement.id}`) return fulfill(route, { companyId, settlement: verifiedSettlement, payments: [], hasMorePayments: false, nextPaymentCursor: null });
    if (url.pathname === `/v1/hr/final-settlements/${approvedSettlement.id}`) return fulfill(route, { companyId, settlement: approvedSettlement, payments: [settlementPayment], hasMorePayments: false, nextPaymentCursor: null });
    if (url.pathname === "/v1/hr/final-settlements") return fulfill(route, { companyId, settlements: [pendingSettlement, verifiedSettlement, approvedSettlement], hasMore: false, nextCursor: null });
    if (url.pathname === "/v1/hr/payroll-runs" && route.request().method() === "GET") {
      const more = url.searchParams.has("cursor");
      return fulfill(route, { companyId, payrollRuns: more ? [{ ...payrollRun, id: "66666666-6666-4666-8666-666666666666", runNumber: "PAY-2026-07" }] : [payrollRun, approvedPayrollRun], hasMore: !more, nextCursor: more ? null : payrollRun.id, summary: { count: 12, grossAmount: "36000.0000", advanceSettlementAmount: "500.0000", administrativeDeductionAmount: "250.0000", netPayableAmount: "35250.0000" } });
    }
    if (url.pathname === "/v1/hr/payroll-runs/missing-month-preview") return fulfill(route, {
      state: "READY", payrollMonth: "2026-07-01", payrollBusinessDate: "2026-07-31",
      counts: { eligibleEmployees: 1, employeesMissingCompensation: 0, excludedEmployees: 0 },
      totals: { grossEntitlementAmount: "3000.0000", eligibleAdvanceAmount: "500.0000", eligibleAdministrativeDeductionAmount: "200.0000" },
      messageAr: null,
    });
    if (url.pathname === "/v1/hr/payroll-history/nurix") return fulfill(route, {
      payrollRuns: [], summary: { count: 0, grossAmount: "0.0000", deductionsAmount: "0.0000", advancesAmount: "0.0000", netAmount: "0.0000" },
    });
    if (url.pathname === `/v1/hr/payroll-runs/${payrollRun.id}`) {
      if (options.slowPayrollDetail) await new Promise((resolve) => setTimeout(resolve, 350));
      return fulfill(route, { payrollRun: { ...payrollRun, notes: "ملاحظة المسودة" }, lines: [{ id: "line-1", employeeId: employee.id, employeeStatus: options.payrollSavedEmployeeStatus, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, grossSalary: "3000.0000", compensationMethod: "FIXED_MONTHLY", eligibilityCode: options.payrollSavedEmployeeStatus === "ON_LEAVE" ? "PRORATED_NEW_HIRE_V1" : options.payrollSavedEmployeeStatus === "ACTIVE" ? "FULL_MONTH_ON_LEAVE_EXCEPTION_V1" : "FULL_MONTH_V1", basicSalary: "3000.0000", foodAllowance: "0.0000", housingAllowance: "0.0000", transportAllowance: "0.0000", otherAllowance: "0.0000", overtimeAmount: "0.0000", overtimeHours: "0.0000", scheduledHoursPerDay: null, scheduledWorkDays: null, compensationPolicySnapshot: null, payrollCalculationSnapshot: null, advanceSettlementAmount: "100.0000", administrativeDeductionAmount: "0.0000", netPayableAmount: "2900.0000", paidAmount: "0.0000", advances: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", sourceId: advance.id, amount: "100.0000", referenceNumber: advance.advanceNumber }], administrativeDeductions: [] }], payments: [], hasMoreLines: false, nextLineCursor: null, hasMorePayments: false, nextPaymentCursor: null });
    }
    if (url.pathname === `/v1/hr/payroll-runs/${approvedPayrollRun.id}`) return fulfill(route, { payrollRun: approvedPayrollRun, lines: [], payments: [payrollPayment], hasMoreLines: false, nextLineCursor: null, hasMorePayments: false, nextPaymentCursor: null });
    if (url.pathname === "/v1/hr/payroll-runs/preview") {
      const input = route.request().postDataJSON();
      if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(input.payrollMonth ?? "")) return fulfill(route, { error: { code: "VALIDATION_FAILED", message: { ar: "بيانات الطلب غير صالحة.", en: "Invalid payroll month." }, correlationId: "e2e-payroll-month", retry: { kind: "do-not-retry" } } }, 400);
      if (options.payrollPreviewFailure) return fulfill(route, { error: { code: "PAYROLL_PREVIEW_FAILED", message: { ar: "تعذر إعداد معاينة المسير.", en: "The payroll preview could not be prepared." }, correlationId: "e2e-payroll-preview", retry: { kind: "safe-retry" } } }, 503);
      const selected = input.selectedEmployeeIds ? input.selectedEmployeeIds.includes(employee.id) : !(input.excludedEmployeeIds ?? []).includes(employee.id);
      const applied = input.lines?.find((line: { employeeId: string }) => line.employeeId === employee.id);
      const advanceTotal = selected ? (applied?.advances ?? []).reduce((sum: number, item: { amount: string }) => sum + Number(item.amount), 0) : 0;
      const deductionTotal = selected ? (applied?.administrativeDeductions ?? []).reduce((sum: number, item: { amount: string }) => sum + Number(item.amount), 0) : 0;
      const employeeGross = options.payrollOverSettlementFixture ? 1800 : 3000;
      if (advanceTotal + deductionTotal > employeeGross) return fulfill(route, { error: { code: "VALIDATION_FAILED", message: { ar: "مجموع السلف والخصومات المختارة يتجاوز راتب الموظف. خفّض مبالغ الاستقطاع ثم أعد المحاولة.", en: "Selected advance settlements and deductions exceed the employee salary. Reduce the deductions and try again." }, correlationId: "e2e-payroll-over-salary", retry: { kind: "do-not-retry" } } }, 400);
      const previewEmployee = { id: employee.id, employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn, status: "ACTIVE", selected, included: selected, estimatedNetAmount: selected ? String(employeeGross - advanceTotal - deductionTotal) : "0.0000", reason: "ACTIVE_WITH_VALID_COMPENSATION", eligibilityCode: "FULL_MONTH_V1", calculationPeriodStart: "2026-08-01", calculationPeriodEnd: "2026-08-31", eligibleDays: 31, calendarDaysInMonth: 31, prorationRatio: "1.0000", monthlyGrossAmount: String(employeeGross), estimatedGrossAmount: String(employeeGross), advances: options.payrollOverSettlementFixture ? [{ id: advance.id, referenceNumber: advance.advanceNumber, remainingAmount: "1000" }, { id: "second-advance", referenceNumber: "ADV-002", remainingAmount: "1000" }] : [{ id: advance.id, referenceNumber: advance.advanceNumber, remainingAmount: advance.remainingAmount }], advanceCount: options.truncatedPreview ? 101 : options.payrollOverSettlementFixture ? 2 : 1, hasMoreAdvances: Boolean(options.truncatedPreview), administrativeDeductions: options.payrollSelectionFixture ? [{ id: "ded-choice", referenceNumber: "DED-001", remainingAmount: "50.0000" }] : [], administrativeDeductionCount: options.payrollSelectionFixture ? 1 : 0, hasMoreAdministrativeDeductions: false };
      const secondId = "33333333-3333-4333-8333-333333333333";
      const secondSelected = Boolean(options.payrollSelectionFixture) && (input.selectedEmployeeIds ? input.selectedEmployeeIds.includes(secondId) : !(input.excludedEmployeeIds ?? []).includes(secondId));
      const gross = (selected ? employeeGross : 0) + (secondSelected ? 2000 : 0);
      const count = Number(selected) + Number(secondSelected);
      const second = { ...previewEmployee, id: secondId, employeeNumber: "EMP-002", nameAr: "الموظف الثاني", nameEn: "Second Employee", selected: secondSelected, included: secondSelected, monthlyGrossAmount: "2000.0000", estimatedGrossAmount: "2000.0000", estimatedNetAmount: secondSelected ? "2000.0000" : "0.0000", advances: [], advanceCount: 0, hasMoreAdvances: false, administrativeDeductions: [], administrativeDeductionCount: 0, hasMoreAdministrativeDeductions: false };
      return fulfill(route, { companyId, counts: { active: options.payrollSelectionFixture ? 2 : 1, onLeave: 0, included: count, excluded: (options.payrollSelectionFixture ? 2 : 1) - count, exceptions: 0 }, totals: { employeeCount: count, grossAmount: String(gross), advanceSettlementAmount: String(advanceTotal), administrativeDeductionAmount: String(deductionTotal), netPayableAmount: String(gross - advanceTotal - deductionTotal) }, exceptions: [], employees: options.payrollSelectionFixture && input.cursor ? [second] : [previewEmployee], hasMore: Boolean(options.payrollSelectionFixture && !input.cursor), nextCursor: options.payrollSelectionFixture && !input.cursor ? employee.id : null });
    }
    if (url.pathname === "/v1/hr/payroll-runs/update" && route.request().method() === "POST") return fulfill(route, { id: payrollRun.id, runNumber: payrollRun.runNumber, replayed: false });
    if (url.pathname === "/v1/hr/payroll-runs" && route.request().method() === "POST") return fulfill(route, { id: payrollRun.id, runNumber: payrollRun.runNumber, replayed: false });
    if (url.pathname === "/v1/hr/employee-payroll-history") return fulfill(route, { companyId, lines: [], hasMore: false, nextCursor: null });
    if (url.pathname === "/v1/hr/compensation-policies") return fulfill(route, { policies: [compensationPolicy] });
    if (url.pathname === "/v1/finance/configuration") return fulfill(route, { suppliers: [{ id: "supplier-1", nameAr: "مورد", nameEn: "Supplier", status: "ACTIVE" }], categories: [{ id: "category-1", code: "IQAMA", nameAr: "إقامة", nameEn: "Iqama", kind: "EXPENSE", status: "ACTIVE", suggestedSupplierId: null, isPosting: true }], vaults: [{ id: "vault-1", nameAr: "الخزينة", nameEn: "Vault", status: "ACTIVE", isPaymentDestination: true, paymentMethod: "CASH", paymentMethods: ["CASH"] }] });
    return fulfill(route, {});
  });
}

async function expectViewportContained(page: Page) {
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  for (const dialog of await page.getByRole("dialog").all()) {
    if (!(await dialog.isVisible())) continue;
    const box = await dialog.boundingBox();
    // A dialog can close between the visibility read and measurement while a
    // nested action is replacing it. It is no longer a visible viewport item.
    if (!box) continue;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) + 1);
  }
}

async function expectTopmostDialog(page: Page, name: string | RegExp) {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expectViewportContained(page);
  return dialog;
}

async function openAdvanceDetail(page: Page) {
  await page.locator(".hr-advance-group > button").first().click();
  await page.getByRole("button", { name: advance.advanceNumber }).click();
  return expectTopmostDialog(page, advance.advanceNumber);
}

async function openEmployeeProfile(page: Page) {
  await page.getByRole("listitem").filter({ hasText: employee.nameAr }).click();
  const profile = page.locator(".hr-employee-profile-page");
  await expect(profile).toBeVisible();
  return profile;
}

async function fillOnboarding(page: Page) {
  const dialog = page.getByRole("dialog", { name: "إضافة موظف" });
  await dialog.getByLabel("الاسم الكامل*").fill("موظف جديد");
  await dialog.getByRole("button", { name: "تاريخ التعيين" }).click();
  await page.getByRole("dialog", { name: "تاريخ التعيين" })
    .locator(".baseer-calendar-picker__days button:not(.is-outside):not([disabled])")
    .first()
    .click();
  await dialog.getByLabel("إجمالي الراتب الشهري*").fill("3000");
  return dialog;
}

test("HR overview keeps only its actionable summary cards in the modern administrative shell", async ({ page, isMobile }) => {
  const requested: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("baseer-erp.shell.presentation.v1", "modern-3");
  });
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=0");

  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
  await expect(page.locator(".hr-overview__activity-card.baseer-card--record")).toHaveCount(3);
  await expect(page.locator(".hr-workforce-chart")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(isMobile || (await page.locator(".module-sidebar").isVisible())).toBeTruthy();
});

test("attendance daily register keeps wide columns inside its mobile scroller", async ({ page }) => {
  const requested: string[] = [];
  await page.setViewportSize({ width: 393, height: 852 });
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=7");

  await expect(page.getByRole("heading", { name: "الحضور والانصراف" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "الحضور مقابل خطة الدوام" })).toBeVisible();
  const scroller = page.locator(".baseer-data-grid__scroll").first();
  await expect(scroller).toBeVisible();

  const geometry = await scroller.evaluate((element) => ({
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    localOverflow: element.scrollWidth - element.clientWidth,
    tableWidth: element.querySelector("table")?.scrollWidth ?? 0,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  expect(geometry.localOverflow).toBeGreaterThan(0);
  expect(geometry.tableWidth).toBeGreaterThan(geometry.viewportWidth);
  expect(requested.some((request) => request.startsWith("GET /v1/attendance/dashboard"))).toBeTruthy();
});

test("HR quick actions are permission-gated and open the requested operation", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=0");
  await expect(page.getByRole("heading", { name: "اليوم في الموارد البشرية" })).toBeVisible();
  await expect(page.locator(".hr-workforce-chart")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "موظف جديد" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إنشاء مسير" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل إجازة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل خدمة" })).toBeVisible();
  await page.getByRole("button", { name: "موظف جديد" }).click();
  const employeeDialog = page.getByRole("dialog", { name: "إضافة موظف" });
  await expect(employeeDialog).toContainText("إضافة موظف");
  await expect(employeeDialog).toHaveAttribute("aria-modal", "true");
  const coarsePointer = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  if (coarsePointer) await expect(employeeDialog).toBeFocused();
  await expectViewportContained(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("advance issuer sees the advance action only in the advances workstation", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { permissionCodes: ["hr.advances.issue"] });

  await page.goto("/#module=hr&section=4");
  const advanceQuickAdd = page.getByRole("button", { name: "إصدار سلفة" });
  await expect(advanceQuickAdd).toBeVisible();
  await advanceQuickAdd.click();
  await expectTopmostDialog(page, "إصدار سلفة");
});

test("payroll uses server search and cursor paging without page-level overflow", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=3");
  await expect(page.getByRole("heading", { name: "الرواتب", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "البحث في المسيرات" }).fill("PAY-2026");
  await expect.poll(() => requested.some((request) => request.includes("/v1/hr/payroll-runs?") && request.includes("search=PAY-2026"))).toBe(true);
  await page.getByRole("button", { name: "تحميل المزيد" }).click();
  await expect(page.getByText("PAY-2026-07")).toBeVisible();
  await expect.poll(() => requested.some((request) => request.includes("cursor="))).toBe(true);
  await expectViewportContained(page);
  const tableOverflowIsContained = await page.locator("table").first().evaluate((table) => {
    const parent = table.parentElement; return !!parent && parent.scrollWidth >= parent.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
  });
  expect(tableOverflowIsContained).toBe(true);
});

test("payroll create and saved draft edit keep one stable full editor", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { slowPayrollDetail: true });
  await page.goto("/#module=hr&section=3");

  await page.getByRole("button", { name: "إنشاء مسير" }).click();
  const createDialog = await expectTopmostDialog(page, "إنشاء مسير راتب");
  await createDialog.getByLabel("ملاحظات").fill("مسودة جديدة");
  const createButton = createDialog.getByRole("button", { name: "إنشاء المسودة" });
  await expect(createButton).toBeEnabled();
  const createRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs" && request.method() === "POST");
  await createButton.click();
  const createRequest = await createRequestPromise;
  expect(createRequest.postDataJSON()).toMatchObject({ notes: "مسودة جديدة", includeAllEligible: true });
  await expect(createDialog).toBeHidden();

  await page.getByRole("button", { name: payrollRun.runNumber }).click();
  const editor = page.getByRole("dialog", { name: `تعديل مسودة ${payrollRun.runNumber}` });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("status")).toHaveText("جارٍ فتح مسودة المسير…");
  const loadingBox = await editor.boundingBox();
  expect(loadingBox).not.toBeNull();
  await expect(editor.getByLabel("ملاحظات")).toHaveValue("ملاحظة المسودة");
  const readyBox = await editor.boundingBox();
  expect(readyBox).not.toBeNull();
  expect(Math.abs(readyBox!.x - loadingBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(readyBox!.y - loadingBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(readyBox!.width - loadingBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(readyBox!.height - loadingBox!.height)).toBeLessThanOrEqual(1);
  await expect(editor.getByLabel("الشهر").first()).toBeDisabled();
  await expect(editor.locator('.hr-payroll-create__application-list input[type="checkbox"]')).toBeChecked();
  await expect(editor.locator(".hr-payroll-create__application-list .baseer-money-input")).toHaveValue("100");
  await expect(editor.locator(".hr-payroll-create__total")).toContainText("2,900");
  const previewRequestsBeforeEdit = requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview").length;
  await editor.locator(".hr-payroll-create__application-list .baseer-money-input").fill("125");
  await expect(editor.locator(".hr-payroll-create__total")).toContainText("2,875");
  await expect(editor.getByRole("button", { name: "مراجعة واعتماد", exact: true })).toBeDisabled();
  await expect.poll(() => requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview").length).toBe(previewRequestsBeforeEdit + 1);
  await page.waitForTimeout(350);
  expect(requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview")).toHaveLength(previewRequestsBeforeEdit + 1);
  await editor.getByLabel("ملاحظات").fill("ملاحظة معدلة");
  const updateRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs/update" && request.method() === "POST");
  await editor.getByRole("button", { name: "حفظ التعديلات" }).click();
  const updateRequest = await updateRequestPromise;
  expect(updateRequest.postDataJSON()).toMatchObject({ payrollRunId: payrollRun.id, payrollMonth: "2026-08-01", selectedEmployeeIds: [employee.id], notes: "ملاحظة معدلة", lines: [{ employeeId: employee.id, advances: [{ id: advance.id, amount: "125" }] }] });
  expect(updateRequest.postDataJSON()).not.toHaveProperty("businessDate");
  await expect(editor).toBeHidden();
  expect(requested.filter((request) => request === "POST /v1/hr/payroll-runs/update")).toHaveLength(1);
  await expectViewportContained(page);
});

test("payroll preview failure reports once without a request loop", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { payrollPreviewFailure: true });
  await page.goto("/#module=hr&section=3");
  await page.getByRole("button", { name: "إنشاء مسير" }).click();
  const dialog = await expectTopmostDialog(page, "إنشاء مسير راتب");
  await expect(dialog.getByRole("alert")).toContainText("تعذر إعداد معاينة المسير");
  await page.waitForTimeout(700);
  expect(requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview")).toHaveLength(1);
});

for (const language of ["ar", "en"] as const) {
  test(`payroll previous month survives blur and submits a canonical date (${language})`, async ({ page }) => {
    const requested: string[] = [];
    await page.clock.setFixedTime(new Date("2026-09-06T10:00:00.000Z"));
    await mockHr(page, requested, { language });
    await page.goto("/#module=hr&section=3");
    const runRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: payrollRun.runNumber, exact: true }) });
    await expect(runRow.getByRole("cell", { name: "2026-08", exact: true })).toBeVisible();
    await expect(runRow.getByText("2026-08-01", { exact: true })).toHaveCount(0);
    const ar = language === "ar";
    await page.getByRole("button", { name: ar ? "إنشاء مسير" : "Create payroll" }).click();
    const dialog = page.getByRole("dialog", { name: ar ? "إنشاء مسير راتب" : "Create payroll run" });
    const monthInput = dialog.getByRole("textbox", { name: ar ? "الشهر" : "Month", exact: true });
    await monthInput.fill("2026-07");
    await dialog.getByRole("button", { name: ar ? "فتح التقويم: الشهر" : "Open calendar: Month", exact: true }).click();
    await page.locator(".baseer-calendar-picker__months button").nth(7).click();
    await dialog.getByLabel(ar ? "ملاحظات" : "Notes", { exact: true }).fill("August payroll");
    await expect(monthInput).toHaveValue("2026-08");
    const previewRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs/preview" && request.postDataJSON()?.payrollMonth === "2026-08-01");
    await dialog.getByRole("button", { name: ar ? "تحديث" : "Refresh", exact: true }).click();
    const previewRequest = await previewRequestPromise;
    expect(previewRequest.postDataJSON()).not.toHaveProperty("businessDate");
    const create = dialog.getByRole("button", { name: ar ? "إنشاء المسودة" : "Create draft", exact: true });
    await expect(create).toBeEnabled();
    const createRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs" && request.method() === "POST");
    const summaryRequestsBeforeCreate = requested.filter((request) => request === "GET /v1/hr/payroll-runs/missing-month-preview").length;
    await create.click();
    const payload = (await createRequestPromise).postDataJSON();
    expect(payload).toMatchObject({ payrollMonth: "2026-08-01", notes: "August payroll" });
    expect(payload).not.toHaveProperty("businessDate");
    await expect(dialog).toBeHidden();
    await expect.poll(() => requested.filter((request) => request === "GET /v1/hr/payroll-runs/missing-month-preview").length).toBeGreaterThan(summaryRequestsBeforeCreate);
    await expectViewportContained(page);
  });
}

test("employee profile shows exact counts, lazy compliance paging, and topmost modal semantics", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=1");
  const profile = await openEmployeeProfile(page);
  const tabsAreContained = await profile.getByRole("tablist").evaluate((tabs) => tabs.scrollWidth >= tabs.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(tabsAreContained).toBe(true);
  await expect(profile).toContainText("14");
  await expect(profile).toContainText("52");
  await expect(profile).toContainText("81");
  await profile.getByRole("tab", { name: "الخدمات والامتثال" }).click();
  await expect(profile.getByText("SRV-001")).toBeVisible();
  await profile.getByRole("button", { name: "تحميل المزيد" }).click();
  await expect(profile.getByText("SRV-002")).toBeVisible();
  await expect(profile.getByRole("button", { name: "نهاية الخدمة" })).toBeDisabled();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(profile).toBeVisible();
  await expectViewportContained(page);
});

test("employee profile presents server-owned attendance compliance without payroll actions", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=1");
  const profile = await openEmployeeProfile(page);
  const card = profile.locator(".hr-attendance-compliance");
  await expect(card).toBeVisible();
  await expect(card).toContainText("مؤشر الالتزام بالدوام");
  await expect(card).toContainText("لا يرتبط بالراتب أو احتساب الأوفر تايم");
  await expect(card).toContainText("97%");
  await expect.poll(() => requested.some((request) => request === `GET /v1/attendance/employees/${employee.id}/compliance?scope=YEAR`)).toBe(true);
  await expect(card.getByRole("button", { name: /راتب|خصم|مسير/ })).toHaveCount(0);
});

test("a stale employee profile link self-recovers to the current company register", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&page=hr-employees&stage=employee-stale-employee-id");

  await expect(page.getByText("تم تحديث بيانات الموظفين والعودة إلى القائمة. افتح بطاقة الموظف الحالية.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "موظف الاختبار" })).toBeVisible();
  await expect(page).toHaveURL(/#module=hr&page=hr-employees$/);
  await page.waitForTimeout(300);
  // React Strict Mode may mount a development read effect twice. The guard is
  // that recovery clears the stage and never creates a retry loop.
  expect(requested.filter((request) => request === "GET /v1/hr/employees/stale-employee-id").length).toBeLessThanOrEqual(2);
  await expect(page.getByText("السجل المطلوب غير موجود.")).toHaveCount(0);
});

test("successful onboarding closes, refreshes, and never repeats the POST", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { onboarding: "success" });
  await page.goto("/#module=hr&section=1&stage=new-employee");
  const dialog = await fillOnboarding(page);
  await dialog.getByRole("button", { name: "إضافة الموظف وحفظ الراتب" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => requested.filter((request) => request === "POST /v1/hr/employees/onboard").length).toBe(1);
  await page.waitForTimeout(300);
  expect(requested.filter((request) => request === "POST /v1/hr/employees/onboard")).toHaveLength(1);
});

test("failed onboarding POST remains in the topmost dialog error slot", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { onboarding: "failure" });
  await page.goto("/#module=hr&section=1&stage=new-employee");
  const dialog = await fillOnboarding(page);
  await dialog.getByRole("button", { name: "إضافة الموظف وحفظ الراتب" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("تعذر حفظ موظف الاختبار.");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(requested.filter((request) => request === "POST /v1/hr/employees/onboard")).toHaveLength(1);
});

test("HR renders a usable English LTR route", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { language: "en" });
  await page.goto("/#module=hr&section=3");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Payroll runs" })).toBeVisible();
  await expectViewportContained(page);
});

test("payroll preview exposes truncated applications and blocks incomplete creation", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { truncatedPreview: true });
  await page.goto("/#module=hr&section=3&stage=create-payroll");
  const dialog = page.getByRole("dialog", { name: "إنشاء مسير راتب" });
  await expect(dialog.getByText("تظهر 1 من 101. توجد تطبيقات إضافية غير ظاهرة.")).toBeVisible();
  await expect(dialog.getByText("توجد سلف أو خصومات إضافية غير ظاهرة في المعاينة. لا يمكن إنشاء المسير حتى تكتمل قائمة التطبيقات.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "إنشاء المسودة" })).toBeDisabled();
});

test("service and payroll stages open dialogs directly", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=5&stage=record-service");
  await expect(page.getByRole("dialog")).toContainText("تسجيل خدمة");
  await expectViewportContained(page);
  await page.keyboard.press("Escape");
  await page.goto("/#module=hr&section=3&stage=create-payroll");
  await expect(page.getByRole("dialog")).toContainText("إنشاء مسير راتب");
  await expectViewportContained(page);
});

test("all seven HR top-level sections render without page overflow", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  const surfaces = [
    { section: 0, text: "اليوم في الموارد البشرية" },
    { section: 1, text: "الموظفون" },
    { section: 2, text: "الإجازات والعودة" },
    { section: 3, text: "الرواتب" },
    { section: 4, text: "السلف والخصومات" },
    { section: 5, text: "الإقامات والخدمات" },
    { section: 6, text: "حاسبة الراتب" },
  ];
  for (const surface of surfaces) {
    await page.goto(`/#module=hr&section=${surface.section}`);
    const marker = surface.section === 6 ? page.getByRole("tab", { name: surface.text }) : page.getByRole("heading", { name: surface.text, exact: true }).first();
    await expect(marker).toBeVisible();
    if (surface.section === 6) {
      const documentsTab = page.getByRole("tab", { name: "وثائق الراتب" });
      await documentsTab.click();
      await expect(documentsTab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { name: "وثائق الراتب المعتمدة" })).toBeVisible();
    }
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expectViewportContained(page);
  }
});

test("employee profile covers all tabs and its principal dialogs", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { terminatedEmployee: true });
  await page.goto(`/#module=hr&page=hr-employees&stage=employee-${employee.id}`);
  const profile = page.locator(".hr-employee-profile-page");
  await expect(profile).toBeVisible();

  await profile.locator('input[type="file"][accept="image/jpeg,image/png"]').setInputFiles({
    name: "profile.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await expect(profile.getByRole("button", { name: "عرض صورة الموظف" })).toBeEnabled();
  await profile.getByRole("button", { name: "عرض صورة الموظف" }).click();
  await expectTopmostDialog(page, "صورة الموظف");
  await page.keyboard.press("Escape");
  await expect(profile).toBeVisible();

  const tabNames = ["نظرة 360", "المسار والتعويض والزيادات", "الرواتب والتسويات", "الإجازات", "الخدمات والامتثال", "المستندات والخطابات", "السجل المالي"];
  for (const name of tabNames) {
    const tab = profile.getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }

  await profile.getByRole("tab", { name: "المسار والتعويض والزيادات" }).click();
  await expect(profile.getByRole("heading", { name: "سجل تغييرات الراتب" })).toBeVisible();
  await profile.getByRole("tab", { name: "نظرة 360" }).click();
  await profile.getByRole("button", { name: "إدارة الراتب" }).click();
  const salaryDialog = await expectTopmostDialog(page, "إدارة الراتب");
  await salaryDialog.getByRole("button", { name: /زيادة راتب/ }).click();
  await expect(salaryDialog.getByText("مبلغ الزيادة", { exact: true })).toBeVisible();
  await salaryDialog.getByRole("button", { name: /تخفيض راتب/ }).click();
  await expect(salaryDialog.getByText("مبلغ التخفيض", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profile).toBeVisible();
  await profile.getByRole("tab", { name: "المسار والتعويض والزيادات" }).click();
  await profile.getByRole("button", { name: "تسجيل ترقية" }).click();
  await expectTopmostDialog(page, "تسجيل ترقية");
  await page.keyboard.press("Escape");

  await profile.getByRole("tab", { name: "المستندات والخطابات" }).click();
  await expect(profile.getByRole("button", { name: "إضافة مستند" })).toBeVisible();
  await profile.getByRole("button", { name: "إضافة مستند" }).click();
  await expectTopmostDialog(page, "إضافة مستند");
  await page.keyboard.press("Escape");
  await profile.getByRole("button", { name: document.title }).click();
  const documentDetail = await expectTopmostDialog(page, document.title);
  await documentDetail.getByRole("button", { name: "استبدال الملف" }).click();
  await expectTopmostDialog(page, "استبدال ملف المستند");
  await page.keyboard.press("Escape");
  await documentDetail.getByRole("button", { name: "إلغاء المستند" }).click();
  await expectTopmostDialog(page, "إلغاء المستند");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await profile.getByRole("button", { name: "إصدار خطاب" }).click();
  await expectTopmostDialog(page, "إصدار خطاب موظف");
  await page.keyboard.press("Escape");
  await profile.getByRole("button", { name: letter.letterNumber }).click();
  const letterDetail = await expectTopmostDialog(page, letter.letterNumber);
  await letterDetail.getByRole("button", { name: "إلغاء الخطاب" }).click();
  await expectTopmostDialog(page, "إلغاء الخطاب");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await profile.getByRole("button", { name: "نهاية الخدمة" }).click();
  const eos = await expectTopmostDialog(page, `نهاية خدمة ${employee.nameAr}`);
  await eos.getByRole("tab", { name: "سجل المخالصات" }).click();
  await eos.getByRole("button", { name: pendingSettlement.settlementNumber }).click();
  const pendingDetail = await expectTopmostDialog(page, pendingSettlement.settlementNumber);
  await pendingDetail.getByRole("button", { name: "تحقق من السبب" }).click();
  await expectTopmostDialog(page, "تحقق من سبب الإنهاء");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await eos.getByRole("button", { name: verifiedSettlement.settlementNumber }).click();
  const verifiedDetail = await expectTopmostDialog(page, verifiedSettlement.settlementNumber);
  await verifiedDetail.getByRole("button", { name: "اعتماد" }).click();
  await expectTopmostDialog(page, "اعتماد المخالصة");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await eos.getByRole("button", { name: approvedSettlement.settlementNumber }).click();
  const approvedDetail = await expectTopmostDialog(page, approvedSettlement.settlementNumber);
  await approvedDetail.getByRole("button", { name: "صرف" }).click();
  await expectTopmostDialog(page, "صرف المخالصة");
  await page.keyboard.press("Escape");
  await approvedDetail.getByRole("button", { name: "إلغاء", exact: true }).click();
  await expectTopmostDialog(page, "إلغاء المخالصة");
  await page.keyboard.press("Escape");
  await approvedDetail.getByRole("button", { name: "إلغاء الدفعة" }).click();
  await expectTopmostDialog(page, "إلغاء دفعة المخالصة");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(profile).toBeVisible();
  await profile.getByRole("button", { name: "تعديل البيانات" }).click();
  await expectTopmostDialog(page, "تعديل الموظف");
});

test("leave and payroll dialogs include nested return and destructive confirmation", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=2");
  await page.getByRole("button", { name: "تسجيل إجازة" }).click();
  const leaveRegister = await expectTopmostDialog(page, "تسجيل إجازة");
  if (await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)) {
    await expect(leaveRegister).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: new RegExp(employee.employeeNumber) }).click();
  const leaveDetail = await expectTopmostDialog(page, "تفاصيل الإجازة");
  await leaveDetail.getByRole("button", { name: "تسجيل العودة" }).click();
  await expectTopmostDialog(page, "تسجيل العودة إلى العمل");
  await expect(page.locator('[role="dialog"][aria-hidden="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

  await page.goto("/#module=hr&section=3");
  await page.getByRole("button", { name: "إنشاء مسير" }).click();
  await expectTopmostDialog(page, "إنشاء مسير راتب");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "سياسات التعويض" }).click();
  const policies = await expectTopmostDialog(page, "سياسات التعويض");
  await policies.getByRole("button", { name: "إضافة سياسة" }).click();
  await expectTopmostDialog(page, "إضافة سياسة تعويض");
  await expect(page.locator('[role="dialog"][aria-hidden="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await policies.getByRole("button", { name: "إصدار جديد: سياسة الاختبار" }).click();
  await expectTopmostDialog(page, "إنشاء إصدار سياسة");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: payrollRun.runNumber }).click();
  const payrollEditor = await expectTopmostDialog(page, `تعديل مسودة ${payrollRun.runNumber}`);
  await payrollEditor.getByRole("button", { name: "حذف المسودة" }).click();
  await expectTopmostDialog(page, "حذف مسودة المسير");
  await page.keyboard.press("Escape");
  await expect(payrollEditor).toHaveAttribute("aria-modal", "true");
  await payrollEditor.getByRole("button", { name: "مراجعة واعتماد" }).click();
  const payrollDetail = await expectTopmostDialog(page, payrollRun.runNumber);
  await expect(payrollDetail.getByRole("button", { name: "اعتماد" })).toBeVisible();
  await payrollDetail.getByRole("button", { name: "حذف المسودة" }).click();
  await expectTopmostDialog(page, "حذف مسودة المسير");
  await expect(page.locator('[role="dialog"][aria-hidden="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(payrollDetail).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: approvedPayrollRun.runNumber }).click();
  const approvedPayroll = await expectTopmostDialog(page, approvedPayrollRun.runNumber);
  await approvedPayroll.getByRole("button", { name: "سداد" }).click();
  await expectTopmostDialog(page, "سداد مسير الرواتب");
  await page.keyboard.press("Escape");
  await approvedPayroll.getByRole("button", { name: "إلغاء", exact: true }).click();
  await expectTopmostDialog(page, "إلغاء مسير الرواتب");
  await page.keyboard.press("Escape");
  await approvedPayroll.getByRole("button", { name: "إلغاء الدفعة" }).click();
  await expectTopmostDialog(page, "إلغاء دفعة المسير");
});

test("leave date picker uses the Baseer calendar in Arabic without a native date input", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=2");
  await page.getByRole("button", { name: "تسجيل إجازة" }).click();
  const dialog = await expectTopmostDialog(page, "تسجيل إجازة");
  const from = dialog.getByRole("textbox", { name: "من" });
  const to = dialog.getByRole("textbox", { name: "إلى" });
  await expect(from).toBeVisible();
  await expect(from).toHaveAttribute("lang", "en");
  await expect(from).toHaveAttribute("type", "text");
  await from.focus();
  await expect(from).toBeFocused();
  await from.fill("2026-09-10");
  await dialog.getByRole("button", { name: "فتح التقويم: من" }).click();
  const calendar = page.getByRole("dialog", { name: "من" });
  await expect(calendar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await dialog.getByRole("button", { name: "فتح التقويم: من" }).click();
  await page.getByRole("dialog", { name: "من" }).getByRole("button", { name: "11", exact: true }).click();
  await expect(from).toHaveValue("2026-09-11");
  await dialog.getByRole("button", { name: "فتح التقويم: إلى" }).click();
  await expect(page.getByRole("dialog", { name: "إلى" }).getByRole("button", { name: "10", exact: true }).first()).toBeDisabled();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await to.fill("2026-09-12");
});

test("leave date picker remains labeled, bounded and usable in English LTR", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { language: "en" });

  await page.goto("/#module=hr&section=2");
  await page.getByRole("button", { name: "Record leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Record leave" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const from = dialog.getByRole("textbox", { name: "From" });
  const to = dialog.getByRole("textbox", { name: "To" });
  await from.fill("2026-09-11");
  await dialog.getByRole("button", { name: "Open calendar: From" }).click();
  await page.getByRole("dialog", { name: "From" }).getByRole("button", { name: "12", exact: true }).click();
  await expect(from).toHaveValue("2026-09-12");
  await dialog.getByRole("button", { name: "Open calendar: To" }).click();
  await expect(page.getByRole("dialog", { name: "To" }).getByRole("button", { name: "11", exact: true }).first()).toBeDisabled();
  await to.fill("2026-09-13");
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
});

test("clearable document dates clear through the Baseer date control", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=1");
  const profile = await openEmployeeProfile(page);
  await profile.getByRole("tab", { name: "المستندات والخطابات" }).click();
  await profile.getByRole("button", { name: "إضافة مستند" }).click();
  const create = await expectTopmostDialog(page, "إضافة مستند");
  const issueDate = create.getByRole("textbox", { name: "تاريخ الإصدار" });
  await issueDate.fill("2026-08-10");
  await expect(issueDate).toHaveValue("2026-08-10");
  await create.getByRole("button", { name: "مسح التاريخ" }).click();
  await expect(issueDate).toHaveValue("");
});

test("service cancellation validates its required reason before sending a request", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=5");
  await page.getByRole("button", { name: "إدارة الخدمات" }).click();
  const serviceRow = page.getByRole("row").filter({ hasText: service.referenceNumber! });
  await serviceRow.getByRole("button", { name: new RegExp(employee.employeeNumber) }).click();
  const serviceDetail = await expectTopmostDialog(page, "تجديد إقامة");
  await serviceDetail.getByRole("button", { name: "إلغاء الخدمة" }).click();
  const dialog = await expectTopmostDialog(page, "إلغاء الخدمة");
  await expect(dialog.locator('[data-baseer-rhf-form="true"]')).toBeVisible();
  await dialog.getByRole("button", { name: "تأكيد الإلغاء" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveText("أدخل سبب الإلغاء قبل التأكيد.");
  await expect(dialog.getByRole("textbox", { name: "سبب الإلغاء" })).toBeFocused();
  expect(requested.some((request) => request.startsWith("POST /v1/hr/services/cancel"))).toBeFalsy();

  await dialog.getByRole("textbox", { name: "سبب الإلغاء" }).fill("سبب اختباري");
  await dialog.getByRole("button", { name: "تأكيد الإلغاء" }).click();
  await expect.poll(() => requested.some((request) => request.startsWith("POST /v1/hr/services/cancel"))).toBe(true);
});

test("leave employee filter uses the Baseer Combobox adapter with keyboard search", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=2");
  await page.getByRole("button", { name: "الفلاتر" }).click();
  const combobox = page.getByRole("combobox", { name: "الموظف" });
  await combobox.focus();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "فتح قائمة الموظف" });
  await toggle.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(combobox).not.toBeFocused();
  await combobox.fill("موظف");
  await expect(page.getByRole("option", { name: `${employee.employeeNumber} · ${employee.nameAr}` })).toBeVisible();
  await expect.poll(() => requested.some((request) => request.includes("GET /v1/hr/employees?search="))).toBeTruthy();
  await combobox.press("Home");
  await combobox.press("End");
  await combobox.press("ArrowDown");
  await combobox.press("Enter");
  await expect(combobox).toHaveValue(`${employee.employeeNumber} · ${employee.nameAr}`);
  expect(requested.some((request) => request.includes("GET /v1/hr/employees?search="))).toBeTruthy();

  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("leave register requests server sorting when its period header changes", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=2");
  await page.getByRole("columnheader", { name: "الفترة" }).getByRole("button").click();
  await expect.poll(() => requested.filter((request) => request.startsWith("GET /v1/hr/leaves")).at(-1) ?? "").toContain("sortDirection=asc");
  await expect(page.getByRole("columnheader", { name: "الفترة" })).toHaveAttribute("aria-sort", "ascending");
});

for (const language of ["ar", "en"] as const) {
  test(`leave register has no automated WCAG A or AA violations in ${language}`, async ({ page }) => {
    const requested: string[] = [];
    await mockHr(page, requested, { language });

    await page.goto("/#module=hr&section=2");
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    expect(report.violations).toEqual([]);
  });
}

test("leave employee search does not survive a real company switch", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { slowEmployeeSearch: true });

  await page.goto("/#module=hr&section=2");
  await page.getByRole("button", { name: "الفلاتر" }).click();
  const combobox = page.getByRole("combobox", { name: "الموظف" });
  await combobox.fill("موظف");
  await expect.poll(() => requested.some((request) => request.includes("GET /v1/hr/employees?search="))).toBeTruthy();
  await switchToAlternateCompany(page);
  await page.getByRole("button", { name: "الفلاتر" }).click();
  const alternateCombobox = page.getByRole("combobox", { name: "الموظف" });
  await alternateCombobox.fill("موظف");
  await expect(page.getByRole("option", { name: `${employee.employeeNumber} · ${employee.nameAr}` })).toHaveCount(0);
  await expect(page.getByText("لا يوجد موظفون مطابقون.")).toBeVisible();
  await expect.poll(() => requested.some((request) => request.includes("GET /v1/hr/employees?search="))).toBeTruthy();
});

test("leave employee filter is cleared after a real company switch", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=2");
  await page.getByRole("button", { name: "الفلاتر" }).click();
  const combobox = page.getByRole("combobox", { name: "الموظف" });
  await combobox.fill("موظف");
  await expect(page.getByRole("option", { name: `${employee.employeeNumber} · ${employee.nameAr}` })).toBeVisible();
  await combobox.press("ArrowDown");
  await combobox.press("Enter");
  const employeeChip = page.locator(".baseer-inline-actions .daily-sales-badge").filter({ hasText: "موظف الاختبار" });
  await expect(employeeChip).toBeVisible();

  requested.length = 0;
  await switchToAlternateCompany(page);
  await expect(employeeChip).toHaveCount(0);
  await page.getByRole("button", { name: "الفلاتر" }).click();
  await page.getByLabel("الحالة").selectOption("APPROVED");
  await expect.poll(() => requested.filter((request) => request.startsWith("GET /v1/hr/leaves")).at(-1) ?? "").not.toContain("employeeId=");
});

test("leave employee filter remains labeled and usable in English LTR", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { language: "en" });

  await page.goto("/#module=hr&section=2");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "Filters" }).click();
  const combobox = page.getByRole("combobox", { name: "Employee" });
  await combobox.fill("Test");
  await expect(page.getByRole("option", { name: `${employee.employeeNumber} · ${employee.nameEn}` })).toBeVisible();
  await expect.poll(() => requested.some((request) => request.includes("GET /v1/hr/employees?search=Test"))).toBeTruthy();
  await combobox.press("ArrowDown");
  await combobox.press("Enter");
  await expect(combobox).toHaveValue(`${employee.employeeNumber} · ${employee.nameEn}`);
});

test("advance deduction and service create/detail dialogs are centralized", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=4");
  await page.getByRole("button", { name: "إصدار سلفة" }).click();
  await expectTopmostDialog(page, "إصدار سلفة");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "إضافة خصم إداري" }).click();
  await expectTopmostDialog(page, "إضافة خصم إداري");
  await page.keyboard.press("Escape");
  const advanceDetail = await openAdvanceDetail(page);
  await advanceDetail.getByRole("button", { name: "إلغاء إصدار السلفة" }).click();
  await expectTopmostDialog(page, "إلغاء إصدار السلفة");
  await page.keyboard.press("Escape");
  await expect(advanceDetail).toBeVisible();
  await advanceDetail.getByRole("button", { name: "إغلاق" }).click();
  await page.getByRole("button", { name: "سداد السلفة" }).click();
  await expectTopmostDialog(page, "سداد السلفة");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "تأجيل الرصيد" }).click();
  await expectTopmostDialog(page, "تأجيل الرصيد");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: deduction.deductionNumber }).click();
  await expectTopmostDialog(page, deduction.deductionNumber);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "تأجيل الخصم" }).click();
  await expectTopmostDialog(page, "تأجيل الخصم");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "إلغاء الخصم" }).click();
  await expectTopmostDialog(page, "إلغاء الخصم");
  await page.keyboard.press("Escape");

  await page.goto("/#module=hr&section=5");
  await page.getByRole("button", { name: "إدارة الخدمات" }).click();
  await page.getByRole("button", { name: "تسجيل خدمة" }).click();
  await expectTopmostDialog(page, "تسجيل خدمة وإصدار فاتورة");
  await page.keyboard.press("Escape");
  const serviceRow = page.getByRole("row").filter({ hasText: service.referenceNumber! });
  await serviceRow.getByRole("button", { name: new RegExp(employee.employeeNumber) }).click();
  let serviceDetail = await expectTopmostDialog(page, "تجديد إقامة");
  await serviceDetail.getByRole("button", { name: "تعديل", exact: true }).click();
  await expectTopmostDialog(page, "تعديل الخدمة");
  await page.keyboard.press("Escape");
  await serviceRow.getByRole("button", { name: new RegExp(employee.employeeNumber) }).click();
  serviceDetail = await expectTopmostDialog(page, "تجديد إقامة");
  await serviceDetail.getByRole("button", { name: "تجديد", exact: true }).click();
  await expectTopmostDialog(page, "تجديد الخدمة");
  await page.keyboard.press("Escape");
  await serviceRow.getByRole("button", { name: new RegExp(employee.employeeNumber) }).click();
  serviceDetail = await expectTopmostDialog(page, "تجديد إقامة");
  await serviceDetail.getByRole("button", { name: "إصدار التكلفة" }).click();
  await expectTopmostDialog(page, "إصدار تكلفة الخدمة");
  await page.keyboard.press("Escape");
  await serviceDetail.getByRole("button", { name: "إلغاء الخدمة" }).click();
  await expectTopmostDialog(page, "إلغاء الخدمة");
  await page.keyboard.press("Escape");
  const postedRow = page.getByRole("row").filter({ hasText: postedService.referenceNumber! });
  await postedRow.getByRole("button", { name: new RegExp(employee.employeeNumber) }).click();
  const postedDetail = await expectTopmostDialog(page, "تجديد إقامة");
  await postedDetail.getByRole("button", { name: "إلغاء التكلفة" }).click();
  await expectTopmostDialog(page, "إلغاء تكلفة الخدمة");
});

test("advance deferral pagination advances and clears its own cursor", async ({ page }) => {
  const requested: string[] = [];
  const detailRequests: string[] = [];
  await mockHr(page, requested);
  await page.route(`**/v1/hr/advances/${advance.id}**`, async (route) => {
    const url = new URL(route.request().url());
    detailRequests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    const deferralCursor = url.searchParams.get("deferralCursor");
    const deferrals = deferralCursor
      ? [{ id: "deferral-2", businessDate: "2026-08-02", deferredUntil: "2026-10-01", reason: "تأجيل ثانٍ" }]
      : [{ id: "deferral-1", businessDate: "2026-08-01", deferredUntil: "2026-09-01", reason: "تأجيل أول" }];
    return fulfill(route, { advance, sourceAnnotations: [], settlements: [], hasMoreSettlements: false, nextSettlementCursor: null, deferrals, hasMoreDeferrals: !deferralCursor, nextDeferralCursor: deferralCursor ? null : "deferral-cursor-2" });
  });

  await page.goto("/#module=hr&section=4");
  const advanceDetail = await openAdvanceDetail(page);
  await expect(advanceDetail.getByText("تأجيل أول")).toBeVisible();
  await advanceDetail.getByRole("button", { name: "تحميل المزيد" }).click();
  await expect(advanceDetail.getByText("تأجيل ثانٍ")).toBeVisible();
  await expect(advanceDetail.getByRole("button", { name: "تحميل المزيد" })).toHaveCount(0);
  expect(detailRequests.filter((request) => request === `GET /v1/hr/advances/${advance.id}?deferralCursor=deferral-cursor-2&deferralPageSize=50`)).toHaveLength(1);
});
for (const language of ["ar", "en"] as const) {
  test(`payroll employee selection updates global server cards across pages (${language})`, async ({ page }, testInfo) => {
    const requested: string[] = [];
    await mockHr(page, requested, { language, payrollSelectionFixture: true });
    await page.goto("/#module=hr&section=3");
    const ar = language === "ar";
    await page.getByRole("button", { name: ar ? "إنشاء مسير" : "Create payroll", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: ar ? "إنشاء مسير راتب" : "Create payroll run" });
    const summary = dialog.getByRole("list", { name: ar ? "ملخص المسير" : "Payroll summary" });
    const card = (label: string) => summary.getByRole("listitem").filter({ hasText: label });
    const gross = card(ar ? "إجمالي الرواتب" : "Gross salaries");
    const net = card(ar ? "صافي الرواتب" : "Net salaries");
    const first = dialog.getByRole("checkbox", { name: ar ? "إدراج موظف الاختبار" : "Include Test Employee", exact: true });
    await expect(first).toBeChecked();
    await expect(dialog.getByText("EMP-001", { exact: false })).toHaveCount(0);
    await expect(gross).toContainText("5,000");
    await expect(net).toContainText("5,000");
    await dialog.locator('.hr-payroll-create__application-list label').filter({ hasText: "ADV-001" }).getByRole("checkbox").check();
    await dialog.getByRole("textbox", { name: ar ? "سلفة ADV-001" : "Advance ADV-001", exact: true }).fill("125.25");
    await dialog.locator('.hr-payroll-create__application-list label').filter({ hasText: "DED-001" }).getByRole("checkbox").check();
    await expect(card(ar ? "سداد السلف" : "Advance settlements")).toContainText("125.25");
    await expect(card(ar ? "الخصومات" : "Deductions")).toContainText("50");
    await expect(net).toContainText("4,824.75");
    await page.screenshot({ path: testInfo.outputPath("payroll-selection-employee.png") });
    await dialog.locator(".hr-payroll-create__controls").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("payroll-selection-summary.png") });
    await dialog.getByRole("button", { name: ar ? "التالي" : "Next", exact: true }).click();
    const second = dialog.getByRole("checkbox", { name: ar ? "إدراج الموظف الثاني" : "Include Second Employee", exact: true });
    await expect(second).toBeChecked();
    await expect(net).toContainText("4,824.75");
    await second.uncheck();
    const create = dialog.getByRole("button", { name: ar ? "إنشاء المسودة" : "Create draft", exact: true });
    // Pending-save blocking is verified with a held response below; immediate responses may already be current.
    await expect(gross).toContainText("3,000");
    await expect(net).toContainText("2,824.75");
    await dialog.getByRole("button", { name: ar ? "السابق" : "Previous", exact: true }).click();
    await expect(first).toBeChecked();
    await expect(dialog.getByRole("textbox", { name: ar ? "سلفة ADV-001" : "Advance ADV-001", exact: true })).toHaveValue("125.25");
    await expect(net).toContainText("2,824.75");
    await dialog.getByRole("button", { name: ar ? "إلغاء التحديد" : "Clear selection", exact: true }).click();
    await expect(first).not.toBeChecked();
    await expect(net.locator(".baseer-money")).toHaveText("0 SAR");
    await expect(create).toBeDisabled();
    await dialog.getByRole("button", { name: ar ? "تحديد الكل" : "Select all", exact: true }).click();
    await expect(net).toContainText("5,000");
    await first.uncheck();
    await expect(net).toContainText("2,000");
    await expectViewportContained(page);
    const requestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs" && request.method() === "POST");
    await create.click();
    expect((await requestPromise).postDataJSON()).toMatchObject({ excludedEmployeeIds: [employee.id], lines: [] });
    await expect(dialog).toBeHidden();
  });
}

test("payroll saved selection does not re-add employees missing from the draft", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { payrollSelectionFixture: true });
  await page.goto("/#module=hr&section=3");
  await page.getByRole("button", { name: payrollRun.runNumber, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `تعديل مسودة ${payrollRun.runNumber}` });
  await expect(dialog.getByRole("checkbox", { name: "إدراج موظف الاختبار", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "إدراج الموظف الثاني", exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("listitem").filter({ hasText: "صافي الرواتب" })).toContainText("2,900");
  const requestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs/update" && request.method() === "POST");
  await dialog.getByRole("button", { name: "حفظ التعديلات", exact: true }).click();
  expect((await requestPromise).postDataJSON()).toMatchObject({ selectedEmployeeIds: [employee.id], lines: [{ employeeId: employee.id }] });
});

test("payroll incomplete applications remain blocked across pages until employee deselection", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { payrollSelectionFixture: true, truncatedPreview: true });
  await page.goto("/#module=hr&section=3");
  await page.getByRole("button", { name: "إنشاء مسير", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "إنشاء مسير راتب" });
  const create = dialog.getByRole("button", { name: "إنشاء المسودة", exact: true });
  await expect(dialog.getByText("توجد سلف أو خصومات إضافية", { exact: false })).toBeVisible();
  await expect(create).toBeDisabled();
  await dialog.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "إدراج الموظف الثاني", exact: true })).toBeChecked();
  await expect(create).toBeDisabled();
  await dialog.getByRole("button", { name: "السابق", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "إدراج موظف الاختبار", exact: true }).uncheck();
  await expect(create).toBeEnabled();
});

test("payroll late selection preview cannot overwrite newer totals or enable stale creation", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested, { payrollSelectionFixture: true });
  let releaseOld: (() => void) | undefined;
  let held = false;
  const oldRequest = new Promise<void>((resolve) => { releaseOld = resolve; });
  await page.route("**/v1/hr/payroll-runs/preview", async (route) => {
    if (route.request().postDataJSON().excludedEmployeeIds?.includes(employee.id)) { held = true; await oldRequest; }
    await route.fallback();
  });
  await page.goto("/#module=hr&section=3");
  await page.getByRole("button", { name: "إنشاء مسير", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "إنشاء مسير راتب" });
  const net = dialog.getByRole("listitem").filter({ hasText: "صافي الرواتب" });
  const create = dialog.getByRole("button", { name: "إنشاء المسودة", exact: true });
  await expect(net).toContainText("5,000");
  await dialog.getByRole("checkbox", { name: "إدراج موظف الاختبار", exact: true }).uncheck();
  await expect.poll(() => held).toBe(true);
  await expect(create).toBeDisabled();
  await expect(net).toContainText("5,000");
  await expect(dialog.locator(".hr-payroll-create__summary-region")).toHaveAttribute("aria-busy", "true");
  await dialog.getByRole("button", { name: "تحديد الكل", exact: true }).click();
  await expect(net).toContainText("5,000");
  releaseOld?.();
  await expect.poll(() => requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview").length).toBeGreaterThanOrEqual(2);
  await expect(create).toBeEnabled();
  await expect(net).toContainText("5,000");
});

for (const status of ["ON_LEAVE", "ACTIVE"] as const) {
  test(`payroll saved employee restores current leave inclusion (${status})`, async ({ page }) => {
    const requested: string[] = [];
    await mockHr(page, requested, { payrollSavedEmployeeStatus: status });
    const requestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs/preview" && request.postDataJSON().selectedEmployeeIds?.includes(employee.id));
    await page.goto("/#module=hr&section=3");
    await page.getByRole("button", { name: payrollRun.runNumber, exact: true }).click();
    expect((await requestPromise).postDataJSON().includeOnLeaveEmployeeIds).toEqual(status === "ON_LEAVE" ? [employee.id] : []);
    const dialog = page.getByRole("dialog", { name: `تعديل مسودة ${payrollRun.runNumber}` });
    const updatePromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs/update" && request.method() === "POST");
    await dialog.getByRole("button", { name: "حفظ التعديلات", exact: true }).click();
    expect((await updatePromise).postDataJSON().includeOnLeaveEmployeeIds).toEqual(status === "ON_LEAVE" ? [employee.id] : []);
  });
}

for (const language of ["ar", "en"] as const) {
  test(`payroll excessive advance settlement blocks creation and recovers after correction (${language})`, async ({ page }) => {
    const requested: string[] = [];
    await mockHr(page, requested, { language, payrollOverSettlementFixture: true });
    const ar = language === "ar";
    await page.goto("/#module=hr&section=3");
    await page.getByRole("button", { name: ar ? "إنشاء مسير" : "Create payroll", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: ar ? "إنشاء مسير راتب" : "Create payroll run" });
    const net = dialog.getByRole("listitem").filter({ hasText: ar ? "صافي الرواتب" : "Net salaries" });
    const create = dialog.getByRole("button", { name: ar ? "إنشاء المسودة" : "Create draft", exact: true });
    await expect(net).toContainText("1,800");
    await dialog.locator('.hr-payroll-create__application-list label').filter({ hasText: "ADV-001" }).getByRole("checkbox").check();
    await expect(net).toContainText("800");
    await dialog.locator('.hr-payroll-create__application-list label').filter({ hasText: "ADV-002" }).getByRole("checkbox").check();
    await expect(create).toBeDisabled();
    await expect(dialog.getByRole("alert")).toContainText(ar ? "يتجاوز راتب الموظف" : "exceed the employee salary");
    await expect(net.locator(".baseer-money")).toHaveCount(0);
    expect(requested.filter((request) => request === "POST /v1/hr/payroll-runs")).toHaveLength(0);
    await dialog.getByRole("textbox", { name: ar ? "سلفة ADV-002" : "Advance ADV-002", exact: true }).fill("800");
    await expect(net.locator(".baseer-money")).toHaveText("0 SAR");
    await expect(create).toBeEnabled();
    const saved = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs" && request.method() === "POST");
    await create.click();
    expect((await saved).postDataJSON()).toMatchObject({ lines: [{ employeeId: employee.id, advances: [{ id: advance.id, amount: "1000" }, { id: "second-advance", amount: "800" }] }] });
    await expect(dialog).toBeHidden();
  });
}

for (const language of ["ar", "en"] as const) {
  test(`payroll summary stays stable while selection requests start immediately (${language})`, async ({ page }, testInfo) => {
    const requested: string[] = [];
    await page.clock.install({ time: new Date("2026-09-06T09:00:00Z") });
    await mockHr(page, requested, { language, payrollSelectionFixture: true });
    let release: (() => void) | undefined;
    let held = false;
    const responseGate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/v1/hr/payroll-runs/preview", async (route) => {
      if (route.request().postDataJSON().lines?.[0]?.advances?.[0]?.amount === "500") { held = true; await responseGate; }
      await route.fallback();
    });
    const ar = language === "ar";
    await page.goto("/#module=hr&section=3");
    await page.getByRole("button", { name: ar ? "إنشاء مسير" : "Create payroll", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: ar ? "إنشاء مسير راتب" : "Create payroll run" });
    const summary = dialog.locator(".hr-payroll-create__summary-region");
    const net = dialog.getByRole("listitem").filter({ hasText: ar ? "صافي الرواتب" : "Net salaries" });
    const footer = dialog.locator(".hr-payroll-create__total");
    const create = dialog.getByRole("button", { name: ar ? "إنشاء المسودة" : "Create draft", exact: true });
    await expect(create).toBeEnabled();
    await expect(net).toContainText("5,000");
    const geometry = () => dialog.locator(".hr-payroll-create__summary-region, .hr-payroll-create__table-heading, .hr-payroll-create__total").evaluateAll((elements) => elements.map((element) => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, top: rect.top }; }));
    await dialog.locator(".hr-payroll-create__controls").scrollIntoViewIfNeeded();
    const before = await geometry();
    await page.clock.pauseAt(new Date("2026-09-06T09:10:00Z"));
    await dialog.locator('.hr-payroll-create__application-list label').filter({ hasText: "ADV-001" }).getByRole("checkbox").check({ force: true });
    await page.clock.runFor(1);
    await expect.poll(() => held).toBe(true);
    await expect(summary).toHaveAttribute("aria-busy", "true");
    await expect(create).toBeDisabled();
    await expect(net).toContainText("5,000");
    await expect(footer).toContainText("5,000");
    await expect(dialog.locator(".hr-payroll-create__update-status")).toContainText(ar ? "آخر حساب مكتمل" : "last completed calculation");
    await expect(dialog.getByRole("row").filter({ hasText: "ADV-001" }).locator(".baseer-money").last()).toContainText("3,000");
    await page.clock.resume();
    await dialog.locator(".hr-payroll-create__controls").scrollIntoViewIfNeeded();
    const pending = await geometry();
    for (let i = 0; i < before.length; i++) for (const dimension of ["width", "height", "top"] as const) expect(Math.abs(pending[i][dimension] - before[i][dimension])).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("payroll-pending-stable.png") });
    release?.();
    await expect(net).toContainText("4,500");
    await expect(create).toBeEnabled();
    await expect(summary).toHaveAttribute("aria-busy", "false");
    // Coalesce a burst of typing; a checkbox above did not wait for this timer.
    await page.clock.pauseAt(new Date("2026-09-06T09:20:00Z"));
    const count = requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview").length;
    const amount = dialog.getByRole("textbox", { name: ar ? "سلفة ADV-001" : "Advance ADV-001", exact: true });
    await amount.fill("12");
    await amount.fill("125.25");
    await page.clock.runFor(149);
    expect(requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview")).toHaveLength(count);
    await expect(net).toContainText("4,500");
    await expect(create).toBeDisabled();
    await page.clock.runFor(1);
    await expect(net).toContainText("4,874.75");
    expect(requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview")).toHaveLength(count + 1);
    await page.clock.resume();
    await expect(create).toBeEnabled();
    // A new month must never display the previous month's receipt.
    let releaseMonth: (() => void) | undefined;
    let monthHeld = false;
    const monthGate = new Promise<void>((resolve) => { releaseMonth = resolve; });
    await page.route("**/v1/hr/payroll-runs/preview", async (route) => {
      if (route.request().postDataJSON().payrollMonth === "2026-07-01") { monthHeld = true; await monthGate; }
      await route.fallback();
    });
    await dialog.getByRole("textbox", { name: ar ? "الشهر" : "Month", exact: true }).fill("2026-07");
    await dialog.getByLabel(ar ? "ملاحظات" : "Notes", { exact: true }).click();
    await expect.poll(() => monthHeld).toBe(true);
    await expect(summary.locator(".baseer-money")).toHaveCount(0);
    await expect(footer.locator(".baseer-money")).toHaveCount(0);
    await expect(dialog.locator(".hr-payroll-create__table-wrap")).toHaveCount(0);
    await expect(create).toBeDisabled();
    releaseMonth?.();
    await expect(net).toContainText("5,000");
    await expect(create).toBeEnabled();
    await expectViewportContained(page);
  });
}

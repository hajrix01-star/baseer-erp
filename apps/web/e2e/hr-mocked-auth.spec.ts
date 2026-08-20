import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";
const permissions = [
  "hr.employees.read", "hr.employees.write", "hr.leaves.read", "hr.leaves.manage",
  "hr.payroll.read", "hr.payroll.create", "hr.payroll.approve", "hr.payroll.pay", "hr.payroll.reverse",
  "hr.advances.read", "hr.advances.issue", "hr.advances.settle", "hr.advances.reverse", "hr.deductions.manage",
  "hr.employee_letters.read", "hr.employee_letters.issue", "hr.final_settlements.read", "hr.final_settlements.create",
  "hr.final_settlements.verify", "hr.final_settlements.approve", "hr.final_settlements.pay", "hr.final_settlements.reverse",
  "finance.purchase_expense.create", "finance.purchase_expense.cancel",
];

const employee = {
  id: "22222222-2222-4222-8222-222222222222", employeeNumber: "EMP-001", nameAr: "موظف الاختبار", nameEn: "Test Employee",
  jobTitle: "محاسب", phone: null, email: null, iqamaNumber: "1234567890", workSchedule: null, hireDate: "2024-01-01",
  currentMonthlyGross: "3000.0000", profilePhotoVersionId: null, status: "TERMINATED", terminatedAt: "2026-08-01", notes: null,
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

async function mockHr(page: Page, requested: string[], options: { language?: "ar" | "en"; onboarding?: "success" | "failure"; truncatedPreview?: boolean; slowPayrollDetail?: boolean; payrollPreviewFailure?: boolean } = {}) {
  const language = options.language ?? "ar";
  await page.addInitScript(({ company, locale }) => {
    sessionStorage.setItem("baseer.erp.access-token", "e2e-token");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
  }, { company: companyId, locale: language });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requested.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test Company", permissionCodes: permissions }] });
    if (url.pathname === "/v1/hr/employees/onboard" && route.request().method() === "POST") {
      if (options.onboarding === "failure") return fulfill(route, { error: { code: "VALIDATION_FAILED", message: { ar: "تعذر حفظ موظف الاختبار.", en: "The test employee could not be saved." }, correlationId: "e2e", retry: { kind: "do-not-retry" } } }, 422);
      return fulfill(route, { id: employee.id, compensationId, replayed: false });
    }
    if (url.pathname === "/v1/hr/overview") return fulfill(route, {
      companyId, businessDate: "2026-08-20", workforce: { activeEmployees: 7, employeesOnLeave: 1 }, financial: { openAdvances: 2, openAdministrativeDeductions: 1 },
      payroll: { draftCount: 1, awaitingPaymentCount: 0, recentRuns: [payrollRun] }, services: { expiredCount: 0, expiringCount: 1, attentionItems: [] },
      leaves: { openCount: 1, actionItems: [] }, finalSettlements: { openCount: 0, actionItems: [] },
    });
    if (url.pathname === "/v1/hr/employees" && route.request().method() === "GET") return fulfill(route, { companyId, employees: [employee], hasMore: false, nextCursor: null, summary: { activeEmployees: 7, employeesOnLeave: 1, openAdvances: 2, openAdministrativeDeductions: 1 } });
    if (url.pathname === `/v1/hr/employees/${employee.id}/promotions`) return fulfill(route, { promotions: [], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/employees/${employee.id}/compensation-history`) return fulfill(route, { compensationHistory: [compensation], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/employees/${employee.id}/documents`) {
      if (route.request().method() === "POST") return fulfill(route, { id: document.id, versionId: "photo-version-1", replayed: false });
      return fulfill(route, { companyId, documents: [document], hasMore: false, nextCursor: null });
    }
    if (url.pathname === `/v1/hr/employees/${employee.id}/letters`) return fulfill(route, { companyId, letters: [letter], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/employees/${employee.id}/payroll`) return fulfill(route, { companyId, lines: [], hasMore: false, nextCursor: null });
    if (url.pathname === `/v1/hr/employees/${employee.id}`) return fulfill(route, {
      companyId, employee, compensation, compensationHistory: [], compensationHistoryCount: 14, services: [], serviceCount: 52, servicesHasMore: true,
      movements: [{ id: "movement-1", journalEntryId: "journal-1", movementType: "PAYROLL_ACCRUAL", businessDate: "2026-08-20", amount: "3000.0000", sourceReference: payrollRun.runNumber, description: null }], movementCount: 81, hasMoreMovements: false, nextMovementCursor: null,
    });
    if (url.pathname === `/v1/hr/services/${service.id}`) return fulfill(route, { service });
    if (url.pathname === `/v1/hr/services/${postedService.id}`) return fulfill(route, { service: postedService });
    if (url.pathname === "/v1/hr/services") {
      const more = url.searchParams.has("cursor");
      return fulfill(route, { companyId, services: more ? [{ ...service, id: "55555555-5555-4555-8555-555555555555", referenceNumber: "SRV-002" }] : [service, postedService], hasMore: !more, nextCursor: more ? null : service.id, summary: { count: 52, expired: 1, due30: 2, due90: 3 } });
    }
    if (url.pathname === `/v1/hr/leaves/${leave.id}`) return fulfill(route, { leave });
    if (url.pathname === "/v1/hr/leaves") return fulfill(route, { companyId, leaves: [leave], hasMore: false, nextCursor: null, summary: { count: 9, onLeaveNow: 1, upcoming: 2, returned: 6 } });
    if (url.pathname === `/v1/hr/advances/${advance.id}`) return fulfill(route, { advance, settlements: [], hasMoreSettlements: false, nextSettlementCursor: null, deferrals: [], hasMoreDeferrals: false, nextDeferralCursor: null });
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
    if (url.pathname === `/v1/hr/payroll-runs/${payrollRun.id}`) {
      if (options.slowPayrollDetail) await new Promise((resolve) => setTimeout(resolve, 350));
      return fulfill(route, { payrollRun: { ...payrollRun, notes: "ملاحظة المسودة" }, lines: [{ id: "line-1", employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, grossSalary: "3000.0000", compensationMethod: "FIXED_MONTHLY", eligibilityCode: "FULL_MONTH_V1", basicSalary: "3000.0000", foodAllowance: "0.0000", housingAllowance: "0.0000", transportAllowance: "0.0000", otherAllowance: "0.0000", overtimeAmount: "0.0000", overtimeHours: "0.0000", scheduledHoursPerDay: null, scheduledWorkDays: null, compensationPolicySnapshot: null, payrollCalculationSnapshot: null, advanceSettlementAmount: "100.0000", administrativeDeductionAmount: "0.0000", netPayableAmount: "2900.0000", paidAmount: "0.0000", advances: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", sourceId: advance.id, amount: "100.0000", referenceNumber: advance.advanceNumber }], administrativeDeductions: [] }], payments: [], hasMoreLines: false, nextLineCursor: null, hasMorePayments: false, nextPaymentCursor: null });
    }
    if (url.pathname === `/v1/hr/payroll-runs/${approvedPayrollRun.id}`) return fulfill(route, { payrollRun: approvedPayrollRun, lines: [], payments: [payrollPayment], hasMoreLines: false, nextLineCursor: null, hasMorePayments: false, nextPaymentCursor: null });
    if (url.pathname === "/v1/hr/payroll-runs/preview") {
      if (options.payrollPreviewFailure) return fulfill(route, { error: { code: "PAYROLL_PREVIEW_FAILED", message: { ar: "تعذر إعداد معاينة المسير.", en: "The payroll preview could not be prepared." }, correlationId: "e2e-payroll-preview", retry: { kind: "safe-retry" } } }, 503);
      const previewEmployee = { id: employee.id, employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn, status: "ACTIVE", included: true, reason: "ACTIVE_WITH_VALID_COMPENSATION", eligibilityCode: "FULL_MONTH_V1", calculationPeriodStart: "2026-08-01", calculationPeriodEnd: "2026-08-31", eligibleDays: 31, calendarDaysInMonth: 31, prorationRatio: "1.0000", monthlyGrossAmount: "3000.0000", estimatedGrossAmount: "3000.0000", advances: [{ id: advance.id, referenceNumber: advance.advanceNumber, remainingAmount: advance.remainingAmount }], advanceCount: options.truncatedPreview ? 101 : 1, hasMoreAdvances: Boolean(options.truncatedPreview), administrativeDeductions: [], administrativeDeductionCount: 0, hasMoreAdministrativeDeductions: false };
      return fulfill(route, { companyId, counts: { active: 1, onLeave: 0, included: 1, excluded: 0, exceptions: 0 }, totals: { employeeCount: 1, grossAmount: "3000.0000", advanceSettlementAmount: "100.0000", administrativeDeductionAmount: "0.0000", netPayableAmount: "2900.0000" }, exceptions: [], employees: [previewEmployee], hasMore: false, nextCursor: null });
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
    expect(box).not.toBeNull();
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

async function fillOnboarding(page: Page) {
  const dialog = page.getByRole("dialog", { name: "إضافة موظف" });
  await dialog.getByLabel("الاسم الكامل*").fill("موظف جديد");
  await dialog.getByLabel("تاريخ التعيين*").fill("2026-08-01");
  await dialog.getByLabel("إجمالي الراتب الشهري*").fill("3000");
  return dialog;
}

test("HR quick actions are permission-gated and open the requested operation", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=0");
  await expect(page.getByRole("heading", { name: "اليوم في الموارد البشرية" })).toBeVisible();
  await expect(page.getByRole("button", { name: "موظف جديد" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إنشاء مسير" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل إجازة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل خدمة" })).toBeVisible();
  await page.getByRole("button", { name: "موظف جديد" }).click();
  await expect(page.getByRole("dialog")).toContainText("إضافة موظف");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  await expectViewportContained(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("payroll uses server search and cursor paging without page-level overflow", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=3");
  await expect(page.getByRole("heading", { name: "مسير الرواتب" })).toBeVisible();
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
  await expect(editor.getByLabel("الشهر")).toBeDisabled();
  await expect(editor.locator('.hr-payroll-create__application-list input[type="checkbox"]')).toBeChecked();
  await expect(editor.locator(".hr-payroll-create__application-list .baseer-money-input")).toHaveValue("100");
  await expect(editor.locator(".hr-payroll-create__total")).toContainText("2,900");
  const previewRequestsBeforeEdit = requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview").length;
  await editor.locator(".hr-payroll-create__application-list .baseer-money-input").fill("125");
  await expect(editor.locator(".hr-payroll-create__total")).toContainText("2,875");
  await page.waitForTimeout(350);
  expect(requested.filter((request) => request === "POST /v1/hr/payroll-runs/preview")).toHaveLength(previewRequestsBeforeEdit);
  await editor.getByLabel("ملاحظات").fill("ملاحظة معدلة");
  const updateRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/hr/payroll-runs/update" && request.method() === "POST");
  await editor.getByRole("button", { name: "حفظ التعديلات" }).click();
  const updateRequest = await updateRequestPromise;
  expect(updateRequest.postDataJSON()).toMatchObject({ payrollRunId: payrollRun.id, notes: "ملاحظة معدلة", lines: [{ employeeId: employee.id, advances: [{ id: advance.id, amount: "125" }] }] });
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

test("employee profile shows exact counts, lazy compliance paging, and topmost modal semantics", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=1");
  await page.getByRole("listitem").filter({ hasText: "موظف الاختبار" }).click();
  const profile = page.getByRole("dialog", { name: "موظف الاختبار" });
  await expect(profile).toBeVisible();
  const tabsAreContained = await profile.getByRole("tablist").evaluate((tabs) => tabs.scrollWidth >= tabs.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(tabsAreContained).toBe(true);
  await expect(profile).toContainText("14");
  await expect(profile).toContainText("52");
  await expect(profile).toContainText("81");
  await profile.getByRole("tab", { name: "الخدمات والامتثال" }).click();
  await expect(profile.getByText("SRV-001")).toBeVisible();
  await profile.getByRole("button", { name: "تحميل المزيد" }).click();
  await expect(profile.getByText("SRV-002")).toBeVisible();
  await profile.getByRole("button", { name: "نهاية الخدمة" }).click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(2);
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
  await expect(page.locator('[role="dialog"][aria-hidden="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(profile).toBeVisible();
  await expectViewportContained(page);
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
    { section: 3, text: "مسير الرواتب" },
    { section: 4, text: "السلف والخصومات" },
    { section: 5, text: "خدمات الموظفين والامتثال" },
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
  await mockHr(page, requested);
  await page.goto("/#module=hr&section=1");
  await page.getByRole("listitem").filter({ hasText: employee.nameAr }).click();
  const profile = await expectTopmostDialog(page, employee.nameAr);

  await profile.locator('input[type="file"][accept="image/jpeg,image/png"]').setInputFiles({
    name: "profile.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await expect(profile.getByRole("button", { name: "عرض صورة الموظف" })).toBeEnabled();
  await profile.getByRole("button", { name: "عرض صورة الموظف" }).click();
  await expectTopmostDialog(page, "صورة الموظف");
  await page.keyboard.press("Escape");
  await expect(profile).toHaveAttribute("aria-modal", "true");

  const tabNames = ["نظرة 360", "المسار والتعويض", "الرواتب والتسويات", "الإجازات", "الخدمات والامتثال", "المستندات والخطابات", "السجل المالي"];
  for (const name of tabNames) {
    const tab = profile.getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }

  await profile.getByRole("tab", { name: "المسار والتعويض" }).click();
  await expect(profile.getByText("الراتب والبدلات", { exact: true })).toBeVisible();
  await profile.getByRole("button", { name: "إدارة الراتب" }).click();
  const salaryDialog = await expectTopmostDialog(page, "إدارة الراتب");
  await salaryDialog.getByRole("button", { name: /زيادة راتب/ }).click();
  await expect(salaryDialog.getByText("مبلغ الزيادة", { exact: true })).toBeVisible();
  await salaryDialog.getByRole("button", { name: /تخفيض راتب/ }).click();
  await expect(salaryDialog.getByText("مبلغ التخفيض", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profile).toHaveAttribute("aria-modal", "true");
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
  await approvedDetail.getByRole("button", { name: "عكس", exact: true }).click();
  await expectTopmostDialog(page, "عكس المخالصة");
  await page.keyboard.press("Escape");
  await approvedDetail.getByRole("button", { name: "عكس الدفعة" }).click();
  await expectTopmostDialog(page, "عكس دفعة المخالصة");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(profile).toHaveAttribute("aria-modal", "true");
  await profile.getByRole("button", { name: "تعديل البيانات" }).click();
  await expectTopmostDialog(page, "تعديل الموظف");
});

test("leave and payroll dialogs include nested return and destructive confirmation", async ({ page }) => {
  const requested: string[] = [];
  await mockHr(page, requested);

  await page.goto("/#module=hr&section=2");
  await page.getByRole("button", { name: "تسجيل إجازة" }).click();
  await expectTopmostDialog(page, "تسجيل إجازة");
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
  await approvedPayroll.getByRole("button", { name: "عكس", exact: true }).click();
  await expectTopmostDialog(page, "عكس مسير الرواتب");
  await page.keyboard.press("Escape");
  await approvedPayroll.getByRole("button", { name: "عكس الدفعة" }).click();
  await expectTopmostDialog(page, "عكس دفعة المسير");
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
  await page.getByRole("button", { name: advance.advanceNumber }).click();
  const advanceDetail = await expectTopmostDialog(page, advance.advanceNumber);
  await advanceDetail.getByRole("button", { name: "عكس إصدار السلفة" }).click();
  await expectTopmostDialog(page, "عكس إصدار السلفة");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "سداد السلفة" }).click();
  await expectTopmostDialog(page, "سداد السلفة");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "تأجيل الرصيد" }).click();
  await expectTopmostDialog(page, "تأجيل الرصيد");
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
  await postedDetail.getByRole("button", { name: "عكس التكلفة" }).click();
  await expectTopmostDialog(page, "عكس تكلفة الخدمة");
});

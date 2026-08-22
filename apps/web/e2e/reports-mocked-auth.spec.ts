import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const trialRunId = "33333333-3333-4333-8333-333333333333";
const cashRunId = "44444444-4444-4444-8444-444444444444";
const vatRunId = "55555555-5555-4555-8555-555555555555";
const documentId = "66666666-6666-4666-8666-666666666666";

type RequestLog = { method: string; pathname: string; search: string; company: string | null };

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

function money(value: string, display = value, sign: "positive" | "negative" | "zero" = "positive") {
  const [whole, fraction = ""] = value.split(".");
  return { raw: `${whole}.${fraction.padEnd(4, "0").slice(0, 4)}`, display, sign };
}

const zero = money("0.00", "0.00", "zero");
const debit = money("120.00", "120.00");
const credit = money("40.00", "40.00");

function catalogue() {
  return {
    companyId,
    reports: [
      { code: "ledger_trial_balance", titleAr: "ميزان المراجعة", titleEn: "Trial Balance", basis: "ledger", readiness: "READY" },
      { code: "personal_cash_performance", titleAr: "الربح والخسارة المالي", titleEn: "Financial profit and loss", basis: "cash", readiness: "READY" },
      { code: "internal_vat_report", titleAr: "التقرير الضريبي الداخلي", titleEn: "Internal VAT report", basis: "vat", readiness: "READY" },
    ],
  };
}

function trialReport(url: URL) {
  return {
    state: "READY",
    reportCode: "ledger_trial_balance",
    definitionVersion: "ledger_trial_balance_v1",
    reportRunId: trialRunId,
    ledgerRevision: "1",
    runChecksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    company: { displayName: "Test company", functionalCurrency: "SAR" },
    selectedPeriod: { from: url.searchParams.get("from"), to: url.searchParams.get("to") },
    economicAsOfDate: url.searchParams.get("to"),
    businessTimezone: "Asia/Riyadh",
    sourceKindAr: "قيود دفتر مختومة",
    basisLabelAr: "دفتر الأستاذ — القيود المختومة",
    cancellationTreatmentAr: "القيود الملغاة مستبعدة",
    dataCoverage: { state: "COMPLETE" },
    roundingRule: "HALF_UP_2DP",
    reconciliation: { state: "RECONCILED", messageAr: "الأرصدة متوازنة" },
    rows: [{
      accountId, code: "1100", nameAr: "الصندوق", nameEn: "Cash", type: "ASSET", isSystem: true,
      amounts: { openingDebit: zero, openingCredit: zero, periodDebit: debit, periodCredit: credit, closingDebit: money("80.00", "80.00"), closingCredit: zero },
    }],
    totals: { openingDebit: zero, openingCredit: zero, periodDebit: debit, periodCredit: credit, closingDebit: money("80.00", "80.00"), closingCredit: zero },
  };
}

function cashReport(url: URL) {
  return {
    state: "READY", reportCode: "personal_cash_performance", definitionVersion: "v1", reportRunId: cashRunId, ledgerRevision: "1", runChecksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    company: { displayName: "Test company", functionalCurrency: "SAR" }, businessTimezone: "Asia/Riyadh",
    selectedPeriod: { from: url.searchParams.get("from"), to: url.searchParams.get("to") }, basisLabelAr: "حركة مالية فعلية", vatInclusive: url.searchParams.get("vatInclusive") === "true",
    cancellationTreatmentAr: "القيود الملغاة مستبعدة", dataCoverage: { state: "COMPLETE", sourceKind: "sealed_ledger_vault_lines" }, roundingRule: "HALF_UP_2DP",
    rows: [
      { code: "sales", labelAr: "المبيعات المحصلة", labelEn: "Sales collections", kind: "SECTION", parentCode: null, direction: "INFLOW", eventCount: 2, amount: money("200.00", "200.00"), shareOfCollectedSalesPercent: "100.0000" },
      { code: "expenses", labelAr: "مصروفات", labelEn: "Expenses", kind: "SECTION", parentCode: null, direction: "OUTFLOW", eventCount: 1, amount: money("50.00", "50.00", "negative"), shareOfCollectedSalesPercent: "25.0000" },
    ],
    totals: { inflows: money("200.00", "200.00"), outflows: money("50.00", "50.00", "negative"), netCashResult: money("150.00", "150.00"), netCashResultShareOfCollectedSalesPercent: "75.0000" },
  };
}

function vatReport(url: URL) {
  return {
    state: "READY", reportCode: "internal_vat_report", definitionVersion: "internal_vat_report_v1", reportRunId: vatRunId,
    ledgerRevision: "1", runChecksum: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    company: { displayName: "Test company", functionalCurrency: "SAR" },
    selectedPeriod: { from: url.searchParams.get("from"), to: url.searchParams.get("to") },
    basisLabelAr: "دفتر الأستاذ — حسابات الضريبة",
    rows: [
      { code: "output_vat", labelAr: "ضريبة المخرجات", labelEn: "Output VAT", amount: money("30.00", "30.00"), eventCount: 1 },
      { code: "input_vat", labelAr: "ضريبة المدخلات", labelEn: "Input VAT", amount: money("10.00", "10.00", "negative"), eventCount: 1 },
      { code: "vat_paid", labelAr: "ضريبة مسددة", labelEn: "VAT paid", amount: zero, eventCount: 0 },
      { code: "vat_refunded", labelAr: "ضريبة مستردة", labelEn: "VAT refunded", amount: zero, eventCount: 0 },
    ],
    netVat: money("20.00", "20.00"),
  };
}

async function mockReports(page: Page, language: "ar" | "en", requests: RequestLog[]) {
  await page.addInitScript(({ company, locale }) => {
    sessionStorage.setItem("baseer.erp.access-token", "reports-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "reports-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
  }, { company: companyId, locale: language });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push({ method: route.request().method(), pathname: url.pathname, search: url.search, company: route.request().headers()["x-baseer-company-id"] ?? null });
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes: ["reports.read", "platform.output.preview", "platform.output.export"] }] });
    if (url.pathname === "/v1/reports/catalogue") return fulfill(route, catalogue());
    if (url.pathname === "/v1/reports/ledger-trial-balance") return fulfill(route, trialReport(url));
    if (url.pathname === `/v1/reports/ledger-trial-balance/${trialRunId}/evidence`) {
      const second = Boolean(url.searchParams.get("cursor"));
      return fulfill(route, { reportRunId: trialRunId, accountId, scope: url.searchParams.get("scope"), nextCursor: second ? null : "trial-page-2", items: [{ lineId: second ? "line-2" : "line-1", businessDate: "2026-08-01", reference: second ? "JV-002" : "JV-001", labelAr: "قيد يومية", labelEn: "Journal entry", description: "Report test", cancellationLabelAr: null, debit, credit: zero }] });
    }
    if (url.pathname === `/v1/reports/ledger-trial-balance/${trialRunId}/evidence/line-1/source`) return fulfill(route, { journalEntry: { businessDate: "2026-08-01", sourceReference: "JV-001", labelAr: "قيد يومية", labelEn: "Journal entry", description: "Report test", cancellationLabelAr: null, lines: [{ id: "trial-source-line", lineNumber: 1, accountCode: "1100", accountNameAr: "الصندوق", accountNameEn: "Cash", debit, credit: zero }] } });
    if (url.pathname === "/v1/reports/personal-cash-performance") return fulfill(route, cashReport(url));
    if (url.pathname === `/v1/reports/personal-cash-performance/${cashRunId}/evidence`) {
      const second = Boolean(url.searchParams.get("cursor"));
      return fulfill(route, { reportRunId: cashRunId, rowCode: url.searchParams.get("rowCode"), nextCursor: second ? null : "cash-page-2", items: [{ eventId: second ? "cash-event-2" : "cash-event-1", businessDate: "2026-08-02", direction: "INFLOW", amount: money("100.00", "100.00"), source: { journalEntryId: "cash-journal-1", labelAr: "تحصيل مبيعات", labelEn: "Sales receipt", reference: second ? "RC-002" : "RC-001" } }] });
    }
    if (url.pathname === `/v1/reports/personal-cash-performance/${cashRunId}/evidence/cash-event-1/source`) return fulfill(route, { journalEntry: { id: "cash-journal-1", businessDate: "2026-08-02", sourceType: "SALE", sourceReference: "RC-001", description: "Sales receipt", status: "POSTED", postedAt: "2026-08-02T09:00:00.000Z", lines: [{ id: "cash-source-line", lineNumber: 1, accountCode: "1100", accountNameAr: "الصندوق", accountNameEn: "Cash", debitAmount: "100.00", creditAmount: "0.00" }] } });
    if (url.pathname === "/v1/reports/internal-vat") return fulfill(route, vatReport(url));
    if (url.pathname === `/v1/reports/internal-vat/${vatRunId}/evidence`) return fulfill(route, { reportRunId: vatRunId, rowCode: url.searchParams.get("rowCode"), nextCursor: null, items: [{ lineId: "vat-line-1", businessDate: "2026-08-03", amount: money("30.00", "30.00"), reference: "VAT-001", labelAr: "فاتورة مبيعات", labelEn: "Sales invoice" }] });
    if (url.pathname === `/v1/reports/internal-vat/${vatRunId}/evidence/vat-line-1/source`) return fulfill(route, { journalEntry: { sourceReference: "VAT-001", businessDate: "2026-08-03", description: "VAT source", lines: [{ id: "vat-source-line", lineNumber: 1, accountCode: "2100", accountNameAr: "ضريبة مخرجات", accountNameEn: "Output VAT", debitAmount: "0.00", creditAmount: "30.00" }] } });
    if (url.pathname === "/v1/reports/documents") return fulfill(route, { documents: [{ id: documentId, reportRunId: trialRunId, reportCode: "ledger_trial_balance", title: language === "ar" ? "ميزان مراجعة أغسطس" : "August Trial Balance", locale: language, createdAt: "2026-08-03T09:00:00.000Z" }] });
    return fulfill(route, {});
  });
}

function reportRequests(requests: readonly RequestLog[], pathname: string) {
  return requests.filter((request) => request.method === "GET" && request.pathname === pathname);
}

test("reports catalogue is accessible in Arabic RTL and English LTR", async ({ page }) => {
  const arRequests: RequestLog[] = [];
  await mockReports(page, "ar", arRequests);
  await page.goto("/#module=reports&section=0");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "مركز التقارير" })).toBeVisible();
  await expect(page.getByRole("button", { name: "فتح ميزان المراجعة" })).toBeEnabled();
  expect(reportRequests(arRequests, "/v1/reports/catalogue").length).toBeGreaterThan(0);
  expect(arRequests.filter((request) => request.pathname.startsWith("/v1/reports/")).every((request) => request.company === companyId)).toBeTruthy();
  expect((await new AxeBuilder({ page }).include(".reports-overview").analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Reports center" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open trial balance" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include(".reports-overview").analyze()).violations).toEqual([]);
});

test("trial snapshot supports period/toggle, evidence source, cursor paging and focus-safe report runs", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockReports(page, "en", requests);
  await page.goto("/#module=reports&section=1&stage=trial-balance");
  const snapshot = page.locator('table[data-baseer-report-table="snapshot"]');
  await expect(snapshot).toBeVisible();
  await expect(snapshot).toContainText("120.00");
  // The report-run change resets any old evidence in an effect; let that reset settle before opening new evidence.
  await page.waitForTimeout(120);
  const trigger = snapshot.locator("button").first();
  await trigger.click();
  const evidence = page.getByRole("dialog", { name: /evidence/ });
  await expect(evidence).toBeVisible();
  const bounds = await evidence.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return { top: rectangle.top, left: rectangle.left, right: rectangle.right, bottom: rectangle.bottom, viewportWidth: window.visualViewport?.width ?? document.documentElement.clientWidth, viewportHeight: window.visualViewport?.height ?? document.documentElement.clientHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  await evidence.getByRole("button", { name: "Open source journal" }).click();
  const reportDialog = page.getByRole("dialog");
  await expect(reportDialog.getByText("JV-001")).toBeVisible();
  await page.getByRole("button", { name: "Back to evidence" }).click();
  await reportDialog.getByRole("button", { name: "Load more" }).click();
  await expect(reportDialog.getByText("JV-002")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reportDialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const initialTrialRuns = reportRequests(requests, "/v1/reports/ledger-trial-balance").length;
  expect(initialTrialRuns).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "Show zero-balance accounts" }).check();
  await expect.poll(() => reportRequests(requests, "/v1/reports/ledger-trial-balance").length).toBeGreaterThan(initialTrialRuns);
  await expect(snapshot).toContainText("120.00");
  const afterToggleRuns = reportRequests(requests, "/v1/reports/ledger-trial-balance").length;
  await page.locator(".baseer-period-filter__trigger").click();
  const period = page.getByRole("dialog", { name: "Choose period" });
  await period.locator("select").selectOption("YEAR");
  await period.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => reportRequests(requests, "/v1/reports/ledger-trial-balance").length).toBeGreaterThan(afterToggleRuns);
  await expect(snapshot).toContainText("120.00");

  const runsBeforeFocus = reportRequests(requests, "/v1/reports/ledger-trial-balance").length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(150);
  expect(reportRequests(requests, "/v1/reports/ledger-trial-balance")).toHaveLength(runsBeforeFocus);
});

test("cash and VAT snapshots are read models, and saved report documents remain explicit", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockReports(page, "en", requests);
  await page.goto("/#module=reports&section=1&stage=cash-performance");
  const cashSnapshot = page.locator('table[data-baseer-report-table="snapshot"]');
  await expect(cashSnapshot).toBeVisible();
  await expect(cashSnapshot).toContainText("Sales collections");
  const cashRunsBeforeToggle = reportRequests(requests, "/v1/reports/personal-cash-performance").length;
  await page.getByRole("checkbox", { name: "VAT inclusive" }).uncheck();
  await expect.poll(() => reportRequests(requests, "/v1/reports/personal-cash-performance").length).toBeGreaterThan(cashRunsBeforeToggle);
  await page.getByRole("button", { name: "Sales collections" }).first().click();
  const cashEvidence = page.getByRole("dialog", { name: /Amount details — Sales collections/ });
  await cashEvidence.getByRole("button", { name: "Open source journal" }).click();
  await expect(page.getByRole("dialog").getByText("RC-001")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/#module=reports&section=2");
  await expect(page.getByRole("heading", { name: "Internal VAT report" })).toBeVisible();
  await expect(page.locator(".reports-prototype__table")).toContainText("Output VAT");
  await page.getByRole("button", { name: "Output VAT" }).first().click();
  await expect(page.getByRole("dialog", { name: /Amount details — Output VAT/ })).toContainText("VAT-001");
  expect(reportRequests(requests, "/v1/reports/internal-vat").length).toBeGreaterThan(0);

  await page.goto("/#module=reports&section=4");
  await expect(page.getByRole("heading", { name: "Report documents" })).toBeVisible();
  await expect(page.getByText("August Trial Balance")).toBeVisible();
  expect(reportRequests(requests, "/v1/reports/documents").length).toBeGreaterThan(0);
});

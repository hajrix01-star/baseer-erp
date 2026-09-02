import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const trialRunId = "33333333-3333-4333-8333-333333333333";
const cashRunId = "44444444-4444-4444-8444-444444444444";
const renewedCashRunId = "44444444-4444-4444-8444-444444444445";
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
  const trialEvidence = (account?: string) => ({
    openingDebit: { reportCode: "ledger_trial_balance", metric: { kind: account ? "TRIAL_ACCOUNT" : "TRIAL_TOTAL", ...(account ? { accountId: account } : {}), scope: "OPENING", side: "DEBIT" } },
    openingCredit: { reportCode: "ledger_trial_balance", metric: { kind: account ? "TRIAL_ACCOUNT" : "TRIAL_TOTAL", ...(account ? { accountId: account } : {}), scope: "OPENING", side: "CREDIT" } },
    periodDebit: { reportCode: "ledger_trial_balance", metric: { kind: account ? "TRIAL_ACCOUNT" : "TRIAL_TOTAL", ...(account ? { accountId: account } : {}), scope: "PERIOD", side: "DEBIT" } },
    periodCredit: { reportCode: "ledger_trial_balance", metric: { kind: account ? "TRIAL_ACCOUNT" : "TRIAL_TOTAL", ...(account ? { accountId: account } : {}), scope: "PERIOD", side: "CREDIT" } },
    closingDebit: { reportCode: "ledger_trial_balance", metric: { kind: account ? "TRIAL_ACCOUNT" : "TRIAL_TOTAL", ...(account ? { accountId: account } : {}), scope: "CLOSING", side: "DEBIT" } },
    closingCredit: { reportCode: "ledger_trial_balance", metric: { kind: account ? "TRIAL_ACCOUNT" : "TRIAL_TOTAL", ...(account ? { accountId: account } : {}), scope: "CLOSING", side: "CREDIT" } },
  });
  return {
    state: "READY",
    reportCode: "ledger_trial_balance",
    definitionVersion: "ledger_trial_balance_v1",
    dataMode: "LIVE",
    ledgerRevision: "1",
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
      amounts: { openingDebit: zero, openingCredit: zero, periodDebit: debit, periodCredit: credit, closingDebit: money("80.00", "80.00"), closingCredit: zero }, evidence: trialEvidence(accountId),
    }],
    totals: { openingDebit: zero, openingCredit: zero, periodDebit: debit, periodCredit: credit, closingDebit: money("80.00", "80.00"), closingCredit: zero }, totalsEvidence: trialEvidence(),
  };
}

function cashReport(url: URL) {
  const cashEvidence = (rowCode: string) => ({ reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode } });
  return {
    state: "READY", reportCode: "personal_cash_performance", definitionVersion: "v1", dataMode: "LIVE", ledgerRevision: "1",
    company: { displayName: "Test company", functionalCurrency: "SAR" }, businessTimezone: "Asia/Riyadh",
    selectedPeriod: { from: url.searchParams.get("from"), to: url.searchParams.get("to") }, basisLabelAr: "حركة مالية فعلية", vatInclusive: url.searchParams.get("vatInclusive") === "true",
    cancellationTreatmentAr: "القيود الملغاة مستبعدة", dataCoverage: { state: "COMPLETE", sourceKind: "sealed_ledger_vault_lines" }, roundingRule: "HALF_UP_2DP",
    rows: [
      { code: "sales", labelAr: "المبيعات المحصلة", labelEn: "Sales collections", kind: "SECTION", parentCode: null, direction: "INFLOW", eventCount: 2, amount: money("200.00", "200.00"), shareOfCollectedSalesPercent: "100.0000", evidence: cashEvidence("sales") },
      { code: "expenses", labelAr: "مصروفات", labelEn: "Expenses", kind: "SECTION", parentCode: null, direction: "OUTFLOW", eventCount: 1, amount: money("50.00", "50.00", "negative"), shareOfCollectedSalesPercent: "25.0000", evidence: cashEvidence("expenses") },
    ],
    totals: { inflows: money("200.00", "200.00"), outflows: money("50.00", "50.00", "negative"), netCashResult: money("150.00", "150.00"), netCashResultShareOfCollectedSalesPercent: "75.0000", inflowsEvidence: cashEvidence("sales"), outflowsEvidence: cashEvidence("expenses"), netCashResultEvidence: cashEvidence("net_cash_result") },
  };
}

function vatReport(url: URL) {
  return {
    state: "READY", reportCode: "internal_vat_report", definitionVersion: "internal_vat_report_v1", dataMode: "LIVE",
    ledgerRevision: "1",
    company: { displayName: "Test company", functionalCurrency: "SAR" },
    selectedPeriod: { from: url.searchParams.get("from"), to: url.searchParams.get("to") },
    basisLabelAr: "دفتر الأستاذ — حسابات الضريبة",
    rows: [
      { code: "output_vat", labelAr: "ضريبة المخرجات", labelEn: "Output VAT", amount: money("30.00", "30.00"), eventCount: 1, evidence: { reportCode: "internal_vat_report", metric: { kind: "VAT_ROW", rowCode: "output_vat" } } },
      { code: "input_vat", labelAr: "ضريبة المدخلات", labelEn: "Input VAT", amount: money("10.00", "10.00", "negative"), eventCount: 1, evidence: { reportCode: "internal_vat_report", metric: { kind: "VAT_ROW", rowCode: "input_vat" } } },
      { code: "vat_paid", labelAr: "ضريبة مسددة", labelEn: "VAT paid", amount: zero, eventCount: 0, evidence: { reportCode: "internal_vat_report", metric: { kind: "VAT_ROW", rowCode: "vat_paid" } } },
      { code: "vat_refunded", labelAr: "ضريبة مستردة", labelEn: "VAT refunded", amount: zero, eventCount: 0, evidence: { reportCode: "internal_vat_report", metric: { kind: "VAT_ROW", rowCode: "vat_refunded" } } },
    ],
    netVat: money("20.00", "20.00"), netVatEvidence: { reportCode: "internal_vat_report", metric: { kind: "VAT_NET" } },
  };
}

async function mockReports(page: Page, language: "ar" | "en", requests: RequestLog[], options: { expireFirstCashEvidence?: boolean; expireFirstCashDocumentSave?: boolean } = {}) {
  let cashEvidenceRuns = 0;
  let cashSaveRuns = 0;
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
    if (url.pathname === "/v1/reports/official-runs" && route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { reportCode?: string; purpose?: string };
      const isCash = body.reportCode === "personal_cash_performance";
      const isEvidence = body.purpose === "evidence";
      const isSave = body.purpose === "save";
      if (isCash && isEvidence) cashEvidenceRuns += 1;
      if (isCash && isSave) cashSaveRuns += 1;
      const reportRunId = body.reportCode === "ledger_trial_balance" ? trialRunId
        : body.reportCode === "internal_vat_report" ? vatRunId
        : (options.expireFirstCashEvidence && isEvidence && cashEvidenceRuns > 1) || (options.expireFirstCashDocumentSave && isSave && cashSaveRuns > 1) ? renewedCashRunId : cashRunId;
      return fulfill(route, { reportRunId, reportCode: body.reportCode, definitionVersion: "v1", ledgerRevision: "1", checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", expiresAt: "2099-01-02T00:00:00.000Z" });
    }
    if (url.pathname === "/v1/reports/ledger-trial-balance") return fulfill(route, trialReport(url));
    if (url.pathname === `/v1/reports/ledger-trial-balance/${trialRunId}/evidence`) {
      const second = Boolean(url.searchParams.get("cursor"));
      return fulfill(route, { reportRunId: trialRunId, accountId, scope: url.searchParams.get("scope"), nextCursor: second ? null : "trial-page-2", items: [{ lineId: second ? "line-2" : "line-1", businessDate: "2026-08-01", reference: second ? "JV-002" : "JV-001", labelAr: "قيد يومية", labelEn: "Journal entry", description: "Report test", cancellationLabelAr: null, debit, credit: zero }] });
    }
    if (url.pathname === `/v1/reports/ledger-trial-balance/${trialRunId}/evidence/line-1/source`) return fulfill(route, { journalEntry: { businessDate: "2026-08-01", sourceReference: "JV-001", labelAr: "قيد يومية", labelEn: "Journal entry", description: "Report test", cancellationLabelAr: null, lines: [{ id: "trial-source-line", lineNumber: 1, accountCode: "1100", accountNameAr: "الصندوق", accountNameEn: "Cash", debit, credit: zero }] } });
    if (url.pathname === "/v1/reports/personal-cash-performance") {
      return fulfill(route, cashReport(url));
    }
    if (url.pathname === "/v1/reports/financial-evidence/live") {
      const reportCode = url.searchParams.get("reportCode");
      if (reportCode === "ledger_trial_balance") { const second = Boolean(url.searchParams.get("cursor")); const scope = url.searchParams.get("scope"); const side = url.searchParams.get("side"); const amount = scope === "PERIOD" && side === "DEBIT" ? debit : scope === "PERIOD" && side === "CREDIT" ? credit : zero; return fulfill(route, { descriptor: { reportCode, metric: { kind: url.searchParams.get("metricKind"), accountId: url.searchParams.get("accountId"), scope, side } }, nextCursor: amount.sign === "zero" || second ? null : "trial-page-2", items: amount.sign === "zero" ? [] : [{ evidenceId: second ? "trial-evidence-2" : "trial-evidence-1", businessDate: "2026-08-01", amount, source: { journalEntryId: "trial-journal-1", labelAr: "قيد يومية", labelEn: "Journal entry", reference: second ? "JV-002" : "JV-001", description: "Report test", counterparty: null } }] }); }
      if (reportCode === "internal_vat_report") { const net = url.searchParams.get("metricKind") === "VAT_NET"; return fulfill(route, { descriptor: { reportCode, metric: { kind: url.searchParams.get("metricKind"), rowCode: url.searchParams.get("rowCode") } }, nextCursor: null, items: net ? [{ evidenceId: "vat-output-evidence", businessDate: "2026-08-03", amount: money("30.00", "30.00"), source: { journalEntryId: "vat-journal-1", labelAr: "فاتورة مبيعات", labelEn: "Sales invoice", reference: "VAT-001", description: "Output VAT", counterparty: null } }, { evidenceId: "vat-input-evidence", businessDate: "2026-08-04", amount: money("-10.00", "10.00", "negative"), source: { journalEntryId: "vat-journal-2", labelAr: "فاتورة مشتريات", labelEn: "Purchase invoice", reference: "VAT-002", description: "Input VAT", counterparty: null } }] : [{ evidenceId: "vat-evidence-1", businessDate: "2026-08-03", amount: money("30.00", "30.00"), source: { journalEntryId: "vat-journal-1", labelAr: "فاتورة مبيعات", labelEn: "Sales invoice", reference: "VAT-001", description: "VAT source", counterparty: null } }] }); }
      const second = Boolean(url.searchParams.get("cursor"));
      return fulfill(route, { descriptor: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: url.searchParams.get("rowCode") ?? "sales" } }, nextCursor: second ? null : "cash-page-2", items: [{ evidenceId: second ? "cash-evidence-2" : "cash-evidence-1", businessDate: "2026-08-02", amount: money("100.00", "100.00"), source: { journalEntryId: second ? "cash-journal-2" : "cash-journal-1", labelAr: "تحصيل مبيعات", labelEn: "Sales receipt", reference: second ? "RC-002" : "RC-001", description: "Sales receipt", counterparty: { labelAr: "عميل اختبار", labelEn: "Test customer" } } }] });
    }
    if (url.pathname === "/v1/reports/financial-evidence/live/source/cash-journal-1") return fulfill(route, { journalEntry: { id: "cash-journal-1", businessDate: "2026-08-02", labelAr: "تحصيل مبيعات", labelEn: "Sales receipt", sourceReference: "RC-001", description: "Sales receipt", counterparty: { labelAr: "عميل اختبار", labelEn: "Test customer" }, status: "POSTED", lines: [{ id: "cash-source-line", lineNumber: 1, accountCode: "1100", accountNameAr: "الصندوق", accountNameEn: "Cash", debit: money("100.00", "100.00"), credit: zero, description: null }] } });
    if (url.pathname === "/v1/reports/financial-evidence/live/source/trial-journal-1") return fulfill(route, { journalEntry: { id: "trial-journal-1", businessDate: "2026-08-01", labelAr: "قيد يومية", labelEn: "Journal entry", sourceReference: "JV-001", description: "Report test", counterparty: null, status: "POSTED", lines: [{ id: "trial-source-line", lineNumber: 1, accountCode: "1100", accountNameAr: "الصندوق", accountNameEn: "Cash", debit, credit: zero, description: null }] } });
    if (url.pathname === "/v1/reports/financial-evidence/live/source/vat-journal-1") return fulfill(route, { journalEntry: { id: "vat-journal-1", businessDate: "2026-08-03", labelAr: "فاتورة مبيعات", labelEn: "Sales invoice", sourceReference: "VAT-001", description: "VAT source", counterparty: null, status: "POSTED", lines: [{ id: "vat-source-line", lineNumber: 1, accountCode: "2100", accountNameAr: "ضريبة مخرجات", accountNameEn: "Output VAT", debit: zero, credit: money("30.00", "30.00"), description: null }] } });
    if (url.pathname === "/v1/reports/internal-vat") return fulfill(route, vatReport(url));
    if (url.pathname === `/v1/reports/internal-vat/${vatRunId}/evidence`) return fulfill(route, { reportRunId: vatRunId, rowCode: url.searchParams.get("rowCode"), nextCursor: null, items: [{ lineId: "vat-line-1", businessDate: "2026-08-03", amount: money("30.00", "30.00"), reference: "VAT-001", labelAr: "فاتورة مبيعات", labelEn: "Sales invoice" }] });
    if (url.pathname === `/v1/reports/internal-vat/${vatRunId}/evidence/vat-line-1/source`) return fulfill(route, { journalEntry: { sourceReference: "VAT-001", businessDate: "2026-08-03", description: "VAT source", lines: [{ id: "vat-source-line", lineNumber: 1, accountCode: "2100", accountNameAr: "ضريبة مخرجات", accountNameEn: "Output VAT", debitAmount: "0.00", creditAmount: "30.00" }] } });
    if (url.pathname === "/v1/reports/documents" && route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (options.expireFirstCashDocumentSave && body.reportRunId === cashRunId) return fulfill(route, { error: { code: "REPORT_RUN_EXPIRED", message: { ar: "انتهت صلاحية لقطة التقرير.", en: "The report run has expired." }, correlationId: "expired-report-run", retry: { kind: "do-not-retry" } } }, 404);
      return fulfill(route, { id: documentId, reused: false });
    }
    if (url.pathname === "/v1/reports/documents") return fulfill(route, { documents: [{ id: documentId, reportRunId: trialRunId, reportCode: "ledger_trial_balance", title: language === "ar" ? "ميزان مراجعة أغسطس" : "August Trial Balance", locale: language, createdAt: "2026-08-03T09:00:00.000Z" }] });
    return fulfill(route, {});
  });
}

function reportRequests(requests: readonly RequestLog[], pathname: string) {
  return requests.filter((request) => request.method === "GET" && request.pathname === pathname);
}

function officialRunRequests(requests: readonly RequestLog[]) {
  return requests.filter((request) => request.method === "POST" && request.pathname === "/v1/reports/official-runs");
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

  // The current app persists locale before boot rather than exposing a route
  // level language toggle. Apply the second locale at the same boot boundary.
  await page.addInitScript(() => localStorage.setItem("baseer.ui.locale.v1", "en"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Reports center" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open trial balance" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include(".reports-overview").analyze()).violations).toEqual([]);
});

test("financial report tabs retain a light selected state and a real panel contract", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockReports(page, "en", requests);
  await page.goto("/#module=reports&section=1&stage=trial-balance");
  const tabs = page.getByRole("tablist", { name: "Financial reports" });
  const trialBalance = tabs.getByRole("tab", { name: "Trial Balance" });
  const profitAndLoss = tabs.getByRole("tab", { name: "Profit and loss" });
  const cashMovement = tabs.getByRole("tab", { name: "Cash movement" });
  await expect(trialBalance).toHaveAttribute("aria-selected", "true");
  await expect(trialBalance).toHaveAttribute("aria-controls", "financial-report-panel-trial-balance");
  await expect(page.locator("#financial-report-panel-trial-balance")).toHaveAttribute("role", "tabpanel");
  const colors = await Promise.all([trialBalance, cashMovement].map((tab) => tab.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  })));
  expect(colors[0]?.color).not.toBe("rgb(255, 255, 255)");
  expect(colors[0]?.background).not.toBe(colors[1]?.background);

  await cashMovement.click();
  await expect(page).toHaveURL(/#module=reports&page=reports-financial&stage=cash-performance$/);
  await expect(cashMovement).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#financial-report-panel-cash-performance")).toHaveAttribute("role", "tabpanel");

  await cashMovement.press("ArrowLeft");
  await expect(profitAndLoss).toBeFocused();
  await profitAndLoss.press("ArrowLeft");
  await expect(trialBalance).toBeFocused();
  await expect(cashMovement).toHaveAttribute("aria-selected", "true");
  await trialBalance.press("Enter");
  await expect(page).toHaveURL(/#module=reports&page=reports-financial&stage=trial-balance$/);
  await expect(trialBalance).toHaveAttribute("aria-selected", "true");
});

test("Arabic report tabs follow their visual RTL arrow direction", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockReports(page, "ar", requests);
  await page.goto("/#module=reports&page=reports-financial&stage=trial-balance");
  const tabs = page.getByRole("tablist", { name: "التقارير المالية" });
  const trialBalance = tabs.getByRole("tab", { name: "ميزان المراجعة" });
  const profitAndLoss = tabs.getByRole("tab", { name: "الربح والخسارة" });
  await trialBalance.focus();
  await trialBalance.press("ArrowLeft");
  await expect(profitAndLoss).toBeFocused();
  await expect(trialBalance).toHaveAttribute("aria-selected", "true");
  await profitAndLoss.press("Enter");
  await expect(page).toHaveURL(/#module=reports&page=reports-financial&stage=accrual-profit-loss$/);
  await expect(profitAndLoss).toHaveAttribute("aria-selected", "true");
});

test("live trial balance supports period/toggle while evidence uses one frozen run", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockReports(page, "en", requests);
  await page.goto("/#module=reports&section=1&stage=trial-balance");
  const desktopSnapshot = page.locator('table[data-baseer-report-table="snapshot"]');
  const mobileSnapshot = page.locator(".reports-trial-balance__mobile-list");
  const usesMobileLayout = await page.evaluate(() => window.matchMedia("(max-width: 720px)").matches);
  const snapshot = usesMobileLayout ? mobileSnapshot : desktopSnapshot;
  await expect(snapshot).toBeVisible();
  await expect(snapshot).toContainText("120.00");
  // The report-run change resets any old evidence in an effect; let that reset settle before opening new evidence.
  await page.waitForTimeout(120);
  const trigger = usesMobileLayout
    ? mobileSnapshot.locator(".reports-trial-balance__mobile-card").first().getByRole("button", { name: "120.00" })
    : desktopSnapshot.getByRole("row", { name: /1100 · Cash/ }).getByRole("button", { name: "120.00" });
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
  await evidence.getByRole("button", { name: /Journal entry/ }).click();
  await evidence.getByRole("button", { name: "Open journal" }).click();
  const reportDialog = page.getByRole("dialog");
  await expect(reportDialog.getByText("JV-001")).toBeVisible();
  const trialEvidenceRequests = reportRequests(requests, "/v1/reports/financial-evidence/live");
  expect(trialEvidenceRequests.some((request) => request.search.includes("reportCode=ledger_trial_balance") && request.search.includes(`accountId=${accountId}`) && request.search.includes("scope=PERIOD") && request.search.includes("side=DEBIT"))).toBeTruthy();
  expect(reportRequests(requests, "/v1/reports/financial-evidence/live/source/trial-journal-1").length).toBe(1);
  expect(reportRequests(requests, "/v1/reports/financial-evidence/live/source/trial-evidence-1").length).toBe(0);
  await page.getByRole("button", { name: "Back to operations" }).click();
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
  await period.getByRole("button", { name: "Open Period type options" }).click();
  await page.getByRole("option", { name: "Year" }).click();
  await period.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => reportRequests(requests, "/v1/reports/ledger-trial-balance").length).toBeGreaterThan(afterToggleRuns);
  await expect(snapshot).toContainText("120.00");

  const officialRunsBeforeFocus = officialRunRequests(requests).length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(150);
  expect(officialRunRequests(requests)).toHaveLength(officialRunsBeforeFocus);
});

test("cash and VAT reads are live, and report documents remain explicit", async ({ page }) => {
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
  const cashEvidence = page.getByRole("dialog", { name: /Sales collections/ });
  await cashEvidence.getByRole("button", { name: /Sales receipt/ }).click();
  await cashEvidence.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("dialog").getByText("RC-001")).toBeVisible();
  expect(reportRequests(requests, "/v1/reports/financial-evidence/live/source/cash-journal-1").length).toBe(1);
  expect(reportRequests(requests, "/v1/reports/financial-evidence/live/source/cash-evidence-1").length).toBe(0);
  await page.keyboard.press("Escape");

  await page.goto("/#module=reports&section=2");
  await expect(page.getByRole("heading", { name: "Internal VAT report" })).toBeVisible();
  await expect(page.locator(".reports-prototype__table")).toContainText("Output VAT");
  await page.getByRole("button", { name: "Output VAT" }).first().click();
  await expect(page.getByRole("dialog", { name: /Output VAT/ })).toContainText("VAT-001");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Net VAT for period" }).click();
  const vatNetDialog = page.getByRole("dialog", { name: /Net VAT for period/ });
  await expect(vatNetDialog).toContainText("VAT-001");
  await expect(vatNetDialog).toContainText("VAT-002");
  expect(reportRequests(requests, "/v1/reports/financial-evidence/live").some((request) => request.search.includes("reportCode=internal_vat_report") && request.search.includes("metricKind=VAT_NET"))).toBeTruthy();
  expect(reportRequests(requests, "/v1/reports/internal-vat").length).toBeGreaterThan(0);

  await page.goto("/#module=reports&section=4");
  await expect(page.getByRole("heading", { name: "Report documents", level: 1 })).toBeVisible();
  await expect(page.getByText("August Trial Balance")).toBeVisible();
  expect(reportRequests(requests, "/v1/reports/documents").length).toBeGreaterThan(0);
});

test("cash evidence opens directly without creating an output snapshot", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockReports(page, "en", requests);
  await page.goto("/#module=reports&section=1&stage=cash-performance");
  await expect(page.getByRole("button", { name: "Sales collections" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sales collections" }).first().click();
  const dialog = page.getByRole("dialog", { name: /Sales collections/ });
  await dialog.getByRole("button", { name: /Sales receipt/ }).click();
  await expect(dialog.getByText("RC-001")).toBeVisible();
  expect(officialRunRequests(requests).length).toBe(0);
  expect(reportRequests(requests, "/v1/reports/financial-evidence/live").length).toBeGreaterThan(0);
});

test("an expired snapshot is regenerated before saving a report document", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockReports(page, "en", requests, { expireFirstCashDocumentSave: true });
  await page.goto("/#module=reports&section=1&stage=cash-performance");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeVisible();
  await share.click();
  await page.getByRole("menuitem", { name: "Save to report documents" }).click();
  await expect(page.getByText("The report snapshot was saved to report documents.")).toBeVisible();
  await expect.poll(() => officialRunRequests(requests).length).toBeGreaterThanOrEqual(2);
  expect(requests.filter((request) => request.method === "POST" && request.pathname === "/v1/reports/documents").length).toBeGreaterThan(0);
});

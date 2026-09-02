import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";

function money(raw: string, display: string, sign: "positive" | "negative" | "zero" = "positive") {
  return { raw, display, sign };
}

const financialRead = {
  state: "READY",
  selectedPeriod: { from: "2026-08-01", to: "2026-08-31" },
  rows: [
    { code: "sales", labelAr: "المبيعات", labelEn: "Sales", kind: "SECTION", parentCode: null, direction: "INFLOW", eventCount: 2, amount: money("200.0000", "200.00"), shareOfCollectedSalesPercent: "100.0000", evidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "sales" } } },
    { code: "expenses", labelAr: "المصروفات", labelEn: "Expenses", kind: "SECTION", parentCode: null, direction: "OUTFLOW", eventCount: 1, amount: money("50.0000", "50.00", "negative"), shareOfCollectedSalesPercent: "25.0000", evidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "expenses" } } },
    { code: "purchase-supplies", labelAr: "مستلزمات مشتريات", labelEn: "Purchase supplies", kind: "LINE", parentCode: "purchases", direction: "OUTFLOW", eventCount: 1, amount: money("30.0000", "30.00", "negative"), shareOfCollectedSalesPercent: "15.0000", evidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "purchase-supplies" } } },
    { code: "expense-rent", labelAr: "إيجار", labelEn: "Rent", kind: "LINE", parentCode: "expenses", direction: "OUTFLOW", eventCount: 1, amount: money("20.0000", "20.00", "negative"), shareOfCollectedSalesPercent: "10.0000", evidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "expense-rent" } } },
  ],
  vaults: [],
  totals: { inflows: money("200.0000", "200.00"), outflows: money("50.0000", "50.00", "negative"), netCashResult: money("150.0000", "150.00"), netCashResultShareOfCollectedSalesPercent: "75.0000", inflowsEvidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "sales" } }, outflowsEvidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "expenses" } }, netCashResultEvidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "net_cash_result" } } },
  operatingCosts: { basisLabelAr: "الحركات المالية المثبتة خلال الفترة", total: money("50.0000", "50.00", "negative"), shareOfCollectedSalesPercent: "25.0000", evidence: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "expenses" } }, groups: [] },
};

const marketingRead = {
  financialRead: { contractVersion: "financial-read.v1", subject: "MIXED_ANALYTICS", defaultTaxView: "VAT_INCLUDED", allowedTaxViews: ["VAT_INCLUDED"], authority: "mock", quality: "READY", currencyScope: { mode: "SINGLE_CURRENCY", currencyCode: "SAR" }, presentationPolicy: "SERVER_FORMATTED" },
  period: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31" },
  sales: { dataQuality: "READY", payload: { netAmount: "200.0000", grossAmount: "230.0000" } },
  campaigns: [], days: [], weekdayAverages: [], salesTargets: [], context: [], linkedActualGrossAmount: "0.0000",
  linkedActualGrossAmountDisplay: "0.00",
  timeline: { daily: { rows: [], campaignLanes: [] }, monthly: { rows: [], campaignLanes: [] } },
  spendResult: { plannedCampaignCost: "0.0000", plannedCampaignCostDisplay: "0.00", linkedActualSpend: "0.0000", linkedActualSpendDisplay: "0.00", linkedPostedSpendOnly: true, spendDataQuality: "READY", excludedLinkedDocumentCount: 0, officialGrossSales: "230.0000", officialGrossSalesDisplay: "230.00", officialGrossSalesCalendarDisplay: "230.00", spendToSalesPercent: "0.0000", campaignCount: 0, salesDataQuality: "READY", googleAdsStatus: "NOT_CONNECTED", conclusionAr: "", conclusionEn: "" },
};

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function mockCommandCenter(page: Page, options: { marketingFails?: boolean; marketingIncomplete?: boolean; marketingAllowed?: boolean } = {}, requests: string[] = []) {
  let delayNextFinancialRead = false;
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "mock-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "mock-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "en");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes: ["reports.read", ...(options.marketingAllowed === false ? [] : ["marketing.insights.read"])] }] });
    if (url.pathname === "/v1/reports/personal-cash-performance") {
      // Keep a background refresh pending long enough to prove that the
      // completed table remains readable while the next receipt is loading.
      if (delayNextFinancialRead) {
        delayNextFinancialRead = false;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      return fulfill(route, financialRead);
    }
    if (url.pathname === "/v1/reports/financial-evidence/live") return fulfill(route, { descriptor: { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: url.searchParams.get("rowCode") ?? "expenses" } }, nextCursor: null, items: [{ evidenceId: "expense-evidence-1", businessDate: "2026-08-03", amount: money("50.0000", "50.00", "negative"), source: { journalEntryId: "expense-journal-1", labelAr: "إيجار", labelEn: "Rent", reference: "EXP-001", description: "Mock rent expense", counterparty: { labelAr: "مورد الاختبار", labelEn: "Test supplier" } } }] });
    if (url.pathname === "/v1/reports/financial-evidence/live/source/expense-journal-1") return fulfill(route, { journalEntry: { id: "expense-journal-1", businessDate: "2026-08-03", labelAr: "إيجار", labelEn: "Rent", sourceReference: "EXP-001", description: "Mock rent expense", counterparty: { labelAr: "مورد الاختبار", labelEn: "Test supplier" }, status: "POSTED", lines: [] } });
    if (url.pathname === "/v1/finance/daily-sales/analytics") return fulfill(route, { primary: { weeks: [] }, comparison: { weeks: [] } });
    if (url.pathname === "/v1/marketing/calendar") {
      if (options.marketingFails) return fulfill(route, { error: { code: "DEPENDENCY_UNAVAILABLE", message: { ar: "خدمة التسويق غير متاحة.", en: "Marketing service is unavailable." }, correlationId: "command-center-marketing", retry: { kind: "retry" } } }, 503);
      if (options.marketingIncomplete) return fulfill(route, { ...marketingRead, timeline: undefined });
      return fulfill(route, marketingRead);
    }
    return fulfill(route, {});
  });
  return { delayNextFinancialRead: () => { delayNextFinancialRead = true; } };
}

test("command center opens live reads directly without a summary gate", async ({ page }) => {
  await mockCommandCenter(page);
  await page.goto("/#module=command&section=0");

  await expect(page.getByRole("heading", { name: "Financial movement by item", exact: true })).toBeVisible();
  const timeline = page.locator('section[aria-label="Marketing timeline"]');
  const operatingCosts = page.getByRole("region", { name: "Total operating costs" });
  await expect(timeline).toBeVisible();
  await expect(operatingCosts).toBeVisible();
  await expect(timeline.locator(".baseer-marketing-timeline__header .command-center__metric")).toHaveCount(5);
  const timelineHeader = timeline.locator(".baseer-marketing-timeline__header");
  await expect(timelineHeader.getByText("Campaigns in period", { exact: true })).toBeVisible();
  await expect(timelineHeader.getByText("Official sales", { exact: true })).toBeVisible();
  const layoutOrder = await page.locator("main").evaluate((main) => {
    const timelineIndex = [...main.querySelectorAll("section")].indexOf(main.querySelector('section[aria-label="Marketing timeline"]')!);
    const operatingCostsIndex = [...main.querySelectorAll("section")].indexOf(main.querySelector('section[aria-labelledby="command-center-operating-costs-title"]')!);
    return { timelineIndex, operatingCostsIndex };
  });
  expect(layoutOrder.timelineIndex).toBeGreaterThanOrEqual(0);
  expect(layoutOrder.operatingCostsIndex).toBeGreaterThan(layoutOrder.timelineIndex);
  await expect(page.getByText("Net movement", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open full command center" })).toHaveCount(0);
  await expect(page.getByText("The summary could not be loaded. Open the full command center to retry.")).toHaveCount(0);
});

test("a marketing read failure does not hide the live financial cards", async ({ page }) => {
  await mockCommandCenter(page, { marketingFails: true });
  await page.goto("/#module=command&section=0");

  await expect(page.getByText("Net movement", { exact: true })).toBeVisible();
  await expect(page.getByText("The service is temporarily unavailable. Try again.")).toBeVisible();
  await expect(page.getByText("The summary could not be loaded. Open the full command center to retry.")).toHaveCount(0);
});

test("a partial marketing payload stays isolated from the financial command center", async ({ page }) => {
  await mockCommandCenter(page, { marketingIncomplete: true });
  await page.goto("/#module=command&section=0");

  await expect(page.getByText("Net movement", { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-label="Marketing timeline"]')).toContainText("Marketing timeline data is incomplete.");
});

test("a background cash refresh never replaces the completed report with a loading state", async ({ page }) => {
  const controls = await mockCommandCenter(page, { marketingAllowed: false });
  await page.goto("/#module=command&section=0");

  const reportTable = page.locator(".reports-prototype__table");
  await expect(reportTable).toBeVisible();
  await expect(reportTable.getByRole("columnheader", { name: "Of sales" })).toBeVisible();
  await expect(reportTable.getByText("100%", { exact: true })).toBeVisible();
  controls.delayNextFinancialRead();
  const backgroundRefresh = page.waitForRequest((request) => new URL(request.url()).pathname === "/v1/reports/personal-cash-performance");
  await backgroundRefresh;
  await expect(reportTable).toBeVisible();
  await expect(page.getByText("Loading report…", { exact: true })).toHaveCount(0);
});

test("command-center opens a financial amount directly and resolves its journal id independently from the evidence id", async ({ page }) => {
  const requests: string[] = [];
  await mockCommandCenter(page, {}, requests);
  await page.goto("/#module=command&section=0");

  await page.getByRole("button", { name: "Operation details — Expenses" }).click();
  const dialog = page.getByRole("dialog", { name: "Operation details — Expenses" });
  await expect(dialog).toContainText("EXP-001");
  await dialog.getByRole("button", { name: "Rent" }).click();
  await dialog.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("dialog", { name: "Source journal" }).getByText("EXP-001", { exact: true })).toBeVisible();
  expect(requests).toContain("/v1/reports/financial-evidence/live");
  expect(requests).toContain("/v1/reports/financial-evidence/live/source/expense-journal-1");
  expect(requests).not.toContain("/v1/reports/financial-evidence/live/source/expense-evidence-1");
  expect(requests).not.toContain("/v1/reports/official-runs");
});

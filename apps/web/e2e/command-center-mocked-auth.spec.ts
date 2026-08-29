import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";

function money(raw: string, display: string, sign: "positive" | "negative" | "zero" = "positive") {
  return { raw, display, sign };
}

const financialRead = {
  state: "READY",
  selectedPeriod: { from: "2026-08-01", to: "2026-08-31" },
  rows: [
    { code: "sales", labelAr: "المبيعات", labelEn: "Sales", kind: "SECTION", parentCode: null, direction: "INFLOW", eventCount: 2, amount: money("200.0000", "200.00"), shareOfCollectedSalesPercent: "100.0000" },
    { code: "expenses", labelAr: "المصروفات", labelEn: "Expenses", kind: "SECTION", parentCode: null, direction: "OUTFLOW", eventCount: 1, amount: money("50.0000", "50.00", "negative"), shareOfCollectedSalesPercent: "25.0000" },
    { code: "purchase-supplies", labelAr: "مستلزمات مشتريات", labelEn: "Purchase supplies", kind: "LINE", parentCode: "purchases", direction: "OUTFLOW", eventCount: 1, amount: money("30.0000", "30.00", "negative"), shareOfCollectedSalesPercent: "15.0000" },
    { code: "expense-rent", labelAr: "إيجار", labelEn: "Rent", kind: "LINE", parentCode: "expenses", direction: "OUTFLOW", eventCount: 1, amount: money("20.0000", "20.00", "negative"), shareOfCollectedSalesPercent: "10.0000" },
  ],
  vaults: [],
  totals: { inflows: money("200.0000", "200.00"), outflows: money("50.0000", "50.00", "negative"), netCashResult: money("150.0000", "150.00"), netCashResultShareOfCollectedSalesPercent: "75.0000" },
};

const marketingRead = {
  period: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31", timezone: "Asia/Riyadh" },
  sales: { dataQuality: "READY", payload: { netAmount: "200.0000" } },
  campaigns: [], days: [], weekdayAverages: [], salesTargets: [], context: [], linkedActualGrossAmount: "0.0000",
  spendResult: { plannedCampaignCost: "0.0000", linkedActualSpend: "0.0000", officialNetSales: "200.0000", spendToSalesPercent: "0.0000", campaignCount: 0, salesDataQuality: "READY", conclusionAr: "", conclusionEn: "" },
};

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function mockCommandCenter(page: Page, options: { marketingFails?: boolean } = {}, requests: string[] = []) {
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
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes: ["reports.read", "marketing.insights.read"] }] });
    if (url.pathname === "/v1/reports/personal-cash-performance") return fulfill(route, financialRead);
    if (url.pathname === "/v1/reports/personal-cash-performance/live/evidence") return fulfill(route, { rowCode: url.searchParams.get("rowCode"), nextCursor: null, items: [{ eventId: "expense-event-1", businessDate: "2026-08-03", direction: "OUTFLOW", amount: money("50.0000", "50.00", "negative"), source: { journalEntryId: "expense-journal-1", labelAr: "إيجار", labelEn: "Rent", reference: "EXP-001", origin: { labelAr: "المصروفات", labelEn: "Expenses", route: "#module=operations&page=operations-purchases" } } }] });
    if (url.pathname === "/v1/marketing/calendar") {
      if (options.marketingFails) return fulfill(route, { error: { code: "DEPENDENCY_UNAVAILABLE", message: { ar: "خدمة التسويق غير متاحة.", en: "Marketing service is unavailable." }, correlationId: "command-center-marketing", retry: { kind: "retry" } } }, 503);
      return fulfill(route, marketingRead);
    }
    return fulfill(route, {});
  });
}

test("command center opens live reads directly without a summary gate", async ({ page }) => {
  await mockCommandCenter(page);
  await page.goto("/#module=command&section=0");

  await expect(page.getByRole("heading", { name: "Financial movement by item", exact: true })).toBeVisible();
  const timeline = page.locator('section[aria-label="Marketing timeline"]');
  const categoryBreakdown = page.locator('section[aria-label="Purchase and expense breakdown by category"]');
  await expect(timeline).toBeVisible();
  await expect(categoryBreakdown).toBeVisible();
  await expect(timeline.locator(".baseer-marketing-timeline__header .command-center__metric")).toHaveCount(5);
  const timelineHeader = timeline.locator(".baseer-marketing-timeline__header");
  await expect(timelineHeader.getByText("Campaigns in period", { exact: true })).toBeVisible();
  await expect(timelineHeader.getByText("Official sales", { exact: true })).toBeVisible();
  const layoutOrder = await page.locator("main").evaluate((main) => {
    const timelineIndex = [...main.querySelectorAll("section")].indexOf(main.querySelector('section[aria-label="Marketing timeline"]')!);
    const categoryIndex = [...main.querySelectorAll("section")].indexOf(main.querySelector('section[aria-label="Purchase and expense breakdown by category"]')!);
    return { timelineIndex, categoryIndex };
  });
  expect(layoutOrder.timelineIndex).toBeGreaterThanOrEqual(0);
  expect(layoutOrder.categoryIndex).toBeGreaterThan(layoutOrder.timelineIndex);
  await expect(page.getByText("Net movement", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open full command center" })).toHaveCount(0);
  await expect(page.getByText("The summary could not be loaded. Open the full command center to retry.")).toHaveCount(0);
});

test("a marketing read failure does not hide the live financial cards", async ({ page }) => {
  await mockCommandCenter(page, { marketingFails: true });
  await page.goto("/#module=command&section=0");

  await expect(page.getByText("Net movement", { exact: true })).toBeVisible();
  await expect(page.getByText("Marketing service is unavailable.")).toBeVisible();
  await expect(page.getByText("The summary could not be loaded. Open the full command center to retry.")).toHaveCount(0);
});

test("command-center operation details read live without creating a report snapshot", async ({ page }) => {
  const requests: string[] = [];
  await mockCommandCenter(page, {}, requests);
  await page.goto("/#module=command&section=0");

  await page.getByRole("button", { name: "Operation details — Expenses" }).click();
  await expect(page.getByRole("dialog", { name: "Operation details — Expenses" })).toContainText("EXP-001");
  expect(requests).toContain("/v1/reports/personal-cash-performance/live/evidence");
  expect(requests).not.toContain("/v1/reports/official-runs");
});

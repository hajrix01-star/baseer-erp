import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "b7cc9176-36aa-4da3-9e6f-2d1c1d1c87d9";
const permissionCodes = ["finance.daily_sales.history.read_all"];
const analyticsMonth = {
  fromBusinessDate: "2026-08-01",
  toBusinessDate: "2026-08-31",
  amountBasis: "GROSS_VAT_INCLUSIVE",
  vatInclusive: true,
  dataQuality: "READY",
  coverage: { recordedSalesDays: 31, requiredOperatingDays: 31, scheduledClosedDays: 0, missingDays: 0, partialDays: 0 },
  display: {
    salesGrossAmount: "120,000 ر.س", applicationSalesGrossAmount: "42,000 ر.س", dailyAverageSalesAmount: "3,871 ر.س", recordedCustomerCount: "620", dailyAverageCustomerCount: "20", applicationSalesSharePercent: "35%",
    salesGrossPlotValue: 120000, applicationSalesGrossPlotValue: 42000, applicationSalesSharePlotValue: 35,
  },
};

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function prepareAnalyticsFailure(page: Page) {
  let analyticsRequests = 0;
  let serviceRecovered = false;
  await page.addInitScript(({ company, permissions }) => {
    sessionStorage.setItem("baseer.erp.access-token", "analytics-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "analytics-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer.e2e.permission-codes", JSON.stringify(permissions));
  }, { company: companyId, permissions: permissionCodes });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") {
      return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes }] });
    }
    if (url.pathname === "/v1/finance/daily-sales/analytics") {
      analyticsRequests += 1;
      expect(route.request().headers()["authorization"]).toBe("Bearer analytics-e2e-token");
      expect(route.request().headers()["x-baseer-company-id"]).toBe(companyId);
      // Keep the proxy unavailable through any development-mode effect replay;
      // the test enables recovery only after the visible retry action appears.
      if (!serviceRecovered) {
        await route.fulfill({ status: 502, contentType: "text/plain", body: "Bad gateway" });
        return;
      }
      return fulfill(route, {
        annualMonths: [{ ...analyticsMonth, month: "2026-08", changeFromPreviousMonth: { dailyAverageSalesPercent: "5%", dailyAverageSalesDirection: "POSITIVE" } }],
        primary: { month: "2026-08", weeks: [] },
        comparison: { month: "2026-07", weeks: [] },
      });
    }
    return fulfill(route, {});
  });
  return {
    analyticsRequests: () => analyticsRequests,
    recoverService: () => { serviceRecovered = true; },
  };
}

test("sales analytics turns a proxy failure into an actionable retry state", async ({ page }) => {
  const service = await prepareAnalyticsFailure(page);
  await page.goto("/#module=command&section=2");

  const error = page.getByRole("alert");
  await expect(error).toContainText("الخدمة غير متاحة مؤقتًا. أعد المحاولة.");
  await expect(error).toContainText("لم تتغير أي بيانات محاسبية.");
  await expect(error.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
  await expect.poll(service.analyticsRequests).toBeGreaterThanOrEqual(2);

  service.recoverService();
  await error.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect.poll(service.analyticsRequests).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const chart = page.locator(".application-sales-share-chart");
  await expect(chart.locator("canvas")).toBeVisible();
  expect(await chart.evaluate((node) => node.clientWidth)).toBeGreaterThan(200);
});

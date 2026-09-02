import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

async function openCommandCenter(page: Page) {
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "sidebar-preview-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "sidebar-preview-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
  }, companyId);

  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") return fulfill(route, {
      companies: [{
        id: companyId,
        nameAr: "شركة بصير التجريبية",
        nameEn: "Baseer preview company",
        permissionCodes: ["reports.read", "marketing.insights.read"],
      }],
    });
    if (path === "/v1/reports/personal-cash-performance") return fulfill(route, {
      state: "READY",
      selectedPeriod: { from: "2026-08-01", to: "2026-08-31" },
      rows: [], vaults: [],
      totals: {
        inflows: { raw: "0.0000", display: "0.00", sign: "zero" },
        outflows: { raw: "0.0000", display: "0.00", sign: "zero" },
        netCashResult: { raw: "0.0000", display: "0.00", sign: "zero" },
        netCashResultShareOfCollectedSalesPercent: "0.0000",
      },
    });
    if (path === "/v1/finance/daily-sales/analytics") return fulfill(route, {
      primary: {
        monthSummary: { dataQuality: "READY", coverage: { recordedSalesDays: 31, requiredOperatingDays: 31 }, display: { dailyAverageSalesAmount: "0.00", dailyAverageCustomerCount: "0" } },
        weeks: [],
      },
      comparison: {
        monthSummary: { dataQuality: "READY", coverage: { recordedSalesDays: 31, requiredOperatingDays: 31 }, display: { dailyAverageSalesAmount: "0.00", dailyAverageCustomerCount: "0" } },
        weeks: [],
      },
    });
    if (path === "/v1/marketing/calendar") return fulfill(route, {
      period: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31", timezone: "Asia/Riyadh" },
      sales: { dataQuality: "READY", payload: { netAmount: "0.0000" } },
      campaigns: [], days: [], weekdayAverages: [], salesTargets: [], context: [], linkedActualGrossAmount: "0.0000",
      spendResult: { plannedCampaignCost: "0.0000", linkedActualSpend: "0.0000", officialNetSales: "0.0000", spendToSalesPercent: "0.0000", campaignCount: 0, salesDataQuality: "READY", conclusionAr: "", conclusionEn: "" },
    });
    return fulfill(route, {});
  });

  await page.goto("/#module=command&section=0");
  await expect(page.locator(".module-page")).toBeVisible();
}

test("captures the modern admin Command Center navigation", async ({ page, isMobile }, testInfo) => {
    await openCommandCenter(page);
    await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");

    if (isMobile) {
      await page.getByRole("button", { name: "الأقسام" }).click();
      const drawer = page.getByRole("dialog", { name: "مركز القيادة", exact: true });
      await expect(drawer).toBeVisible();
      await drawer.screenshot({ path: testInfo.outputPath("command-center-sidebar-modern-admin-mobile.png") });
      return;
    }

    const sidebar = page.locator(".module-sidebar");
    await expect(sidebar).toBeVisible();
    // Capture the stable page canvas rather than a replaceable lazy sidebar
    // node. The rail remains visible in the image while route hydration may
    // still reconcile its contents.
    await page.screenshot({ path: testInfo.outputPath("command-center-sidebar-modern-admin-desktop.png") });
});

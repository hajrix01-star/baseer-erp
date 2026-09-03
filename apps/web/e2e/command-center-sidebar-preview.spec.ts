import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

function money(raw: string, display: string, sign: "positive" | "negative" | "zero" = "zero") {
  return { raw, display, sign };
}

const cashEvidence = { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "net_cash_result" } };

// This test renders the actual command-center route before capturing navigation.
// Keep its receipt structurally valid: a partial legacy fixture makes the page
// fail before the navigation under test is ever mounted.
const financialRead = {
  state: "READY",
  selectedPeriod: { from: "2026-08-01", to: "2026-08-31" },
  rows: [],
  vaults: [],
  totals: {
    inflows: money("0.0000", "0.00"),
    outflows: money("0.0000", "0.00"),
    netCashResult: money("0.0000", "0.00"),
    netCashResultShareOfCollectedSalesPercent: "0.0000",
    inflowsEvidence: cashEvidence,
    outflowsEvidence: cashEvidence,
    netCashResultEvidence: cashEvidence,
  },
  operatingCosts: { basisLabelAr: "الحركات المالية المثبتة خلال الفترة", total: money("0.0000", "0.00"), shareOfCollectedSalesPercent: "0.0000", evidence: cashEvidence, groups: [] },
  comparison: { state: "UNAVAILABLE", netCashResultPercentChange: null },
};

const marketingRead = {
  financialRead: { contractVersion: "financial-read.v1", subject: "MIXED_ANALYTICS", defaultTaxView: "VAT_INCLUDED", allowedTaxViews: ["VAT_INCLUDED"], authority: "mock", quality: "READY", currencyScope: { mode: "SINGLE_CURRENCY", currencyCode: "SAR" }, presentationPolicy: "SERVER_FORMATTED" },
  period: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31" },
  sales: { dataQuality: "READY", payload: { netAmount: "0.0000", grossAmount: "0.0000" } },
  campaigns: [], days: [], weekdayAverages: [], salesTargets: [], context: [], linkedActualGrossAmount: "0.0000", linkedActualGrossAmountDisplay: "0.00",
  timeline: { daily: { rows: [], campaignLanes: [] }, monthly: { rows: [], campaignLanes: [] } },
  spendResult: { plannedCampaignCost: "0.0000", plannedCampaignCostDisplay: "0.00", linkedActualSpend: "0.0000", linkedActualSpendDisplay: "0.00", linkedPostedSpendOnly: true, spendDataQuality: "READY", excludedLinkedDocumentCount: 0, officialGrossSales: "0.0000", officialGrossSalesDisplay: "0.00", officialGrossSalesCalendarDisplay: "0.00", spendToSalesPercent: "0.0000", campaignCount: 0, salesDataQuality: "READY", googleAdsStatus: "NOT_CONNECTED", conclusionAr: "", conclusionEn: "" },
};

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
    if (path === "/v1/reports/personal-cash-performance") return fulfill(route, financialRead);
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
    if (path === "/v1/marketing/calendar") return fulfill(route, marketingRead);
    return fulfill(route, {});
  });

  await page.goto("/#module=command&page=command-money-marketing");
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

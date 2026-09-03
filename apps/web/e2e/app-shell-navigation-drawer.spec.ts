import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";

function money(raw: string, display: string, sign: "positive" | "negative" | "zero" = "zero") {
  return { raw, display, sign };
}

const cashEvidence = { reportCode: "personal_cash_performance", metric: { kind: "CASH_ROW", rowCode: "net_cash_result" } };

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

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

async function openCommandWorkspace(page: Page) {
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "mock-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "mock-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") {
      return fulfill(route, {
        companies: [{
          id: companyId,
          nameAr: "شركة الاختبار",
          nameEn: "Test company",
          permissionCodes: ["reports.read", "marketing.insights.read"],
        }],
      });
    }
    if (path === "/v1/reports/personal-cash-performance") return fulfill(route, financialRead);
    if (path === "/v1/marketing/calendar") return fulfill(route, marketingRead);
    return fulfill(route, {});
  });
  await page.goto("/#module=command&section=0");
  await expect(page.locator(".module-page")).toBeVisible();
}

async function expectDrawerHasNoWcagAAIssues(page: Page) {
  const report = await new AxeBuilder({ page })
    .include(".mobile-drawer__panel")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(report.violations).toEqual([]);
}

test("desktop app shell keeps RTL and LTR navigation as a persistent, accessible sidebar", async ({ page, isMobile }) => {
  test.skip(isMobile, "The drawer interaction is covered by the Pixel 5 project.");
  await openCommandWorkspace(page);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".module-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "الأقسام" })).toBeHidden();
  await expect(page.locator(".module-sidebar")).toHaveScreenshot("app-shell-desktop-ar.png", { animations: "disabled", maxDiffPixelRatio: 0.001 });

});

test("Pixel 5 navigation drawer traps focus, restores it, and remains accessible in RTL and LTR", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The drawer is the mobile navigation contract.");
  await openCommandWorkspace(page);

  const openArabicDrawer = page.getByRole("button", { name: "الأقسام" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await openArabicDrawer.click();
  const arabicDrawer = page.getByRole("dialog", { name: "مركز القيادة", exact: true });
  const arabicClose = arabicDrawer.getByRole("button", { name: "إغلاق", exact: true });
  await expect(arabicDrawer).toHaveAttribute("aria-modal", "true");
  const brandContrast = await arabicDrawer.locator(".mobile-drawer__brand").evaluate((element) => {
    const wordmark = element.querySelector(".baseer-brand__image");
    const pseudo = getComputedStyle(element, "::before");
    return { imageDisplay: wordmark ? getComputedStyle(wordmark).display : null, maskImage: pseudo.maskImage || pseudo.webkitMaskImage, background: pseudo.backgroundColor };
  });
  expect(brandContrast.imageDisplay).toBe("none");
  expect(brandContrast.maskImage).toContain("baseer-wordmark.png");
  expect(brandContrast.background).not.toBe("rgba(0, 0, 0, 0)");
  await expect(arabicClose).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await expectDrawerHasNoWcagAAIssues(page);
  await expect(page).toHaveScreenshot("app-shell-drawer-mobile-ar.png", { animations: "disabled" });

  const arabicPanel = await arabicDrawer.boundingBox();
  const mobileViewport = page.viewportSize();
  expect(arabicPanel).not.toBeNull();
  expect(mobileViewport).not.toBeNull();
  expect(Math.round((arabicPanel?.x ?? 0) + (arabicPanel?.width ?? 0))).toBe(mobileViewport?.width);

  const arabicLastFocusable = arabicDrawer.getByRole("button").last();
  await page.keyboard.press("Shift+Tab");
  await expect(arabicLastFocusable).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(arabicClose).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(arabicDrawer).toHaveCount(0);
  await expect(openArabicDrawer).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");

  await openArabicDrawer.click();
  await page.locator(".mobile-drawer__backdrop").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("dialog", { name: "مركز القيادة", exact: true })).toHaveCount(0);
  await expect(openArabicDrawer).toBeFocused();

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const openEnglishDrawer = page.getByRole("button", { name: "Sections" });
  await openEnglishDrawer.focus();
  await page.keyboard.press("Enter");
  const englishDrawer = page.getByRole("dialog", { name: "Command center", exact: true });
  const englishClose = englishDrawer.getByRole("button", { name: "Close", exact: true });
  await expect(englishClose).toBeFocused();
  await expectDrawerHasNoWcagAAIssues(page);
  await expect(page).toHaveScreenshot("app-shell-drawer-mobile-en.png", { animations: "disabled" });

  const englishPanel = await englishDrawer.boundingBox();
  expect(englishPanel).not.toBeNull();
  expect(Math.round(englishPanel?.x ?? -1)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(englishDrawer).toHaveCount(0);
  await expect(openEnglishDrawer).toBeFocused();
});

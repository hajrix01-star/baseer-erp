import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "33333333-3333-4333-8333-333333333333";
const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const financeAccountsSource = readFileSync(resolve(testDirectory, "../src/finance-accounts-workspace.tsx"), "utf8");
const financeAccountsRuntimeSource = readFileSync(resolve(testDirectory, "../src/finance-accounts-workspace-runtime.tsx"), "utf8");
const reportsOverviewSource = readFileSync(resolve(testDirectory, "../src/reports-overview-workspace.tsx"), "utf8");
const reportDocumentsSource = readFileSync(resolve(testDirectory, "../src/report-documents-workspace.tsx"), "utf8");
const vatSimulationSource = readFileSync(resolve(testDirectory, "../src/vat-simulation-workspace.tsx"), "utf8");

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

async function openModernCommandCenter(page: Page) {
  await page.addInitScript(({ company }) => {
    sessionStorage.setItem("baseer.erp.access-token", "theme-navigation-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "theme-navigation-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.presentation.v1", "modern-3");
  }, { company: companyId });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") return fulfill(route, {
      companies: [{
        id: companyId,
        nameAr: "شركة اختبار التنقل",
        nameEn: "Navigation test company",
        permissionCodes: [
          "reports.read", "marketing.insights.read", "finance.purchase_expense.read",
          "finance.vaults.read", "finance.configuration.read", "finance.daily_sales.read", "operations.catalog.manage", "hr.employees.read",
          "administration.companies.read", "decision.metrics.read",
        ],
      }],
    });
    if (path === "/v1/reports/personal-cash-performance") return fulfill(route, {
      state: "READY", selectedPeriod: { from: "2026-08-01", to: "2026-08-31" }, rows: [], vaults: [],
      totals: {
        inflows: { raw: "0.0000", display: "0.00", sign: "zero" },
        outflows: { raw: "0.0000", display: "0.00", sign: "zero" },
        netCashResult: { raw: "0.0000", display: "0.00", sign: "zero" },
        netCashResultShareOfCollectedSalesPercent: "0.0000",
      },
    });
    if (path === "/v1/finance/daily-sales/analytics") return fulfill(route, {
      primary: { weeks: [], monthSummary: { dataQuality: "READY", coverage: { recordedSalesDays: 0, requiredOperatingDays: 0 }, display: { dailyAverageSalesAmount: "0.00", dailyAverageCustomerCount: "0" } } },
      comparison: { weeks: [], monthSummary: { dataQuality: "READY", coverage: { recordedSalesDays: 0, requiredOperatingDays: 0 }, display: { dailyAverageSalesAmount: "0.00", dailyAverageCustomerCount: "0" } } },
    });
    if (path === "/v1/marketing/calendar") return fulfill(route, {
      period: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31", timezone: "Asia/Riyadh" },
      sales: { dataQuality: "READY", payload: { netAmount: "0.0000" } }, campaigns: [], days: [], weekdayAverages: [], salesTargets: [], context: [], linkedActualGrossAmount: "0.0000",
      timeline: { daily: { rows: [], campaignLanes: [] }, monthly: { rows: [], campaignLanes: [] } },
      spendResult: { plannedCampaignCost: "0.0000", linkedActualSpend: "0.0000", officialNetSales: "0.0000", spendToSalesPercent: "0.0000", campaignCount: 0, salesDataQuality: "READY", conclusionAr: "", conclusionEn: "" },
    });
    return fulfill(route, {});
  });
  await page.goto("/#module=command&page=command-money-marketing");
  await expect(page.locator(".module-page")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
}

test("modern admin exposes the single tree navigation without bypassing permissions", async ({ page, isMobile }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openModernCommandCenter(page);

  if (isMobile) await page.getByRole("button", { name: "الأقسام" }).click();
  const navigationRoot = isMobile ? page.getByRole("dialog", { name: "مركز القيادة", exact: true }) : page.locator(".module-sidebar");
  await expect(navigationRoot.locator(".theme-navigation--tree")).toBeVisible();
  await expect(page.locator(".theme-navigation-control")).toHaveCount(0);
  const treeNodes = navigationRoot.locator(".theme-navigation__tree-node");
  await expect(treeNodes).toHaveCount(8);
  // The compact reference tree keeps only the active module expanded. This
  // must follow the current route rather than preserving an unrelated module
  // from a previous page, otherwise the page-stage tabs are unreachable.
  const openNodes = navigationRoot.locator(".theme-navigation__tree-node[open]");
  const currentNode = navigationRoot.locator(".theme-navigation__tree-node.is-current-module");
  await expect(openNodes).toHaveCount(1);
  await expect(currentNode).toHaveCount(1);
  await expect(currentNode).toHaveAttribute("open", "");
  // Modern rails intentionally omit the legacy shell heading. The active
  // module is identified by the first open tree row, as in the reference.
  await expect(currentNode.getByText("مركز القيادة", { exact: true })).toBeVisible();
  await expect(navigationRoot.getByText("المالية", { exact: true }).first()).toBeVisible();
  await expect(navigationRoot.getByRole("button", { name: "لوحة المال والتسويق", exact: true })).toBeVisible();
  await expect(navigationRoot.getByRole("button", { name: "السجل المالي الموحد", exact: true })).toHaveCount(0);
  await expect(navigationRoot.getByText("الموارد البشرية", { exact: true }).first()).toBeVisible();
  await expect(navigationRoot.getByText("لوحة المالك", { exact: true })).toHaveCount(0);
  if (!isMobile) await navigationRoot.screenshot({ path: testInfo.outputPath("theme-tree-hierarchy-desktop.png") });

  if (isMobile) {
    await page.getByRole("button", { name: "إغلاق", exact: true }).click();
    expect(pageErrors).toEqual([]);
    return;
  }
  expect(pageErrors).toEqual([]);
});

test("modern admin tree keeps child labels readable on their light surface", async ({ page, isMobile }) => {
  await openModernCommandCenter(page);
  if (isMobile) {
    await page.getByRole("button", { name: "الأقسام" }).click();
  }

  const root = isMobile ? page.getByRole("dialog", { name: "مركز القيادة", exact: true }) : page.locator(".module-sidebar");
  const currentTree = root.locator(".theme-navigation--tree .theme-navigation__tree-node.is-current-module");
  await expect(currentTree).toBeVisible();
  const foregroundLuminance = await currentTree.locator(".theme-navigation__section:not(.is-active), .theme-navigation__page-tabs button:not(.is-active)").evaluateAll((elements) => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const linear = channels.map((channel) => {
        const unit = channel / 255;
        return unit <= .04045 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
      });
      return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
    };
    return elements.map((element) => luminance(getComputedStyle(element).color));
  });
  expect(foregroundLuminance.length).toBeGreaterThan(0);
  // The branches sit on a pale surface.  A near-white foreground (luminance
  // 1) is the exact regression that made their Arabic labels disappear.
  expect(Math.max(...foregroundLuminance)).toBeLessThan(.4);
});

test("documented page stages render in the workspace without duplicating the current page permission boundary", async ({ page, isMobile }) => {
  await openModernCommandCenter(page);
  await page.goto("/#module=reports&page=reports-financial");
  await expect(page.locator(".module-page")).toBeVisible();

  if (isMobile) await page.getByRole("button", { name: "الأقسام" }).click();
  const navigationRoot = isMobile ? page.getByRole("dialog", { name: "التقارير", exact: true }) : page.locator(".module-sidebar");
  await expect(navigationRoot.locator(".theme-navigation__tree-node[open]")).toHaveCount(1);
  await expect(navigationRoot.locator(".theme-navigation__tree-node.is-current-module")).toHaveAttribute("open", "");
  await expect(navigationRoot.locator(".theme-navigation__page-tabs")).toHaveCount(0);
  const reportTabs = page.getByRole("tablist", { name: "التقارير المالية" });
  await expect(reportTabs).toBeVisible();
  await expect(reportTabs.getByRole("tab", { name: "ميزان المراجعة" })).toHaveAttribute("aria-selected", "true");
  await reportTabs.getByRole("tab", { name: "الربح والخسارة المالي" }).click();
  await expect(page).toHaveURL(/#module=reports&page=reports-financial&stage=cash-performance$/);
  await expect(reportTabs.getByRole("tab", { name: "الربح والخسارة المالي" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("لوحة المالك", { exact: true })).toHaveCount(0);
});

test("finance specialist surfaces inherit the modern admin semantic roles", async ({ page }) => {
  await openModernCommandCenter(page);
  await page.goto("/#module=finance&page=finance-accounts");
  await expect(page.locator(".module-page")).toBeVisible();

  const financeDebit = () => page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.className = "finance-accounts-workspace";
    fixture.innerHTML = '<span class="finance-account-amount finance-account-amount--debit">0</span>';
    document.body.append(fixture);
    const value = getComputedStyle(fixture.firstElementChild!).color;
    fixture.remove();
    return value;
  });
  await expect.poll(financeDebit).not.toBe("");
});

test("finance and report representative surfaces preserve their central-card role and explicit canvas exception", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openModernCommandCenter(page);

  // A source-level contract keeps the safe BaseerCard bindings meaningful even
  // when this route's intentionally minimal API fixture has no chart of
  // accounts receipt to render.  The browser assertion below then checks that
  // the selected modern presentation styles the resulting role.
  expect(financeAccountsSource).toContain('<BaseerCard variant="record"');
  expect(financeAccountsRuntimeSource).toContain('<BaseerCard variant="record">');
  expect(reportsOverviewSource).toContain('<BaseerCard variant="record"');
  expect(reportDocumentsSource).toContain('<BaseerCard variant="record"');
  expect(vatSimulationSource).toContain('<BaseerCard variant="form-or-receipt"');
  expect(vatSimulationSource).toContain('<BaseerCard variant="joined-ledger"');

  await page.goto("/#module=finance&page=finance-accounts");
  await expect(page.locator(".module-page")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
  const financeRecordRadius = await page.evaluate(() => {
    const fixture = document.createElement("article");
    fixture.className = "baseer-card baseer-card--default baseer-card--record";
    document.body.append(fixture);
    const value = getComputedStyle(fixture).borderRadius;
    fixture.remove();
    return value;
  });
  expect(financeRecordRadius).not.toBe("0px");

  await page.goto("/#module=reports&page=reports-financial&stage=cash-performance");
  const canvas = page.locator(".reports-prototype__canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".reports-prototype__canvas.baseer-card")).toHaveCount(0);
  await expect(page.locator(".reports-prototype .baseer-filter-bar")).toBeVisible();

  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe("0px");
  expect(pageErrors).toEqual([]);
});

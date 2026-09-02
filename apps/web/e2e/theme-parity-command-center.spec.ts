import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

/**
 * Acceptance coverage for the single modern administrative interface. This is
 * deliberately a read-only, mocked command-centre session: it proves the
 * presentation contract without mutating ERP data or depending on a backend.
 */
const companyId = "44444444-4444-4444-8444-444444444444";

type Presentation = "modern-3";

const money = (raw: string, display: string, sign: "positive" | "negative" | "zero" = "positive") => ({ raw, display, sign });

const financialRead = {
  state: "READY",
  selectedPeriod: { from: "2026-08-01", to: "2026-08-31" },
  rows: [
    { code: "sales", labelAr: "المبيعات", labelEn: "Sales", kind: "SECTION", parentCode: null, direction: "INFLOW", eventCount: 12, amount: money("12500.0000", "12,500.00"), shareOfCollectedSalesPercent: "100.0000", rankWithinParent: 1, shareOfDirectionPercent: "100.0000", shareOfParentPercent: null },
    { code: "purchases", labelAr: "المشتريات", labelEn: "Purchases", kind: "SECTION", parentCode: null, direction: "OUTFLOW", eventCount: 4, amount: money("3200.0000", "3,200.00", "negative"), shareOfCollectedSalesPercent: "25.6000", rankWithinParent: 1, shareOfDirectionPercent: "64.0000", shareOfTotalOutflowPercent: "64.0000", shareOfParentPercent: null },
    { code: "recurring_expenses", labelAr: "التكاليف الدورية", labelEn: "Recurring costs", kind: "SECTION", parentCode: null, direction: "OUTFLOW", eventCount: 2, amount: money("700.0000", "700.00", "negative"), shareOfCollectedSalesPercent: "5.6000", rankWithinParent: 2, shareOfDirectionPercent: "14.0000", shareOfTotalOutflowPercent: "14.0000", shareOfParentPercent: null },
    { code: "expenses", labelAr: "مصاريف أخرى", labelEn: "Other expenses", kind: "SECTION", parentCode: null, direction: "OUTFLOW", eventCount: 3, amount: money("1100.0000", "1,100.00", "negative"), shareOfCollectedSalesPercent: "8.8000", rankWithinParent: 3, shareOfDirectionPercent: "22.0000", shareOfTotalOutflowPercent: "22.0000", shareOfParentPercent: null },
    { code: "purchase-supplies", labelAr: "مستلزمات التشغيل", labelEn: "Operating supplies", kind: "LINE", parentCode: "purchases", direction: "OUTFLOW", eventCount: 4, amount: money("3200.0000", "3,200.00", "negative"), shareOfCollectedSalesPercent: "25.6000", rankWithinParent: 1, shareOfDirectionPercent: "64.0000", shareOfTotalOutflowPercent: "64.0000", shareOfParentPercent: "100.0000" },
    { code: "recurring-rent", labelAr: "إيجار دوري", labelEn: "Recurring rent", kind: "LINE", parentCode: "recurring_expenses", direction: "OUTFLOW", eventCount: 2, amount: money("700.0000", "700.00", "negative"), shareOfCollectedSalesPercent: "5.6000", rankWithinParent: 1, shareOfDirectionPercent: "14.0000", shareOfTotalOutflowPercent: "14.0000", shareOfParentPercent: "100.0000" },
    { code: "expense-other", labelAr: "مصروفات تشغيلية", labelEn: "Operating expenses", kind: "LINE", parentCode: "expenses", direction: "OUTFLOW", eventCount: 3, amount: money("1100.0000", "1,100.00", "negative"), shareOfCollectedSalesPercent: "8.8000", rankWithinParent: 1, shareOfDirectionPercent: "22.0000", shareOfTotalOutflowPercent: "22.0000", shareOfParentPercent: "100.0000" },
  ],
  operatingCosts: {
    basisLabelAr: "الحركات المالية المثبتة خلال الفترة",
    total: money("5000.0000", "5,000.00", "negative"),
    shareOfCollectedSalesPercent: "40.0000",
    groups: [
      {
        code: "purchases",
        labelAr: "المشتريات",
        labelEn: "Purchases",
        amount: money("3200.0000", "3,200.00", "negative"),
        eventCount: 4,
        shareOfCollectedSalesPercent: "25.6000",
        rows: [{ code: "purchase-supplies", evidenceRowCode: "purchase-supplies", labelAr: "مستلزمات التشغيل", labelEn: "Operating supplies", amount: money("3200.0000", "3,200.00", "negative"), eventCount: 4, shareOfParentPercent: "100.0000" }],
      },
      {
        code: "recurring_expenses",
        labelAr: "التكاليف الدورية",
        labelEn: "Recurring costs",
        amount: money("700.0000", "700.00", "negative"),
        eventCount: 2,
        shareOfCollectedSalesPercent: "5.6000",
        rows: [{ code: "recurring-rent", evidenceRowCode: "recurring-rent", labelAr: "إيجار دوري", labelEn: "Recurring rent", amount: money("700.0000", "700.00", "negative"), eventCount: 2, shareOfParentPercent: "100.0000" }],
      },
      {
        code: "expenses",
        labelAr: "مصاريف أخرى",
        labelEn: "Other expenses",
        amount: money("1100.0000", "1,100.00", "negative"),
        eventCount: 3,
        shareOfCollectedSalesPercent: "8.8000",
        rows: [{ code: "expense-other", evidenceRowCode: "expense-other", labelAr: "مصروفات تشغيلية", labelEn: "Operating expenses", amount: money("1100.0000", "1,100.00", "negative"), eventCount: 3, shareOfParentPercent: "100.0000" }],
      },
    ],
  },
  vaults: [{ vaultId: "main-vault", vaultNameAr: "الخزينة الرئيسية", vaultNameEn: "Main vault", inflows: money("12500.0000", "12,500.00"), outflows: money("5000.0000", "5,000.00", "negative"), balance: money("7500.0000", "7,500.00") }],
  totals: { inflows: money("12500.0000", "12,500.00"), outflows: money("5000.0000", "5,000.00", "negative"), netCashResult: money("7500.0000", "7,500.00"), netCashResultShareOfCollectedSalesPercent: "60.0000" },
  comparison: { state: "READY", netCashResultPercentChange: "12.5000" },
};

const dailySalesRead = {
  primary: { monthSummary: { dataQuality: "READY", coverage: { recordedSalesDays: 28, requiredOperatingDays: 28 }, display: { dailyAverageSalesAmount: "446.43", dailyAverageCustomerCount: "18" } }, weeks: [] },
  comparison: { monthSummary: { dataQuality: "READY", coverage: { recordedSalesDays: 28, requiredOperatingDays: 28 }, display: { dailyAverageSalesAmount: "410.00", dailyAverageCustomerCount: "16" } }, weeks: [] },
};

const timelineAmount = (value: number) => ({ amount: value.toFixed(4), chartValue: value, display: value.toLocaleString("en-US", { minimumFractionDigits: 2 }) });
const marketingTimelineRows = [
  ["2026-08-01", 780, 125, 210, 7], ["2026-08-04", 960, 240, 280, 9], ["2026-08-07", 1120, 330, 360, 11],
  ["2026-08-10", 1080, 290, 410, 10], ["2026-08-13", 1350, 420, 520, 13], ["2026-08-16", 1490, 510, 610, 15],
  ["2026-08-19", 1410, 460, 540, 14], ["2026-08-22", 1660, 590, 690, 17], ["2026-08-25", 1770, 640, 760, 18], ["2026-08-28", 1880, 700, 810, 19],
].map(([label, sales, campaignSpend, purchases, customerCount]) => ({
  label, fromBusinessDate: label, toBusinessDate: label,
  sales: timelineAmount(Number(sales)), campaignSpend: timelineAmount(Number(campaignSpend)), purchases: timelineAmount(Number(purchases)), customerCount: Number(customerCount),
  salesDayQuality: "READY", activeCampaignIds: ["campaign-1"],
  campaignSpendByCampaign: [{ campaignId: "campaign-1", ...timelineAmount(Number(campaignSpend)), documentCount: 1, barHeightPercent: Math.round(Number(campaignSpend) / 7) }],
}));
const marketingTimeline = {
  daily: {
    rows: marketingTimelineRows,
    campaignLanes: [{ campaignId: "campaign-1", activeIndexes: marketingTimelineRows.map((_row, index) => index), totalSpend: timelineAmount(4305), spendBars: marketingTimelineRows.map((row) => row.campaignSpendByCampaign[0]) }],
  },
  monthly: { rows: [], campaignLanes: [] },
};

const marketingRead = {
  period: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31", timezone: "Asia/Riyadh" },
  sales: { dataQuality: "READY", payload: { netAmount: "12500.0000", customerCount: 120 }, coverage: { availableDays: 28 } },
  campaigns: [{ id: "campaign-1", titleAr: "حملة العودة للمدارس", titleEn: "Back to school" }],
  days: [], weekdayAverages: [], salesTargets: [], context: [], linkedActualGrossAmount: "12500.0000",
  timeline: marketingTimeline,
  spendResult: { plannedCampaignCost: "1500.0000", linkedActualSpend: "1200.0000", officialGrossSales: "12500.0000", spendToSalesPercent: "9.6000", campaignCount: 1, salesDataQuality: "READY", conclusionAr: "قراءة تجريبية موثقة.", conclusionEn: "Deterministic preview read." },
};

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

async function openCommandCenter(page: Page, presentation: Presentation) {
  await page.addInitScript(({ company, selectedPresentation }) => {
    sessionStorage.setItem("baseer.erp.access-token", "theme-parity-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "theme-parity-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.presentation.v1", selectedPresentation);
    localStorage.setItem("baseer-erp.shell.theme-navigation-mode.v1", "tree");
    localStorage.setItem("baseer-erp.shell.appearance.v1", "light");
  }, { company: companyId, selectedPresentation: presentation });

  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") return fulfill(route, {
      companies: [{
        id: companyId, nameAr: "شركة قبول الثيم", nameEn: "Theme acceptance company",
        permissionCodes: ["reports.read", "marketing.insights.read", "finance.purchase_expense.read", "finance.vaults.read", "operations.catalog.manage", "hr.employees.read", "hr.advances.issue", "administration.companies.read", "decision.metrics.read"],
      }],
    });
    if (path === "/v1/reports/personal-cash-performance") return fulfill(route, financialRead);
    if (path === "/v1/finance/daily-sales/analytics") return fulfill(route, dailySalesRead);
    if (path === "/v1/marketing/calendar") return fulfill(route, marketingRead);
    if (path === "/v1/reports/personal-cash-performance/live/evidence") return fulfill(route, {
      rowCode: "expenses", nextCursor: null,
      items: [{ eventId: "expense-1", businessDate: "2026-08-06", amount: money("1800.0000", "1,800.00", "negative"), source: { journalEntryId: "journal-1", labelAr: "إيجار المقر", labelEn: "Office rent", reference: "EXP-001", origin: { labelAr: "المصروفات", labelEn: "Expenses", route: "#module=operations&page=operations-purchases" } } }],
    });
    if (path === "/v1/reports/personal-cash-performance/live/evidence/expense-1/source") return fulfill(route, {
      journalEntry: { businessDate: "2026-08-06", sourceType: "EXPENSE", sourceReference: "EXP-001", description: "إيجار المقر", status: "POSTED", lines: [{ id: "line-1", lineNumber: 1, accountCode: "6100", accountNameAr: "مصروف الإيجار", accountNameEn: "Rent expense", debitAmount: "1800.0000", creditAmount: "0.0000" }] },
    });
    return fulfill(route, {});
  });

  await page.goto("/#module=command&page=command-money-marketing");
  await expect(page.locator(".module-page")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", presentation);
  await expect(page.getByText("الحركة المالية حسب البند", { exact: true })).toBeVisible();
}

async function assertSharedCommandCenterSurfaces(page: Page, isMobile: boolean) {
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".header-profile-menu > summary")).toBeVisible();
  await expect(page.locator(".command-center__financial-grid")).toBeVisible();
  await expect(page.getByText("إجمالي الداخل", { exact: true })).toBeVisible();
  const operatingCosts = page.locator(".command-center__operating-costs");
  await expect(operatingCosts.getByText("إجمالي التكاليف التشغيلية", { exact: true })).toBeVisible();
  await expect(operatingCosts.getByText("المشتريات", { exact: true })).toBeVisible();
  await expect(operatingCosts.getByText("التكاليف الدورية", { exact: true })).toBeVisible();
  await expect(operatingCosts.getByText("مصاريف أخرى", { exact: true })).toBeVisible();
  await expect(operatingCosts.getByText("المسددة", { exact: true })).toHaveCount(0);
  await expect(page.locator(".command-center__metric").first()).toHaveClass(/baseer-card--metric/);
  await expect(page.locator(".command-center__financial-grid .command-center__breakdown").first()).toHaveClass(/baseer-card--record/);
  await expect(page.locator(".command-center__vault-ledger")).toHaveClass(/baseer-card--joined-ledger/);
  await expect(page.locator(".command-center__daily-sales-average")).toHaveClass(/baseer-card--record/);
  await expect(page.locator(".command-center__weekly-sales")).toHaveClass(/baseer-card--record/);

  // The series legend is deliberately a real control rather than a painted
  // label: it has to keep the visual comparison readable without losing the
  // underlying data series on either presentation.
  const timeline = page.locator(".baseer-marketing-timeline--command");
  await expect(timeline.locator(".baseer-marketing-timeline__toolbar")).toBeVisible();
  const salesSeries = timeline.getByRole("button", { name: "المبيعات الرسمية" });
  await expect(salesSeries).toHaveAttribute("aria-pressed", "true");
  await salesSeries.click();
  await expect(salesSeries).toHaveAttribute("aria-pressed", "false");
  await salesSeries.click();
  await expect(salesSeries).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "الفترة" }).click();
  const filterDialog = page.getByRole("dialog", { name: "اختيار الفترة" });
  await expect(filterDialog).toBeVisible();
  await expect(filterDialog.getByRole("button", { name: "تطبيق" })).toBeVisible();
  const periodType = filterDialog.getByRole("combobox", { name: "نوع الفترة" });
  await expect(periodType).toBeFocused();
  const focusedControlStyle = async (locator: Locator) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderColor, boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
  });
  const selectorFocus = await focusedControlStyle(periodType);
  expect(selectorFocus.borderColor).not.toBe("rgb(0, 0, 0)");
  expect(selectorFocus.boxShadow).not.toBe("none");
  await periodType.click();
  await page.getByRole("option", { name: "شهر", exact: true }).click();
  const year = filterDialog.getByRole("spinbutton", { name: "السنة" });
  await periodType.focus();
  await page.keyboard.press("Tab");
  await expect(year).toBeFocused();
  const yearFocus = await focusedControlStyle(year);
  expect(yearFocus.borderColor).not.toBe("rgb(0, 0, 0)");
  expect(yearFocus.boxShadow).not.toBe("none");
  await page.getByRole("button", { name: "إلغاء" }).click();
  await expect(filterDialog).toHaveCount(0);

  await page.getByRole("button", { name: "تفصيل العمليات — المصروفات" }).first().click();
  const details = page.getByRole("dialog", { name: "تفصيل العمليات — المصروفات" });
  await expect(details).toBeVisible();
  await expect(details.locator("table.command-center__evidence-table")).toBeVisible();
  await expect(details).toContainText("EXP-001");
  await details.getByLabel("إغلاق", { exact: true }).click();
  await expect(details).toHaveCount(0);
}

async function readNavigationGeometry(page: Page, root: string) {
  return page.evaluate((rootSelector) => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const px = (value: string) => Number.parseFloat(value) || 0;
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      return {
        width: rounded(box.width),
        height: rounded(box.height),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        minBlockSize: px(computed.minBlockSize),
        gap: px(computed.gap),
        paddingInline: [px(computed.paddingInlineStart), px(computed.paddingInlineEnd)],
      };
    };
    const navigation = document.querySelector<HTMLElement>(rootSelector);
    const activeItems = navigation?.querySelectorAll(".theme-navigation__section.is-active") ?? [];
    const currentModules = navigation?.querySelectorAll(".theme-navigation__tree-node.is-current-module") ?? [];
    const navigationBox = navigation?.getBoundingClientRect();
    const overflowCandidates = navigation && navigationBox ? [...navigation.querySelectorAll<HTMLElement>("*")]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { selector: element.className || element.tagName, start: rounded(navigationBox.right - box.right), end: rounded(box.left - navigationBox.left), width: rounded(box.width) };
      })
      .filter((item) => item.start < -1 || item.end < -1)
      .slice(0, 8) : [];
    return {
      viewport: { width: innerWidth, height: innerHeight },
      navigation: read(rootSelector),
      tree: read(`${rootSelector} .theme-navigation--tree`),
      treeRow: read(`${rootSelector} .theme-navigation--tree .theme-navigation__tree-node > summary`),
      branch: read(`${rootSelector} .theme-navigation--tree .theme-navigation__branches`),
      section: read(`${rootSelector} .theme-navigation--tree .theme-navigation__section`),
      activeItems: activeItems.length,
      currentModules: currentModules.length,
      overflowCandidates,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, root);
}

async function assertNavigationGeometry(page: Page, isMobile: boolean, presentation: Presentation) {
  const sidebar = page.locator(".module-sidebar");
  // The legacy six-dot module switcher was deliberately removed from the
  // desktop header. Desktop navigation lives in the persistent sidebar, and
  // mobile exposes the dedicated sections button below.
  await expect(page.locator(".theme-navigation-control")).toHaveCount(0);

  if (isMobile) {
    await expect(sidebar).toBeHidden();
    const sections = page.getByRole("button", { name: "الأقسام" });
    await expect(sections).toBeVisible();
    // The mobile navigation trigger belongs to the shell header, matching the
    // reference interaction.  It must never consume the page-heading space.
    await expect(page.locator(".topbar").getByRole("button", { name: "الأقسام" })).toBeVisible();
    await expect(page.locator(".topbar .header-home-button")).toBeVisible();
    const profileTrigger = page.locator(".topbar .header-profile-menu > summary");
    await expect(profileTrigger).toBeVisible();
    const headerControlBounds = await page.locator(".topbar :is(.header-home-button, .header-navigation-button, .header-profile-menu > summary)").evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, isWithinViewport: box.left >= 0 && box.right <= window.innerWidth };
    }));
    expect(headerControlBounds.every((box) => box.isWithinViewport)).toBe(true);
    await expect(page.locator(".page-heading").getByRole("button", { name: "الأقسام" })).toHaveCount(0);
    await page.locator(".topbar").screenshot({ path: `artifacts/header-${presentation}-mobile-navigation-trigger.png` });
    await profileTrigger.click();
    const profilePanel = page.locator(".header-profile-menu__panel");
    await expect(profilePanel).toBeVisible();
    await expect(profilePanel.locator(".header-profile-menu__interface select")).toHaveCount(0);
    await expect(profilePanel.getByRole("button", { name: "English", exact: true })).toBeVisible();
    await profileTrigger.click();
    await sections.click();
    const drawer = page.getByRole("dialog", { name: "مركز القيادة", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(".theme-navigation--tree")).toBeVisible();
    // Durable evidence for the visual review: the full-page mobile capture
    // intentionally shows the destination canvas, whereas these capture the
    // actual open navigation drawer and its relationship to the scrim.
    await drawer.screenshot({ path: `artifacts/sidebar-${presentation}-mobile-tree-after.png` });
    await page.screenshot({ path: `artifacts/sidebar-${presentation}-mobile-tree-after-full.png` });
    const geometry = await readNavigationGeometry(page, ".mobile-drawer__panel");
    console.log(`navigation geometry ${presentation}/mobile/tree: ${JSON.stringify(geometry)}`);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.navigation?.scrollWidth ?? Infinity).toBeLessThanOrEqual((geometry.navigation?.clientWidth ?? 0) + 2);
    // The drawer leaves part of the destination canvas visible rather than
    // becoming a full-page navigation takeover.
    expect(geometry.navigation?.width ?? 0).toBeGreaterThan((geometry.viewport.width ?? 0) * .8);
    expect(geometry.navigation?.width ?? Infinity).toBeLessThan((geometry.viewport.width ?? 0) * .9);
    expect(geometry.treeRow?.minBlockSize ?? 0).toBeGreaterThanOrEqual(38);
    expect(geometry.section?.minBlockSize ?? 0).toBeGreaterThanOrEqual(32);
    expect(geometry.activeItems).toBeGreaterThanOrEqual(1);
    expect(geometry.currentModules).toBe(1);
    await drawer.getByRole("button", { name: "إغلاق", exact: true }).click();
  } else {
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator(".theme-navigation--tree")).toBeVisible();
    await sidebar.screenshot({ path: `artifacts/sidebar-${presentation}-desktop-tree-after.png` });
    const box = await sidebar.boundingBox();
    expect(box?.width ?? 0).toBe(244);
    const geometry = await readNavigationGeometry(page, ".module-sidebar");
    console.log(`navigation geometry ${presentation}/desktop/tree: ${JSON.stringify(geometry)}`);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.navigation?.scrollWidth ?? Infinity).toBeLessThanOrEqual((geometry.navigation?.clientWidth ?? 0) + 2);
    // Reference navigation: 39px module headers, 36px page links, and a
    // deliberately compact 2px / 1px hierarchy rhythm.
    expect(geometry.treeRow?.minBlockSize ?? 0).toBeGreaterThanOrEqual(38);
    expect(geometry.section?.minBlockSize ?? 0).toBeGreaterThanOrEqual(32);
    expect(geometry.tree?.gap ?? 0).toBeGreaterThanOrEqual(1);
    expect(geometry.branch?.gap ?? 0).toBeGreaterThanOrEqual(.04);
    expect(geometry.activeItems).toBeGreaterThanOrEqual(1);
    expect(geometry.currentModules).toBe(1);
  }
}

async function readPresentationGeometry(page: Page) {
  return page.evaluate(() => {
    const px = (value: string) => Number.parseFloat(value) || 0;
    const style = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
        minBlockSize: computed.minBlockSize,
        maxInlineSize: computed.maxInlineSize,
        padding: [computed.paddingTop, computed.paddingRight, computed.paddingBottom, computed.paddingLeft].map(px),
        gap: computed.gap,
        borderRadius: computed.borderRadius,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      header: style(".topbar"),
      sidebar: style(".module-sidebar"),
      page: style(".module-page"),
      card: style(".command-center .baseer-card"),
      commandMetrics: style(".command-center__metrics"),
      commandMetric: style(".command-center__metric"),
      timelineMetrics: style(".command-center .baseer-marketing-timeline__metrics"),
      timelineMetricLast: style(".command-center .baseer-marketing-timeline__metrics > .command-center__metric:last-child"),
      timelinePlot: style(".command-center .baseer-marketing-timeline__plot"),
      timelineCanvas: style(".command-center .baseer-marketing-timeline__plot canvas"),
    };
  });
}

/**
 * A rendered chart can be technically present while wasting the available
 * reading canvas through an accidental fixed width or an oversized inset.
 * Measure the card, ECharts host and canvas separately: the first ratio
 * protects the responsive surface, while the second protects the plotted
 * information area inside it.
 */
async function readTimelineViewportUse(page: Page) {
  return page.evaluate(() => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      return {
        left: rounded(box.left), right: rounded(box.right), width: rounded(box.width), height: rounded(box.height),
        paddingInline: rounded((Number.parseFloat(computed.paddingInlineStart) || 0) + (Number.parseFloat(computed.paddingInlineEnd) || 0)),
      };
    };
    const timeline = read(".command-center .baseer-marketing-timeline--command");
    const financialGrid = read(".command-center .command-center__financial-grid");
    const plot = read(".command-center .baseer-marketing-timeline__plot");
    const canvas = read(".command-center .baseer-marketing-timeline__plot canvas");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      timeline,
      financialGrid,
      plot,
      canvas,
      timelineViewportRatio: timeline ? rounded(timeline.width / innerWidth) : 0,
      timelineGridRatio: timeline && financialGrid ? rounded(timeline.width / financialGrid.width) : 0,
      plotContentRatio: timeline && plot ? rounded(plot.width / Math.max(1, timeline.width - timeline.paddingInline)) : 0,
      canvasPlotRatio: canvas && plot ? rounded(canvas.width / plot.width) : 0,
    };
  });
}

test("the modern admin interface keeps an unobstructed timeline composition", async ({ page }) => {
  await openCommandCenter(page, "modern-3");
  const timeline = page.locator(".baseer-marketing-timeline--command");
  const toolbar = timeline.locator(".baseer-marketing-timeline__toolbar");
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveCSS("display", "flex");
  await expect(timeline.locator(".baseer-marketing-timeline__plot-period")).toHaveCount(0);
  await expect(page.locator(".advance-quick-add")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/command-center-modern-admin.png", fullPage: true });
});

for (const presentation of ["modern-3"] as const) {
  test(`${presentation} gives the principal chart a useful share of every viewport`, async ({ page, isMobile }) => {
    await openCommandCenter(page, presentation);
    const plot = page.locator(".command-center .baseer-marketing-timeline__plot");
    await expect(plot).toBeVisible();
    // ECharts mounts its canvas asynchronously after the server-read fixture.
    await expect(plot.locator("canvas").first()).toBeVisible();
    const geometry = await readTimelineViewportUse(page);
    console.log(`timeline viewport use ${presentation}/${isMobile ? "393px" : "desktop"}: ${JSON.stringify(geometry)}`);

    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.timeline).not.toBeNull();
    expect(geometry.plot).not.toBeNull();
    expect(geometry.canvas).not.toBeNull();
    expect(geometry.timeline?.left ?? -Infinity).toBeGreaterThanOrEqual(-1);
    expect(geometry.timeline?.right ?? Infinity).toBeLessThanOrEqual(geometry.viewport.width + 1);
    // On a 393px phone the chart becomes the full-width decision surface.
    // Desktop intentionally places the financial breakdown beside it; the
    // chart must still retain the dominant 1.48 / 2.20 grid track, rather
    // than being reduced to a narrow leftover column.
    if (isMobile) expect(geometry.timelineViewportRatio).toBeGreaterThanOrEqual(.92);
    else expect(geometry.timelineGridRatio).toBeGreaterThanOrEqual(.65);
    // Headers, legends and card padding must not collapse the actual plot.
    // Compare against the card's content box, not its border box: intentional
    // card padding is reading space, while unused content width is a defect.
    expect(geometry.plotContentRatio).toBeGreaterThanOrEqual(.94);
    expect(geometry.canvasPlotRatio).toBeGreaterThanOrEqual(.98);
  });

  test(`${presentation} exposes measured shell and container geometry`, async ({ page, isMobile }) => {
    await openCommandCenter(page, presentation);
    await expect(page.locator(".command-center .baseer-marketing-timeline__plot")).toBeVisible();
    await expect(page.locator(".command-center .baseer-marketing-timeline--command")).toHaveAttribute("data-chart-density", isMobile ? "compact" : "regular");
    const geometry = await readPresentationGeometry(page);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.header?.height).toBeGreaterThan(0);
    expect(geometry.page).not.toBeNull();
    expect(geometry.card).not.toBeNull();
    expect(geometry.commandMetrics).not.toBeNull();
    expect(geometry.commandMetric).not.toBeNull();
    console.log(`presentation geometry ${presentation}/${isMobile ? "mobile" : "desktop"}: ${JSON.stringify(geometry)}`);

    if (isMobile) {
      expect(geometry.sidebar?.width ?? 0).toBe(0);
      expect(geometry.page?.maxInlineSize).toBe("100%");
      expect(geometry.page?.padding?.[0] ?? 0).toBeGreaterThanOrEqual(14);
      expect(geometry.page?.padding?.[1] ?? 0).toBeGreaterThanOrEqual(10);
      // Primary card surfaces must use the broad phone canvas rather than a
      // centred desktop-width column. The 10px page gutter remains visible
      // for safe touch scrolling and card shadow breathing room.
      expect(geometry.card?.width ?? 0).toBeGreaterThanOrEqual((geometry.viewport.width ?? 0) - 24);
      expect(geometry.timelinePlot?.height ?? Infinity).toBeGreaterThanOrEqual(220);
      expect(geometry.timelinePlot?.height ?? 0).toBeLessThanOrEqual(224);
      expect(geometry.header?.height ?? 0).toBeGreaterThanOrEqual(56);
      // The marketing summary has five fixed operational measures.  Its fifth
      // card spans the second mobile row instead of leaving a half-width orphan.
      expect(geometry.timelineMetricLast?.width ?? 0).toBeGreaterThan((geometry.timelineMetrics?.width ?? Infinity) * .9);
    } else {
      expect(geometry.header?.height ?? 0).toBeGreaterThanOrEqual(56);
      expect(geometry.header?.padding?.[1] ?? 0).toBeGreaterThanOrEqual(12);
      expect(geometry.sidebar?.width).toBe(244);
      expect(geometry.page?.maxInlineSize).toBe("100%");
      expect(geometry.page?.padding?.[0] ?? 0).toBeGreaterThanOrEqual(16);
      expect(geometry.page?.padding?.[2] ?? 0).toBeGreaterThanOrEqual(32);
      expect(geometry.timelinePlot?.height ?? 0).toBeGreaterThanOrEqual(320);
    }
  });

  test(`${presentation} keeps command-centre geometry, filters, evidence table and tree navigation on every viewport`, async ({ page, isMobile }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await openCommandCenter(page, presentation);
    await assertSharedCommandCenterSurfaces(page, isMobile);
    await page.screenshot({ path: `artifacts/command-center-${presentation}-${isMobile ? "mobile" : "desktop"}-tree.png`, fullPage: true });
    await assertNavigationGeometry(page, isMobile, presentation);
    await page.screenshot({ path: `artifacts/command-center-${presentation}-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });

    // The compact mobile header intentionally omits the appearance menu; its
    // geometry is exercised above. Dark state is accepted through the real
    // desktop appearance control for each presentation.
    if (!isMobile) {
      await page.locator(".theme-button summary").click();
      await page.getByRole("button", { name: "ليلي", exact: true }).click();
      await expect(page.locator("body")).toHaveAttribute("data-color-scheme", "dark");
      await expect(page.locator("body")).toHaveAttribute("data-ui-theme", presentation);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--canvas").trim())).not.toBe("");
      await page.screenshot({ path: `artifacts/command-center-${presentation}-desktop-dark.png`, fullPage: true });
    }
    await page.goto("/#module=command&page=command-calendar");
    await expect(page.locator(".command-center__calendar")).toBeVisible();
    await expect(page.locator(".command-center__calendar")).toHaveClass(/baseer-card--chart/);
    expect(pageErrors).toEqual([]);
  });
}

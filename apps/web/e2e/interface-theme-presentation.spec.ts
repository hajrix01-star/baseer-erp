import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

async function openThemePreview(page: Page) {
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "theme-preview-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "theme-preview-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.theme.v1", "blue");
    localStorage.setItem("baseer-erp.shell.app-background.v2", "product-gray");
    localStorage.setItem("baseer-erp.shell.container-surface.v1", "beige");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") return fulfill(route, {
      companies: [{
        id: companyId,
        nameAr: "شركة اختبار الثيم",
        nameEn: "Theme preview company",
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
    if (path === "/v1/marketing/calendar") return fulfill(route, {
      period: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31", timezone: "Asia/Riyadh" },
      sales: { dataQuality: "READY", payload: { netAmount: "0.0000" } },
      campaigns: [], days: [], weekdayAverages: [], salesTargets: [], context: [], linkedActualGrossAmount: "0.0000",
      spendResult: { plannedCampaignCost: "0.0000", linkedActualSpend: "0.0000", officialNetSales: "0.0000", spendToSalesPercent: "0.0000", campaignCount: 0, salesDataQuality: "READY", conclusionAr: "", conclusionEn: "" },
    });
    return fulfill(route, {});
  });
  await page.goto("/");
  await expect(page.locator(".launcher-page")).toBeVisible();
}

async function enableDarkMode(page: Page, isMobile: boolean) {
  const legacyThemeSummary = page.locator(".theme-button summary");
  const canUseLegacyPicker = !isMobile && await legacyThemeSummary.isVisible();
  if (canUseLegacyPicker) {
    await legacyThemeSummary.click();
    await page.getByRole("button", { name: "ليلي", exact: true }).click();
    return;
  }
  if (isMobile) await expect(legacyThemeSummary).not.toBeVisible();
  await page.evaluate(() => { document.body.dataset.colorScheme = "dark"; });
}

test("Theme 1 and Theme 2 replace the complete shared presentation palette", async ({ page, isMobile }, testInfo) => {
  await openThemePreview(page);
  const picker = page.locator(".interface-theme-control select");
  await expect(picker).toBeVisible();

  await picker.selectOption("modern-1");
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-1");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--brand").trim())).toBe("#0b8060");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe("Tahoma, Arial, sans-serif");
  if (!isMobile) await expect.poll(() => page.locator(".launcher-topbar").evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(70);
  else await expect.poll(() => page.locator(".launcher-topbar").evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(62);
  await page.screenshot({ path: testInfo.outputPath(`theme-1-${isMobile ? "mobile" : "desktop"}.png`), fullPage: true });

  await picker.selectOption("modern-2");
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-2");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--brand").trim())).toBe("#a74d2c");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe("Tahoma, Arial, sans-serif");
  if (!isMobile) await expect.poll(() => page.locator(".launcher-topbar").evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(56);
  else await expect.poll(() => page.locator(".launcher-topbar").evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(62);
  await page.screenshot({ path: testInfo.outputPath(`theme-2-${isMobile ? "mobile" : "desktop"}.png`), fullPage: true });
});

test("modern presentations isolate their palette from stored Baseer legacy controls", async ({ page, isMobile }) => {
  await openThemePreview(page);
  const picker = page.locator(".interface-theme-control select");
  await picker.selectOption("modern-1");
  await expect.poll(() => page.evaluate(() => ({
    brand: getComputedStyle(document.body).getPropertyValue("--brand").trim(),
    surface: getComputedStyle(document.body).getPropertyValue("--surface-raised").trim(),
    legacyClass: document.body.classList.contains("is-blue"),
    background: document.body.dataset.launcherBackground ?? null,
    container: document.body.dataset.containerSurface ?? null,
  }))).toEqual({ brand: "#0b8060", surface: "#fff", legacyClass: false, background: null, container: null });

  const legacyThemeSummary = page.locator(".theme-button summary");
  if (isMobile) await expect(legacyThemeSummary).not.toBeVisible();
  else await legacyThemeSummary.click();
  await expect(page.getByRole("button", { name: "blue", exact: true })).toHaveCount(0);
  await expect(isMobile ? picker : page.getByText("المظهر", { exact: true })).toBeVisible();

  await picker.selectOption("modern-2");
  await expect.poll(() => page.evaluate(() => ({
    brand: getComputedStyle(document.body).getPropertyValue("--brand").trim(),
    surface: getComputedStyle(document.body).getPropertyValue("--surface-raised").trim(),
    legacyClass: document.body.classList.contains("is-blue"),
    background: document.body.dataset.launcherBackground ?? null,
    container: document.body.dataset.containerSurface ?? null,
  }))).toEqual({ brand: "#a74d2c", surface: "#fffdf9", legacyClass: false, background: null, container: null });
});

test("chart palettes follow computed presentation tokens in RTL and dark mode", async ({ page, isMobile }) => {
  await openThemePreview(page);
  await page.goto("/#module=reports&page=reports-financial");
  await expect(page.locator(".module-page")).toBeVisible();

  const picker = page.locator(".interface-theme-control select");
  await picker.selectOption("modern-1");
  await expect.poll(() => page.evaluate(() => {
    const table = document.createElement("table");
    table.className = "baseer-chart__inline-table";
    table.dir = "rtl";
    table.innerHTML = '<tbody><tr><td><span class="baseer-chart__inline-bar"><span class="baseer-chart__inline-bar-fill" style="--baseer-bar-scale:.5;--baseer-bar-delay:0ms"></span></span></td></tr></tbody>';
    document.body.append(table);
    const fill = table.querySelector<HTMLElement>(".baseer-chart__inline-bar-fill")!;
    const result = {
      primary: getComputedStyle(document.body).getPropertyValue("--chart-primary").trim(),
      secondary: getComputedStyle(document.body).getPropertyValue("--chart-secondary").trim(),
      grid: getComputedStyle(document.body).getPropertyValue("--chart-grid").trim(),
      background: getComputedStyle(fill).backgroundImage,
    };
    table.remove();
    return result;
  })).toEqual({
    primary: "#0b8060",
    secondary: "#d29034",
    grid: "rgb(16 94 73 / 13%)",
    background: "linear-gradient(270deg, rgb(7, 87, 68), rgb(53, 173, 134))",
  });

  await picker.selectOption("modern-2");
  await enableDarkMode(page, isMobile);
  await expect(page.locator("body")).toHaveAttribute("data-color-scheme", "dark");
  await expect.poll(() => page.evaluate(() => ({
    primary: getComputedStyle(document.body).getPropertyValue("--chart-primary").trim(),
    axis: getComputedStyle(document.body).getPropertyValue("--chart-axis").trim(),
    tooltipSurface: getComputedStyle(document.body).getPropertyValue("--chart-tooltip-surface").trim(),
  }))).toEqual({ primary: "#ef9b70", axis: "#ddc3b1", tooltipSurface: "#37241b" });
});

test("modern presentations keep reference primitive geometry across RTL, mobile, and dark surfaces", async ({ page, isMobile }) => {
  await openThemePreview(page);
  const picker = page.locator(".interface-theme-control select");

  const primitives = () => page.evaluate(() => {
    const fixture = document.createElement("section");
    fixture.innerHTML = [
      '<article class="baseer-card baseer-card--default">Card</article>',
      '<div class="baseer-metric-grid"><article class="baseer-card baseer-card--compact baseer-metric"><small>Metric</small><strong>100</strong></article><article class="baseer-card baseer-card--compact baseer-metric"><small>Metric</small><strong>200</strong></article></div>',
      '<div class="baseer-data-table"><table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table></div>',
      '<section class="baseer-filter-bar administration-companies-toolbar"><input class="baseer-filter-bar__select" /></section>',
      '<section class="baseer-dialog" role="dialog">Dialog</section>',
    ].join("");
    document.body.append(fixture);
    const query = <T extends Element>(selector: string) => fixture.querySelector<T>(selector)!;
    const styles = (selector: string) => getComputedStyle(query(selector));
    const result = {
      cardRadius: styles(".baseer-card").borderRadius,
      metricRadius: styles(".baseer-metric").borderRadius,
      metricMinHeight: styles(".baseer-metric").minHeight,
      metricPadding: styles(".baseer-metric").padding,
      metricGap: styles(".baseer-metric-grid").gap,
      metricGridRadius: styles(".baseer-metric-grid").borderRadius,
      tableRadius: styles(".baseer-data-table").borderRadius,
      headerPadding: styles("th").padding,
      cellPadding: styles("td").padding,
      filterPadding: styles(".baseer-filter-bar").padding,
      dialogRadius: styles(".baseer-dialog").borderRadius,
    };
    fixture.remove();
    return result;
  });

  await picker.selectOption("modern-1");
  const themeOne = await primitives();
  expect(themeOne.cardRadius).toBe("18px");
  expect(themeOne.metricRadius).toBe("17px");
  expect(themeOne.metricPadding).toBe("16px");
  expect(themeOne.metricGap).toBe(isMobile ? "9px" : "13px");
  expect(themeOne.metricMinHeight).toBe(isMobile ? "128px" : "144px");
  expect(themeOne.tableRadius).toBe("18px");
  expect(themeOne.headerPadding).toBe("11px 22px");
  expect(themeOne.cellPadding).toBe("12px 22px");

  if (!isMobile) {
    const themeOnePagePadding = await page.evaluate(() => {
      const modulePage = document.createElement("section");
      modulePage.className = "module-page";
      document.body.append(modulePage);
      const padding = Number.parseFloat(getComputedStyle(modulePage).paddingInlineStart);
      modulePage.remove();
      return padding;
    });
    expect(themeOnePagePadding).toBeGreaterThanOrEqual(50);
    expect(themeOnePagePadding).toBeLessThanOrEqual(52);
  }

  await picker.selectOption("modern-2");
  const themeTwo = await primitives();
  expect(themeTwo.cardRadius).toBe("5px");
  expect(themeTwo.metricRadius).toBe(isMobile ? "5px" : "0px");
  expect(themeTwo.metricMinHeight).toBe(isMobile ? "128px" : "118px");
  expect(themeTwo.metricGap).toBe(isMobile ? "9px" : "0px");
  expect(themeTwo.metricGridRadius).toBe(isMobile ? "0px" : "5px");
  expect(themeTwo.tableRadius).toBe("5px");
  expect(themeTwo.headerPadding).toBe("11px 22px");
  expect(themeTwo.cellPadding).toBe("12px 22px");
  expect(themeTwo.dialogRadius).toBe("5px");

  await page.evaluate(() => { document.body.dataset.colorScheme = "dark"; });
  const darkThemeTwo = await primitives();
  expect(darkThemeTwo.cardRadius).toBe("5px");
  expect(darkThemeTwo.metricMinHeight).toBe(isMobile ? "128px" : "118px");
});

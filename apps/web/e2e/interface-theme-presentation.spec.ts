import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";
const presentationStorageKey = "baseer-erp.shell.presentation.v1";
const paletteStorageKey = "baseer-erp.shell.color-palette.v1";

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

async function openThemePreview(page: Page, storedPresentation: string | null, storedPalette: string | null = null) {
  await page.addInitScript(({ company, presentation, palette, presentationKey, paletteKey }) => {
    sessionStorage.setItem("baseer.erp.access-token", "theme-preview-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "theme-preview-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.appearance.v1", "light");
    if (presentation === null) localStorage.removeItem(presentationKey);
    else localStorage.setItem(presentationKey, presentation);
    if (palette === null) localStorage.removeItem(paletteKey);
    else localStorage.setItem(paletteKey, palette);
  }, { company: companyId, presentation: storedPresentation, palette: storedPalette, presentationKey: presentationStorageKey, paletteKey: paletteStorageKey });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") return fulfill(route, {
      companies: [{ id: companyId, nameAr: "شركة اختبار الثيم", nameEn: "Theme preview company", permissionCodes: ["reports.read"] }],
    });
    if (path === "/v1/reports/personal-cash-performance") return fulfill(route, {
      state: "READY", selectedPeriod: { from: "2026-08-01", to: "2026-08-31" }, rows: [], vaults: [],
      totals: {
        inflows: { raw: "0.0000", display: "0.00", sign: "zero" }, outflows: { raw: "0.0000", display: "0.00", sign: "zero" },
        netCashResult: { raw: "0.0000", display: "0.00", sign: "zero" }, netCashResultShareOfCollectedSalesPercent: "0.0000",
      },
    });
    return fulfill(route, {});
  });
  await page.goto("/");
  await expect(page.locator(".launcher-page")).toBeVisible();
}

test("legacy presentations migrate into their matching modern administrative colour palette", async ({ page }) => {
  for (const [storedPresentation, expectedPalette] of [[null, "modern-admin"], ["baseer", "modern-admin"], ["modern-1", "calm-green"], ["modern-2", "editorial-copper"], ["modern-3", "modern-admin"], ["unexpected-value", "modern-admin"]] as const) {
    await openThemePreview(page, storedPresentation);
    await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
    await expect(page.locator("body")).toHaveAttribute("data-color-palette", expectedPalette);
    await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), presentationStorageKey)).toBe("modern-3");
    await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), paletteStorageKey)).toBe(expectedPalette);
  }
});

test("the profile menu exposes three colour palettes without a competing interface layout", async ({ page }) => {
  await openThemePreview(page, "modern-1");
  const profileMenu = page.locator(".header-profile-menu");
  await profileMenu.locator(":scope > summary").click();

  await expect(profileMenu.locator(".header-profile-menu__interface")).toHaveCount(0);
  await expect(profileMenu.locator("select")).toHaveCount(0);
  await expect(profileMenu.locator(".palette-picker button")).toHaveCount(3);
  await expect(profileMenu.locator(".header-profile-menu__appearance summary")).toHaveAttribute("aria-label", "المظهر");
});

test("palette and appearance remain switchable without changing the modern administrative interface", async ({ page }) => {
  await openThemePreview(page, "modern-2");
  const profileMenu = page.locator(".header-profile-menu");
  await profileMenu.locator(":scope > summary").click();
  await page.getByRole("button", { name: "أخضر هادئ", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
  await expect(page.locator("body")).toHaveAttribute("data-color-palette", "calm-green");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--brand").trim())).toBe("#16815f");
  await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), paletteStorageKey)).toBe("calm-green");
  await profileMenu.locator(".header-profile-menu__appearance summary").click();
  await page.getByRole("button", { name: "ليلي", exact: true }).click();

  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
  await expect(page.locator("body")).toHaveAttribute("data-color-scheme", "dark");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--brand").trim())).toBe("#52c69a");
});

test("every saved palette supplies its own light and dark semantic brand token", async ({ page }) => {
  for (const [palette, lightBrand, darkBrand] of [["calm-green", "#16815f", "#52c69a"], ["editorial-copper", "#9c4f28", "#ef9b70"], ["modern-admin", "#127f73", "#55c7b7"]] as const) {
    await openThemePreview(page, "modern-3", palette);
    await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
    await expect(page.locator("body")).toHaveAttribute("data-color-palette", palette);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--brand").trim())).toBe(lightBrand);
    const profileMenu = page.locator(".header-profile-menu");
    await profileMenu.locator(":scope > summary").click();
    await profileMenu.locator(".header-profile-menu__appearance summary").click();
    await page.getByRole("button", { name: "ليلي", exact: true }).click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--brand").trim())).toBe(darkBrand);
  }
});

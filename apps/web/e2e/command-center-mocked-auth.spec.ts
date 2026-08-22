import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const calendarPath = "/v1/finance/operational-calendar";

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

async function mockCommandCenter(page: Page, permissions: string[], calendarRequests: URL[], language: "ar" | "en" = "en") {
  await page.addInitScript(({ company, locale }) => {
    sessionStorage.setItem("baseer.erp.access-token", "mock-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "mock-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
  }, { company: companyId, locale: language });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, name: "Test company", functionalCurrency: "SAR", permissionCodes: permissions }] });
    if (url.pathname === calendarPath) {
      calendarRequests.push(url);
      return fulfill(route, {
        companyId,
        fromBusinessDate: `${url.searchParams.get("fromBusinessDate")}T00:00:00.000Z`,
        toBusinessDate: `${url.searchParams.get("toBusinessDate")}T00:00:00.000Z`,
        days: [{ businessDate: "2026-08-23", operationalStatus: "OPEN", dataStatus: "RECORDED", hasActiveClosing: true, salesGrossAmount: "120.4500", customerCount: 4 }],
      });
    }
    return fulfill(route, {});
  });
}

test("Command center reads a company-scoped calendar, preserves Decimal strings, and supports accessible refresh", async ({ page }) => {
  const calendarRequests: URL[] = [];
  await mockCommandCenter(page, ["finance.daily_sales.read"], calendarRequests);
  await page.goto("/#module=command&section=0");
  await expect(page.getByRole("heading", { name: "Operations and sales calendar" })).toBeVisible();
  await expect(page.getByText("SAR 120.4500", { exact: true })).toBeVisible();
  await expect.poll(() => calendarRequests.length).toBeGreaterThanOrEqual(1);
  expect(calendarRequests.every((request) => request.searchParams.has("fromBusinessDate"))).toBeTruthy();
  expect(calendarRequests.every((request) => request.searchParams.has("toBusinessDate"))).toBeTruthy();
  await expect(page.locator(".command-sales-calendar")).toHaveAttribute("aria-busy", "false");

  await page.locator(".baseer-period-filter__trigger").click();
  const periodDialog = page.getByRole("dialog", { name: "Choose period" });
  await periodDialog.getByRole("combobox").selectOption("YEAR");
  await periodDialog.getByRole("button", { name: "2026", exact: true }).click();
  await periodDialog.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => calendarRequests.some((request) => request.searchParams.get("fromBusinessDate") === "2026-01-01" && request.searchParams.get("toBusinessDate") === "2026-12-31")).toBeTruthy();
  const requestCountBeforeRefresh = calendarRequests.length;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => calendarRequests.length).toBeGreaterThan(requestCountBeforeRefresh);
  const accessibility = await new AxeBuilder({ page }).include(".command-sales-calendar").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("Command center supports Arabic RTL without converting Decimal display values", async ({ page }) => {
  const calendarRequests: URL[] = [];
  await mockCommandCenter(page, ["finance.daily_sales.read"], calendarRequests, "ar");
  await page.goto("/#module=command&section=0");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "تقويم التشغيل والمبيعات" })).toBeVisible();
  await expect(page.getByText("SAR 120.4500", { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include(".command-sales-calendar").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("Command center does not issue calendar reads without finance.daily_sales.read", async ({ page }) => {
  const calendarRequests: URL[] = [];
  await mockCommandCenter(page, ["finance.purchase_expense.read"], calendarRequests);
  await page.goto("/#module=command&section=0");
  await expect(page.getByText("You do not have permission to read the operations and sales calendar.")).toBeVisible();
  await expect.poll(() => calendarRequests.length).toBe(0);
});

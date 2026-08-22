import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function mockInternalRegistration(page: Page) {
  const requested: Array<{ method: string; path: string; body?: unknown }> = [];
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "operations-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "operations-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() : undefined;
    requested.push({ method, path: `${url.pathname}${url.search}`, body });
    if (url.pathname === "/v1/companies/available") {
      return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test Company", permissionCodes: ["operations.internal_registration.create", "operations.internal_registration.read"] }] });
    }
    if (url.pathname === "/v1/operations/internal-registration/workstation") {
      return fulfill(route, {
        sections: [{ id: "section-1", nameAr: "المطبخ", nameEn: "Kitchen" }],
        products: [{ id: "product-1", sectionId: "section-1", nameAr: "صنف الاختبار", nameEn: "Test item", units: [{ unitId: "unit-1", nameAr: "حبة", nameEn: "Each" }] }],
      });
    }
    if (url.pathname === "/v1/operations/internal-registration/report") {
      return fulfill(route, { totals: { registrationCount: 0, lineCount: 0, quantity: "0", amount: "0" }, registrations: [] });
    }
    if (url.pathname === "/v1/operations/internal-registration" && method === "POST") {
      return fulfill(route, { id: "registration-1", replayed: false });
    }
    return fulfill(route, { error: { code: "NOT_FOUND", message: { ar: "غير موجود", en: "Not found" } } }, 404);
  });
  return requested;
}

test("internal registration keeps its Gregorian business date through the Baseer date adapter", async ({ page }) => {
  const requested = await mockInternalRegistration(page);
  await page.goto("/#module=operations&section=7");

  await expect(page.getByText("سلة التسجيل")).toBeVisible();
  const entryCalendar = page.getByRole("button", { name: "فتح التقويم" }).first();
  await entryCalendar.click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("grid")).toHaveCount(0);

  await page.getByRole("button", { name: /صنف الاختبار/ }).click();
  await page.getByRole("button", { name: "حفظ التسجيل" }).click();
  await expect.poll(() => requested.find((request) => request.method === "POST" && request.path === "/v1/operations/internal-registration")?.body).toMatchObject({
    businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    sectionId: "section-1",
    lines: [{ menuProductItemId: "product-1", unitId: "unit-1", quantity: "1" }],
  });

  const accessibility = await new AxeBuilder({ page }).include(".operations-internal-registration").analyze();
  expect(accessibility.violations).toEqual([]);
});

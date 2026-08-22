import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const catalog = {
  units: [{ id: "unit-1", code: "EA", nameAr: "حبة", nameEn: "Each", dimension: "COUNT", isActive: true }],
  sections: [{ id: "section-1", nameAr: "المطبخ", nameEn: "Kitchen", isActive: true }],
  items: [{ id: "item-1", code: "MAT-001", nameAr: "مادة الاختبار", nameEn: "Test material", kind: "RAW_MATERIAL", status: "ACTIVE", sectionId: null, baseUnitId: "unit-1", itemUnits: [{ unitId: "unit-1", isBase: true, isActive: true, isOrderEnabled: true, lastPurchaseUnitPrice: null, lastPurchasePriceAt: null, menuSaleUnitPrice: null }], conversionVersion: null, liveRecipeUnitCost: null, liveRecipeCostStatus: "NO_RECIPE" }],
};
const execution = {
  inventory: [],
  requests: [{ id: "request-1", requestNumber: "REQ-001", businessDate: "2026-08-20", executionKind: "DELEGATED", plannedPaymentChannel: "CUSTODY", status: "PENDING_RECEIPT", custodyFundingAmount: "50.0000", custodyBalance: "50.0000", representativeName: "مندوب الاختبار", notes: null, cancellationReason: null, estimatedTotal: "50.0000", actualTotal: "0.0000", varianceTotal: "0.0000", lines: [], receipts: [] }],
  custody: { representativeName: "مندوب الاختبار", balance: "50.0000", events: [] },
};
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
      return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test Company", permissionCodes: ["operations.internal_registration.create", "operations.internal_registration.read", "operations.catalog.manage"] }] });
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
    if (url.pathname === "/v1/operations/catalog") return fulfill(route, catalog);
    if (url.pathname === "/v1/operations/catalog/items/update" && method === "POST") return fulfill(route, { id: "item-1", replayed: false });
    if (url.pathname === "/v1/operations/execution-workspace") return fulfill(route, execution);
    if (url.pathname === "/v1/operations/custody/returns" && method === "POST") return fulfill(route, { id: "custody-return-1", replayed: false });
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

test("catalog item details use the lazy Baseer form adapter without changing the update command", async ({ page }) => {
  const requested = await mockInternalRegistration(page);
  await page.goto("/#module=operations&section=5");

  await page.getByRole("button", { name: "مادة الاختبار" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("الرمز").fill("MAT-002");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => requested.find((request) => request.method === "POST" && request.path === "/v1/operations/catalog/items/update")?.body).toMatchObject({
    itemId: "item-1",
    code: "MAT-002",
    nameAr: "مادة الاختبار",
    sectionId: null,
  });
});

test("custody return keeps decimal text and Gregorian business date through its adapter", async ({ page }) => {
  const requested = await mockInternalRegistration(page);
  await page.goto("/#module=operations&section=6");

  await page.getByRole("button", { name: "تسجيل مرتجع عهدة" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "فتح التقويم" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog.getByLabel("ربط بالطلب").selectOption("request-1");
  await dialog.getByLabel("الإجمالي").fill("12.5000");
  await dialog.getByLabel("سبب المرتجع").fill("باقي العهدة");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => requested.find((request) => request.method === "POST" && request.path === "/v1/operations/custody/returns")?.body).toMatchObject({
    requestId: "request-1",
    businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    amount: "12.5000",
    notes: "باقي العهدة",
  });
});

test("purchase request and completion expose the shared Gregorian date adapter", async ({ page }) => {
  await mockInternalRegistration(page);
  await page.goto("/#module=operations&section=6");

  await page.getByRole("button", { name: "إنشاء طلب شراء" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "فتح التقويم" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "إلغاء" }).click();

  await page.getByRole("button", { name: "اعتماد الشراء الفعلي" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "فتح التقويم" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("grid")).toHaveCount(0);
});

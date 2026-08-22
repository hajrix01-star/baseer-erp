import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const catalog = {
  units: [
    { id: "unit-1", code: "EA", nameAr: "حبة", nameEn: "Each", dimension: "COUNT", isActive: true },
    { id: "unit-2", code: "CARTON", nameAr: "كرتون", nameEn: "Carton", dimension: "PACKAGE", isActive: true },
  ],
  sections: [{ id: "section-1", nameAr: "المطبخ", nameEn: "Kitchen", isActive: true }],
  items: [
    { id: "item-1", code: "MAT-001", nameAr: "مادة الاختبار", nameEn: "Test material", kind: "RAW_MATERIAL", status: "ACTIVE", sectionId: null, baseUnitId: "unit-1", itemUnits: [{ unitId: "unit-1", isBase: true, isActive: true, isOrderEnabled: false, lastPurchaseUnitPrice: null, lastPurchasePriceAt: null, menuSaleUnitPrice: null }, { unitId: "unit-2", isBase: false, isActive: true, isOrderEnabled: true, lastPurchaseUnitPrice: null, lastPurchasePriceAt: null, menuSaleUnitPrice: null }], conversionVersion: { version: 1, edges: [{ fromUnitId: "unit-2", toUnitId: "unit-1", factor: "12.0000" }] }, liveRecipeUnitCost: null, liveRecipeCostStatus: "NO_RECIPE" },
    { id: "menu-1", code: "MENU-001", nameAr: "منتج الاختبار", nameEn: "Test menu product", kind: "MENU_PRODUCT", status: "ACTIVE", sectionId: "section-1", baseUnitId: "unit-1", itemUnits: [{ unitId: "unit-1", isBase: true, isActive: true, isOrderEnabled: false, lastPurchaseUnitPrice: null, lastPurchasePriceAt: null, menuSaleUnitPrice: "7.0000" }], conversionVersion: null, liveRecipeUnitCost: null, liveRecipeCostStatus: "NO_RECIPE" },
  ],
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
    if (url.pathname === "/v1/operations/catalog/item-units/price" && method === "POST") return fulfill(route, { id: "menu-1", replayed: false });
    if (url.pathname === "/v1/operations/catalog/item-units/configure" && method === "POST") return fulfill(route, { id: "item-1", replayed: false });
    if (url.pathname === "/v1/operations/catalog/conversions/publish" && method === "POST") return fulfill(route, { id: "item-1", replayed: false });
    if (url.pathname === "/v1/operations/reports/materials-received") {
      const firstPage = !url.searchParams.has("cursor");
      return fulfill(route, {
        totals: { materialCount: 2, quantity: "24.0000", amount: "216.0000" },
        materials: firstPage
          ? [{ rawMaterialItemId: "item-1", materialNameAr: "مادة الاختبار", materialNameEn: "Test material", unitId: "unit-1", unitNameAr: "حبة", unitNameEn: "Each", quantity: "12.0000", amount: "96.0000", weightedActualUnitPrice: "8.0000" }]
          : [{ rawMaterialItemId: "item-2", materialNameAr: "مادة الاختبار الثانية", materialNameEn: "Second test material", unitId: "unit-2", unitNameAr: "كرتون", unitNameEn: "Carton", quantity: "12.0000", amount: "120.0000", weightedActualUnitPrice: "10.0000" }],
        nextCursor: firstPage ? "item-1:unit-1" : null,
        asOf: "2026-08-22T12:00:00.000Z",
      });
    }
    if (url.pathname === "/v1/operations/reports/custody-monthly") return fulfill(route, { representativeName: "مندوب الاختبار", months: [{ month: "2026-08", openingBalance: "50.0000", funding: "0", purchases: "8.0000", returns: "0", reversals: "0", closingBalance: "42.0000" }] });
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

test("catalog price keeps the decimal string in its separate Baseer command form", async ({ page }) => {
  const requested = await mockInternalRegistration(page);
  await page.goto("/#module=operations&section=5");

  await page.getByRole("button", { name: "منتجات المنيو" }).click();
  await page.getByRole("button", { name: "منتج الاختبار" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "سعر بيع المنيو" }).click();
  await dialog.getByLabel("سعر بيع المنيو").fill("9.2500");
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => requested.find((request) => request.method === "POST" && request.path === "/v1/operations/catalog/item-units/price")?.body).toMatchObject({
    itemId: "menu-1",
    unitId: "unit-1",
    price: "9.2500",
  });
});

test("catalog conversion uses the lazy Baseer form adapter without changing the three inventory commands", async ({ page }) => {
  const requested = await mockInternalRegistration(page);
  await page.goto("/#module=operations&section=5");

  await page.getByRole("button", { name: "مادة الاختبار" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "الوحدات والتحويلات" }).click();
  await dialog.getByRole("button", { name: "تعديل" }).click();
  await dialog.getByLabel("عامل التحويل").fill("24.0000");
  await dialog.getByRole("button", { name: "حفظ الوحدات والتحويلات" }).click();

  await expect.poll(() => requested.filter((request) => request.method === "POST" && request.path.startsWith("/v1/operations/catalog/")).map((request) => request.path)).toEqual([
    "/v1/operations/catalog/item-units/configure",
    "/v1/operations/catalog/conversions/publish",
    "/v1/operations/catalog/item-units/configure",
  ]);
  expect(requested.find((request) => request.path === "/v1/operations/catalog/conversions/publish")?.body).toMatchObject({
    itemId: "item-1",
    edges: [{ fromUnitId: "unit-2", toUnitId: "unit-1", factor: "24.0000" }],
  });
  const accessibility = await new AxeBuilder({ page }).include(".operations-inline-conversion").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("operations reports keep their read-only data inside the company and period query boundary", async ({ page }) => {
  const requested = await mockInternalRegistration(page);
  await page.goto("/#module=operations&section=8");

  await expect(page.getByRole("heading", { name: "تقارير المشتريات والعهدة" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "96.0000" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "مادة الاختبار الثانية" })).toHaveCount(0);
  await page.getByRole("button", { name: "تحميل المزيد" }).click();
  await expect(page.getByRole("cell", { name: "مادة الاختبار الثانية" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تحميل المزيد" })).toHaveCount(0);
  await expect(page.getByText("مندوب الاختبار")).toBeVisible();
  const reportRequests = requested.filter((request) => request.path.startsWith("/v1/operations/reports/")).map((request) => request.path);
  expect(reportRequests).toEqual(expect.arrayContaining([
    expect.stringMatching(/^\/v1\/operations\/reports\/materials-received\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&pageSize=50$/),
    expect.stringMatching(/^\/v1\/operations\/reports\/materials-received\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&pageSize=50&cursor=item-1%3Aunit-1$/),
    expect.stringMatching(/^\/v1\/operations\/reports\/custody-monthly\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&pageSize=50$/),
  ]));
  const accessibility = await new AxeBuilder({ page }).include(".baseer-data-table").analyze();
  expect(accessibility.violations).toEqual([]);
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

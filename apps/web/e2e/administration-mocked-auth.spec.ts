import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const roleId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const permissions = [
  "administration.companies.read", "administration.companies.manage",
  "administration.users.read", "administration.users.manage",
  "administration.roles.read", "administration.roles.manage",
];

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

function overview(owner = true) {
  return {
    owner,
    companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", businessTimezone: "Asia/Riyadh", status: "ACTIVE", logoFileMetadataId: null, contextLocationCode: null, contextLocationLabelAr: null, contextLatitude: null, contextLongitude: null }],
    users: [{ id: userId, login: "user@test.local", nameAr: "مستخدم الاختبار", nameEn: "Test user", preferredLanguage: "ar", avatarKind: "INITIALS", status: "ACTIVE", isOwner: false, memberships: [{ companyId, companyNameAr: "شركة الاختبار", companyNameEn: "Test company", roleId, roleNameAr: "مدير الاختبار", roleNameEn: "Test manager" }] }],
    roles: [{ id: roleId, code: "TEST_MANAGER", nameAr: "مدير الاختبار", nameEn: "Test manager", isSystem: false, permissionCodes: ["administration.users.read"] }],
    permissions: [
      { code: "administration.users.read", module: "administration", nameAr: "عرض المستخدمين", nameEn: "View users", risk: "standard" },
      { code: "administration.users.manage", module: "administration", nameAr: "إدارة المستخدمين", nameEn: "Manage users", risk: "sensitive" },
    ],
  };
}

async function mockAdministration(page: Page, language: "ar" | "en", requests: string[] = [], owner = true) {
  await page.addInitScript(({ locale, company }) => {
    sessionStorage.setItem("baseer.erp.access-token", "administration-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "administration-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
  }, { locale: language, company: companyId });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes: permissions }] });
    if (url.pathname === "/v1/administration/overview") return fulfill(route, overview(owner));
    return fulfill(route, { updated: true, id: "44444444-4444-4444-8444-444444444444" });
  });
}

test("company form uses the central validation adapter in Arabic RTL", async ({ page }) => {
  const requests: string[] = [];
  await mockAdministration(page, "ar", requests);
  await page.goto("/#module=administration&section=1");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: /إضافة شركة/ }).click();
  const dialog = page.getByRole("dialog", { name: "إضافة شركة" });
  const form = dialog.locator("[data-baseer-rhf-form]");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "إنشاء الشركة" }).click();
  await expect(form.getByRole("alert").first()).toBeVisible();
  expect(requests.filter((request) => request === "POST /v1/administration/companies")).toHaveLength(0);
  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations).toEqual([]);
});

test("user create and manage forms preserve centralized validation", async ({ page }) => {
  const requests: string[] = [];
  await mockAdministration(page, "en", requests);
  await page.goto("/#module=administration&section=2");

  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("region", { name: "Users table" })).toBeVisible();
  await page.getByRole("button", { name: /Add user/ }).click();
  const create = page.getByRole("dialog", { name: "Add employee" });
  await expect(create.locator("[data-baseer-rhf-form]")).toBeVisible();
  await create.getByRole("button", { name: "Save employee" }).click();
  await expect(create.getByRole("alert").first()).toBeVisible();
  expect(requests.filter((request) => request === "POST /v1/administration/users")).toHaveLength(0);
  await create.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Test user/ }).click();
  const manage = page.getByRole("dialog", { name: "Test user" });
  await expect(manage.locator("[data-baseer-rhf-form]")).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations).toEqual([]);
});

test("role editor validates its fields and permission selection", async ({ page }) => {
  const requests: string[] = [];
  await mockAdministration(page, "en", requests);
  await page.goto("/#module=administration&section=3");

  await page.getByRole("button", { name: /Add role/ }).click();
  const form = page.locator("[data-baseer-rhf-form]");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Add role" }).click();
  await expect(form.getByRole("alert")).toHaveCount(5);
  expect(requests.filter((request) => request === "POST /v1/administration/roles")).toHaveLength(0);
  const accessibility = await new AxeBuilder({ page }).include("[data-baseer-rhf-form]").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("non-owner administration remains read-only", async ({ page }) => {
  const requests: string[] = [];
  await mockAdministration(page, "ar", requests, false);
  await page.goto("/#module=administration&section=2");

  await expect(page.getByText("يمكنك العرض فقط؛ تغييرات الإدارة تحتاج مالك النظام.")).toBeVisible();
  await expect(page.getByRole("button", { name: /إضافة مستخدم/ })).toHaveCount(0);
  await page.getByRole("button", { name: /مستخدم الاختبار/ }).click();
  const dialog = page.getByRole("dialog", { name: "مستخدم الاختبار" });
  await expect(dialog.getByRole("button", { name: "حفظ التغييرات" })).toHaveCount(0);
  expect(requests.some((request) => /POST|PUT|DELETE/.test(request))).toBeFalsy();
});

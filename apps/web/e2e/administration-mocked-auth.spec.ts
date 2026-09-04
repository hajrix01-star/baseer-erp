import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const roleId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const permissions = [
  "administration.companies.read", "administration.companies.manage",
  "administration.users.read", "administration.users.manage",
  "administration.roles.read", "administration.roles.manage",
  "platform.ai.configuration.read", "platform.ai.configuration.write", "platform.ai.provider.configure",
];

const basiraGovernance = {
  companyId,
  catalogue: [],
  companyContexts: [],
  activations: [],
  receipts: [],
  evaluations: [],
  evaluationRuns: [],
  consumption: { dayStartAt: "2026-08-25T00:00:00.000Z", currency: "USD", chargedCostUsd: "0.0000", providerCalls: 0 },
};

const openAiCapability = {
  provider: "OPENAI_COMPATIBLE",
  model: "gpt-5-mini",
  displayNameAr: "OpenAI GPT-5 mini",
  displayNameEn: "OpenAI GPT-5 mini",
  summaryAr: "ملف تجريبي محكوم لبصيرة.",
  summaryEn: "A governed pilot profile for Basira.",
  status: "AVAILABLE",
  activationReadiness: "READY_FOR_CONFIGURATION",
  requiredActivationGates: [],
  costTier: "LOW",
  supportedSkillKeys: ["decision.command_center_analyst"],
};

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
    if (url.pathname === "/v1/administration/ai/configuration") return fulfill(route, { companyId, providerCapabilities: [openAiCapability], activeProvider: null, providerConfigurations: [], latestProviderConnectionCheck: null, activeSystemIdentity: null, activeIdentity: null });
    if (url.pathname === "/v1/administration/ai/governance") return fulfill(route, basiraGovernance);
    if (url.pathname === "/v1/administration/ai/provider-connection" && route.request().method() === "POST") return fulfill(route, { state: "READY", reason: null, provider: "OPENAI_COMPATIBLE", model: "gpt-5-mini", checkedAt: "2026-08-23T12:00:00.000Z" });
    if (url.pathname === "/v1/administration/ai/provider-configurations" && route.request().method() === "POST") return fulfill(route, { id: "44444444-4444-4444-8444-444444444444", provider: "OPENAI_COMPATIBLE", model: "gpt-5-mini", status: "ACTIVE", isDefault: true, dailyRequestLimit: 10, dailyCostLimit: null, configurationVersion: 1, createdAt: "2026-08-23T12:00:00.000Z", updatedAt: "2026-08-23T12:00:00.000Z" }, 201);
    return fulfill(route, { updated: true, id: "44444444-4444-4444-8444-444444444444" });
  });
}

async function expectViewportBoundedDialog(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      dialogOverflow: element.scrollWidth - element.clientWidth,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.dialogOverflow).toBeLessThanOrEqual(1);
  expect(geometry.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
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

test("Basira settings store the OpenAI key once and never display it", async ({ page }) => {
  const requests: string[] = [];
  await mockAdministration(page, "en", requests);
  await page.goto("/#module=administration&section=4");

  const advancedSettingsTab = page.getByRole("tab", { name: "Advanced settings" });
  if (test.info().project.name === "mobile-chromium") await page.getByLabel("Go to section").selectOption("settings");
  else await advancedSettingsTab.click();
  await expect(page.getByRole("heading", { name: "AI connection and limits" })).toBeVisible();
  const form = page.locator("form[data-baseer-rhf-form]");
  await form.getByRole("button", { name: "Save Basira configuration" }).click();
  await expect(form.getByRole("alert").first()).toBeVisible();
  expect(requests.filter((request) => request === "POST /v1/administration/ai/provider-configurations")).toHaveLength(0);
  await page.getByLabel("AI provider API key").fill("sk-test-never-real");
  await page.getByRole("button", { name: "Save Basira configuration" }).click();
  await expect.poll(() => requests.filter((request) => request === "POST /v1/administration/ai/provider-configurations").length).toBe(1);
  await expect(page.getByText("The encrypted configuration was saved as a draft. Verify the connection, then activate it explicitly.")).toBeVisible();
  await expect(page.getByLabel("AI provider API key")).toHaveValue("");
  const accessibility = await new AxeBuilder({ page }).include(".administration-ai-settings").analyze();
  expect(accessibility.violations).toEqual([]);
});

for (const language of ["ar", "en"] as const) {
  test(`Basira connection settings retain their visual contract in ${language}`, async ({ page, isMobile }) => {
    await mockAdministration(page, language);
    await page.goto("/#module=administration&section=4");

    if (isMobile) {
      await page.getByLabel(language === "ar" ? "انتقل إلى قسم" : "Go to section").selectOption("settings");
    } else {
      await page.getByRole("tab", { name: language === "ar" ? "إعدادات متقدمة" : "Advanced settings" }).click();
    }
    await expect(page.locator(".administration-ai-settings")).toBeVisible();
    await expect(page.getByLabel(language === "ar" ? /مفتاح مزوّد الذكاء/ : "AI provider API key")).toBeVisible();
    await expect(page).toHaveScreenshot(`basira-connection-${language}.png`, { animations: "disabled" });
  });
}

test("modern administrative dialog shell bounds the company editor", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("baseer-erp.shell.presentation.v1", "modern-3"));
  await mockAdministration(page, "ar");
  await page.goto("/#module=administration&section=1");
  await page.getByRole("button", { name: /إضافة شركة/ }).click();
  await expectViewportBoundedDialog(page, "إضافة شركة");
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
});

test("company editor saves company and VAT atomically from one action", async ({ page }) => {
  const requests: string[] = [];
  let savedBody: Record<string, unknown> | null = null;
  await mockAdministration(page, "ar", requests);
  await page.route(`**/v1/administration/companies/${companyId}/settings`, async (route) => {
    savedBody = route.request().postDataJSON() as Record<string, unknown>;
    return fulfill(route, { updated: true });
  });
  await page.goto("/#module=administration&section=1");
  await page.locator(".administration-company-card", { hasText: "شركة الاختبار" }).click();
  const dialog = page.getByRole("dialog", { name: /تعديل: شركة الاختبار/ });
  await dialog.getByLabel("نسبة ضريبة القيمة المضافة").fill("12.5");
  await expect(dialog.getByRole("button", { name: "حفظ النسبة" })).toHaveCount(0);
  await expect(dialog.getByLabel(/سبب التغيير/)).toHaveCount(0);
  await expect(dialog.getByText(/تطبّق على الفواتير الجديدة/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect.poll(() => savedBody).not.toBeNull();
  expect(savedBody).toMatchObject({ vatRateBasisPoints: 1250, nameAr: "شركة الاختبار" });
  expect(requests.filter((request) => request === "POST /v1/finance/configuration/vat-rate")).toHaveLength(0);
});

test("company logo rejects an invalid browser file before requesting administration", async ({ page }) => {
  const requests: string[] = [];
  await mockAdministration(page, "ar", requests);
  await page.goto("/#module=administration&section=1");
  await page.locator(".administration-company-card", { hasText: "شركة الاختبار" }).click();
  const dialog = page.getByRole("dialog", { name: /تعديل: شركة الاختبار/ });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "logo.gif", mimeType: "image/gif", buffer: Buffer.from("gif") });
  await expect(page.getByText("اختر شعاراً بصيغة PNG أو JPG أو WebP.")).toBeVisible();
  expect(requests.filter((request) => request === `POST /v1/administration/companies/${companyId}/logo`)).toHaveLength(0);
});

test("company archive is a direct audited action without a reason field", async ({ page }) => {
  const requests: string[] = [];
  let archiveBody: Record<string, unknown> | null = null;
  await mockAdministration(page, "ar", requests);
  await page.route(`**/v1/administration/companies/${companyId}/status`, async (route) => {
    archiveBody = route.request().postDataJSON() as Record<string, unknown>;
    return fulfill(route, { updated: true, status: "ARCHIVED" });
  });
  await page.goto("/#module=administration&section=1");
  await page.locator(".administration-company-card", { hasText: "شركة الاختبار" }).click();
  const dialog = page.getByRole("dialog", { name: /تعديل: شركة الاختبار/ });
  await expect(dialog.getByLabel(/سبب التغيير/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "أرشفة الشركة" }).click();
  await expect.poll(() => archiveBody).not.toBeNull();
  expect(archiveBody).toEqual({ status: "ARCHIVED" });
});

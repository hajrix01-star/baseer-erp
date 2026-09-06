import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";
const permissions = ["marketing.insights.read", "marketing.campaign.write", "marketing.google-connection.manage", "marketing.reputation.policy.manage"];

const workspace = {
  companyId,
  campaigns: [],
  readiness: [
    { provider: "GOOGLE_BUSINESS", status: "AUTHORIZED_READ_ONLY_SELECTED", messageAr: "تم حفظ موقع Google Business الوحيد للقراءة فقط." },
    { provider: "GOOGLE_ADS", status: "NOT_CONNECTED", messageAr: "Google Ads غير متصل." },
  ],
  replyPolicy: { automationStatus: "PAUSED", authoringMethod: "TEMPLATE", tone: "WARM", languageMode: "MATCH_REVIEW", autoFourFiveEnabled: true, autoThreeIfSafe: false, signature: null, revision: 1, executionReadiness: "NOT_CONNECTED" },
};

const connections = {
  liveOauthEnabled: false,
  connections: [
    { provider: "GOOGLE_BUSINESS", status: "AUTHORIZED_READ_ONLY_SELECTED", setupRequestedAt: null, platformReadiness: "PLATFORM_READY_AWAITING_OAUTH_IMPLEMENTATION", pilotAuthorizationAvailable: true, allowedOperation: "BUSINESS_READ_AND_GOVERNED_PUBLISH", messageAr: "تم حفظ موقع Google Business الوحيد للقراءة فقط.", messageEn: "A single Google Business location is saved for read-only preparation." },
    { provider: "GOOGLE_ADS", status: "NOT_CONNECTED", setupRequestedAt: null, platformReadiness: "PLATFORM_SETUP_REQUIRED", pilotAuthorizationAvailable: false, allowedOperation: "ADS_READ_ONLY", messageAr: "Google Ads غير متصل.", messageEn: "Google Ads is not connected." },
  ],
};

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function prepare(page: Page) {
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "marketing-test-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "marketing-test-refresh");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة اختبار", nameEn: "Test company", isOwner: true, permissionCodes: permissions }] });
    if (url.pathname === "/v1/marketing") return fulfill(route, workspace);
    if (url.pathname === "/v1/marketing/provider-connections") return fulfill(route, connections);
    if (url.pathname === "/v1/marketing/basira/analysis-readiness") return fulfill(route, { ready: false, reasons: [] });
    return fulfill(route, { error: { code: "FORBIDDEN", message: { ar: "غير متاح للاختبار", en: "Unavailable for test" } } }, 403);
  });
}

test("marketing has five clear sections and one Google Business action", async ({ page }) => {
  await prepare(page);
  await page.goto("/#module=marketing&page=marketing-sources-policies");

  if (test.info().project.name === "desktop-chromium") {
    await expect(page.getByRole("button", { name: "النظرة", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "الحملات والعروض", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "السمعة والتقييمات", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Google Ads", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "المصادر والسياسات", exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("متصل للقراءة فقط", { exact: true })).toBeVisible();
  await expect(page.getByText("اختر حساباً", { exact: false })).toHaveCount(0);
  await expect(page.getByText("اختر موقعاً", { exact: false })).toHaveCount(0);
});

test("Google Ads is honest when no facts are connected", async ({ page }) => {
  await prepare(page);
  await page.goto("/#module=marketing&page=marketing-google-ads");

  await expect(page.locator("h1")).toHaveText("Google Ads");
  await expect(page.getByText("غير متصل", { exact: true })).toBeVisible();
  await expect(page.getByText(/لا تتوفر تكلفة أو تحويلات أو قرارات إنفاق/)).toBeVisible();
});

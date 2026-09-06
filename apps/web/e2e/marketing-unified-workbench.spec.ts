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

async function prepare(page: Page, options: { permissionCodes?: string[]; googleBusinessSelected?: boolean; googleBusinessStatus?: string } = {}) {
  const permissionCodes = options.permissionCodes ?? permissions;
  let googleBusinessSelected = options.googleBusinessSelected ?? true;
  const googleBusinessStatus = options.googleBusinessStatus ?? (googleBusinessSelected ? "AUTHORIZED_READ_ONLY_SELECTED" : "NOT_CONNECTED");
  const currentWorkspace = {
    ...workspace,
    readiness: workspace.readiness.map((item) => item.provider === "GOOGLE_BUSINESS" ? { ...item, status: googleBusinessStatus, messageAr: googleBusinessSelected ? item.messageAr : "Google Business غير متصل." } : item),
  };
  let currentConnections = {
    ...connections,
    connections: connections.connections.map((item) => item.provider === "GOOGLE_BUSINESS" ? { ...item, status: googleBusinessStatus, messageAr: googleBusinessSelected ? item.messageAr : "Google Business غير متصل." } : item),
  };
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "marketing-test-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "marketing-test-refresh");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة اختبار", nameEn: "Test company", isOwner: true, permissionCodes }] });
    if (url.pathname === "/v1/marketing") return fulfill(route, currentWorkspace);
    if (url.pathname === "/v1/marketing/provider-connections") return fulfill(route, currentConnections);
    if (url.pathname === "/v1/marketing/provider-connections/google-business/pilot/authorization") return fulfill(route, { authorizationUrl: "https://google.test/oauth", expiresAt: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/marketing/provider-connections/google-business/pilot" && route.request().method() === "DELETE") {
      googleBusinessSelected = false;
      currentConnections = { ...currentConnections, connections: currentConnections.connections.map((item) => item.provider === "GOOGLE_BUSINESS" ? { ...item, status: "NOT_CONNECTED", messageAr: "Google Business غير متصل." } : item) };
      return fulfill(route, { status: "NOT_CONNECTED" });
    }
    if (url.pathname === "/v1/marketing/basira/analysis-readiness") return fulfill(route, { ready: false, reasons: [] });
    return fulfill(route, { error: { code: "FORBIDDEN", message: { ar: "غير متاح للاختبار", en: "Unavailable for test" } } }, 403);
  });
}

test("marketing has five clear sections in the same desktop and mobile order", async ({ page, isMobile }) => {
  await prepare(page);
  await page.goto("/#module=marketing&page=marketing-sources-policies");

  const navigation = isMobile ? page.getByRole("dialog") : page.locator(".module-sidebar");
  if (isMobile) await page.getByRole("button", { name: "الأقسام" }).click();
  await expect(navigation.getByRole("button", { name: "النظرة", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "الحملات والعروض", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "السمعة والتقييمات", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Google Ads", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "المصادر والربط", exact: true })).toBeVisible();
  await expect(page.getByText("متصل للقراءة فقط", { exact: true })).toBeVisible();
  await expect(page.getByText("اختر حساباً", { exact: false })).toHaveCount(0);
  await expect(page.getByText("اختر موقعاً", { exact: false })).toHaveCount(0);
});

test("Google Business starts from one authorized action", async ({ page }) => {
  await prepare(page, { googleBusinessSelected: false });
  await page.goto("/#module=marketing&page=marketing-sources-policies");

  const connect = page.getByRole("button", { name: "ربط Google Business", exact: true });
  await expect(connect).toHaveCount(1);
  const authorization = page.waitForRequest((request) => request.url().includes("/v1/marketing/provider-connections/google-business/pilot/authorization") && request.method() === "POST");
  await connect.click();
  await authorization;
});

test("Google Business can be disconnected from the same single connection workspace", async ({ page }) => {
  await prepare(page);
  await page.goto("/#module=marketing&page=marketing-sources-policies");

  await page.getByRole("button", { name: "فصل Google Business", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "فصل Google Business" })).toBeVisible();
  const disconnect = page.waitForRequest((request) => request.url().includes("/v1/marketing/provider-connections/google-business/pilot") && request.method() === "DELETE");
  await page.getByRole("button", { name: "فصل الاتصال", exact: true }).click();
  await disconnect;
  await expect(page.getByRole("button", { name: "ربط Google Business", exact: true })).toBeVisible();
});

test("a failed Google Business connection gives one clear retry action", async ({ page }) => {
  await prepare(page, { googleBusinessStatus: "BLOCKED" });
  await page.goto("/#module=marketing&page=marketing-sources-policies");

  await expect(page.getByText("تعذر الربط؛ يمكنك المحاولة من جديد", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ربط Google Business", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "فصل Google Business", exact: true })).toHaveCount(0);
});

test("the calendar stays inside campaigns", async ({ page }) => {
  await prepare(page);
  await page.goto("/#module=marketing&page=marketing-campaigns");
  await expect(page.getByRole("heading", { name: "التقويم والنتيجة", exact: true })).toBeVisible();
});

test("Google Ads is honest when no facts are connected", async ({ page }) => {
  await prepare(page);
  await page.goto("/#module=marketing&page=marketing-google-ads");

  await expect(page.locator("h1")).toHaveText("Google Ads");
  await expect(page.getByText("غير متصل", { exact: true })).toBeVisible();
  await expect(page.getByText(/لا تتوفر تكلفة أو تحويلات أو قرارات إنفاق/)).toBeVisible();
});

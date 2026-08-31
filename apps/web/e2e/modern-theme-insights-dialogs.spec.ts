import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";
const alertId = "22222222-2222-4222-822222222222";

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function prepareShell(page: Page, theme: "modern-1" | "modern-2", permissions: readonly string[]) {
  await page.addInitScript(({ company, uiTheme }) => {
    sessionStorage.setItem("baseer.erp.access-token", "modern-insights-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "modern-insights-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.presentation.v1", uiTheme);
  }, { company: companyId, uiTheme: theme });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة اختبار الواجهات", nameEn: "UI test company", functionalCurrency: "SAR", permissionCodes: permissions }] });
    return fulfill(route, { code: "E2E_UNPREPARED_ENDPOINT", message: `No fixture for ${url.pathname}` }, 404);
  });
}

async function expectBounded(page: Page, locator: ReturnType<Page["getByRole"]>) {
  await expect(locator).toBeVisible();
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      elementOverflow: element.scrollWidth - element.clientWidth,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.elementOverflow).toBeLessThanOrEqual(1);
  expect(geometry.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
}

function expectModernShell(page: Page, theme: "modern-1" | "modern-2") {
  return expect(page.locator("body")).toHaveAttribute("data-ui-theme", theme);
}

async function mockMarketing(page: Page, theme: "modern-1" | "modern-2") {
  await prepareShell(page, theme, ["marketing.insights.read", "marketing.campaign.write"]);
  await page.route("**/v1/marketing", async (route) => fulfill(route, {
    companyId,
    campaigns: [{
      id: "33333333-3333-4333-8333-333333333333", titleAr: "حملة افتتاح الفرع", titleEn: "Branch opening", platform: "META", externalReference: "META-2026-08", startsOn: "2026-08-01", endsOn: "2026-08-31", status: "ACTIVE", stoppedOn: null, stoppedReason: null, objective: "تعريف العملاء بالخدمة الجديدة", notes: "بيانات تجريبية قابلة للمراجعة", plannedCost: "1200.00", plannedCurrencyCode: "SAR", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    }],
  }));
}

async function mockEvidence(page: Page, theme: "modern-1" | "modern-2") {
  await prepareShell(page, theme, ["inbound_evidence.owner_access"]);
  await page.route("**/v1/inbound-evidence", async (route) => fulfill(route, {
    labels: [{ id: "44444444-4444-4444-8444-444444444444", nameAr: "فواتير ومصروفات", nameEn: "Invoices & expenses", colorHex: "#526D87", sortOrder: 100, systemKey: null, ruleCount: 1 }],
    rules: [{ id: "55555555-5555-4555-8555-555555555555", name: "موردو الاختبار", enabled: true, priority: 100, labelId: "44444444-4444-4444-8444-444444444444", senderContains: "supplier.example", subjectContains: null, attachmentCondition: "REQUIRED" }],
    connector: { status: "NOT_CONNECTED", messageAr: "Gmail غير متصل", messageEn: "Gmail is not connected" },
  }));
}

async function mockDecision(page: Page, theme: "modern-1" | "modern-2") {
  await prepareShell(page, theme, ["decision.context.read", "decision.context.company.manage", "decision.alerts.read", "decision.alerts.manage"]);
  const alert = { id: alertId, ruleCode: "sales_change", ruleVersion: "sales_change.v1", status: "OPEN", titleAr: "تغير مبيعات قابل للمراجعة", createdAt: "2026-08-23T08:30:00.000Z", acknowledgedAt: null, closedAt: null, evidenceSnapshotId: "77777777-7777-4777-8777-777777777777" };
  await page.route("**/v1/decision-intelligence/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/v1/decision-intelligence/context/timeline") return fulfill(route, [{
      id: "66666666-6666-4666-8666-666666666666", scope: "COMPANY", eventKind: "OPERATIONAL_EVENT", titleAr: "إغلاق فرع الاختبار", startsOn: "2026-08-10", endsOn: "2026-08-10", verificationStatus: "SYSTEM_RECONCILED", sourceReference: "قرار داخلي", locationLabelAr: null, isManual: true,
    }]);
    if (pathname === "/v1/decision-intelligence/alerts") return fulfill(route, [alert]);
    if (pathname === `/v1/decision-intelligence/alerts/${alertId}/evidence`) return fulfill(route, {
      alert,
      snapshot: { id: alert.evidenceSnapshotId, evidenceKind: "OFFICIAL_FACT", verificationStatus: "SYSTEM_RECONCILED", periodFrom: "2026-08-01", periodTo: "2026-08-31", timezone: "Asia/Riyadh", checksum: "a".repeat(64), checksumValid: true, createdAt: "2026-08-23T08:30:00.000Z", supersedesSnapshotId: null, payload: { currentNetAmount: "120.0000", comparisonNetAmount: "100.0000", differenceNetAmount: "20.0000", percentDifference: "20.0000", dataQuality: "READY", sourceReferences: [] } },
      actions: [],
    });
    return fulfill(route, { code: "E2E_UNPREPARED_DECISION_ENDPOINT", message: `No fixture for ${pathname}` }, 404);
  });
}

for (const theme of ["modern-1", "modern-2"] as const) {
  test(`Modern insights: marketing campaign form is bounded in ${theme}`, async ({ page }) => {
    await mockMarketing(page, theme);
    await page.goto("/#module=marketing&page=marketing-campaigns");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("button", { name: "إضافة حملة" }).click();
    await expectBounded(page, page.getByRole("dialog", { name: "إضافة حملة" }));
    await expectModernShell(page, theme);
  });

  test(`Modern insights: inbound label form is bounded in ${theme}`, async ({ page }) => {
    await mockEvidence(page, theme);
    await page.goto("/#module=inbound-evidence&page=evidence-labels");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("button", { name: "إضافة Label" }).click();
    await expectBounded(page, page.getByRole("dialog", { name: "إضافة Label" }));
    await expectModernShell(page, theme);
  });

  test(`Modern insights: decision evidence is bounded in ${theme}`, async ({ page }) => {
    await mockDecision(page, theme);
    await page.goto("/#module=decision&page=decision-alerts");
    // Decision is a deliberately nested lazy route. Waiting for its mounted
    // workspace (instead of assuming a short fixed delay) makes a direct link
    // deterministic without masking a missing API response as success.
    await expect(page.locator(".decision-workspace")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "عرض الأدلة" }).click();
    await expectBounded(page, page.getByRole("dialog", { name: "حزمة أدلة التنبيه" }));
    await expectModernShell(page, theme);
  });
}

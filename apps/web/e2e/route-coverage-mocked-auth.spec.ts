import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";

const permissionCodes = [
  "reports.read", "marketing.insights.read", "finance.daily_sales.read", "finance.daily_sales.history.read_all", "inbound_evidence.owner_access",
  "decision.metrics.read", "decision.alerts.read", "decision.context.read", "decision.context.company.manage", "decision.feedback.write", "decision.policy.manage", "decision.context.global.manage", "decision.human_insights.read", "platform.ai.use",
  "finance.purchase_expense.read", "finance.purchase_expense.create", "finance.loans.read", "finance.loans.write", "finance.suppliers.read", "operations.assets.read", "finance.configuration.read", "finance.setup.write", "finance.foundation.write",
  "attendance.manage", "administration.companies.read", "administration.companies.manage", "administration.users.read", "administration.users.manage", "administration.roles.read", "administration.roles.manage", "platform.ai.configuration.read", "platform.ai.identity.read", "platform.ai.system_identity.read",
];

const uncoveredRoutes = [
  { module: "command", page: "command-calendar", title: "التقويم" },
  { module: "command", page: "command-analytics", title: "التحليلات" },
  { module: "command", page: "command-owner-notebook", title: "دفتر المالك اليومي" },
  { module: "decision", page: "decision-interpretations", title: "التفسيرات والقرارات البشرية" },
  { module: "marketing", page: "marketing-overview", title: "النظرة" },
  { module: "marketing", page: "marketing-calendar", title: "التقويم التسويقي" },
  { module: "marketing", page: "marketing-campaigns", title: "الحملات والعروض" },
  { module: "marketing", page: "marketing-reputation", title: "السمعة وGoogle" },
  { module: "marketing", page: "marketing-sources-policies", title: "المصادر والسياسات" },
  { module: "inbound-evidence", page: "evidence-overview", title: "النظرة" },
  { module: "inbound-evidence", page: "evidence-labels", title: "Labels وقواعد الفرز" },
  { module: "inbound-evidence", page: "evidence-sources", title: "مصادر الربط" },
  { module: "operations", page: "operations-overview", title: "نظرة التشغيل" },
  { module: "operations", page: "operations-sales", title: "المبيعات" },
  { module: "operations", page: "operations-expenses-obligations", title: "المصروفات والالتزامات" },
  { module: "operations", page: "operations-suppliers", title: "الموردون" },
  { module: "operations", page: "operations-assets-warranties", title: "الأصول والضمان" },
  { module: "finance", page: "finance-categories", title: "الفئات والتصنيفات" },
  { module: "hr", page: "hr-attendance", title: "الحضور والانصراف" },
  { module: "reports", page: "reports-hajri-tax", title: "محاكاة VAT" },
  { module: "administration", page: "administration-overview", title: "نظرة الإدارة" },
  { module: "administration", page: "administration-backup", title: "النسخ الاحتياطي" },
  { module: "administration", page: "administration-nurix-migration", title: "ترحيل نوركس" },
] as const;

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

/**
 * This deliberately has no live-network dependency. Every non-bootstrap API
 * read receives a safe denied receipt so the route's own loading/error path
 * renders without inventing domain data or performing commands.
 */
async function mockRouteCoverage(page: Page) {
  const activeReads = new Map<string, number>();
  const concurrentDuplicateReads: string[] = [];
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "route-coverage-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "route-coverage-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const readKey = `${request.method()} ${url.pathname}`;
    const isTrackedRead = request.method() === "GET" && url.pathname !== "/v1/companies/available";
    if (isTrackedRead) {
      const active = activeReads.get(readKey) ?? 0;
      if (active > 0) concurrentDuplicateReads.push(readKey);
      activeReads.set(readKey, active + 1);
    }
    try {
      if (url.pathname === "/v1/companies/available") {
        return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة اختبار", nameEn: "Test company", isOwner: true, permissionCodes }] });
      }
      return fulfill(route, { error: { code: "FORBIDDEN", message: { ar: "قراءة الاختبار غير متاحة.", en: "The test read is unavailable." } } }, request.method() === "GET" ? 403 : 405);
    } finally {
      if (isTrackedRead) activeReads.set(readKey, (activeReads.get(readKey) ?? 1) - 1);
    }
  });
  return concurrentDuplicateReads;
}

for (const entry of uncoveredRoutes) {
  test(`route coverage: ${entry.page}`, async ({ page }) => {
    const concurrentDuplicateReads = await mockRouteCoverage(page);
    await page.goto(`/#module=${entry.module}&page=${entry.page}`);

    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".module-page")).toBeVisible();
    await expect(page.locator(".page-heading h1")).toHaveText(entry.title);
    await page.waitForTimeout(150);
    expect(concurrentDuplicateReads).toEqual([]);
  });
}

import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const alertId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const reviewId = "44444444-4444-4444-8444-444444444444";
const checksum = "a".repeat(64);

type RequestLog = { method: string; pathname: string; search: string; body: Record<string, unknown> | null; company: string | null; idempotencyKey: string | null };

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

function metric(url: URL) {
  const from = url.searchParams.get("from") ?? "2026-08-01";
  const to = url.searchParams.get("to") ?? from;
  return {
    metricCode: "finance.sales.net.daily", metricDefinitionVersion: "finance.sales.net.daily.v1",
    period: { fromBusinessDate: from, toBusinessDate: to, timezone: "Asia/Riyadh", timeGrain: from === to ? "DAY" : "PERIOD" },
    evidenceKind: "OFFICIAL_FACT", verificationStatus: "SYSTEM_RECONCILED", dataQuality: "READY",
    calculatedAt: "2026-08-23T08:30:00.000Z", sourceFreshAt: "2026-08-23T08:00:00.000Z",
    coverage: { requiredDays: 31, availableDays: 31, missingDays: [], excludedDays: [] }, sourceReferences: [{ sourceType: "JOURNAL", sourceId: "sealed-ledger-revision-7", checksum }],
    payload: { currencyCode: "SAR", netAmount: "120.0000", grossAmount: "138.0000", vatAmount: "18.0000", customerCount: 4 },
  };
}

function comparison(url: URL, matched = false) {
  const current = metric(url);
  const previous = { ...current, period: { ...current.period, fromBusinessDate: "2026-07-01", toBusinessDate: "2026-07-31" }, payload: { ...current.payload, netAmount: "100.0000", grossAmount: "115.0000", vatAmount: "15.0000", customerCount: 3 } };
  return {
    metricCode: matched ? "finance.sales.net.weekday_comparison" : "finance.sales.net.period_comparison",
    metricDefinitionVersion: matched ? "finance.sales.net.weekday_comparison.v1" : "finance.sales.net.period_comparison.v1",
    comparisonPolicyCode: matched ? "MATCHED_WEEKDAYS" : "PREVIOUS_EQUAL_PERIOD", comparisonPolicyVersion: matched ? "matched_weekdays.v1" : "previous_equal_period.v1",
    dataQuality: "READY", current, comparison: previous,
    payload: { currencyCode: "SAR", currentNetAmount: "120.0000", comparisonNetAmount: "100.0000", differenceNetAmount: "20.0000", percentDifference: "20.0000", currentCustomerCount: 4, comparisonCustomerCount: 3 },
  };
}

function incompleteComparison(url: URL, matched = false) {
  const result = comparison(url, matched);
  return {
    ...result,
    dataQuality: "INCOMPLETE",
    payload: {
      currencyCode: "SAR",
      currentNetAmount: null,
      comparisonNetAmount: null,
      differenceNetAmount: null,
      percentDifference: null,
      currentCustomerCount: null,
      comparisonCustomerCount: null,
    },
  };
}

const event = { id: "55555555-5555-4555-8555-555555555555", scope: "COMPANY", eventKind: "OPERATIONAL_EVENT", titleAr: "إغلاق فرع الاختبار", startsOn: "2026-08-10", endsOn: "2026-08-10", verificationStatus: "SYSTEM_RECONCILED", sourceReference: "قرار داخلي", locationLabelAr: null, isManual: true };
const alert = { id: alertId, ruleCode: "sales_change", ruleVersion: "sales_change.v1", status: "OPEN", titleAr: "تغير مبيعات قابل للمراجعة", createdAt: "2026-08-23T08:30:00.000Z", acknowledgedAt: null, closedAt: null, evidenceSnapshotId: "66666666-6666-4666-8666-666666666666" };

function evidence() {
  return {
    alert,
    snapshot: { id: alert.evidenceSnapshotId, evidenceKind: "OFFICIAL_FACT", verificationStatus: "SYSTEM_RECONCILED", periodFrom: "2026-08-01", periodTo: "2026-08-31", timezone: "Asia/Riyadh", checksum, checksumValid: true, createdAt: "2026-08-23T08:30:00.000Z", supersedesSnapshotId: null, payload: { currentNetAmount: "120.0000", comparisonNetAmount: "100.0000", differenceNetAmount: "20.0000", percentDifference: "20.0000", dataQuality: "READY", sourceReferences: [{ sourceType: "JOURNAL", sourceId: "sealed-ledger-revision-7", checksum }] } },
    actions: [{ action: "ACKNOWLEDGED", reason: "تمت مراجعة القراءة", createdAt: "2026-08-23T09:00:00.000Z" }],
  };
}

const policy = { enabled: true, comparisonPolicyCode: "PREVIOUS_EQUAL_PERIOD", comparisonPolicyVersion: "previous_equal_period.v1", decreaseThresholdBasisPoints: 1250, increaseThresholdBasisPoints: 2500, minimumBaselineAmount: "100.1250", minimumAbsoluteDifferenceAmount: "20.5000", cooldownHours: 24, updatedAt: "2026-08-23T08:00:00.000Z" };
const candidate = { id: candidateId, eventKind: "PUBLIC_EVENT", titleAr: "عطلة تجريبية", startsOn: "2026-08-20T00:00:00.000Z", endsOn: "2026-08-20T23:59:59.999Z", scope: "TENANT_GLOBAL", locationCode: null, locationLabelAr: null, relevanceReasonAr: "مصدر رسمي ثابت", status: "PENDING_REVIEW", sourceUpdatedAt: "2026-08-19T10:00:00.000Z", createdAt: "2026-08-19T10:00:00.000Z", source: { sourceCode: "SA_NCM_WEATHER_FORECAST", displayNameAr: "المركز الوطني للأرصاد", sourceUrl: "https://ncm.gov.sa/" } };
const review = { id: reviewId, eventKind: "PUBLIC_EVENT", scope: "TENANT_GLOBAL", locationLabelAr: null, currentRevision: 1, source: { sourceCode: "SA_SPL_FIXTURES", displayNameAr: "رابطة الدوري السعودي" }, revisions: [{ revision: 2, titleAr: "مباراة مراجعة", startsOn: "2026-08-24T00:00:00.000Z", endsOn: "2026-08-24T23:59:59.999Z", sourceUpdatedAt: "2026-08-22T12:00:00.000Z", sourceChecksum: checksum }] };
const sourceHealth = [{ category: "RESEARCH", sourceCode: "SA_NCM_WEATHER_FORECAST", displayNameAr: "المركز الوطني للأرصاد", sourceUrl: "https://ncm.gov.sa/", scheduleCode: "daily", readiness: "READY_TO_SYNC", readinessReason: "موصل حكومي معتمد", lastRun: { status: "SUCCEEDED", startedAt: "2026-08-23T06:00:00.000Z", finishedAt: "2026-08-23T06:01:00.000Z" } }];

async function mockDecision(page: Page, language: "ar" | "en", permissions: string[], requests: RequestLog[], options?: { incompleteComparisons?: boolean }) {
  await page.addInitScript(({ locale, company }) => {
    sessionStorage.setItem("baseer.erp.access-token", "mock-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "mock-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
  }, { locale: language, company: companyId });
  await page.route("**/v1/**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    let body: Record<string, unknown> | null = null;
    try { body = request.postDataJSON() as Record<string, unknown>; } catch { /* request has no JSON body */ }
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search, body, company: request.headers()["x-baseer-company-id"] ?? null, idempotencyKey: request.headers()["x-idempotency-key"] ?? null });
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, name: "شركة اختبار", functionalCurrency: "SAR", permissionCodes: permissions }] });
    if (url.pathname === "/v1/administration/ai/runtime/decision-alert-explanations" && request.method() === "POST") return fulfill(route, {
      receiptId: "77777777-7777-4777-8777-777777777777", alertId, skillKey: "decision.command_center_analyst", model: "gpt-5-mini",
      explanation: { summary: "The frozen evidence shows a reconciled sales change that needs review.", evidence: ["The evidence snapshot checksum is valid."], limitations: ["This is not proof of causation."], reviewSteps: ["Review the source ledger evidence."] },
      createdAt: "2026-08-23T10:00:00.000Z", replayed: false,
    });
    if (url.pathname === "/v1/decision-intelligence/metrics/sales-daily") return fulfill(route, metric(url));
    if (url.pathname === "/v1/decision-intelligence/metrics/sales-comparison") return fulfill(route, options?.incompleteComparisons ? incompleteComparison(url) : comparison(url));
    if (url.pathname === "/v1/decision-intelligence/metrics/sales-matched-weekday") return fulfill(route, options?.incompleteComparisons ? incompleteComparison(url, true) : comparison(url, true));
    if (url.pathname === "/v1/decision-intelligence/context/timeline") return fulfill(route, [event]);
    if (url.pathname === "/v1/decision-intelligence/alerts") return fulfill(route, [alert]);
    if (url.pathname === `/v1/decision-intelligence/alerts/${alertId}/evidence`) return fulfill(route, evidence());
    if (url.pathname === "/v1/decision-intelligence/policies/sales-change" && request.method() === "GET") return fulfill(route, policy);
    if (url.pathname === "/v1/decision-intelligence/context/research/candidates") return fulfill(route, [candidate]);
    if (url.pathname === "/v1/decision-intelligence/context/reviews") return fulfill(route, [review]);
    if (url.pathname === "/v1/decision-intelligence/context/sources/health") return fulfill(route, sourceHealth);
    if (url.pathname.startsWith("/v1/decision-intelligence/")) return fulfill(route, { accepted: true });
    return fulfill(route, {});
  });
}

const allPermissions = ["platform.ai.use", "decision.metrics.read", "decision.context.read", "decision.alerts.read", "decision.alerts.manage", "decision.feedback.write", "decision.policy.manage", "decision.context.company.manage", "decision.context.global.manage"];

async function open(page: Page, section: number) {
  await page.goto(`/#module=decision&section=${section}`);
  await expect(page.locator(".decision-workspace")).toBeVisible();
}

test("Decision overview is accessible in Arabic and English, refreshes by period, and observes permission-gated reads", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockDecision(page, "ar", allPermissions, requests);
  await open(page, 0);
  await expect(page.getByRole("heading", { name: "قراءات موثقة قبل أي تفسير" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.locator(".baseer-period-filter__trigger").click();
  const periodDialog = page.getByRole("dialog", { name: "اختيار الفترة" });
  await periodDialog.getByRole("combobox", { name: "نوع الفترة" }).click();
  await page.getByRole("option", { name: "سنة", exact: true }).click();
  await periodDialog.getByRole("button", { name: "2026", exact: true }).click();
  await periodDialog.getByRole("button", { name: "تطبيق" }).click();
  await expect.poll(() => requests.some((request) => request.pathname.endsWith("/metrics/sales-daily") && request.search.includes("from=2026-01-01") && request.search.includes("to=2026-12-31"))).toBeTruthy();
  const initialMetrics = requests.filter((request) => request.pathname.includes("/metrics/")).length;
  await page.getByRole("button", { name: "تحديث" }).click();
  await expect.poll(() => requests.filter((request) => request.pathname.includes("/metrics/")).length).toBeGreaterThan(initialMetrics);
  const results = await new AxeBuilder({ page }).include(".decision-workspace").analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Evidence before interpretation" })).toBeVisible();

  const limitedRequests: RequestLog[] = [];
  const limited = await page.context().newPage();
  await mockDecision(limited, "en", ["decision.metrics.read"], limitedRequests);
  await open(limited, 0);
  await expect(limited.getByText("Reconciled net sales")).toBeVisible();
  const decisionGets = limitedRequests.filter((request) => request.method === "GET" && request.pathname.startsWith("/v1/decision-intelligence/"));
  expect([...new Set(decisionGets.map((request) => request.pathname))].sort()).toEqual([
    "/v1/decision-intelligence/metrics/sales-comparison",
    "/v1/decision-intelligence/metrics/sales-daily",
  ]);
  await limited.close();
});

test("Decision overview keeps an incomplete comparison as a review state instead of a white page", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockDecision(page, "ar", allPermissions, requests, { incompleteComparisons: true });
  await open(page, 0);
  await expect(page.getByRole("heading", { name: "قراءات موثقة قبل أي تفسير" })).toBeVisible();
  await expect(page.locator(".decision-sales-comparison")).toContainText("غير مكتملة");
  await expect(page.getByText("لا يصدر المركز حكماً عن التغير لأن إحدى الفترتين ناقصة أو غير متاحة. راجع جودة البيانات أولاً.")).toBeVisible();
  await expect(page.getByText("تنبيهات مفتوحة")).toBeVisible();
});

test("Timeline and alerts keep validation, evidence, status reason, Escape, and focus behavior", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockDecision(page, "en", allPermissions, requests);
  await open(page, 1);
  await expect(page.getByText(event.titleAr, { exact: true })).toBeVisible();
  const addEvent = page.getByRole("button", { name: "Add company event" });
  await addEvent.click();
  const eventDialog = page.getByRole("dialog", { name: "Add company event" });
  await expect(eventDialog).toBeVisible();
  await expect(eventDialog.locator("form[data-baseer-rhf-form]:not([aria-busy])")).toBeVisible();
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(eventDialog.getByRole("alert").first()).toBeVisible();
  expect(requests.some((request) => request.pathname.endsWith("/context/company-events") && request.method === "POST")).toBeFalsy();
  await eventDialog.getByLabel("Title").fill("A later opening date");
  const from = eventDialog.getByRole("textbox", { name: "From" });
  await expect(from).toHaveAttribute("lang", "en");
  await eventDialog.getByRole("button", { name: "Open calendar: From" }).click();
  await expect(page.getByRole("dialog", { name: "From" })).toBeVisible();
  await eventDialog.getByRole("button", { name: "Close calendar" }).click();
  await expect(page.getByRole("dialog", { name: "From" })).toHaveCount(0);
  await from.fill("2026-12-31");
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(eventDialog.getByText("End date cannot precede start date.")).toBeVisible();
  expect(requests.some((request) => request.pathname.endsWith("/context/company-events") && request.method === "POST")).toBeFalsy();
  await page.keyboard.press("Escape");
  await expect(addEvent).toBeFocused();

  await open(page, 2);
  await expect(page.getByRole("heading", { name: alert.titleAr })).toBeVisible();
  const evidenceTrigger = page.getByRole("button", { name: "View evidence" });
  await evidenceTrigger.click();
  await expect(page.getByRole("dialog", { name: "Alert evidence package" })).toContainText("Checksum valid");
  await page.keyboard.press("Escape");
  await expect(evidenceTrigger).toBeFocused();
  const explain = page.getByRole("button", { name: "✦ Explain" });
  await explain.click();
  await expect(page.getByRole("dialog", { name: "Basira alert explanation" })).toContainText("not proof of causation");
  await expect.poll(() => requests.filter((request) => request.pathname === "/v1/administration/ai/runtime/decision-alert-explanations").length).toBe(1);
  const explanationRequest = requests.find((request) => request.pathname === "/v1/administration/ai/runtime/decision-alert-explanations");
  expect(explanationRequest?.body).toMatchObject({ alertId, language: "en" });
  expect(typeof explanationRequest?.body?.idempotencyKey).toBe("string");
  await page.keyboard.press("Escape");
  await expect(explain).toBeFocused();
  const acknowledge = page.getByRole("button", { name: "Acknowledge" });
  await acknowledge.click();
  await expect(page.getByRole("dialog", { name: "Acknowledge alert" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Acknowledge alert" }).locator("form[data-baseer-rhf-form]:not([aria-busy])")).toBeVisible();
  await page.getByRole("button", { name: "Confirm acknowledgement" }).click();
  expect(requests.some((request) => request.pathname.endsWith(`/alerts/${alertId}/status`) && request.method === "POST")).toBeFalsy();
  await page.getByRole("dialog").getByRole("textbox", { name: "Reason" }).fill("Reviewed with the finance owner");
  await page.getByRole("button", { name: "Confirm acknowledgement" }).click();
  await expect.poll(() => requests.filter((request) => request.pathname.endsWith(`/alerts/${alertId}/status`)).length).toBe(1);
  const statusRequest = requests.find((request) => request.pathname.endsWith(`/alerts/${alertId}/status`));
  expect(statusRequest?.body).toMatchObject({ status: "ACKNOWLEDGED", reason: "Reviewed with the finance owner" });
  expect(typeof statusRequest?.body?.idempotencyKey).toBe("string");
});

test("Quality policy preserves decimal command fields and sources research actions are explicit", async ({ page }) => {
  const requests: RequestLog[] = [];
  await mockDecision(page, "en", allPermissions, requests);
  await open(page, 3);
  await expect(page.getByRole("heading", { name: "Sales-change alert policy" })).toBeVisible();
  const policyCard = page.locator(".decision-sales-policy");
  await expect(policyCard.locator("form[data-baseer-rhf-form]:not([aria-busy])")).toBeVisible();
  await policyCard.getByRole("textbox", { name: "Alert for a decrease of %" }).fill("12.50");
  await policyCard.getByRole("textbox", { name: "Alert for an increase of %" }).fill("25.00");
  await policyCard.getByRole("textbox", { name: "Minimum comparison-period sales (SAR)" }).fill("100.1250");
  await policyCard.getByRole("textbox", { name: "Minimum cash difference (SAR)" }).fill("20.5000");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect.poll(() => requests.filter((request) => request.pathname.endsWith("/policies/sales-change") && request.method === "PUT").length).toBe(1);
  const savedPolicy = requests.find((request) => request.pathname.endsWith("/policies/sales-change") && request.method === "PUT");
  expect(savedPolicy?.body).toMatchObject({ decreaseThresholdBasisPoints: 1250, increaseThresholdBasisPoints: 2500, minimumBaselineAmount: "100.1250", minimumAbsoluteDifferenceAmount: "20.5000" });
  expect(typeof savedPolicy?.body?.idempotencyKey).toBe("string");
  expect(savedPolicy?.idempotencyKey).toBeTruthy();

  await open(page, 4);
  await expect(page.getByRole("heading", { name: "Approved sources and policies" })).toBeVisible();
  await page.getByRole("button", { name: "Scan sources now" }).click();
  await expect.poll(() => requests.filter((request) => request.pathname.includes("/research/sources/") && request.method === "POST").length).toBe(3);
  await page.getByRole("button", { name: "Approve", exact: true }).last().click();
  await expect.poll(() => requests.filter((request) => request.pathname.endsWith("/research/candidates/resolve")).length).toBe(1);
  const candidateResolve = requests.find((request) => request.pathname.endsWith("/research/candidates/resolve"));
  expect(candidateResolve?.body).toMatchObject({ candidateId, action: "APPROVE" });
  expect(typeof candidateResolve?.body?.idempotencyKey).toBe("string");
  await page.getByRole("button", { name: "Approve revision" }).click();
  await expect.poll(() => requests.filter((request) => request.pathname.endsWith("/context/reviews/resolve")).length).toBe(1);
  const reviewResolve = requests.find((request) => request.pathname.endsWith("/context/reviews/resolve"));
  expect(reviewResolve?.body).toMatchObject({ eventId: reviewId, revision: 2, action: "APPROVE", reason: "اعتماد مراجعة المصدر الرسمية" });
});

import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const companyId = "11111111-1111-4111-8111-111111111111";
const permissions = ["finance.configuration.read", "finance.setup.write", "finance.foundation.write"];
const treasuryPermissions = ["finance.vaults.read", "finance.vaults.write", "finance.vaults.transfer"];
const allFinancePermissions = [...permissions, "finance.purchase_expense.read", ...treasuryPermissions];

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function mockAuthenticatedSession(page: Page, language: "ar" | "en", permissionCodes: string[]) {
  await page.addInitScript(({ locale, company, grantedPermissions }) => {
    sessionStorage.setItem("baseer.erp.access-token", "finance-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "finance-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
    localStorage.setItem("baseer.e2e.permission-codes", JSON.stringify(grantedPermissions));
  }, { locale: language, company: companyId, grantedPermissions: permissionCodes });
}

function availableCompanies(permissionCodes: string[]) {
  return {
    companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes }],
  };
}

function migrationReviewCompanies(permissionCodes: string[]) {
  return {
    companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes, migrationReviewLocked: true }],
  };
}

async function mockFinanceSetup(page: Page, language: "ar" | "en", permissionCodes = permissions) {
  await page.addInitScript(({ locale, company }) => {
    sessionStorage.setItem("baseer.erp.access-token", "finance-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "finance-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", locale);
  }, { locale: language, company: companyId });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes }] });
    if (url.pathname === "/v1/finance/configuration/readiness") return fulfill(route, {
      companyId, requiredBaseSeedVersion: 8, profile: null, openPeriod: null,
      counts: { activeVaults: 0, activeAccounts: 0, activeCategories: 0, activeSuppliers: 0 },
      issues: ["FINANCE_NOT_INITIALIZED"], standardSuppliers: [{ key: "electricity", nameAr: "الكهرباء", nameEn: "Electricity" }],
    });
    return fulfill(route, {});
  });
}

async function mockTreasury(page: Page) {
  await mockAuthenticatedSession(page, "ar", treasuryPermissions);
  const vaults = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nameAr: "الصندوق", nameEn: "Cash", type: "CASH", paymentMethods: ["CASH"], status: "ACTIVE", isSalesChannel: true, isPaymentDestination: true, sortOrder: 1, openingBalance: "100.0000", balanceAsOf: "100.0000", inflow: "0.0000", outflow: "0.0000" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nameAr: "البنك", nameEn: "Bank", type: "BANK", paymentMethods: ["BANK_TRANSFER"], status: "ACTIVE", isSalesChannel: false, isPaymentDestination: true, sortOrder: 2, openingBalance: "100.0000", balanceAsOf: "100.0000", inflow: "0.0000", outflow: "0.0000" },
  ];
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, availableCompanies(treasuryPermissions));
    if (url.pathname === "/v1/finance/treasury") return fulfill(route, {
      companyId, businessDate: "2026-08-20", asOfBusinessDate: "2026-08-20", fromBusinessDate: null, toBusinessDate: null,
      summary: { openingBalance: "200.0000", balanceAsOf: "200.0000", inflow: "0.0000", outflow: "0.0000", net: "0.0000" },
      groups: [{ key: "OTHER_VAULTS", count: 2, openingBalance: "200.0000", balanceAsOf: "200.0000", inflow: "0.0000", outflow: "0.0000", net: "0.0000" }], vaults,
    });
    if (url.pathname === "/v1/finance/treasury/reconciliations") return fulfill(route, { companyId, items: [], nextCursor: null });
    return fulfill(route, {});
  });
}

async function mockFinancialReads(page: Page, requests: string[]) {
  await mockAuthenticatedSession(page, "ar", ["finance.configuration.read", "finance.purchase_expense.read"]);
  const account = { id: "account-1", code: "1000", nameAr: "النقدية", nameEn: "Cash", type: "ASSET", status: "ACTIVE", isSystem: false, balanceDebit: "10.0000", balanceCredit: "0.0000", periodDebit: "10.0000", periodCredit: "0.0000" };
  const movement = (id: string, reference: string) => ({ id, journalEntryId: `journal-${id}`, businessDate: "2026-08-20", sourceType: "JOURNAL", sourceReference: reference, displayLabelAr: "قيد يومية", displayLabelEn: "Journal", displayReference: reference, description: null, debitAmount: "10.0000", creditAmount: "0.0000", reversalOfEntryId: null, reversalEntryId: null });
  const invoice = (id: string, number: string) => ({ id, source: "OUTFLOW_DOCUMENT", sourceType: "outflow_document", documentNumber: number, displayLabelAr: "فاتورة مشتريات", displayLabelEn: "Purchase invoice", businessDate: "2026-08-20", supplierInvoiceDate: null, kind: "PURCHASE", operationFamily: "PURCHASES", operationClass: "PURCHASE_INVOICE", settlementKind: "PAID", status: "POSTED", supplier: { id: "supplier-1", nameAr: "مورد", nameEn: "Supplier" }, category: { id: "category-1", nameAr: "مواد", nameEn: "Materials" }, parentClassification: null, grossAmount: "10.0000", netAmount: "8.6957", vatAmount: "1.3043", payrollAccrual: null, journalEntryId: "journal-1", batchNumber: null, notes: null, recurring: false, createdAt: "2026-08-20T00:00:00Z" });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/v1/companies/available") return fulfill(route, availableCompanies(["finance.configuration.read", "finance.purchase_expense.read"]));
    if (url.pathname === "/v1/finance/accounts") return fulfill(route, { companyId, asOfBusinessDate: "2026-08-20", fromBusinessDate: null, toBusinessDate: null, summary: { accountCount: 1, periodDebit: "10.0000", periodCredit: "0.0000" }, accounts: [account] });
    if (url.pathname === "/v1/finance/accounts/account-1/movements") {
      const secondPage = url.searchParams.get("cursor") === "account-next";
      return fulfill(route, { account, asOfBusinessDate: "2026-08-20", fromBusinessDate: null, toBusinessDate: null, summary: { balanceDebit: "10.0000", balanceCredit: "0.0000", periodDebit: "10.0000", periodCredit: "0.0000" }, items: [movement(secondPage ? "2" : "1", secondPage ? "JE-2" : "JE-1")], nextCursor: secondPage ? null : "account-next" });
    }
    if (url.pathname === "/v1/finance/invoice-register") {
      const secondPage = url.searchParams.get("cursor") === "invoice-next";
      return fulfill(route, { companyId, appliedPeriod: { fromBusinessDate: null, toBusinessDate: null, businessMonths: [] }, summary: { documentCount: 1, postedCount: 1, cancelledCount: 0, salesCount: 0, purchaseCount: 1, expenseCount: 0, obligationCount: 0, otherCount: 0, paidCount: 1, payableCount: 0 }, filters: { suppliers: [], categories: [] }, records: [invoice(secondPage ? "invoice-2" : "invoice-1", secondPage ? "PUR-002" : "PUR-001")], hasMore: !secondPage, nextCursor: secondPage ? null : "invoice-next" });
    }
    return fulfill(route, {});
  });
}

/** A purchase-entry clerk is deliberately not allowed to read the register or credit workspace. */
async function mockPurchaseEntryClerk(page: Page, requests: string[]) {
  const entryPermissions = ["finance.purchase_expense.create"];
  await mockAuthenticatedSession(page, "ar", entryPermissions);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname === "/v1/companies/available") return fulfill(route, availableCompanies(entryPermissions));
    if (url.pathname === "/v1/finance/purchase-expense-documents/entry-references") return fulfill(route, {
      companyId,
      profile: { vatAccountingEnabled: true, vatRateBasisPoints: 1500 },
      vaults: [{ id: "vault-entry", nameAr: "صندوق الإدخال", nameEn: "Entry cash", type: "CASH", status: "ACTIVE", isPaymentDestination: true, paymentMethod: "CASH", paymentMethods: ["CASH"] }],
      categories: [{ id: "category-entry", nameAr: "مواد تشغيل", nameEn: "Operating materials", kind: "PURCHASE", status: "ACTIVE", isPosting: true, suggestedSupplierId: null }],
      suppliers: [{ id: "supplier-entry", nameAr: "مورد الإدخال", nameEn: "Entry supplier", status: "ACTIVE", categoryId: null, isFavorite: false }],
    });
    return fulfill(route, {});
  });
}


test("finance setup uses the shared Gregorian form and date adapters in RTL", async ({ page }) => {
  await mockFinanceSetup(page, "ar");
  await page.goto("/#module=finance&section=0");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const form = page.locator("[data-baseer-rhf-form]");
  await expect(form).toBeVisible();
  const startDate = form.locator('input[type="text"][aria-label="بداية الفترة"]');
  const endDate = form.locator('input[type="text"][aria-label="نهاية الفترة"]');
  await expect(startDate).toBeVisible();
  await expect(endDate).toBeVisible();
  await expect(startDate).toHaveAttribute("lang", "en");
  await startDate.focus();
  await expect(startDate).toBeFocused();
  await startDate.fill("2026-01-01");
  await expect(startDate).toHaveValue("2026-01-01");

  await form.getByRole("button", { name: "التالي" }).click();
  await expect(form.getByRole("group", { name: "الخزائن والقنوات المبدئية" })).toBeVisible();
  await expect(form.getByRole("checkbox")).toHaveCount(5);
  const accessibility = await new AxeBuilder({ page }).include("[data-baseer-rhf-form]").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("finance setup keeps the Gregorian adapter available in LTR", async ({ page }) => {
  await mockFinanceSetup(page, "en");
  await page.goto("/#module=finance&section=0");

  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator('[data-baseer-rhf-form] input[type="text"][aria-label="Period start"]')).toBeVisible();
});

test("finance settings displays last while old numeric links retain their page identity", async ({ page }) => {
  await mockFinanceSetup(page, "ar", allFinancePermissions);
  await page.goto("/#module=finance&section=0");

  await expect(page).toHaveURL(/#module=finance&page=finance-settings$/);
  let navigation = page.locator(".module-sidebar .theme-navigation");
  if (test.info().project.name === "mobile-chromium") {
    await page.getByRole("button", { name: /الأقسام/ }).click();
    navigation = page.locator(".mobile-drawer .theme-navigation");
  }
  await expect(navigation.getByRole("button")).toHaveText([
    "السجل المالي الموحد",
    "الخزائن والبنوك",
    "الحسابات",
    "الفئات والتصنيفات",
    "إعدادات المالية",
  ]);

  await navigation.getByRole("button", { name: "السجل المالي الموحد" }).click();
  await expect(page).toHaveURL(/#module=finance&page=finance-ledger$/);
});

test("treasury control uses the central form and reports inline validation errors", async ({ page }) => {
  await mockTreasury(page);
  await page.goto("/#module=finance&section=2");

  await page.getByRole("button", { name: "مطابقة وجرد" }).click();
  const dialog = page.getByRole("dialog", { name: "مطابقة وجرد" });
  const form = dialog.locator("[data-baseer-rhf-form]");
  await expect(form).toBeVisible();
  await expect(form).not.toHaveAttribute("aria-busy", "true");
  await dialog.getByRole("button", { name: "تسجيل المطابقة / الجرد" }).click();
  await expect(dialog.getByRole("alert").first()).toBeVisible();
  await expect(dialog.getByLabel("الرصيد الفعلي")).toHaveAttribute("aria-invalid", "true");

  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations).toEqual([]);
});

test("treasury summary presents the server-owned period net rather than an opening-balance card", async ({ page }) => {
  await mockTreasury(page);
  await page.goto("/#module=finance&section=2");

  const summary = page.locator(".treasury-summary-cards");
  await expect(summary.getByText("رصيد إقفال المدة", { exact: true })).toBeVisible();
  await expect(page.locator(".treasury-summary-period-formula")).toHaveText("الوارد − الصادر");
  await expect(summary.getByText("رصيد الافتتاح", { exact: true })).toHaveCount(0);
});

test("accounts and invoice register retain server cursor pagination", async ({ page }) => {
  const requests: string[] = [];
  await mockFinancialReads(page, requests);
  await page.goto("/#module=finance&section=3");

  await page.getByRole("button", { name: "النقدية" }).click();
  const accountDialog = page.getByRole("dialog");
  await expect(accountDialog).toContainText("JE-1");
  await accountDialog.getByRole("button", { name: "المزيد" }).click();
  await expect(accountDialog).toContainText("JE-2");
  expect(requests.some((request) => request.includes("/v1/finance/accounts/account-1/movements") && request.includes("cursor=account-next"))).toBeTruthy();

  await page.goto("/#module=finance&section=1");
  await expect(page.getByText("PUR-001")).toBeVisible();
  await page.getByRole("button", { name: "المزيد" }).click();
  await expect(page.getByText("PUR-002")).toBeVisible();
  expect(requests.some((request) => request.includes("/v1/finance/invoice-register") && request.includes("cursor=invoice-next"))).toBeTruthy();
});

test("invoice-register search uses the authorised full-history period and exposes the central All filter", async ({ page }) => {
  const requests: string[] = [];
  await mockFinancialReads(page, requests);
  await page.goto("/#module=finance&section=1");

  await expect(page.getByText("PUR-001")).toBeVisible();
  await page.locator(".baseer-filter-bar__search input").fill("PUR");
  await expect.poll(() => requests.some((request) => request.includes("/v1/finance/invoice-register") && request.includes("q=PUR") && request.includes("fromBusinessDate=0001-01-01"))).toBeTruthy();

  await page.getByRole("button", { name: "الفلاتر" }).click();
  await page.locator(".baseer-period-filter__trigger").click();
  await page.getByRole("combobox", { name: "نوع الفترة" }).click();
  await expect(page.getByRole("option", { name: "الكل" })).toBeVisible();
});

test("purchase-entry clerk sees and loads only the entry surface", async ({ page, isMobile }) => {
  const requests: string[] = [];
  await mockPurchaseEntryClerk(page, requests);

  await page.goto("/#module=operations&section=2");
  let navigation = page.locator(".module-sidebar .theme-navigation");
  if (isMobile) {
    await page.getByRole("button", { name: /الأقسام/ }).click();
    navigation = page.locator(".mobile-drawer .theme-navigation");
  }
  await navigation.getByText("المشتريات", { exact: true }).click();
  if (isMobile) await page.getByRole("button", { name: "إغلاق" }).click();

  await expect(page.getByRole("tab", { name: "إدخال" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "سجل الفواتير" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "الآجل" })).toHaveCount(0);
  await expect(page.locator(".advance-quick-add")).toHaveCount(0);
  await expect.poll(() => requests.some((request) => request === "GET /v1/finance/purchase-expense-documents/entry-references")).toBeTruthy();
  expect(requests.some((request) => request.includes("/v1/finance/configuration"))).toBeFalsy();
  expect(requests.some((request) => request.includes("/v1/finance/purchase-expense-documents?") || request.endsWith("/v1/finance/purchase-expense-documents"))).toBeFalsy();
  expect(requests.some((request) => request.includes("/v1/finance/purchase-expense-documents/credit-workspace"))).toBeFalsy();
});

test("purchase invoice history renders its server page as a data table, not grouped cards", async ({ page, isMobile }) => {
  const historyPermissions = ["finance.purchase_expense.read"];
  await mockAuthenticatedSession(page, "ar", historyPermissions);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, availableCompanies(historyPermissions));
    if (url.pathname === "/v1/finance/purchase-expense-documents") return fulfill(route, {
      documents: [{ id: "purchase-history-1", documentNumber: "NXR-20260901", kind: "PURCHASE", settlementKind: "PAID", status: "POSTED", businessDate: "2026-09-01", grossAmount: "80.0000", batchNumber: null, supplierNameAr: "مورد الاختبار", supplierNameEn: "Test supplier", supplierId: "supplier-1", categoryId: "category-1", categoryNameAr: "مواد تشغيل", categoryNameEn: "Operating materials", supplierInvoiceNumber: "SUP-001", supplierInvoiceMissingReason: null, supplierInvoiceDate: "2026-09-01", vatRateBasisPoints: 1500, assetWarrantyFollowUp: false, notes: null, postingVersion: 1, allocations: [] }],
      ownerCanAmend: false, hasMore: false, nextCursor: null,
    });
    return fulfill(route, {});
  });

  await page.goto("/#module=operations&section=2");
  if (isMobile) await page.getByRole("button", { name: /الأقسام/ }).click();
  const navigation = isMobile ? page.locator(".mobile-drawer .theme-navigation") : page.locator(".module-sidebar .theme-navigation");
  await navigation.getByText("المشتريات", { exact: true }).click();
  if (isMobile) await page.getByRole("button", { name: "إغلاق" }).click();

  const register = page.getByRole("region", { name: "سجل الفواتير" });
  await expect(register).toBeVisible();
  await expect(register.getByText("NXR-20260901")).toBeVisible();
  await expect(register.locator("table")).toHaveCount(1);
  await expect(page.locator(".purchase-history-day, .purchase-history-day__documents")).toHaveCount(0);
});

test("purchase date calendar escapes the data table and keeps its action clear of the ISO value", async ({ page, isMobile }) => {
  const requests: string[] = [];
  await mockPurchaseEntryClerk(page, requests);

  await page.goto("/#module=operations&section=2");
  let navigation = page.locator(".module-sidebar .theme-navigation");
  if (isMobile) {
    await page.getByRole("button", { name: /الأقسام/ }).click();
    navigation = page.locator(".mobile-drawer .theme-navigation");
  }
  await navigation.getByText("المشتريات", { exact: true }).click();
  if (isMobile) await page.getByRole("button", { name: "إغلاق" }).click();
  const label = isMobile ? "تاريخ القيد" : "تاريخ الفاتورة";
  const input = page.getByRole("textbox", { name: label }).first();
  const trigger = page.getByRole("button", { name: `فتح التقويم: ${label}` }).first();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(trigger).toBeVisible();
  // The mobile drawer closes immediately after navigation. Wait for the
  // post-transition layout box, not only the locator's transient visibility.
  await expect.poll(async () => {
    const [inputBox, triggerBox] = await Promise.all([input.boundingBox(), trigger.boundingBox()]);
    return Boolean(inputBox && triggerBox);
  }).toBe(true);
  const [inputBox, triggerBox] = await Promise.all([input.boundingBox(), trigger.boundingBox()]);
  expect(inputBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  expect(triggerBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width - 96);

  await trigger.click();
  const calendar = page.getByRole("dialog", { name: label });
  await expect(calendar).toBeVisible();
  expect(await calendar.evaluate((element) => element.parentElement === document.body)).toBe(true);
  await page.mouse.click(4, 4);
  await expect(calendar).toHaveCount(0);
});

test("a migration-review lock opens purchase history without requesting a write-only entry read", async ({ page }) => {
  const requests: string[] = [];
  const permissionCodes = ["finance.purchase_expense.create", "finance.purchase_expense.read"];
  await mockAuthenticatedSession(page, "ar", permissionCodes);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname === "/v1/companies/available") return fulfill(route, migrationReviewCompanies(permissionCodes));
    if (url.pathname === "/v1/finance/purchase-expense-documents") return fulfill(route, { documents: [], ownerCanAmend: false });
    if (url.pathname === "/v1/finance/purchase-expense-documents/entry-references") return fulfill(route, { error: { code: "CONFLICT", message: { ar: "يتعارض الطلب مع الحالة الحالية.", en: "Request conflicts with the current state." } } }, 409);
    return fulfill(route, {});
  });

  await page.goto("/#module=operations&section=2");

  await expect(page.getByRole("tab", { name: "سجل الفواتير" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "إدخال" })).toHaveCount(0);
  await expect(page.locator(".advance-quick-add")).toHaveCount(0);
  await expect(page.getByText("إدخال المشتريات مقفل لمراجعة الترحيل")).toBeVisible();
  await expect(page.getByText("يتعارض الطلب مع الحالة الحالية.")).toHaveCount(0);
  expect(requests.some((request) => request.includes("/finance/purchase-expense-documents/entry-references"))).toBeFalsy();
});

import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "44444444-4444-4444-8444-444444444444";

const money = (raw: string) => ({ raw, display: raw, sign: raw.startsWith("-") ? "negative" : raw === "0" ? "zero" : "positive" });

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

/** Deliberate, server-shaped read receipts. Values are display fixtures only. */
async function openFinanceReportsFixture(page: Page) {
  await page.addInitScript((company) => {
    sessionStorage.setItem("baseer.erp.access-token", "finance-reports-theme-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "finance-reports-theme-refresh");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.presentation.v1", "modern-3");
  }, companyId);
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") return fulfill(route, { companies: [{
      id: companyId, nameAr: "شركة عينة المالية", nameEn: "Finance sample company",
      permissionCodes: ["reports.read", "finance.purchase_expense.read", "finance.vaults.read", "finance.configuration.read"],
    }] });
    if (path === "/v1/finance/invoice-register") return fulfill(route, {
      companyId, appliedPeriod: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31", businessMonths: ["2026-08"] },
      summary: { documentCount: 1, postedCount: 1, cancelledCount: 0, salesCount: 1, purchaseCount: 0, expenseCount: 0, obligationCount: 0, otherCount: 0, paidCount: 1, payableCount: 0 },
      filters: { suppliers: [], categories: [] }, hasMore: false, nextCursor: null,
      records: [{ id: "movement-1", source: "DAILY_SALES", sourceType: "DAILY_SALES", documentNumber: "SAL-2026-0001", displayLabelAr: "مبيعات يومية", displayLabelEn: "Daily sales", businessDate: "2026-08-15", supplierInvoiceDate: null, kind: "SALE", operationFamily: "SALES", operationClass: "SALE_COLLECTION", settlementKind: "PAID", status: "POSTED", supplier: null, category: null, parentClassification: null, grossAmount: "1250.00", netAmount: "1086.96", vatAmount: "163.04", payrollAccrual: null, journalEntryId: "journal-1", batchNumber: null, notes: null, recurring: false, createdAt: "2026-08-15T08:00:00.000Z" }],
    });
    if (path === "/v1/finance/treasury/reconciliations") return fulfill(route, { companyId, items: [], nextCursor: null });
    if (path === "/v1/finance/treasury") return fulfill(route, {
      companyId, businessDate: "2026-08-31", asOfBusinessDate: "2026-08-31", fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-31",
      summary: { openingBalance: "0.00", balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00", net: "1250.00" }, groups: [{ key: "COLLECTION_CHANNELS", count: 1, openingBalance: "0.00", balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00" }, { key: "OTHER_VAULTS", count: 0, openingBalance: "0.00", balanceAsOf: "0.00", inflow: "0.00", outflow: "0.00" }, { key: "ARCHIVED", count: 0, openingBalance: "0.00", balanceAsOf: "0.00", inflow: "0.00", outflow: "0.00" }],
      vaults: [{ id: "vault-1", nameAr: "الصندوق الرئيسي", nameEn: "Main cash", type: "CASH", paymentMethods: ["CASH"], status: "ACTIVE", isSalesChannel: true, isPaymentDestination: true, sortOrder: 1, openingBalance: "0.00", balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00", net: "1250.00" }],
    });
    if (path === "/v1/finance/treasury/vault-1/activity") return fulfill(route, { vault: { id: "vault-1", nameAr: "الصندوق الرئيسي", nameEn: "Main cash", type: "CASH", paymentMethods: ["CASH"], status: "ACTIVE", isSalesChannel: true, isPaymentDestination: true, sortOrder: 1, openingBalance: "0.00", balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00", net: "1250.00" }, asOfBusinessDate: "2026-08-31", summary: { openingBalance: "0.00", balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00", net: "1250.00" }, nextCursor: null, items: [{ id: "activity-1", journalEntryId: "journal-1", businessDate: "2026-08-15", sourceType: "DAILY_SALES", sourceReference: "SAL-2026-0001", description: "عينة", counterpartNameAr: null, counterpartNameEn: null, inflow: "1250.00", outflow: "0.00" }] });
    if (path === "/v1/finance/treasury/journal-entries/journal-1") return fulfill(route, { id: "journal-1", sourceType: "DAILY_SALES", sourceReference: "SAL-2026-0001", displayLabelAr: "مبيعات يومية", displayLabelEn: "Daily sales", displayReference: "SAL-2026-0001", businessDate: "2026-08-15", description: "عينة", status: "POSTED", postedAt: "2026-08-15T08:00:00.000Z", reversalOfEntryId: null, reversalEntryId: null, lines: [{ id: "line-1", lineNumber: 1, accountCode: "1000", accountNameAr: "الصندوق", accountNameEn: "Cash", debitAmount: "1250.00", creditAmount: "0.00", description: null }] });
    if (path === "/v1/reports/accrual-profit-loss") {
      const query = new URL(route.request().url()).searchParams;
      const gross = query.get("vatInclusive") === "true";
      const months = query.get("months")?.split(",") ?? [];
      const periodComparison = months.length > 1 ? {
        columns: months.map((key) => ({ key })),
        rows: [
          { statementLineId: "11111111-1111-4111-8111-111111111111", amounts: months.map((_, index) => money(index ? "700.00" : "550.00")) },
          { statementLineId: "22222222-2222-4222-8222-222222222222", amounts: months.map((_, index) => money(index ? "260.00" : "200.00")) },
        ],
        totals: { revenue: months.map((_, index) => money(index ? "700.00" : "550.00")), expenses: months.map((_, index) => money(index ? "260.00" : "200.00")), netProfit: months.map((_, index) => money(index ? "440.00" : "350.00")), salesVat: months.map((_, index) => money(index ? "91.30" : "71.74")) },
        salesByVaultTotals: months.map((_, index) => money(index ? "700.00" : "550.00")),
        salesByVault: [{ vaultId: "vault-1", amounts: months.map((_, index) => money(index ? "700.00" : "550.00")) }],
      } : undefined;
      return fulfill(route, {
        state: "READY", basisLabelAr: gross ? "جميع الإيرادات والمصروفات شاملة الضريبة" : "جميع الإيرادات والمصروفات بدون الضريبة",
        vatInclusive: gross, vatPresentation: { state: "COMPLETE", warningAr: null }, dataCoverage: { state: "COMPLETE", warningAr: null },
        rows: [
          { statementLineId: "11111111-1111-4111-8111-111111111111", code: "REV-001", nameAr: "المبيعات", nameEn: "Sales", section: "REVENUE", amount: money(gross ? "1250.00" : "1086.96"), shareOfRevenuePercent: "100.0000" },
          { statementLineId: "22222222-2222-4222-8222-222222222222", code: "PUR-001", nameAr: "المشتريات", nameEn: "Purchases", section: "EXPENSE", amount: money(gross ? "460.00" : "400.00"), shareOfRevenuePercent: "36.8000" },
        ],
        totals: { revenue: money(gross ? "1250.00" : "1086.96"), expenses: money(gross ? "460.00" : "400.00"), netProfit: money(gross ? "790.00" : "686.96"), revenueShareOfRevenuePercent: "100.0000", expensesShareOfRevenuePercent: "36.8000", netProfitShareOfRevenuePercent: "63.2000" },
        salesByVault: { grossTotal: money("1250.00"), netTotal: money("1086.96"), vatTotal: money("163.04"), displayedTotal: money(gross ? "1250.00" : "1086.96"), shareOfRevenuePercent: "100.0000", rows: [{ vaultId: "vault-1", vaultNameAr: "الصندوق الرئيسي", vaultNameEn: "Main cash", eventCount: 1, displayedAmount: money(gross ? "1250.00" : "1086.96"), shareOfRevenuePercent: "100.0000" }] },
        ...(periodComparison ? { periodComparison } : {}),
      });
    }
    if (path === "/v1/reports/personal-cash-performance") {
      const months = new URL(route.request().url()).searchParams.get("months")?.split(",") ?? [];
      const periodComparison = months.length > 1 ? {
        columns: months.map((key) => ({ key })),
        rows: [{ code: "sales", amounts: months.map((_, index) => money(index ? "700.00" : "550.00")) }],
        netCashResultAmounts: months.map((_, index) => money(index ? "700.00" : "550.00")),
      } : undefined;
      return fulfill(route, {
        state: "READY", selectedPeriod: { from: "2026-08-01", to: "2026-08-31" }, basisLabelAr: "أساس الاستحقاق", company: { displayName: "شركة عينة المالية", functionalCurrency: "SAR" },
        rows: [{ code: "sales", labelAr: "المبيعات المحصلة", labelEn: "Collected sales", kind: "SECTION", parentCode: null, direction: "INFLOW", eventCount: 1, amount: money("1250.00"), shareOfCollectedSalesPercent: "100" }],
        totals: { inflows: money("1250.00"), outflows: money("0"), netCashResult: money("1250.00"), netCashResultShareOfCollectedSalesPercent: "100" },
        ...(periodComparison ? { periodComparison } : {}),
      });
    }
    if (path === "/v1/reports/personal-cash-performance/live/evidence") return fulfill(route, {
      rowCode: "sales", nextCursor: null, items: [{ eventId: "event-1", businessDate: "2026-08-15", direction: "INFLOW", amount: money("1250.00"), source: { journalEntryId: "journal-1", labelAr: "مبيعات يومية", labelEn: "Daily sales", reference: "SAL-2026-0001" } }],
    });
    if (path === "/v1/reports/vat-simulations") return fulfill(route, {
      vatRateBasisPoints: 1500, simulations: [{ id: "vat-1", year: 2026, quarter: 3, vatRateBasisPoints: 1500, salesTaxableAmount: "1000", outputVatAmount: "150", purchasesTaxableAmount: "400", inputVatAmount: "60", priorAdjustments: "0", balanceCarried: "0", paymentTarget: "90", notes: null, sourceLedgerRevision: "rev-1", sourceImportedAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" }],
    });
    return fulfill(route, {});
  });
  await page.goto("/#module=finance&page=finance-ledger");
  await expect(page.locator(".module-page")).toBeVisible();
}

test("finance and reports real read receipts preserve modern admin card, register, VAT and dialog geometry", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mobile coverage is intentionally split into short route cases below.");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFinanceReportsFixture(page);

  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");

    await page.goto("/#module=finance&page=finance-ledger");
    const register = page.locator(".invoice-register-workspace .baseer-data-table");
    await expect(register).toBeVisible();
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe("0px");
    expect(Number.parseFloat(await register.locator("thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(await register.locator("tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);

    await page.goto("/#module=finance&page=finance-treasury");
    const vaultCard = page.locator(".treasury-vault-cards .baseer-card--metric");
    await expect(vaultCard).toHaveCount(1);
    await expect(vaultCard).toBeVisible();
    await expect(page.locator(".baseer-card--joined-ledger")).toBeVisible();
    await vaultCard.locator("summary").click();
    await vaultCard.getByRole("button", { name: "الحركات", exact: true }).click();
    const activityDialog = page.getByRole("dialog");
    await expect(activityDialog).toBeVisible();
    await activityDialog.getByRole("button", { name: "SAL-2026-0001", exact: true }).click();
    await expect(activityDialog.getByRole("heading", { name: "سطور القيد", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();

    await page.goto("/#module=reports&page=reports-financial&stage=cash-performance");
    const financialTable = page.locator(".reports-prototype__table");
    await expect(financialTable).toBeVisible();
    await expect.poll(() => financialTable.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    const rowButton = page.locator(".reports-prototype__row-label-button", { hasText: "المبيعات المحصلة" });
    await rowButton.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    await rowButton.click();
    const detailDialog = page.getByRole("dialog");
    await expect(detailDialog).toBeVisible();
    await expect.poll(() => detailDialog.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe("0px");
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();

    await page.goto("/#module=reports&page=reports-hajri-tax");
    const vatCard = page.locator(".vat-simulation-workspace__overview.baseer-card--joined-ledger");
    await expect(vatCard).toBeVisible();
    await expect(page.locator(".vat-simulation-workspace__overview-table")).toBeVisible();
    await expect.poll(() => vatCard.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    expect(Number.parseFloat(await page.locator(".vat-simulation-workspace__overview-table thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(await page.locator(".vat-simulation-workspace__overview-table tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);
    await page.locator(".vat-simulation-workspace__overview-table button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();
    if (isMobile) await expect(page.locator(".vat-simulation-workspace__overview-table")).toHaveCSS("overflow-x", "auto");
  expect(pageErrors).toEqual([]);
});

test("mobile fixture: ledger register and treasury cards retain their modern admin semantic variants", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This is the narrow mobile route case.");
  await openFinanceReportsFixture(page);
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
    await page.goto("/#module=finance&page=finance-ledger");
    const register = page.locator(".invoice-register-workspace .baseer-data-table");
    await expect(register).toBeVisible();
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe("0px");
    expect(Number.parseFloat(await register.locator("thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(await register.locator("tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);
    await page.goto("/#module=finance&page=finance-treasury");
    const vault = page.locator(".treasury-vault-cards .baseer-card--metric");
    await expect(vault).toBeVisible();
    await expect(page.locator(".baseer-card--joined-ledger")).toBeVisible();
    await vault.locator("summary").click();
    await vault.getByRole("button", { name: "الحركات", exact: true }).click();
    const activityDialog = page.getByRole("dialog");
    await expect(activityDialog).toBeVisible();
    await activityDialog.getByRole("button", { name: "SAL-2026-0001", exact: true }).click();
    await expect(activityDialog.getByRole("heading", { name: "سطور القيد", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();
});

test("mobile fixture: financial report opens a bounded RTL modern admin detail dialog", async ({ page, isMobile }) => {
  test.setTimeout(12_000);
  test.skip(!isMobile, "This is the narrow mobile route case.");
  await openFinanceReportsFixture(page);
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
    await page.goto("/#module=reports&page=reports-financial&stage=cash-performance");
    const table = page.locator(".reports-prototype__table");
    await expect(table).toBeVisible();
    await expect.poll(() => table.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    const rowButton = page.locator(".reports-prototype__row-label-button", { hasText: "المبيعات المحصلة" });
    await rowButton.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    await rowButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe("0px");
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();
});

test("mobile fixture: VAT register remains horizontally contained in the modern admin interface", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This is the narrow mobile route case.");
  await openFinanceReportsFixture(page);
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
    await page.goto("/#module=reports&page=reports-hajri-tax");
    const overview = page.locator(".vat-simulation-workspace__overview.baseer-card--joined-ledger");
    const table = page.locator(".vat-simulation-workspace__overview-table");
    await expect(overview).toBeVisible();
    await expect.poll(() => overview.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    await expect(table).toBeVisible();
    await expect(table).toHaveCSS("overflow-x", "auto");
    expect(Number.parseFloat(await table.locator("thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(await table.locator("tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart))).toBeGreaterThanOrEqual(8);
    await table.locator("button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();
});

test("profit and loss applies the VAT basis to the complete statement and preserves vault detail", async ({ page }) => {
  await openFinanceReportsFixture(page);
  await page.goto("/#module=reports&page=reports-financial&stage=accrual-profit-loss");

  const report = page.locator(".reports-prototype__table");
  const vatToggle = page.getByRole("checkbox", { name: "شامل الضريبة" });
  await expect(report).toBeVisible();
  await expect(vatToggle).toBeChecked();

  await expect(report.getByRole("row", { name: /إجمالي الإيرادات/ })).toContainText("1250.00");
  await expect(report.getByRole("row", { name: /المبيعات/ }).first()).toContainText("1250.00");
  await expect(report.getByRole("row", { name: /إجمالي المصروفات/ })).toContainText("460.00");
  await expect(report.getByRole("row", { name: /المشتريات/ })).toContainText("460.00");
  await expect(report.getByRole("row", { name: /صافي الربح أو الخسارة/ })).toContainText("790.00");
  await expect(report.getByRole("row", { name: /إيرادات المبيعات حسب الخزينة/ })).toContainText("1250.00");
  await expect(report.getByRole("row", { name: /الصندوق الرئيسي/ })).toContainText("1250.00");
  await expect(report.getByRole("row", { name: /ضريبة المبيعات ضمن التحصيل/ })).toContainText("163.04");

  await vatToggle.uncheck();
  await expect(report.getByRole("row", { name: /إجمالي الإيرادات/ })).toContainText("1086.96");
  await expect(report.getByRole("row", { name: /المبيعات/ }).first()).toContainText("1086.96");
  await expect(report.getByRole("row", { name: /إجمالي المصروفات/ })).toContainText("400.00");
  await expect(report.getByRole("row", { name: /المشتريات/ })).toContainText("400.00");
  await expect(report.getByRole("row", { name: /صافي الربح أو الخسارة/ })).toContainText("686.96");
  await expect(report.getByRole("row", { name: /إيرادات المبيعات حسب الخزينة/ })).toContainText("1086.96");
  await expect(report.getByRole("row", { name: /الصندوق الرئيسي/ })).toContainText("1086.96");
  await expect(report.getByRole("row", { name: /ضريبة المبيعات ضمن التحصيل/ })).toHaveCount(0);
});

test("profit and loss shows selected months beside the server-owned total", async ({ page }) => {
  await openFinanceReportsFixture(page);
  await page.goto("/#module=reports&page=reports-financial&stage=accrual-profit-loss");

  const report = page.locator(".reports-prototype__table");
  await expect(report).toBeVisible();
  await page.locator(".baseer-period-filter__trigger").click();
  const period = page.getByRole("dialog", { name: "اختيار الفترة" });
  await period.getByRole("combobox", { name: "نوع الفترة" }).click();
  await page.getByRole("option", { name: "شهر", exact: true }).click();
  await period.getByRole("spinbutton", { name: "السنة" }).fill("2026");

  const months = period.locator(".baseer-period-filter__months button");
  const selectedMonths = period.locator(".baseer-period-filter__months button[aria-pressed='true']");
  await expect(selectedMonths).toHaveCount(1);
  await months.nth(6).click();
  await expect(selectedMonths).toHaveCount(2);
  await selectedMonths.nth(1).click();
  await expect(selectedMonths).toHaveCount(1);
  await months.nth(7).click();
  await period.getByRole("button", { name: "تطبيق", exact: true }).click();

  await expect(report.getByRole("columnheader")).toHaveCount(5);
  await expect(report.getByRole("columnheader", { name: "المجموع", exact: true })).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "من الإيرادات", exact: true })).toBeVisible();
  await expect(report.getByRole("row", { name: /إجمالي الإيرادات/ })).toContainText("550.00");
  await expect(report.getByRole("row", { name: /إجمالي الإيرادات/ })).toContainText("700.00");
  await expect(report.getByRole("row", { name: /إجمالي الإيرادات/ })).toContainText("1250.00");
});

test("cash movement shows selected months beside the server-owned total", async ({ page }) => {
  await openFinanceReportsFixture(page);
  await page.goto("/#module=reports&page=reports-financial&stage=cash-performance");

  const report = page.locator(".reports-prototype__table");
  await expect(report).toBeVisible();
  await page.locator(".baseer-period-filter__trigger").click();
  const period = page.getByRole("dialog", { name: "اختيار الفترة" });
  await period.getByRole("combobox", { name: "نوع الفترة" }).click();
  await page.getByRole("option", { name: "شهر", exact: true }).click();
  await period.getByRole("spinbutton", { name: "السنة" }).fill("2026");

  const months = period.locator(".baseer-period-filter__months button");
  const selectedMonths = period.locator(".baseer-period-filter__months button[aria-pressed='true']");
  await expect(selectedMonths).toHaveCount(1);
  await months.nth(6).click();
  await expect(selectedMonths).toHaveCount(2);
  await selectedMonths.nth(1).click();
  await months.nth(7).click();
  await period.getByRole("button", { name: "تطبيق", exact: true }).click();

  await expect(report.getByRole("columnheader")).toHaveCount(5);
  await expect(report.getByRole("columnheader", { name: "المجموع", exact: true })).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "من المبيعات", exact: true })).toBeVisible();
  await expect(report.getByRole("row", { name: /المبيعات المحصلة/ })).toContainText("550.00");
  await expect(report.getByRole("row", { name: /المبيعات المحصلة/ })).toContainText("700.00");
  await expect(report.getByRole("row", { name: /المبيعات المحصلة/ })).toContainText("1250.00");
});

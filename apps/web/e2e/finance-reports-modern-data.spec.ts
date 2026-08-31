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
    localStorage.setItem("baseer-erp.shell.presentation.v1", "modern-1");
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
      summary: { balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00", net: "1250.00" }, groups: [{ key: "COLLECTION_CHANNELS", count: 1, balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00" }, { key: "OTHER_VAULTS", count: 0, balanceAsOf: "0.00", inflow: "0.00", outflow: "0.00" }, { key: "ARCHIVED", count: 0, balanceAsOf: "0.00", inflow: "0.00", outflow: "0.00" }],
      vaults: [{ id: "vault-1", nameAr: "الصندوق الرئيسي", nameEn: "Main cash", type: "CASH", paymentMethods: ["CASH"], status: "ACTIVE", isSalesChannel: true, isPaymentDestination: true, sortOrder: 1, balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00" }],
    });
    if (path === "/v1/finance/treasury/vault-1/activity") return fulfill(route, { vault: { id: "vault-1", nameAr: "الصندوق الرئيسي", nameEn: "Main cash", type: "CASH", paymentMethods: ["CASH"], status: "ACTIVE", isSalesChannel: true, isPaymentDestination: true, sortOrder: 1, balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00" }, asOfBusinessDate: "2026-08-31", summary: { balanceAsOf: "1250.00", inflow: "1250.00", outflow: "0.00" }, nextCursor: null, items: [{ id: "activity-1", journalEntryId: "journal-1", businessDate: "2026-08-15", sourceType: "DAILY_SALES", sourceReference: "SAL-2026-0001", description: "عينة", counterpartNameAr: null, counterpartNameEn: null, inflow: "1250.00", outflow: "0.00" }] });
    if (path === "/v1/finance/treasury/journal-entries/journal-1") return fulfill(route, { id: "journal-1", sourceType: "DAILY_SALES", sourceReference: "SAL-2026-0001", displayLabelAr: "مبيعات يومية", displayLabelEn: "Daily sales", displayReference: "SAL-2026-0001", businessDate: "2026-08-15", description: "عينة", status: "POSTED", postedAt: "2026-08-15T08:00:00.000Z", reversalOfEntryId: null, reversalEntryId: null, lines: [{ id: "line-1", lineNumber: 1, accountCode: "1000", accountNameAr: "الصندوق", accountNameEn: "Cash", debitAmount: "1250.00", creditAmount: "0.00", description: null }] });
    if (path === "/v1/reports/personal-cash-performance") return fulfill(route, {
      state: "READY", selectedPeriod: { from: "2026-08-01", to: "2026-08-31" }, basisLabelAr: "أساس الاستحقاق", company: { displayName: "شركة عينة المالية", functionalCurrency: "SAR" },
      rows: [{ code: "sales", labelAr: "المبيعات المحصلة", labelEn: "Collected sales", kind: "SECTION", parentCode: null, direction: "INFLOW", eventCount: 1, amount: money("1250.00"), shareOfCollectedSalesPercent: "100" }],
      totals: { inflows: money("1250.00"), outflows: money("0"), netCashResult: money("1250.00"), netCashResultShareOfCollectedSalesPercent: "100" },
    });
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

async function selectPresentation(page: Page, presentation: "modern-1" | "modern-2") {
  await page.locator(".interface-theme-control select").selectOption(presentation);
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", presentation);
}

test("finance and reports real read receipts preserve modern card, register, VAT and dialog geometry", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mobile coverage is intentionally split into short route cases below.");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFinanceReportsFixture(page);

  for (const presentation of ["modern-1", "modern-2"] as const) {
    await selectPresentation(page, presentation);
    const expectedRadius = presentation === "modern-1" ? "18px" : "5px";

    await page.goto("/#module=finance&page=finance-ledger");
    const register = page.locator(".invoice-register-workspace .baseer-data-table");
    await expect(register).toBeVisible();
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(expectedRadius);
    await expect.poll(() => register.locator("thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("11px");
    await expect.poll(() => register.locator("tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("12px");

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
    await expect.poll(() => detailDialog.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(presentation === "modern-1" ? "17.6px" : "5px");
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();

    await page.goto("/#module=reports&page=reports-hajri-tax");
    const vatCard = page.locator(".vat-simulation-workspace__overview.baseer-card--joined-ledger");
    await expect(vatCard).toBeVisible();
    await expect(page.locator(".vat-simulation-workspace__overview-table")).toBeVisible();
    await expect.poll(() => vatCard.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    await expect.poll(() => page.locator(".vat-simulation-workspace__overview-table thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("12px");
    await expect.poll(() => page.locator(".vat-simulation-workspace__overview-table tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("12px");
    await page.locator(".vat-simulation-workspace__overview-table button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();
    if (isMobile) await expect(page.locator(".vat-simulation-workspace__overview-table")).toHaveCSS("overflow-x", "auto");
  }
  expect(pageErrors).toEqual([]);
});

test("mobile fixture: ledger register and treasury cards retain their semantic variants", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This is the narrow mobile route case.");
  await openFinanceReportsFixture(page);
  for (const presentation of ["modern-1", "modern-2"] as const) {
    await selectPresentation(page, presentation);
    await page.goto("/#module=finance&page=finance-ledger");
    const register = page.locator(".invoice-register-workspace .baseer-data-table");
    await expect(register).toBeVisible();
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    await expect.poll(() => register.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(presentation === "modern-1" ? "18px" : "5px");
    await expect.poll(() => register.locator("thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("11px");
    await expect.poll(() => register.locator("tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("12px");
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
  }
});

test("mobile fixture: financial report opens a bounded RTL detail dialog", async ({ page, isMobile }) => {
  test.setTimeout(12_000);
  test.skip(!isMobile, "This is the narrow mobile route case.");
  await openFinanceReportsFixture(page);
  for (const presentation of ["modern-1", "modern-2"] as const) {
    await selectPresentation(page, presentation);
    await page.goto("/#module=reports&page=reports-financial&stage=cash-performance");
    const table = page.locator(".reports-prototype__table");
    await expect(table).toBeVisible();
    await expect.poll(() => table.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    const rowButton = page.locator(".reports-prototype__row-label-button", { hasText: "المبيعات المحصلة" });
    await rowButton.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    await rowButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(presentation === "modern-1" ? "17.6px" : "5px");
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();
  }
});

test("mobile fixture: VAT register remains horizontally contained", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This is the narrow mobile route case.");
  await openFinanceReportsFixture(page);
  for (const presentation of ["modern-1", "modern-2"] as const) {
    await selectPresentation(page, presentation);
    await page.goto("/#module=reports&page=reports-hajri-tax");
    const overview = page.locator(".vat-simulation-workspace__overview.baseer-card--joined-ledger");
    const table = page.locator(".vat-simulation-workspace__overview-table");
    await expect(overview).toBeVisible();
    await expect.poll(() => overview.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
    await expect(table).toBeVisible();
    await expect(table).toHaveCSS("overflow-x", "auto");
    await expect.poll(() => table.locator("thead th").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("12px");
    await expect.poll(() => table.locator("tbody td").first().evaluate((element) => getComputedStyle(element).paddingBlockStart)).toBe("12px");
    await table.locator("button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "إغلاق", exact: true }).last().click();
  }
});

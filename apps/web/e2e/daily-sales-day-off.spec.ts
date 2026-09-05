import { expect, test, type Route } from "@playwright/test";

const companyId = "66666666-6666-4666-8666-666666666666";
const permissions = ["finance.daily_sales.read", "finance.daily_sales.write"];

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
}

test("day-off dialog submits one atomic Eid date range through Baseer controls", async ({ page }) => {
  let rangeRequest: Record<string, unknown> | null = null;
  await page.addInitScript(({ company, granted }) => {
    sessionStorage.setItem("baseer.erp.access-token", "daily-sales-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "daily-sales-refresh");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer.e2e.permission-codes", JSON.stringify(granted));
  }, { company: companyId, granted: permissions });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test company", permissionCodes: permissions }] });
    if (url.pathname === "/v1/finance/daily-sales/workspace") return fulfill(route, {
      companyId, fromBusinessDate: "2026-09-01", toBusinessDate: "2026-09-05", permissionCodes: permissions, ownerCanCorrect: false,
      entryDate: { businessDate: "2026-09-05", timezone: "Asia/Riyadh" }, vaults: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nameAr: "الصندوق", nameEn: "Cash", type: "CASH", isSalesChannel: true }],
      historyLimit: 50, closings: [], hasMore: false, nextCursor: null, cashHandovers: { totalCashHandoverAmount: "0.0000", recordCount: 0, handovers: [] }, shifts: [],
    });
    if (url.pathname === "/v1/finance/operational-calendar/day-ranges") {
      rangeRequest = route.request().postDataJSON() as Record<string, unknown>;
      return fulfill(route, { days: [
        { businessDate: "2026-09-02", status: "CLOSED", source: "HOLIDAY", dataStatus: "CLOSED" },
        { businessDate: "2026-09-03", status: "CLOSED", source: "HOLIDAY", dataStatus: "CLOSED" },
      ] });
    }
    return fulfill(route, {});
  });

  await page.goto("/#module=operations&page=operations-sales");
  await page.getByRole("button", { name: "إدخال ملخص" }).click();
  await page.getByRole("dialog", { name: "إدخال ملخص" }).getByRole("button", { name: "بدون عمل اليوم" }).click();
  const dialog = page.getByRole("dialog", { name: "تسجيل يوم بدون عمل" });
  await expect(dialog.getByRole("heading", { name: "تسجيل يوم بدون عمل" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "من تاريخ" }).fill("2026-09-02");
  await dialog.getByRole("textbox", { name: "إلى تاريخ" }).fill("2026-09-03");
  await dialog.getByRole("combobox", { name: "سبب عدم العمل" }).click();
  await page.getByRole("option", { name: "عيد", exact: true }).click();
  await dialog.getByRole("button", { name: "حفظ أيام بدون عمل" }).click();

  await expect.poll(() => rangeRequest).not.toBeNull();
  expect(rangeRequest).toMatchObject({
    fromBusinessDate: "2026-09-02",
    toBusinessDate: "2026-09-03",
    status: "CLOSED",
    source: "HOLIDAY",
  });
  expect(String(rangeRequest?.note)).toContain("EID");
});

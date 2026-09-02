import { expect, test, type Page } from "@playwright/test";

const portalProfile = {
  companyId: "11111111-1111-4111-8111-111111111111",
  employeeId: "22222222-2222-4222-8222-222222222222",
  employeeNumber: "EMP-001",
  employeeNameAr: "موظف الحضور",
  employeeNameEn: "Attendance Employee",
  businessDate: "2026-08-31",
  state: "READY",
  commitment: { score: 92, plannedMinutes: 9600, shortageMinutes: 120, evaluatedDays: 20 },
  schedule: [
    { businessDate: "2026-09-01", source: "TEMPLATE", kind: "CUSTOM_PERIODS", periods: [{ startTime: "09:00", endTime: "17:00", endsNextDay: false, minutes: 480 }] },
    { businessDate: "2026-09-02", source: "WEEKLY_ADJUSTMENT", kind: "FULL_REST", periods: [] },
  ],
} as const;

async function preparePwa(page: Page) {
  await page.addInitScript((selectedPresentation) => {
    localStorage.setItem("baseer-erp.shell.presentation.v1", selectedPresentation);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
  }, "modern-1");
  await page.route("**/attendance/portal/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ accessToken: "attendance-e2e-token", expiresAt: "2099-01-01T00:00:00.000Z", profile: portalProfile }),
    });
  });
}

test("attendance PWA migrates legacy presentation preferences and stays contained", async ({ page, isMobile }) => {
    await preparePwa(page);
    await page.goto("/#attendance?tenant=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&company=11111111-1111-4111-8111-111111111111");

    await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
    await expect(page.locator("body")).toHaveAttribute("data-color-palette", "calm-green");
    await expect(page.locator(".attendance-pwa")).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".attendance-pwa__card")).toBeVisible();
    await expect(page.locator(".module-sidebar")).toHaveCount(0);
    const shape = await page.locator(".attendance-pwa__card").evaluate((element) => Number.parseFloat(getComputedStyle(element).borderRadius));
    expect(shape).toBeGreaterThan(0);

    await page.getByRole("button", { name: "دخول حسابي" }).click();
    const dialog = page.getByRole("dialog", { name: "دخول حسابي" });
    await dialog.getByLabel("الكود الشخصي").fill("1234");
    await dialog.getByRole("button", { name: "دخول" }).click();
    await expect(page.getByRole("heading", { name: "موظف الحضور" })).toBeVisible();
    await expect(page.getByLabel("دوام الأسبوع")).toContainText("09:00–17:00");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (isMobile) await expect(page.locator(".attendance-pwa__card")).toBeVisible();
});

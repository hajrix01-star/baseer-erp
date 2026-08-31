import { expect, test, type Page, type Route } from "@playwright/test";

const companyId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const employee = {
  id: employeeId, employeeNumber: "EMP-001", nameAr: "موظف الاختبار", nameEn: "Test Employee", jobTitle: "محاسب",
  phone: null, email: null, iqamaNumber: "1234567890", workSchedule: null, hireDate: "2024-01-01",
  currentMonthlyGross: "3000.0000", profilePhotoVersionId: null, status: "ACTIVE", terminatedAt: null, notes: null,
};
const detail = {
  companyId, employee,
  compensation: { id: "compensation-1", employeeId, effectiveFrom: "2024-01-01", effectiveTo: null, monthlyGross: "3000.0000", policyVersionId: null, compensationMethod: "FIXED_MONTHLY", foodAllowance: "0.0000", housingAllowance: "0.0000", transportAllowance: "0.0000", otherAllowance: "0.0000", scheduledHoursPerDay: null, scheduledWorkDays: null, notes: null },
  compensationHistory: [], compensationHistoryCount: 4,
  // HrEmployeeProfileSummary is part of the employee-file API contract even
  // when this focused fixture grants no payroll/leave/document permissions.
  profileSummary: { payrollRunCount: 0, advanceCount: 0, openAdvanceCount: 0, openAdvanceBalance: "0.0000", leaveCount: 0, documentCount: 0, promotionCount: 0 },
  services: [], serviceCount: 2, servicesHasMore: false,
  movements: [], movementCount: 3, hasMoreMovements: false, nextMovementCursor: null,
};

async function fulfill(route: Route, body: unknown) {
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
}

async function prepareEmployeeProfile(page: Page, presentation: "modern-1" | "modern-2") {
  await page.addInitScript(({ company, selectedPresentation }) => {
    sessionStorage.setItem("baseer.erp.access-token", "hr-profile-e2e-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "hr-profile-e2e-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.presentation.v1", selectedPresentation);
  }, { company: companyId, selectedPresentation: presentation });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/companies/available") return fulfill(route, { companies: [{ id: companyId, nameAr: "شركة الاختبار", nameEn: "Test Company", permissionCodes: ["hr.employees.read", "hr.employees.write"] }] });
    if (path === "/v1/hr/employees" && route.request().method() === "GET") return fulfill(route, { companyId, employees: [employee], hasMore: false, nextCursor: null, summary: { activeEmployees: 1, employeesOnLeave: 0, openAdvances: 0, openAdministrativeDeductions: 0 } });
    if (path === `/v1/hr/employees/${employeeId}`) return fulfill(route, detail);
    if (path === `/v1/attendance/employees/${employeeId}/schedule`) return fulfill(route, { employeeId, assignments: [], weeklyAdjustments: [], exceptions: [] });
    if (path === "/v1/attendance/schedule-templates") return fulfill(route, { templates: [] });
    if (path === `/v1/attendance/employees/${employeeId}/pin`) return fulfill(route, { employeeId, state: "NOT_SET", pin: null });
    return fulfill(route, {});
  });
}

for (const presentation of ["modern-1", "modern-2"] as const) {
  test(`employee file route stays semantic and contained in ${presentation}`, async ({ page, isMobile }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await prepareEmployeeProfile(page, presentation);
    await page.goto(`/#module=hr&page=hr-employees&stage=employee-${employeeId}`);

    const profile = page.getByRole("region", { name: "موظف الاختبار" });
    await expect(page.locator("body")).toHaveAttribute("data-ui-theme", presentation);
    await expect(page).toHaveURL(new RegExp(`stage=employee-${employeeId}`));
    await expect(page.locator("#root")).not.toHaveText("جارٍ التحميل…", { timeout: 15_000 });
    await expect(profile).toBeVisible({ timeout: 15_000 }).catch(async (error) => {
      const rendered = await page.locator("#root").innerText();
      throw new Error(`Employee profile did not render. Page errors: ${pageErrors.join(" | ") || "(none)"}. Root content: ${rendered || "(empty)"}\n${error.message}`);
    });
    expect(pageErrors).toEqual([]);
    await expect(profile.getByText("بيانات العمل")).toBeVisible();
    // Only the two metrics available to the focused employee-read role may
    // render; richer HR metrics must stay permission-gated.
    await expect(profile.locator(".baseer-metric")).toHaveCount(2);
    const measurement = await profile.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { right: box.right, viewportWidth: innerWidth, localOverflow: element.scrollWidth - element.clientWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(measurement.right).toBeLessThanOrEqual(measurement.viewportWidth + 1);
    expect(measurement.localOverflow).toBeLessThanOrEqual(1);
    expect(measurement.pageOverflow).toBeLessThanOrEqual(1);
    if (isMobile) await expect(profile.getByRole("tablist", { name: "أقسام ملف الموظف" })).toBeVisible();
  });
}

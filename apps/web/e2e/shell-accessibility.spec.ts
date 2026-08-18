import { expect, test } from "@playwright/test";

test("sign-in is keyboard reachable and switches Arabic/English", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "مرحباً بك في بصير" })).toBeVisible();
  const username = page.getByRole("textbox", { name: "البريد الإلكتروني أو اسم المستخدم" });
  await username.focus();
  await expect(username).toBeFocused();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Baseer" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("sign-in exposes labelled password controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "كلمة المرور" })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "إظهار" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toBeVisible();
});

test("sign-in remains usable on mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This is covered by the mobile project.");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "مرحباً بك في بصير" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toBeVisible();
});

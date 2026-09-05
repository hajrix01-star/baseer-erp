import { expect, test } from "@playwright/test";

test("public privacy page is bilingual and never starts an ERP API request", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/v1/")) apiRequests.push(`${request.method()} ${url.pathname}`);
  });

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "سياسة الخصوصية" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("link", { name: "شروط الاستخدام" })).toHaveAttribute("href", "/terms");
  await expect.poll(() => apiRequests).toEqual([]);

  await page.getByRole("button", { name: "English" }).first().click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
});

test("public terms page links back to privacy without rendering sign-in", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "شروط الاستخدام" })).toBeVisible();
  await expect(page.getByRole("link", { name: "سياسة الخصوصية" })).toHaveAttribute("href", "/privacy");
  await expect(page.getByRole("heading", { name: "مرحباً بك في بصير" })).toHaveCount(0);
});

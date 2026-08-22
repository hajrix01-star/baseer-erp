import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoWcagAAIssues(page: Page) {
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(report.violations).toEqual([]);
}

test("sign-in meets automated WCAG A/AA checks in Arabic and English", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "مرحباً بك في بصير" })).toBeVisible();
  await expectNoWcagAAIssues(page);

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Baseer" })).toBeVisible();
  await expectNoWcagAAIssues(page);
});

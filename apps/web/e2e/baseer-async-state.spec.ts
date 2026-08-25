import { expect, test, type Page } from "@playwright/test";

type AsyncStatus = "ready" | "loading" | "empty" | "error" | "stale";

async function mountAsyncState(page: Page, status: AsyncStatus, language: "ar" | "en" = "en") {
  await page.goto("/");
  await page.evaluate(async ({ nextStatus, nextLanguage }) => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDomClient } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { BaseerAsyncState } = await import("/src/baseer-async-state.tsx");
    const mount = document.createElement("main");
    mount.id = "baseer-async-state-harness";
    document.body.replaceChildren(mount);
    const onRetry = () => { document.body.dataset.baseerAsyncRetried = "true"; };
    ReactDomClient.createRoot(mount).render(React.createElement(BaseerAsyncState, {
      status: nextStatus,
      language: nextLanguage,
      title: nextStatus === "empty" ? "No matching records" : undefined,
      onRetry: nextStatus === "error" ? onRetry : undefined,
      children: React.createElement("p", null, nextStatus === "ready" ? "Ready content" : "Retained content"),
    }));
  }, { nextStatus: status, nextLanguage: language });
}

test("BaseerAsyncState exposes accessible loading, empty, error, stale and ready contracts", async ({ page }) => {
  await mountAsyncState(page, "loading", "ar");
  await expect(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status")).toContainText("جارٍ تحميل البيانات");

  await mountAsyncState(page, "empty");
  await expect(page.getByRole("status")).toContainText("No matching records");

  await mountAsyncState(page, "error");
  await expect(page.getByRole("alert")).toContainText("The data could not be loaded.");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.baseerAsyncRetried)).toBe("true");

  await mountAsyncState(page, "stale");
  await expect(page.getByRole("status")).toContainText("The displayed data may be out of date.");
  await expect(page.getByText("Retained content")).toBeVisible();

  await mountAsyncState(page, "ready");
  await expect(page.getByText("Ready content")).toBeVisible();
  await expect(page.locator("[data-baseer-async-state]")).toHaveCount(0);
});

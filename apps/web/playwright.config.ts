import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.BASEER_E2E_PORT ?? 5191);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  // GitHub's hosted runner provides two cores; the default CI allocation is
  // one worker, which makes the full cross-device acceptance suite exceed the
  // release gate before it can return a useful result.
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `npm run dev --workspace @baseer-erp/web -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !process.env.BASEER_E2E_PORT,
    timeout: 30_000,
  },
});

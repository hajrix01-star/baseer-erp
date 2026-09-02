import { expect, test, type Page, type Route } from "@playwright/test";

import { pageRegistry } from "../src/page-registry";

/**
 * Broad-permission visual matrix.
 *
 * This deliberately does not manufacture successful domain reads.  A route
 * whose endpoint does not have a faithful fixture receives an explicit 403
 * receipt, and the test attaches every such endpoint to its report.  That
 * keeps the shell/content error state observable without claiming that an
 * unprepared API surface has real data coverage.
 */
const companyId = "77777777-7777-4777-8777-777777777777";
const palettes = ["calm-green", "editorial-copper", "modern-admin"] as const;
const representativePageIds = new Set([
  "command-money-marketing",
  "decision-overview",
  "marketing-overview",
  "evidence-overview",
  "operations-overview",
  "finance-ledger",
  "hr-overview",
  "reports-overview",
  "administration-overview",
]);

type Palette = (typeof palettes)[number];

function broadPermissionCodes() {
  return [...new Set(pageRegistry.flatMap((entry) => {
    const rule = entry.requiredPermissions;
    return Array.isArray(rule) ? rule : rule.allOf;
  }))].sort();
}

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function prepareVisualMatrix(page: Page, palette: Palette) {
  const unpreparedReads = new Set<string>();
  await page.addInitScript(({ company, selectedPalette }) => {
    sessionStorage.setItem("baseer.erp.access-token", "visual-matrix-access-token");
    sessionStorage.setItem("baseer.erp.refresh-token", "visual-matrix-refresh-token");
    sessionStorage.setItem("baseer.erp.session-expires-at", "2099-01-01T00:00:00.000Z");
    sessionStorage.setItem("baseer.erp.company-id", company);
    localStorage.setItem("baseer.ui.locale.v1", "ar");
    localStorage.setItem("baseer-erp.shell.presentation.v1", "modern-3");
    localStorage.setItem("baseer-erp.shell.color-palette.v1", selectedPalette);
    localStorage.setItem("baseer-erp.shell.appearance.v1", "light");
  }, { company: companyId, selectedPalette: palette });

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/companies/available") {
      return fulfill(route, {
        companies: [{
          id: companyId,
          nameAr: "شركة مصفوفة العرض",
          nameEn: "Visual matrix company",
          isOwner: true,
          permissionCodes: broadPermissionCodes(),
        }],
      });
    }

    // This is intentionally a denied receipt rather than `{}`/200.  It makes
    // missing endpoint fixtures visible in the rendered route and report.
    if (request.method() === "GET") unpreparedReads.add(`${request.method()} ${url.pathname}`);
    return fulfill(route, {
      error: {
        code: "TEST_ENDPOINT_NOT_PREPARED",
        message: {
          ar: "قراءة هذه الصفحة غير محضرة في مصفوفة القبول المرئي.",
          en: "This page read is not prepared by the visual acceptance matrix.",
        },
      },
    }, request.method() === "GET" ? 403 : 405);
  });

  return unpreparedReads;
}

async function assertCommonVisualContract(page: Page, palette: Palette, isMobile: boolean) {
  await expect(page.locator("body")).toHaveAttribute("data-ui-theme", "modern-3");
  await expect(page.locator("body")).toHaveAttribute("data-color-palette", palette);
  await expect(page.locator("main.workspace")).toBeVisible();
  await expect(page.locator(".module-page")).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  if (isMobile) {
    await expect(page.getByRole("button", { name: /الأقسام/ })).toBeVisible();
  } else {
    await expect(page.locator(".module-sidebar")).toBeVisible();
    await expect(page.locator(".theme-navigation--tree")).toBeVisible();
  }

  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewport;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className || null,
          id: element.id || null,
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          scrollWidth: element.scrollWidth,
        };
      })
      .filter((element) => element.right > viewport + 1 || element.left < -1)
      .slice(0, 20);
    return { viewport, overflow, offenders };
  });
}

for (const palette of palettes) {
  for (const entry of pageRegistry) {
    test(`${palette} visual matrix: ${entry.id}`, async ({ page, isMobile }, testInfo) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const unpreparedReads = await prepareVisualMatrix(page, palette);

      await page.goto(`/#module=${entry.moduleId}&page=${entry.id}`);
      const overflow = await assertCommonVisualContract(page, palette, isMobile);
      await expect(page.locator(".page-heading h1")).toHaveText(entry.title.ar);
      // Give lazy workspace reads a chance to settle so a rejected read cannot
      // leave an unobserved runtime exception after the shell assertion.
      await page.waitForTimeout(125);

      await testInfo.attach("unprepared-api-reads.json", {
        contentType: "application/json",
        body: JSON.stringify({ pageId: entry.id, palette, reads: [...unpreparedReads].sort() }, null, 2),
      });
      if (overflow.overflow > 1) {
        await testInfo.attach("horizontal-overflow.json", {
          contentType: "application/json",
          body: JSON.stringify(overflow, null, 2),
        });
      }
      if (representativePageIds.has(entry.id)) {
        await page.screenshot({ path: testInfo.outputPath(`${entry.id}-${palette}-${isMobile ? "mobile" : "desktop"}.png`), fullPage: true });
      }
      expect(overflow.overflow, `horizontal overflow diagnostics: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(1);
      expect(pageErrors).toEqual([]);
    });
  }
}

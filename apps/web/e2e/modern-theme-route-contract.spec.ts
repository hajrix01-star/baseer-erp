import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { modules } from "../src/modules";
import { pageRegistry } from "../src/page-registry";

const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const appSource = readFileSync(resolve(testDirectory, "../src/App.tsx"), "utf8");
const shellSource = readFileSync(resolve(testDirectory, "../src/baseer-app-shell.tsx"), "utf8");
const themeLayoutSource = readFileSync(resolve(testDirectory, "../src/baseer-modern-theme-layouts.css"), "utf8");

/**
 * This is a route-contract test, not a visual approval test.  It deliberately
 * guards the invariant that every registry page shares the modern shell and
 * presentation selection.  Visual parity remains gated by the acceptance
 * register and representative browser screenshots.
 */
test("every visible registry page is inside the modern shell presentation contract", () => {
  const visiblePages = pageRegistry.filter((page) => page.navigation.visible);
  const moduleIds = new Set(modules.map((module) => module.id));

  expect(pageRegistry).toHaveLength(53);
  expect(visiblePages).toHaveLength(53);
  expect(new Set(visiblePages.map((page) => page.id)).size).toBe(53);
  expect(visiblePages.every((page) => moduleIds.has(page.moduleId))).toBe(true);

  // App owns the presentation data attribute before it selects either the
  // launcher or any resolved module workspace.  ModuleWorkspaceContents
  // always creates BaseerAppShell before it dispatches route content.
  expect(appSource).toContain("document.body.dataset.uiTheme = presentation");
  expect(appSource).toContain("? <ModuleWorkspace route={route}");
  expect(appSource).toContain("<BaseerAppShell header={header}");
  expect(shellSource).toContain('<main className="workspace">');

  // Both modern presentations carry the reference shell dimensions.  Keeping
  // this in the contract prevents a later token-only change from silently
  // collapsing Theme 1/2 back into a color-only presentation.
  expect(themeLayoutSource).toContain("--shell-header-height: 4.375rem");
  expect(themeLayoutSource).toContain("--shell-header-height: 3.5rem");
  expect(themeLayoutSource).toContain("inline-size: 16.0625rem");
  expect(themeLayoutSource).toContain("inline-size: 13.375rem");
});

test("the only registry-page navigation exception is explicit and security scoped", () => {
  const navigationFalseOccurrences = appSource.match(/navigation:\s*false/g) ?? [];

  expect(navigationFalseOccurrences).toHaveLength(1);
  expect(appSource).toContain('route.moduleId === "operations" && route.section === 7 && !isOwner');
  expect(appSource).toContain(
    '<OperationsInternalRegistrationWorkspace language={language} /></Suspense>, { navigation: false }',
  );
});

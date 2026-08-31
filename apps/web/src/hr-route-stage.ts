import { getPageByLegacySection, pageRouteHash } from "./page-registry";

export function consumeHrRouteStage(section: number) {
  const page = getPageByLegacySection("hr", section);
  if (page) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${pageRouteHash(page.id)}`);
}

/**
 * Removes an obsolete HR stage and notifies the hash router without creating a
 * browser-history entry. This is used when a company-scoped record no longer
 * exists in the currently selected company.
 */
export function recoverHrRouteStage(section: number) {
  consumeHrRouteStage(section);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

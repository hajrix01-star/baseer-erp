import { getPageByLegacySection, pageRouteHash } from "./page-registry";

export function consumeHrRouteStage(section: number) {
  const page = getPageByLegacySection("hr", section);
  if (page) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${pageRouteHash(page.id)}`);
}

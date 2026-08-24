import { modules, type ModuleId } from "./modules";
import { pagesForModule, getPageByLegacySection, type PagePermissionRule } from "./page-registry";

export type ModuleRoute = { moduleId: ModuleId; section: number };

let activePermissionCodes = new Set<string>();

export function setActivePermissionCodes(codes: readonly string[]) { activePermissionCodes = new Set(codes); }
export function hasActivePermission(code: string) { return activePermissionCodes.has(code); }

/**
 * UI discoverability only. The API still authorizes every request using the
 * live company membership; the page registry prevents a user from being led
 * to a screen that is known to be unavailable to them.
 */
function isAllowed(rule: PagePermissionRule | undefined, permissionCodes: readonly string[] | null): boolean {
  // Before the authenticated company response arrives we retain the shell to
  // avoid a misleading empty navigation flash. An empty, loaded list denies
  // every protected route.
  if (permissionCodes === null) return true;
  // A missing rule must never turn into access. New pages need an explicit
  // discoverability decision before they can appear in a live company shell.
  if (!rule) return false;
  const permissions = new Set(permissionCodes);
  if ("allOf" in rule) return rule.allOf.every((code) => permissions.has(code));
  return rule.some((code) => permissions.has(code));
}

export function canOpenRoute(route: ModuleRoute, permissionCodes: readonly string[] | null): boolean {
  return isAllowed(getPageByLegacySection(route.moduleId, route.section)?.requiredPermissions, permissionCodes);
}

export function visibleSections(moduleId: ModuleId, permissionCodes: readonly string[] | null): number[] {
  return [...pagesForModule(moduleId)]
    .sort((left, right) => left.legacySection - right.legacySection)
    .flatMap((page) => canOpenRoute({ moduleId, section: page.legacySection }, permissionCodes) ? [page.legacySection] : []);
}

export function visibleModules(permissionCodes: readonly string[] | null) {
  return modules.filter((module) => visibleSections(module.id, permissionCodes).length > 0);
}

export function firstAllowedRoute(moduleId: ModuleId, permissionCodes: readonly string[] | null): ModuleRoute | null {
  const section = visibleSections(moduleId, permissionCodes)[0];
  return section === undefined ? null : { moduleId, section };
}

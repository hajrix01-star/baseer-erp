import { getModule, modules, type ModuleId } from "./modules";

export type ModuleRoute = { moduleId: ModuleId; section: number };

type Rule = readonly string[] | Readonly<{ allOf: readonly string[] }>;
let activePermissionCodes = new Set<string>();

export function setActivePermissionCodes(codes: readonly string[]) { activePermissionCodes = new Set(codes); }
export function hasActivePermission(code: string) { return activePermissionCodes.has(code); }

const hrPayrollRule = ["hr.payroll.read", "hr.payroll.create", "hr.payroll.approve", "hr.payroll.pay", "hr.payroll.reverse"] as const;
const hrAdvanceRule = ["hr.advances.read", "hr.advances.issue", "hr.advances.settle", "hr.advances.reverse", "hr.deductions.manage"] as const;
const hrFinalSettlementRule = ["hr.final_settlements.read", "hr.final_settlements.create", "hr.final_settlements.verify", "hr.final_settlements.approve", "hr.final_settlements.pay", "hr.final_settlements.reverse"] as const;
const hrOverviewRule = ["hr.employees.read", "hr.employees.write", "hr.leaves.read", "hr.leaves.manage", ...hrPayrollRule, ...hrAdvanceRule, ...hrFinalSettlementRule] as const;

/**
 * UI discoverability only. The API still authorizes every request using the
 * live company membership; this map simply prevents a user from being led to
 * a screen that is known to be unavailable to them.
 */
const sectionRules: Partial<Record<ModuleId, Record<number, Rule>>> = {
  command: { 0: ["reports.read", "marketing.insights.read"], 1: ["marketing.insights.read"], 2: ["finance.daily_sales.read", "finance.daily_sales.history.read_all"], 3: ["inbound_evidence.owner_access"] },
  decision: {
    0: ["decision.metrics.read", "decision.alerts.read", "decision.context.read"],
    1: ["decision.context.read", "decision.context.company.manage"],
    2: ["decision.alerts.read", "decision.feedback.write"],
    3: ["decision.metrics.read", "decision.policy.manage"],
    4: ["decision.context.global.manage", "decision.policy.manage"],
  },
  marketing: {
    0: ["marketing.insights.read"],
    1: ["marketing.insights.read"],
    2: ["marketing.insights.read", "marketing.campaign.write"],
    3: ["marketing.insights.read", "marketing.google-business.profile.read"],
    4: ["marketing.insights.read"],
  },
  // This is intentionally an owner-only hub. The permission merely controls
  // navigation; the API independently verifies the tenant-owner assignment.
  "inbound-evidence": {
    0: ["inbound_evidence.owner_access"],
    1: ["inbound_evidence.owner_access"],
    2: ["inbound_evidence.owner_access"],
  },
  operations: {
    0: { allOf: ["finance.daily_sales.read", "finance.purchase_expense.read"] },
    1: ["finance.daily_sales.read", "finance.daily_sales.create"],
    2: ["finance.purchase_expense.read", "finance.purchase_expense.create"],
    3: ["finance.purchase_expense.read", "finance.purchase_expense.create", "finance.loans.read", "finance.loans.write"],
    4: ["finance.suppliers.read"],
    5: ["operations.catalog.manage"],
    6: ["operations.catalog.manage"],
    7: ["operations.internal_registration.create", "operations.internal_registration.read"],
    // Catalog managers already own the operational management area. Keep this
    // discoverability rule aligned with section 6 while the API remains the
    // authority for the individual materials/custody report projections.
    8: ["operations.catalog.manage", "operations.purchase_request.read", "operations.custody.read"],
    9: ["operations.assets.read"],
  },
  finance: {
    0: ["finance.configuration.read", "finance.setup.write", "finance.foundation.write"],
    1: ["finance.purchase_expense.read"],
    2: ["finance.vaults.read", "finance.vaults.write", "finance.vaults.transfer"],
    3: ["finance.configuration.read"],
    4: ["finance.configuration.read", "finance.setup.write", "finance.foundation.write"],
  },
  reports: {
    0: ["reports.read"],
    1: ["reports.read"],
    2: ["reports.read"],
    3: ["reports.read"],
    4: ["reports.read"],
  },
  hr: {
    // System company-manager roles are upgraded by the paired data migration.
    // Custom roles retain their explicit grants and only see the HR areas they
    // are authorized to use.
    0: hrOverviewRule,
    1: ["hr.employees.read", "hr.employees.write"],
    2: ["hr.leaves.read", "hr.leaves.manage"],
    3: hrPayrollRule,
    4: hrAdvanceRule,
    5: ["hr.employees.read", "hr.employees.write"],
    6: ["hr.employees.read", "hr.payroll.read", "hr.employee_letters.read", "hr.employee_letters.issue"],
  },
  administration: {
    0: ["administration.companies.read", "administration.users.read", "administration.roles.read"],
    1: ["administration.companies.read", "administration.companies.manage"],
    2: ["administration.users.read", "administration.users.manage"],
    3: ["administration.roles.read", "administration.roles.manage"],
    4: ["platform.ai.configuration.read", "platform.ai.identity.read", "platform.ai.system_identity.read"],
    5: ["administration.companies.manage"],
  },
};

function isAllowed(rule: Rule | undefined, permissionCodes: readonly string[] | null): boolean {
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
  return isAllowed(sectionRules[route.moduleId]?.[route.section], permissionCodes);
}

export function visibleSections(moduleId: ModuleId, permissionCodes: readonly string[] | null): number[] {
  const module = getModule(moduleId);
  return module.sections.ar.flatMap((_, section) => canOpenRoute({ moduleId, section }, permissionCodes) ? [section] : []);
}

export function visibleModules(permissionCodes: readonly string[] | null) {
  return modules.filter((module) => visibleSections(module.id, permissionCodes).length > 0);
}

export function firstAllowedRoute(moduleId: ModuleId, permissionCodes: readonly string[] | null): ModuleRoute | null {
  const section = visibleSections(moduleId, permissionCodes)[0];
  return section === undefined ? null : { moduleId, section };
}

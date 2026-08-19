import { getModule, modules, type ModuleId } from "./modules";

export type ModuleRoute = { moduleId: ModuleId; section: number };

type Rule = readonly string[];

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
  command: { 0: ["finance.daily_sales.read", "finance.purchase_expense.read", "finance.loans.read"] },
  operations: {
    1: ["finance.daily_sales.read", "finance.daily_sales.create"],
    2: ["finance.purchase_expense.read", "finance.purchase_expense.create"],
    3: ["finance.purchase_expense.read", "finance.purchase_expense.create", "finance.loans.read", "finance.loans.write"],
    4: ["finance.suppliers.read"],
  },
  finance: {
    0: ["finance.configuration.read", "finance.setup.write", "finance.foundation.write"],
    1: ["finance.purchase_expense.read", "finance.purchase_expense.create", "finance.supplier_dues.read"],
    2: ["finance.vaults.read", "finance.vaults.write", "finance.vaults.transfer"],
  },
  hr: {
    // Keep discovery in sync with the server-owned HR capabilities. A user
    // may legitimately work only in leave, payroll, or final settlements and
    // must still be able to discover that permitted workspace.
    0: hrOverviewRule,
    1: ["hr.employees.read", "hr.employees.write"],
    2: ["hr.leaves.read", "hr.leaves.manage"],
    3: hrPayrollRule,
    4: hrAdvanceRule,
    5: ["hr.employees.read", "hr.employees.write"],
    6: hrFinalSettlementRule,
  },
  administration: {
    0: ["administration.companies.read", "administration.users.read", "administration.roles.read"],
    1: ["administration.companies.read", "administration.companies.manage"],
    2: ["administration.users.read", "administration.users.manage"],
    3: ["administration.roles.read", "administration.roles.manage"],
  },
};

function isAllowed(rule: Rule | undefined, permissionCodes: readonly string[] | null): boolean {
  // Before the authenticated company response arrives we retain the shell to
  // avoid a misleading empty navigation flash. An empty, loaded list denies
  // every protected route.
  if (permissionCodes === null || !rule) return true;
  const permissions = new Set(permissionCodes);
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

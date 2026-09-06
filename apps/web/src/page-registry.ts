import type { SectionGlyph } from "./baseer-section-icon";
import type { ModuleId } from "./modules";

/**
 * A page's identity is independent from its visual position. `legacySection`
 * exists only to resolve historic `section=N` links and to keep existing page
 * components compatible while navigation migrates to stable page identifiers.
 */
export type PagePermissionRule = readonly string[] | Readonly<{ allOf: readonly string[] }>;

type PageDefinition<Id extends string = string, Module extends ModuleId = ModuleId> = {
  id: Id;
  moduleId: Module;
  legacySection: number;
  title: { ar: string; en: string };
  icon: SectionGlyph;
  navigation: { order: number; visible: boolean };
  requiredPermissions: PagePermissionRule;
};

function page<const Id extends string, const Module extends ModuleId>(definition: PageDefinition<Id, Module>): PageDefinition<Id, Module> {
  return definition;
}

const any = (requiredPermissions: readonly string[]): PagePermissionRule => requiredPermissions;
const every = (...permissions: readonly string[]): PagePermissionRule => ({ allOf: permissions });

export const pageRegistry = [
  page({ id: "command-money-marketing", moduleId: "command", legacySection: 0, title: { ar: "لوحة المال والتسويق", en: "Money and marketing" }, icon: "dashboard", navigation: { order: 10, visible: true }, requiredPermissions: any(["reports.read", "marketing.insights.read"]) }),
  page({ id: "command-calendar", moduleId: "command", legacySection: 1, title: { ar: "التقويم", en: "Calendar" }, icon: "target", navigation: { order: 20, visible: true }, requiredPermissions: any(["marketing.insights.read"]) }),
  page({ id: "command-analytics", moduleId: "command", legacySection: 2, title: { ar: "التحليلات", en: "Analytics" }, icon: "chart", navigation: { order: 30, visible: true }, requiredPermissions: any(["finance.daily_sales.history.read_all"]) }),
  page({ id: "command-owner-notebook", moduleId: "command", legacySection: 3, title: { ar: "لوحة المالك", en: "Owner dashboard" }, icon: "ledger", navigation: { order: 40, visible: true }, requiredPermissions: any(["inbound_evidence.owner_access"]) }),

  page({ id: "decision-overview", moduleId: "decision", legacySection: 0, title: { ar: "النظرة والقرارات", en: "Overview & decisions" }, icon: "dashboard", navigation: { order: 10, visible: true }, requiredPermissions: any(["decision.metrics.read", "decision.alerts.read", "decision.context.read"]) }),
  page({ id: "decision-timeline", moduleId: "decision", legacySection: 1, title: { ar: "الخط الزمني والسياق", en: "Timeline & context" }, icon: "calendar", navigation: { order: 20, visible: true }, requiredPermissions: any(["decision.context.read", "decision.context.company.manage"]) }),
  page({ id: "decision-alerts", moduleId: "decision", legacySection: 2, title: { ar: "التنبيهات", en: "Alerts" }, icon: "bell", navigation: { order: 30, visible: true }, requiredPermissions: any(["decision.alerts.read", "decision.feedback.write"]) }),
  page({ id: "decision-data-quality", moduleId: "decision", legacySection: 3, title: { ar: "جودة البيانات", en: "Data quality" }, icon: "chart", navigation: { order: 40, visible: true }, requiredPermissions: any(["decision.metrics.read", "decision.policy.manage"]) }),
  page({ id: "decision-sources-policies", moduleId: "decision", legacySection: 4, title: { ar: "المصادر والسياسات", en: "Sources & policies" }, icon: "shield", navigation: { order: 50, visible: true }, requiredPermissions: any(["decision.context.global.manage", "decision.policy.manage"]) }),
  page({ id: "decision-interpretations", moduleId: "decision", legacySection: 5, title: { ar: "التفسيرات والقرارات البشرية", en: "Interpretations & human decisions" }, icon: "badge", navigation: { order: 60, visible: true }, requiredPermissions: every("decision.human_insights.read", "platform.ai.use") }),

  page({ id: "marketing-overview", moduleId: "marketing", legacySection: 0, title: { ar: "النظرة", en: "Overview" }, icon: "dashboard", navigation: { order: 10, visible: true }, requiredPermissions: any(["marketing.insights.read"]) }),
  page({ id: "marketing-campaigns", moduleId: "marketing", legacySection: 1, title: { ar: "الحملات والعروض", en: "Campaigns & offers" }, icon: "activity", navigation: { order: 20, visible: true }, requiredPermissions: any(["marketing.insights.read"]) }),
  page({ id: "marketing-reputation", moduleId: "marketing", legacySection: 2, title: { ar: "السمعة والتقييمات", en: "Reputation & reviews" }, icon: "shield", navigation: { order: 30, visible: true }, requiredPermissions: any(["marketing.insights.read"]) }),
  page({ id: "marketing-google-ads", moduleId: "marketing", legacySection: 3, title: { ar: "Google Ads", en: "Google Ads" }, icon: "chart", navigation: { order: 40, visible: true }, requiredPermissions: any(["marketing.insights.read"]) }),
  page({ id: "marketing-sources-policies", moduleId: "marketing", legacySection: 4, title: { ar: "المصادر والربط", en: "Sources & connection" }, icon: "shield", navigation: { order: 50, visible: true }, requiredPermissions: any(["marketing.insights.read"]) }),

  page({ id: "evidence-overview", moduleId: "inbound-evidence", legacySection: 0, title: { ar: "النظرة", en: "Overview" }, icon: "dashboard", navigation: { order: 10, visible: true }, requiredPermissions: any(["inbound_evidence.owner_access"]) }),
  page({ id: "evidence-labels", moduleId: "inbound-evidence", legacySection: 1, title: { ar: "Labels وقواعد الفرز", en: "Labels & routing rules" }, icon: "mail", navigation: { order: 20, visible: true }, requiredPermissions: any(["inbound_evidence.owner_access"]) }),
  page({ id: "evidence-sources", moduleId: "inbound-evidence", legacySection: 2, title: { ar: "مصادر الربط", en: "Connection sources" }, icon: "shield", navigation: { order: 30, visible: true }, requiredPermissions: any(["inbound_evidence.owner_access"]) }),

  page({ id: "operations-overview", moduleId: "operations", legacySection: 0, title: { ar: "نظرة التشغيل", en: "Operations overview" }, icon: "dashboard", navigation: { order: 10, visible: true }, requiredPermissions: every("finance.daily_sales.read", "finance.purchase_expense.read") }),
  page({ id: "operations-sales", moduleId: "operations", legacySection: 1, title: { ar: "المبيعات", en: "Sales" }, icon: "trend", navigation: { order: 20, visible: true }, requiredPermissions: any(["finance.daily_sales.read", "finance.daily_sales.create"]) }),
  page({ id: "operations-purchases", moduleId: "operations", legacySection: 2, title: { ar: "المشتريات", en: "Purchasing" }, icon: "cart", navigation: { order: 30, visible: true }, requiredPermissions: any(["finance.purchase_expense.read", "finance.purchase_expense.create"]) }),
  page({ id: "operations-whatsapp-invoice-monitoring", moduleId: "operations", legacySection: 10, title: { ar: "وارد فواتير واتساب", en: "WhatsApp invoice inbox" }, icon: "receipt", navigation: { order: 35, visible: true }, requiredPermissions: any(["operations.whatsapp_invoice_monitoring.read"]) }),
  page({ id: "operations-expenses-obligations", moduleId: "operations", legacySection: 3, title: { ar: "المصروفات والالتزامات", en: "Expenses & obligations" }, icon: "truck", navigation: { order: 40, visible: true }, requiredPermissions: any(["finance.purchase_expense.read", "finance.purchase_expense.create", "finance.loans.read", "finance.loans.write"]) }),
  page({ id: "operations-suppliers", moduleId: "operations", legacySection: 4, title: { ar: "الموردون", en: "Suppliers" }, icon: "boxes", navigation: { order: 50, visible: true }, requiredPermissions: any(["finance.suppliers.read"]) }),
  page({ id: "operations-catalog", moduleId: "operations", legacySection: 5, title: { ar: "الطلبات", en: "Requests" }, icon: "receipt", navigation: { order: 60, visible: true }, requiredPermissions: any(["operations.catalog.manage", "operations.purchase_request.read", "operations.custody.read", "operations.internal_registration.create", "operations.internal_registration.read"]) }),
  page({ id: "operations-execution", moduleId: "operations", legacySection: 6, title: { ar: "طلبات المشتريات والعهدة", en: "Purchase requests & custody" }, icon: "receipt", navigation: { order: 70, visible: false }, requiredPermissions: any(["operations.catalog.manage"]) }),
  page({ id: "operations-internal-registration", moduleId: "operations", legacySection: 7, title: { ar: "التسجيل الداخلي", en: "Internal registration" }, icon: "clipboard", navigation: { order: 80, visible: false }, requiredPermissions: any(["operations.internal_registration.create", "operations.internal_registration.read"]) }),
  page({ id: "operations-reports", moduleId: "operations", legacySection: 8, title: { ar: "تقارير العمليات", en: "Operations reports" }, icon: "chart", navigation: { order: 90, visible: false }, requiredPermissions: any(["operations.catalog.manage", "operations.purchase_request.read", "operations.custody.read", "operations.internal_registration.read"]) }),
  page({ id: "operations-assets-warranties", moduleId: "operations", legacySection: 9, title: { ar: "الأصول والضمان", en: "Assets & warranties" }, icon: "badge", navigation: { order: 100, visible: true }, requiredPermissions: any(["operations.assets.read"]) }),

  page({ id: "finance-ledger", moduleId: "finance", legacySection: 1, title: { ar: "السجل المالي الموحد", en: "Unified financial register" }, icon: "receipt", navigation: { order: 10, visible: true }, requiredPermissions: any(["finance.purchase_expense.read"]) }),
  page({ id: "finance-treasury", moduleId: "finance", legacySection: 2, title: { ar: "الخزائن والبنوك", en: "Treasury & banks" }, icon: "bank", navigation: { order: 20, visible: true }, requiredPermissions: any(["finance.vaults.read", "finance.vaults.write", "finance.vaults.transfer"]) }),
  page({ id: "finance-accounts", moduleId: "finance", legacySection: 3, title: { ar: "الحسابات", en: "Accounts" }, icon: "wallet", navigation: { order: 30, visible: true }, requiredPermissions: any(["finance.configuration.read"]) }),
  page({ id: "finance-categories", moduleId: "finance", legacySection: 4, title: { ar: "الفئات والتصنيفات", en: "Categories & classifications" }, icon: "ledger", navigation: { order: 40, visible: true }, requiredPermissions: any(["finance.configuration.read", "finance.setup.write", "finance.foundation.write"]) }),
  page({ id: "finance-settings", moduleId: "finance", legacySection: 0, title: { ar: "إعدادات المالية", en: "Finance setup" }, icon: "dashboard", navigation: { order: 99, visible: true }, requiredPermissions: any(["finance.configuration.read", "finance.setup.write", "finance.foundation.write"]) }),

  page({ id: "hr-overview", moduleId: "hr", legacySection: 0, title: { ar: "نظرة HR", en: "HR overview" }, icon: "dashboard", navigation: { order: 10, visible: true }, requiredPermissions: any(["hr.employees.read", "hr.employees.write", "hr.leaves.read", "hr.leaves.manage", "hr.payroll.read", "hr.payroll.create", "hr.payroll.approve", "hr.payroll.pay", "hr.payroll.reverse", "hr.advances.read", "hr.advances.issue", "hr.advances.settle", "hr.advances.reverse", "hr.deductions.manage", "hr.final_settlements.read", "hr.final_settlements.create", "hr.final_settlements.verify", "hr.final_settlements.approve", "hr.final_settlements.pay", "hr.final_settlements.reverse"]) }),
  page({ id: "hr-employees", moduleId: "hr", legacySection: 1, title: { ar: "الموظفون", en: "Employees" }, icon: "users", navigation: { order: 20, visible: true }, requiredPermissions: any(["hr.employees.read", "hr.employees.write"]) }),
  page({ id: "hr-leave", moduleId: "hr", legacySection: 2, title: { ar: "الإجازات والعودة", en: "Leave & return" }, icon: "calendar", navigation: { order: 30, visible: true }, requiredPermissions: any(["hr.leaves.read", "hr.leaves.manage"]) }),
  page({ id: "hr-payroll", moduleId: "hr", legacySection: 3, title: { ar: "الرواتب", en: "Payroll" }, icon: "wallet", navigation: { order: 40, visible: true }, requiredPermissions: any(["hr.payroll.read", "hr.payroll.create", "hr.payroll.approve", "hr.payroll.pay", "hr.payroll.reverse"]) }),
  page({ id: "hr-advances-deductions", moduleId: "hr", legacySection: 4, title: { ar: "السلف والخصومات", en: "Advances & deductions" }, icon: "hand", navigation: { order: 50, visible: true }, requiredPermissions: any(["hr.advances.read", "hr.advances.issue", "hr.advances.settle", "hr.advances.reverse", "hr.deductions.manage"]) }),
  page({ id: "hr-services", moduleId: "hr", legacySection: 5, title: { ar: "الإقامات والخدمات", en: "Residencies & services" }, icon: "badge", navigation: { order: 60, visible: true }, requiredPermissions: any(["hr.employees.read", "hr.employees.write"]) }),
  page({ id: "hr-salary-tools", moduleId: "hr", legacySection: 6, title: { ar: "أدوات الراتب", en: "Salary tools" }, icon: "ledger", navigation: { order: 70, visible: true }, requiredPermissions: any(["hr.employees.read", "hr.payroll.read", "hr.employee_letters.read", "hr.employee_letters.issue"]) }),
  page({ id: "hr-attendance", moduleId: "hr", legacySection: 7, title: { ar: "الحضور والانصراف", en: "Attendance & timekeeping" }, icon: "calendar", navigation: { order: 80, visible: true }, requiredPermissions: any(["attendance.manage"]) }),

  page({ id: "reports-overview", moduleId: "reports", legacySection: 0, title: { ar: "نظرة التقارير", en: "Reports overview" }, icon: "dashboard", navigation: { order: 10, visible: true }, requiredPermissions: any(["reports.read"]) }),
  page({ id: "reports-financial", moduleId: "reports", legacySection: 1, title: { ar: "التقارير المالية", en: "Financial reports" }, icon: "chart", navigation: { order: 20, visible: true }, requiredPermissions: any(["reports.read"]) }),
  page({ id: "reports-vat", moduleId: "reports", legacySection: 2, title: { ar: "التقرير الضريبي", en: "VAT report" }, icon: "tax", navigation: { order: 30, visible: true }, requiredPermissions: any(["reports.read"]) }),
  page({ id: "reports-hajri-tax", moduleId: "reports", legacySection: 3, title: { ar: "محاكاة VAT", en: "VAT simulation" }, icon: "tax", navigation: { order: 40, visible: true }, requiredPermissions: any(["reports.read"]) }),
  page({ id: "reports-documents", moduleId: "reports", legacySection: 4, title: { ar: "مستندات التقارير", en: "Report documents" }, icon: "print", navigation: { order: 50, visible: true }, requiredPermissions: any(["reports.read"]) }),

  page({ id: "administration-overview", moduleId: "administration", legacySection: 0, title: { ar: "نظرة الإدارة", en: "Administration overview" }, icon: "dashboard", navigation: { order: 10, visible: false }, requiredPermissions: any(["administration.companies.read", "administration.users.read", "administration.roles.read"]) }),
  page({ id: "administration-companies", moduleId: "administration", legacySection: 1, title: { ar: "الشركات", en: "Companies" }, icon: "building", navigation: { order: 20, visible: true }, requiredPermissions: any(["administration.companies.read", "administration.companies.manage"]) }),
  page({ id: "administration-users", moduleId: "administration", legacySection: 2, title: { ar: "المستخدمون", en: "Users" }, icon: "users", navigation: { order: 30, visible: true }, requiredPermissions: any(["administration.users.read", "administration.users.manage"]) }),
  page({ id: "administration-roles", moduleId: "administration", legacySection: 3, title: { ar: "الأدوار والصلاحيات", en: "Roles & permissions" }, icon: "shield", navigation: { order: 40, visible: true }, requiredPermissions: any(["administration.roles.read", "administration.roles.manage"]) }),
  page({ id: "administration-identity-basira", moduleId: "administration", legacySection: 4, title: { ar: "بصيرة", en: "Basira" }, icon: "badge", navigation: { order: 50, visible: true }, requiredPermissions: any(["platform.ai.configuration.read", "platform.ai.identity.read", "platform.ai.system_identity.read"]) }),
  page({ id: "administration-backup", moduleId: "administration", legacySection: 5, title: { ar: "النسخ الاحتياطي", en: "Backup" }, icon: "backup", navigation: { order: 60, visible: true }, requiredPermissions: any(["administration.companies.manage"]) }),
  page({ id: "administration-nurix-migration", moduleId: "administration", legacySection: 6, title: { ar: "ترحيل نوركس", en: "Noorix migration" }, icon: "shield", navigation: { order: 70, visible: true }, requiredPermissions: any(["administration.companies.manage"]) }),
] as const;

export type PageId = (typeof pageRegistry)[number]["id"];
export type RegisteredPage = (typeof pageRegistry)[number];
export type FinancePageId = Extract<RegisteredPage, { moduleId: "finance" }>["id"];
export type FinancePageDefinition = Extract<RegisteredPage, { moduleId: "finance" }>;

const pagesById = new Map<string, RegisteredPage>(pageRegistry.map((entry) => [entry.id, entry]));
const pagesByLegacyRoute = new Map<string, RegisteredPage>(pageRegistry.map((entry) => [`${entry.moduleId}:${entry.legacySection}`, entry]));

export const financePages: readonly FinancePageDefinition[] = pageRegistry.filter((entry): entry is FinancePageDefinition => entry.moduleId === "finance");
export const financeLegacySections = {
  ar: [...financePages].sort((left, right) => left.legacySection - right.legacySection).map((entry) => entry.title.ar),
  en: [...financePages].sort((left, right) => left.legacySection - right.legacySection).map((entry) => entry.title.en),
} as const;

export function getPage(pageId: string | null | undefined): RegisteredPage | undefined {
  return pageId ? pagesById.get(pageId) : undefined;
}

export function getPageByLegacySection(moduleId: ModuleId, section: number): RegisteredPage | undefined {
  return pagesByLegacyRoute.get(`${moduleId}:${section}`);
}

export function pagesForModule(moduleId: ModuleId): readonly RegisteredPage[] {
  return pageRegistry.filter((entry) => entry.moduleId === moduleId);
}

export function pageRouteHash(pageId: PageId, stage?: string): string {
  const entry = getPage(pageId);
  if (!entry) throw new Error(`Unknown page id: ${pageId}`);
  return `module=${entry.moduleId}&page=${entry.id}${stage ? `&stage=${encodeURIComponent(stage)}` : ""}`;
}

export function getFinancePage(pageId: string | null | undefined): FinancePageDefinition | undefined {
  const entry = getPage(pageId);
  return entry?.moduleId === "finance" ? entry : undefined;
}

export function getFinancePageByLegacySection(section: number): FinancePageDefinition | undefined {
  const entry = getPageByLegacySection("finance", section);
  return entry?.moduleId === "finance" ? entry : undefined;
}

export function financeRouteHash(pageId: FinancePageId, stage?: string): string {
  return pageRouteHash(pageId, stage);
}

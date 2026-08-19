export type AdministrationPermissionDefinition = Readonly<{
  code: string;
  module: string;
  nameAr: string;
  nameEn: string;
  risk: "standard" | "sensitive";
}>;

/**
 * The server owns this catalogue. Administrators can compose roles from these
 * stable capabilities, but they cannot invent permission keys in the UI.
 */
export const ADMINISTRATION_PERMISSION_CATALOG: readonly AdministrationPermissionDefinition[] = [
  { code: "administration.companies.read", module: "administration", nameAr: "عرض الشركات", nameEn: "View companies", risk: "standard" },
  { code: "administration.companies.manage", module: "administration", nameAr: "إدارة الشركات وإعداداتها", nameEn: "Manage companies and settings", risk: "sensitive" },
  { code: "administration.users.read", module: "administration", nameAr: "عرض المستخدمين", nameEn: "View users", risk: "standard" },
  { code: "administration.users.manage", module: "administration", nameAr: "إدارة المستخدمين", nameEn: "Manage users", risk: "sensitive" },
  { code: "administration.roles.read", module: "administration", nameAr: "عرض الأدوار والصلاحيات", nameEn: "View roles and permissions", risk: "standard" },
  { code: "administration.roles.manage", module: "administration", nameAr: "إدارة الأدوار والصلاحيات", nameEn: "Manage roles and permissions", risk: "sensitive" },

  { code: "finance.setup.write", module: "finance", nameAr: "تهيئة المالية للشركة", nameEn: "Initialize company finance", risk: "sensitive" },
  { code: "finance.configuration.read", module: "finance", nameAr: "عرض إعدادات المالية", nameEn: "View finance configuration", risk: "standard" },
  { code: "finance.periods.write", module: "finance", nameAr: "إدارة الفترات المالية", nameEn: "Manage fiscal periods", risk: "sensitive" },
  { code: "finance.vaults.read", module: "finance", nameAr: "عرض الخزائن", nameEn: "View vaults", risk: "standard" },
  { code: "finance.vaults.write", module: "finance", nameAr: "إدارة الخزائن", nameEn: "Manage vaults", risk: "sensitive" },
  { code: "finance.vaults.transfer", module: "finance", nameAr: "تحويل بين الخزائن", nameEn: "Transfer between vaults", risk: "sensitive" },
  { code: "finance.foundation.write", module: "finance", nameAr: "نسخ وإعداد البيانات المالية الأساسية", nameEn: "Copy and initialize finance master data", risk: "sensitive" },
  { code: "finance.suppliers.read", module: "finance", nameAr: "عرض الموردين", nameEn: "View suppliers", risk: "standard" },
  { code: "finance.supplier_dues.read", module: "finance", nameAr: "عرض ذمم الموردين", nameEn: "View supplier dues", risk: "standard" },
  { code: "finance.supplier_dues.write", module: "finance", nameAr: "إنشاء وسداد وعكس ذمم الموردين", nameEn: "Create, pay, and reverse supplier dues", risk: "sensitive" },
  { code: "finance.loans.read", module: "finance", nameAr: "عرض القروض والالتزامات", nameEn: "View inclusive loans and liabilities", risk: "standard" },
  { code: "finance.loans.write", module: "finance", nameAr: "إدارة القروض وسدادها", nameEn: "Manage inclusive loans and repayments", risk: "sensitive" },
  { code: "finance.purchase_expense.read", module: "finance", nameAr: "عرض مستندات المشتريات والمصروفات", nameEn: "View purchase and expense documents", risk: "standard" },
  { code: "finance.purchase_expense.create", module: "finance", nameAr: "إدخال مستندات المشتريات والمصروفات", nameEn: "Create purchase and expense documents", risk: "sensitive" },
  { code: "finance.purchase_expense.correct", module: "finance", nameAr: "تعديل مستندات المشتريات والمصروفات", nameEn: "Correct purchase and expense documents", risk: "sensitive" },
  { code: "finance.purchase_expense.cancel", module: "finance", nameAr: "إلغاء مستندات المشتريات والمصروفات", nameEn: "Cancel purchase and expense documents", risk: "sensitive" },

  { code: "hr.employees.read", module: "hr", nameAr: "عرض الموظفين وملفاتهم", nameEn: "View employees and their files", risk: "standard" },
  { code: "hr.employees.write", module: "hr", nameAr: "إدارة الموظفين وخدماتهم", nameEn: "Manage employees and employee services", risk: "sensitive" },
  { code: "hr.advances.read", module: "hr", nameAr: "عرض سلف الموظفين", nameEn: "View employee advances", risk: "standard" },
  { code: "hr.advances.issue", module: "hr", nameAr: "إصدار سلف الموظفين", nameEn: "Issue employee advances", risk: "sensitive" },
  { code: "hr.advances.settle", module: "hr", nameAr: "تسوية سلف الموظفين", nameEn: "Settle employee advances", risk: "sensitive" },
  { code: "hr.advances.reverse", module: "hr", nameAr: "عكس سلف الموظفين", nameEn: "Reverse employee advances", risk: "sensitive" },
  { code: "hr.deductions.manage", module: "hr", nameAr: "إدارة خصومات الموظفين", nameEn: "Manage employee deductions", risk: "sensitive" },
  { code: "hr.leaves.read", module: "hr", nameAr: "عرض إجازات الموظفين", nameEn: "View employee leaves", risk: "standard" },
  { code: "hr.leaves.manage", module: "hr", nameAr: "إدارة إجازات وعودة الموظفين", nameEn: "Manage employee leaves and returns", risk: "sensitive" },
  { code: "hr.payroll.read", module: "hr", nameAr: "عرض مسيرات الرواتب", nameEn: "View payroll runs", risk: "standard" },
  { code: "hr.payroll.create", module: "hr", nameAr: "إعداد مسيرات الرواتب والرواتب المعتمدة", nameEn: "Prepare payroll runs and compensation", risk: "sensitive" },
  { code: "hr.payroll.approve", module: "hr", nameAr: "اعتماد مسيرات الرواتب", nameEn: "Approve payroll runs", risk: "sensitive" },
  { code: "hr.payroll.pay", module: "hr", nameAr: "سداد مسيرات الرواتب", nameEn: "Pay payroll runs", risk: "sensitive" },
  { code: "hr.payroll.reverse", module: "hr", nameAr: "عكس مسيرات الرواتب", nameEn: "Reverse payroll runs", risk: "sensitive" },
  { code: "hr.employee_documents.read", module: "hr", nameAr: "عرض مستندات الموظفين", nameEn: "View employee documents", risk: "standard" },
  { code: "hr.employee_documents.write", module: "hr", nameAr: "إضافة وتعديل وإلغاء مستندات الموظفين", nameEn: "Manage employee documents", risk: "sensitive" },
  { code: "hr.employee_documents.revoke", module: "hr", nameAr: "إلغاء مستندات الموظفين", nameEn: "Revoke employee documents", risk: "sensitive" },
  { code: "hr.employee_documents.download", module: "hr", nameAr: "تنزيل مرفقات مستندات الموظفين", nameEn: "Download employee document attachments", risk: "sensitive" },
  { code: "hr.employee_letters.read", module: "hr", nameAr: "عرض خطابات الموظفين", nameEn: "View employee letters", risk: "standard" },
  { code: "hr.employee_letters.issue", module: "hr", nameAr: "إصدار خطابات الموظفين", nameEn: "Issue employee letters", risk: "sensitive" },
  { code: "hr.employee_letters.revoke", module: "hr", nameAr: "إلغاء خطابات الموظفين", nameEn: "Revoke employee letters", risk: "sensitive" },

  { code: "finance.daily_sales.read", module: "operations", nameAr: "عرض سجل المبيعات", nameEn: "View sales register", risk: "standard" },
  { code: "finance.daily_sales.history.read_all", module: "operations", nameAr: "عرض كامل سجل المبيعات", nameEn: "View full sales history", risk: "standard" },
  { code: "finance.daily_sales.create", module: "operations", nameAr: "إدخال تقفيل المبيعات", nameEn: "Enter sales closings", risk: "sensitive" },
  { code: "finance.daily_sales.correct", module: "operations", nameAr: "تصحيح تقفيل المبيعات", nameEn: "Correct sales closings", risk: "sensitive" },
  { code: "finance.daily_sales.reverse", module: "operations", nameAr: "عكس تقفيل المبيعات", nameEn: "Reverse sales closings", risk: "sensitive" },
  { code: "finance.operational_calendar.manage", module: "operations", nameAr: "توثيق أيام بدون عمل", nameEn: "Manage non-operating days", risk: "sensitive" },
  // Compatibility only for roles created before the narrower daily-sales split.
  { code: "finance.daily_sales.write", module: "operations", nameAr: "إدخال وتقفيل مبيعات قديم", nameEn: "Legacy sales-closing write", risk: "sensitive" },

  { code: "platform.files.read", module: "platform", nameAr: "عرض الملفات", nameEn: "View files", risk: "standard" },
  { code: "platform.files.write", module: "platform", nameAr: "إضافة ملفات", nameEn: "Add files", risk: "sensitive" },
  { code: "platform.business-date.read", module: "platform", nameAr: "عرض تاريخ العمل", nameEn: "View business date", risk: "standard" },
  { code: "platform.observability.read", module: "platform", nameAr: "عرض حالة التشغيل", nameEn: "View operational health", risk: "standard" },
  { code: "platform.output.preview", module: "platform", nameAr: "معاينة الطباعة", nameEn: "Preview output", risk: "standard" },
  { code: "platform.output.export", module: "platform", nameAr: "تصدير التقارير", nameEn: "Export output", risk: "sensitive" },

  { code: "platform.ai.use", module: "ai", nameAr: "استخدام بصيرة ضمن المهارات المتاحة", nameEn: "Use Basira within available skills", risk: "standard" },
  { code: "platform.ai.configuration.read", module: "ai", nameAr: "عرض إعداد مزود الذكاء", nameEn: "View AI provider configuration", risk: "sensitive" },
  { code: "platform.ai.configuration.write", module: "ai", nameAr: "تعديل إعداد مزود الذكاء", nameEn: "Change AI provider configuration", risk: "sensitive" },
  { code: "platform.ai.provider.configure", module: "ai", nameAr: "تهيئة مزود الذكاء", nameEn: "Configure AI provider", risk: "sensitive" },
  { code: "platform.ai.identity.read", module: "ai", nameAr: "عرض هوية الذكاء للشركة", nameEn: "View company AI identity", risk: "standard" },
  { code: "platform.ai.identity.write", module: "ai", nameAr: "تعديل هوية الذكاء للشركة", nameEn: "Change company AI identity", risk: "sensitive" },
  { code: "platform.ai.identity.create_version", module: "ai", nameAr: "إنشاء إصدار هوية الذكاء للشركة", nameEn: "Create company AI identity version", risk: "sensitive" },
  { code: "platform.ai.system_identity.read", module: "ai", nameAr: "عرض هوية بصيرة المركزية", nameEn: "View central Baseerah identity", risk: "standard" },
  { code: "platform.ai.system_identity.write", module: "ai", nameAr: "تعديل هوية بصيرة المركزية", nameEn: "Change central Baseerah identity", risk: "sensitive" },
  { code: "platform.ai.system_identity.create_version", module: "ai", nameAr: "إنشاء إصدار هوية بصيرة المركزية", nameEn: "Create central Baseerah identity version", risk: "sensitive" },
] as const;

const DAILY_SALES_MANAGE = [
  "finance.daily_sales.create",
  "finance.daily_sales.correct",
  "finance.daily_sales.reverse",
  "finance.operational_calendar.manage",
] as const;

const COMPANY_MANAGER_PERMISSIONS = [
  "platform.ai.use",
  "finance.setup.write",
  "finance.configuration.read",
  "finance.periods.write",
  "finance.vaults.read",
  "finance.vaults.write",
  "finance.vaults.transfer",
  "finance.foundation.write",
  "finance.suppliers.read",
  "finance.supplier_dues.read",
  "finance.supplier_dues.write",
  "finance.loans.read",
  "finance.loans.write",
  "finance.purchase_expense.read",
  "finance.purchase_expense.create",
  "finance.purchase_expense.correct",
  "finance.purchase_expense.cancel",
  "hr.employees.read",
  "hr.employees.write",
  "hr.advances.read",
  "hr.advances.issue",
  "hr.advances.settle",
  "hr.advances.reverse",
  "hr.deductions.manage",
  "hr.leaves.read",
  "hr.leaves.manage",
  "hr.payroll.read",
  "hr.payroll.create",
  "hr.payroll.approve",
  "hr.payroll.pay",
  "hr.payroll.reverse",
  "hr.employee_documents.read",
  "hr.employee_documents.write",
  "hr.employee_documents.revoke",
  "hr.employee_documents.download",
  "hr.employee_letters.read",
  "hr.employee_letters.issue",
  "hr.employee_letters.revoke",
  "finance.daily_sales.read",
  "finance.daily_sales.history.read_all",
  ...DAILY_SALES_MANAGE,
  "platform.files.read",
  "platform.files.write",
  "platform.business-date.read",
  "platform.output.preview",
  "platform.output.export",
] as const;

export const SYSTEM_ROLE_TEMPLATES = [
  { code: "BASEER_COMPANY_MANAGER", nameAr: "مدير الشركة", nameEn: "Company manager", permissions: COMPANY_MANAGER_PERMISSIONS },
  { code: "BASEER_FINANCE_ACCOUNTANT", nameAr: "محاسب", nameEn: "Accountant", permissions: ["platform.ai.use", "finance.configuration.read", "finance.vaults.read", "finance.vaults.transfer", "finance.suppliers.read", "finance.supplier_dues.read", "finance.supplier_dues.write", "finance.loans.read", "finance.loans.write", "finance.purchase_expense.read", "finance.purchase_expense.create", "finance.purchase_expense.correct", "finance.purchase_expense.cancel", "finance.daily_sales.read", "finance.daily_sales.history.read_all", ...DAILY_SALES_MANAGE, "platform.files.read", "platform.files.write", "platform.business-date.read", "platform.output.preview", "platform.output.export"] },
  { code: "BASEER_SALES_SUPERVISOR", nameAr: "مشرف مبيعات", nameEn: "Sales supervisor", permissions: ["platform.ai.use", "finance.daily_sales.read", "finance.daily_sales.history.read_all", ...DAILY_SALES_MANAGE, "platform.business-date.read", "platform.output.preview"] },
  { code: "BASEER_CASHIER", nameAr: "كاشير", nameEn: "Cashier", permissions: ["platform.ai.use", "finance.daily_sales.read", "finance.daily_sales.create", "platform.business-date.read"] },
  { code: "BASEER_READER", nameAr: "قارئ", nameEn: "Reader", permissions: ["platform.ai.use", "finance.daily_sales.read", "finance.configuration.read", "finance.suppliers.read", "finance.supplier_dues.read", "finance.loans.read", "finance.purchase_expense.read", "platform.business-date.read"] },
] as const;

export function permissionCodesAreKnown(codes: readonly string[]): boolean {
  const known = new Set(ADMINISTRATION_PERMISSION_CATALOG.map((item) => item.code));
  return codes.length > 0 && codes.every((code) => known.has(code));
}

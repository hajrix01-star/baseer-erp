export type ModuleId = 'command' | 'decision' | 'marketing' | 'operations' | 'finance' | 'hr' | 'reports' | 'administration';

export type ModuleDefinition = {
  id: ModuleId;
  accent: string;
  accentAlt: string;
  title: { ar: string; en: string };

  sections: { ar: string[]; en: string[] };
};

export const modules: readonly ModuleDefinition[] = [
  { id: 'command', accent: '#08744d', accentAlt: '#35c69a', title: { ar: 'مركز القيادة', en: 'Command center' }, sections: { ar: ['النظرة التنفيذية', 'الأولويات', 'التنبيهات', 'موجز النشاط'], en: ['Executive overview', 'Priorities', 'Alerts', 'Activity brief'] } },
  { id: 'decision', accent: '#3d6f8e', accentAlt: '#64b8c8', title: { ar: 'مركز القرار والسياق', en: 'Decision & context center' }, sections: { ar: ['النظرة والقرارات', 'الخط الزمني والسياق', 'التنبيهات', 'جودة البيانات', 'المصادر والسياسات'], en: ['Overview & decisions', 'Timeline & context', 'Alerts', 'Data quality', 'Sources & policies'] } },
  { id: 'marketing', accent: '#a35b2e', accentAlt: '#e6a64f', title: { ar: 'الأداء التسويقي والسمعة', en: 'Marketing performance & reputation' }, sections: { ar: ['النظرة', 'التقويم التسويقي', 'الحملات والعروض', 'السمعة وGoogle', 'المصادر والسياسات'], en: ['Overview', 'Marketing calendar', 'Campaigns & offers', 'Reputation & Google', 'Sources & policies'] } },
  { id: 'operations', accent: '#176e9e', accentAlt: '#36b8ed', title: { ar: 'العمليات', en: 'Operations' }, sections: { ar: ['نظرة التشغيل', 'المبيعات', 'المشتريات', 'المصروفات والالتزامات', 'الموردون', 'المخزون والمستودعات', 'طلبات المشتريات والعهدة', 'التسجيل الداخلي', 'تقارير العمليات', 'الأصول والضمان'], en: ['Operations overview', 'Sales', 'Purchasing', 'Expenses & obligations', 'Suppliers', 'Inventory & warehouses', 'Purchase requests & custody', 'Internal registration', 'Operations reports', 'Assets & warranties'] } },
  { id: 'finance', accent: '#a3532e', accentAlt: '#ec8851', title: { ar: 'المالية والمحاسبة', en: 'Finance & accounting' }, sections: { ar: ['إعدادات المالية', 'السجل المالي الموحد', 'الخزائن والبنوك', 'الحسابات', 'الفئات والتصنيفات'], en: ['Finance setup', 'Unified financial register', 'Treasury & banks', 'Accounts', 'Categories & classifications'] } },
  { id: 'hr', accent: '#a84c84', accentAlt: '#f0a33c', title: { ar: 'الموارد البشرية', en: 'Human resources' }, sections: { ar: ['نظرة HR', 'الموظفون', 'الإجازات والعودة', 'الرواتب', 'السلف والخصومات', 'الإقامات والخدمات', 'أدوات الراتب'], en: ['HR overview', 'Employees', 'Leave & return', 'Payroll', 'Advances & deductions', 'Residencies & services', 'Salary tools'] } },
  { id: 'reports', accent: '#7554aa', accentAlt: '#38b9d5', title: { ar: 'التقارير', en: 'Reports' }, sections: { ar: ['نظرة التقارير', 'التقارير المالية', 'التقرير الضريبي', 'Hajri Tax', 'مستندات التقارير'], en: ['Reports overview', 'Financial reports', 'VAT report', 'Hajri Tax', 'Report documents'] } },
  { id: 'administration', accent: '#536b63', accentAlt: '#f0b54e', title: { ar: 'الإدارة', en: 'Administration' }, sections: { ar: ['نظرة الإدارة', 'الشركات', 'المستخدمون', 'الأدوار والصلاحيات', 'الهوية والثيم', 'النسخ الاحتياطي'], en: ['Administration overview', 'Companies', 'Users', 'Roles & permissions', 'Identity & theme', 'Backup'] } },
];

export const getModule = (id: ModuleId): ModuleDefinition => modules.find((item) => item.id === id) ?? modules[0];

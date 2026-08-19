export type ModuleId = 'command' | 'operations' | 'finance' | 'hr' | 'reports' | 'administration';

export type ModuleDefinition = {
  id: ModuleId;
  accent: string;
  accentAlt: string;
  title: { ar: string; en: string };

  sections: { ar: string[]; en: string[] };
};

export const modules: readonly ModuleDefinition[] = [
  { id: 'command', accent: '#08744d', accentAlt: '#35c69a', title: { ar: 'مركز القيادة', en: 'Command center' }, sections: { ar: ['النظرة التنفيذية', 'الأولويات', 'التنبيهات', 'موجز النشاط'], en: ['Executive overview', 'Priorities', 'Alerts', 'Activity brief'] } },
  { id: 'operations', accent: '#176e9e', accentAlt: '#36b8ed', title: { ar: 'العمليات', en: 'Operations' }, sections: { ar: ['نظرة التشغيل', 'المبيعات', 'المشتريات', 'المصروفات والالتزامات', 'الموردون', 'المخزون والمستودعات', 'الطلبات'], en: ['Operations overview', 'Sales', 'Purchasing', 'Expenses & obligations', 'Suppliers', 'Inventory & warehouses', 'Requests'] } },
  { id: 'finance', accent: '#a3532e', accentAlt: '#ec8851', title: { ar: 'المالية والمحاسبة', en: 'Finance & accounting' }, sections: { ar: ['إعدادات المالية', 'السجل المالي الموحد', 'الخزائن والبنوك', 'الحسابات', 'الفئات والتصنيفات'], en: ['Finance setup', 'Unified financial register', 'Treasury & banks', 'Accounts', 'Categories & classifications'] } },
  { id: 'hr', accent: '#a84c84', accentAlt: '#f0a33c', title: { ar: 'الموارد البشرية', en: 'Human resources' }, sections: { ar: ['نظرة HR', 'الموظفون', 'الإجازات والعودة', 'الرواتب', 'السلف والخصومات', 'الإقامات والخدمات', 'أدوات الراتب'], en: ['HR overview', 'Employees', 'Leave & return', 'Payroll', 'Advances & deductions', 'Residencies & services', 'Salary tools'] } },
  { id: 'reports', accent: '#7554aa', accentAlt: '#38b9d5', title: { ar: 'التقارير', en: 'Reports' }, sections: { ar: ['نظرة التقارير', 'التقارير المالية', 'التقرير الضريبي', 'Hajri Tax', 'الطباعة والتصدير'], en: ['Reports overview', 'Financial reports', 'VAT report', 'Hajri Tax', 'Print & export'] } },
  { id: 'administration', accent: '#536b63', accentAlt: '#f0b54e', title: { ar: 'الإدارة', en: 'Administration' }, sections: { ar: ['نظرة الإدارة', 'الشركات', 'المستخدمون', 'الأدوار والصلاحيات', 'الهوية والثيم', 'النسخ الاحتياطي'], en: ['Administration overview', 'Companies', 'Users', 'Roles & permissions', 'Identity & theme', 'Backup'] } },
];

export const getModule = (id: ModuleId): ModuleDefinition => modules.find((item) => item.id === id) ?? modules[0];

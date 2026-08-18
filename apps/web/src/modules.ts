export type ModuleId = 'command' | 'operations' | 'finance' | 'hr' | 'reports' | 'administration';

export type ModuleDefinition = {
  id: ModuleId;
  icon: string;
  accent: string;
  title: { ar: string; en: string };

  sections: { ar: string[]; en: string[] };
};

export const modules: readonly ModuleDefinition[] = [
  { id: 'command', icon: '⌘', accent: '#08744d', title: { ar: 'مركز القيادة', en: 'Command center' }, sections: { ar: ['النظرة التنفيذية', 'الأولويات', 'التنبيهات', 'موجز النشاط'], en: ['Executive overview', 'Priorities', 'Alerts', 'Activity brief'] } },
  { id: 'operations', icon: '◫', accent: '#176e9e', title: { ar: 'العمليات', en: 'Operations' }, sections: { ar: ['نظرة التشغيل', 'المبيعات', 'المشتريات', 'المصروفات والالتزامات', 'الموردون', 'المخزون والمستودعات', 'الطلبات'], en: ['Operations overview', 'Sales', 'Purchasing', 'Expenses & obligations', 'Suppliers', 'Inventory & warehouses', 'Requests'] } },
  { id: 'finance', icon: '▣', accent: '#a3532e', title: { ar: 'المالية والمحاسبة', en: 'Finance & accounting' }, sections: { ar: ['إعدادات المالية', 'الفواتير والمدفوعات', 'الخزائن والبنوك', 'الحسابات والسجل', 'الفئات والتصنيفات'], en: ['Finance setup', 'Invoices & payments', 'Treasury & banks', 'Accounts & ledger', 'Categories & classifications'] } },
  { id: 'hr', icon: '♙', accent: '#bd4778', title: { ar: 'الموارد البشرية', en: 'Human resources' }, sections: { ar: ['نظرة HR', 'الموظفون', 'الإجازات والعودة', 'الرواتب', 'السلف والخصومات', 'الإقامات والخدمات'], en: ['HR overview', 'Employees', 'Leave & return', 'Payroll', 'Advances & deductions', 'Residencies & services'] } },
  { id: 'reports', icon: '▥', accent: '#876422', title: { ar: 'التقارير', en: 'Reports' }, sections: { ar: ['نظرة التقارير', 'التقارير المالية', 'التقرير الضريبي', 'Hajri Tax', 'الطباعة والتصدير'], en: ['Reports overview', 'Financial reports', 'VAT report', 'Hajri Tax', 'Print & export'] } },
  { id: 'administration', icon: '⚙', accent: '#536b63', title: { ar: 'الإدارة', en: 'Administration' }, sections: { ar: ['نظرة الإدارة', 'الشركات', 'المستخدمون', 'الأدوار والصلاحيات', 'الهوية والثيم', 'النسخ الاحتياطي'], en: ['Administration overview', 'Companies', 'Users', 'Roles & permissions', 'Identity & theme', 'Backup'] } },
];

export const getModule = (id: ModuleId): ModuleDefinition => modules.find((item) => item.id === id) ?? modules[0];

export type ModuleId = 'command' | 'operations' | 'finance' | 'hr' | 'reports' | 'administration';

export type ModuleDefinition = {
  id: ModuleId;
  icon: string;
  accent: string;
  title: { ar: string; en: string };
  description: { ar: string; en: string };
  sections: { ar: string[]; en: string[] };
};

export const modules: readonly ModuleDefinition[] = [
  { id: 'command', icon: '⌘', accent: '#08744d', title: { ar: 'مركز القيادة', en: 'Command center' }, description: { ar: 'صورة تنفيذية وقرارات اليوم.', en: 'Executive view and today’s decisions.' }, sections: { ar: ['النظرة التنفيذية', 'الأولويات', 'التنبيهات', 'موجز النشاط'], en: ['Executive overview', 'Priorities', 'Alerts', 'Activity brief'] } },
  { id: 'operations', icon: '◫', accent: '#176e9e', title: { ar: 'العمليات', en: 'Operations' }, description: { ar: 'المبيعات والمشتريات والمخزون.', en: 'Sales, purchasing, and inventory.' }, sections: { ar: ['نظرة التشغيل', 'المبيعات', 'المشتريات', 'الموردون', 'المخزون والمستودعات', 'الطلبات'], en: ['Operations overview', 'Sales', 'Purchasing', 'Suppliers', 'Inventory & warehouses', 'Requests'] } },
  { id: 'finance', icon: '▣', accent: '#a3532e', title: { ar: 'المالية والمحاسبة', en: 'Finance & accounting' }, description: { ar: 'الفواتير والخزائن والمصروفات.', en: 'Invoices, treasury, and expenses.' }, sections: { ar: ['نظرة المالية', 'الفواتير والمدفوعات', 'الخزائن والبنوك', 'المصروفات', 'الالتزامات والقروض', 'الحسابات والسجل'], en: ['Finance overview', 'Invoices & payments', 'Treasury & banks', 'Expenses', 'Liabilities & loans', 'Accounts & ledger'] } },
  { id: 'hr', icon: '♙', accent: '#bd4778', title: { ar: 'الموارد البشرية', en: 'Human resources' }, description: { ar: 'الموظفون والرواتب والخدمات.', en: 'Employees, payroll, and services.' }, sections: { ar: ['نظرة HR', 'الموظفون', 'الإجازات والعودة', 'الرواتب', 'السلف والخصومات', 'الإقامات والخدمات'], en: ['HR overview', 'Employees', 'Leave & return', 'Payroll', 'Advances & deductions', 'Residencies & services'] } },
  { id: 'reports', icon: '▥', accent: '#876422', title: { ar: 'التقارير', en: 'Reports' }, description: { ar: 'التقارير والضريبة والطباعة.', en: 'Reports, tax, printing.' }, sections: { ar: ['نظرة التقارير', 'التقارير المالية', 'التقرير الضريبي', 'Hajri Tax', 'الطباعة والتصدير'], en: ['Reports overview', 'Financial reports', 'VAT report', 'Hajri Tax', 'Print & export'] } },
  { id: 'administration', icon: '⚙', accent: '#536b63', title: { ar: 'الإدارة', en: 'Administration' }, description: { ar: 'الشركات والمستخدمون والإعدادات.', en: 'Companies, users, and settings.' }, sections: { ar: ['نظرة الإدارة', 'الشركات', 'المستخدمون', 'الأدوار والصلاحيات', 'الهوية والثيم', 'النسخ الاحتياطي'], en: ['Administration overview', 'Companies', 'Users', 'Roles & permissions', 'Identity & theme', 'Backup'] } },
];

export const getModule = (id: ModuleId): ModuleDefinition => modules.find((item) => item.id === id) ?? modules[0];

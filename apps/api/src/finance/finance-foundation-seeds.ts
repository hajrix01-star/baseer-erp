import { FinanceAccountType, FinanceCategoryKind } from '../generated/prisma/client.js';

export type FinanceAccountSeed = Readonly<{
  code: string;
  systemKey: string;
  nameAr: string;
  nameEn: string;
  type: FinanceAccountType;
}>;

export type FinanceCategorySeed = Readonly<{
  code: string;
  accountCode: string;
  nameAr: string;
  nameEn: string;
  kind: FinanceCategoryKind;
  sortOrder: number;
}>;

// Noorix-compatible codes are retained where they describe the same business
// meaning. BASEER-specific control accounts are additive and remain hidden from
// ordinary cash-management screens until a company enables their use.
export const FINANCE_BASE_ACCOUNT_SEEDS: readonly FinanceAccountSeed[] = [
  { code: 'V-001', systemKey: 'CASH', nameAr: 'نقد وخزائن', nameEn: 'Cash and vaults', type: FinanceAccountType.ASSET },
  { code: 'V-002', systemKey: 'BANK', nameAr: 'بنوك ومحافظ إلكترونية', nameEn: 'Banks and electronic wallets', type: FinanceAccountType.ASSET },
  { code: 'V-003', systemKey: 'HUNGERSTATION', nameAr: 'هنقرستيشن', nameEn: 'HungerStation settlement', type: FinanceAccountType.ASSET },
  { code: 'V-004', systemKey: 'JAHEZ', nameAr: 'جاهز', nameEn: 'Jahez settlement', type: FinanceAccountType.ASSET },
  { code: 'V-005', systemKey: 'KEETA', nameAr: 'كيتا', nameEn: 'Keeta settlement', type: FinanceAccountType.ASSET },
  { code: 'AR-001', systemKey: 'RECEIVABLES', nameAr: 'ذمم العملاء', nameEn: 'Accounts receivable', type: FinanceAccountType.ASSET },
  { code: 'ADV-001', systemKey: 'EMPLOYEE_ADVANCES', nameAr: 'سلف الموظفين', nameEn: 'Employee advances', type: FinanceAccountType.ASSET },
  { code: 'PREPAID-001', systemKey: 'PREPAID_EXPENSES', nameAr: 'مصروفات مقدمة', nameEn: 'Prepaid expenses', type: FinanceAccountType.ASSET },
  { code: 'VAT-IN-001', systemKey: 'VAT_INPUT', nameAr: 'ضريبة مدخلات', nameEn: 'Input VAT', type: FinanceAccountType.ASSET },
  { code: 'AP-001', systemKey: 'SUPPLIER_DUES', nameAr: 'ذمم الموردين', nameEn: 'Supplier dues', type: FinanceAccountType.LIABILITY },
  { code: 'VAT-OUT-001', systemKey: 'VAT_OUTPUT', nameAr: 'ضريبة مخرجات', nameEn: 'Output VAT', type: FinanceAccountType.LIABILITY },
  { code: 'LOAN-001', systemKey: 'INCLUSIVE_LOANS', nameAr: 'قروض والتزامات مالية شاملة', nameEn: 'Inclusive loans and financial commitments', type: FinanceAccountType.LIABILITY },
  { code: 'PAY-001', systemKey: 'PAYROLL_PAYABLE', nameAr: 'رواتب مستحقة', nameEn: 'Payroll payable', type: FinanceAccountType.LIABILITY },
  { code: 'EQU-001', systemKey: 'OWNER_CAPITAL', nameAr: 'رأس المال', nameEn: 'Owner capital', type: FinanceAccountType.EQUITY },
  { code: 'EQU-002', systemKey: 'OPENING_BALANCE_CLEARING', nameAr: 'تسوية الأرصدة الافتتاحية', nameEn: 'Opening-balance clearing', type: FinanceAccountType.EQUITY },
  { code: 'OWNER-001', systemKey: 'OWNER_CURRENT', nameAr: 'جاري المالك ومسحوباته', nameEn: 'Owner current account and drawings', type: FinanceAccountType.EQUITY },
  { code: 'RETAINED-001', systemKey: 'RETAINED_EARNINGS', nameAr: 'أرباح مبقاة', nameEn: 'Retained earnings', type: FinanceAccountType.EQUITY },
  { code: 'REV-001', systemKey: 'SALES_REVENUE', nameAr: 'المبيعات', nameEn: 'Sales revenue', type: FinanceAccountType.REVENUE },
  { code: 'PUR-001', systemKey: 'FOOD_MATERIALS', nameAr: 'مواد غذائية', nameEn: 'Food and materials', type: FinanceAccountType.EXPENSE },
  { code: 'PUR-002', systemKey: 'BEVERAGES', nameAr: 'مشروبات', nameEn: 'Beverages', type: FinanceAccountType.EXPENSE },
  { code: 'PUR-003', systemKey: 'PACKAGING', nameAr: 'تعبئة وتغليف', nameEn: 'Packaging', type: FinanceAccountType.EXPENSE },
  { code: 'PUR-004', systemKey: 'KITCHEN_OPERATIONS', nameAr: 'مستلزمات تشغيل مطبخ', nameEn: 'Kitchen operations', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-002', systemKey: 'GOVERNMENT_FEES', nameAr: 'رسوم حكومية وإقامات', nameEn: 'Government fees and residency', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-003', systemKey: 'RENT_UTILITIES', nameAr: 'إيجار ومرافق', nameEn: 'Rent and utilities', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-004', systemKey: 'PAYROLL_EXPENSE', nameAr: 'رواتب وأجور', nameEn: 'Salaries and wages', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-005', systemKey: 'OPERATIONS_MAINTENANCE', nameAr: 'صيانة وتشغيل', nameEn: 'Maintenance and operations', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-006', systemKey: 'MARKETING', nameAr: 'تسويق وهدايا', nameEn: 'Marketing and gifts', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-007', systemKey: 'FINANCIAL_EXPENSES', nameAr: 'مصروفات مالية أخرى', nameEn: 'Other financial expenses', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-008', systemKey: 'ASSET_EXPENSE_LEGACY', nameAr: 'أصول ومعدات تاريخية', nameEn: 'Legacy assets and equipment expense', type: FinanceAccountType.EXPENSE },
  { code: 'FA-001', systemKey: 'FIXED_ASSETS', nameAr: 'أصول ثابتة', nameEn: 'Fixed assets', type: FinanceAccountType.ASSET },
  { code: 'FA-ACCDEP-001', systemKey: 'ACCUMULATED_DEPRECIATION', nameAr: 'مجمع الإهلاك', nameEn: 'Accumulated depreciation', type: FinanceAccountType.ASSET },
  { code: 'DEPR-EXP-001', systemKey: 'DEPRECIATION_EXPENSE', nameAr: 'مصروف إهلاك', nameEn: 'Depreciation expense', type: FinanceAccountType.EXPENSE },
] as const;

export const FINANCE_BASE_CATEGORY_SEEDS: readonly FinanceCategorySeed[] = [
  { code: 'PUR-001', accountCode: 'PUR-001', nameAr: 'مواد غذائية', nameEn: 'Food and materials', kind: FinanceCategoryKind.PURCHASE, sortOrder: 10 },
  { code: 'PUR-002', accountCode: 'PUR-002', nameAr: 'مشروبات', nameEn: 'Beverages', kind: FinanceCategoryKind.PURCHASE, sortOrder: 20 },
  { code: 'PUR-003', accountCode: 'PUR-003', nameAr: 'تعبئة وتغليف', nameEn: 'Packaging', kind: FinanceCategoryKind.PURCHASE, sortOrder: 30 },
  { code: 'PUR-004', accountCode: 'PUR-004', nameAr: 'مستلزمات تشغيل مطبخ', nameEn: 'Kitchen operations', kind: FinanceCategoryKind.PURCHASE, sortOrder: 40 },
  { code: 'REV-001', accountCode: 'REV-001', nameAr: 'المبيعات', nameEn: 'Sales', kind: FinanceCategoryKind.SALE, sortOrder: 50 },
  { code: 'EXP-002', accountCode: 'EXP-002', nameAr: 'رسوم حكومية وإقامات', nameEn: 'Government fees and residency', kind: FinanceCategoryKind.EXPENSE, sortOrder: 60 },
  { code: 'EXP-003', accountCode: 'EXP-003', nameAr: 'إيجار ومرافق', nameEn: 'Rent and utilities', kind: FinanceCategoryKind.EXPENSE, sortOrder: 70 },
  { code: 'EXP-004', accountCode: 'EXP-004', nameAr: 'رواتب وأجور', nameEn: 'Salaries and wages', kind: FinanceCategoryKind.EXPENSE, sortOrder: 80 },
  { code: 'EXP-005', accountCode: 'EXP-005', nameAr: 'صيانة وتشغيل', nameEn: 'Maintenance and operations', kind: FinanceCategoryKind.EXPENSE, sortOrder: 90 },
  { code: 'EXP-006', accountCode: 'EXP-006', nameAr: 'تسويق وهدايا', nameEn: 'Marketing and gifts', kind: FinanceCategoryKind.EXPENSE, sortOrder: 100 },
  { code: 'EXP-007', accountCode: 'EXP-007', nameAr: 'مصروفات مالية أخرى', nameEn: 'Other financial expenses', kind: FinanceCategoryKind.EXPENSE, sortOrder: 110 },
  { code: 'EXP-008', accountCode: 'EXP-008', nameAr: 'أصول ومعدات تاريخية', nameEn: 'Legacy assets and equipment expense', kind: FinanceCategoryKind.EXPENSE, sortOrder: 120 },
] as const;

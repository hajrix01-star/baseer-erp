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
  { code: 'PEND-001', systemKey: 'CASH_BASIS_PENDING_OUTFLOWS', nameAr: 'مصروفات معلّقة حتى السداد', nameEn: 'Pending outflows until payment', type: FinanceAccountType.ASSET },
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
  { code: 'EXP-003', systemKey: 'RENT', nameAr: 'إيجارات', nameEn: 'Rent', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-004', systemKey: 'PAYROLL_EXPENSE', nameAr: 'رواتب وأجور', nameEn: 'Salaries and wages', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-005', systemKey: 'OPERATIONS_MAINTENANCE', nameAr: 'صيانة وتشغيل', nameEn: 'Maintenance and operations', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-006', systemKey: 'MARKETING', nameAr: 'تسويق وهدايا', nameEn: 'Marketing and gifts', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-007', systemKey: 'FINANCIAL_EXPENSES', nameAr: 'مصروفات مالية أخرى', nameEn: 'Other financial expenses', type: FinanceAccountType.EXPENSE },
  { code: 'EXP-008', systemKey: 'ASSET_EXPENSE_LEGACY', nameAr: 'أصول ومعدات تاريخية', nameEn: 'Legacy assets and equipment expense', type: FinanceAccountType.EXPENSE },
  { code: 'UTIL-001', systemKey: 'UTILITIES_SERVICES', nameAr: 'مرافق وخدمات', nameEn: 'Utilities and services', type: FinanceAccountType.EXPENSE },
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
  { code: 'EXP-003', accountCode: 'EXP-003', nameAr: 'إيجارات', nameEn: 'Rent', kind: FinanceCategoryKind.EXPENSE, sortOrder: 70 },
  { code: 'EXP-004', accountCode: 'EXP-004', nameAr: 'رواتب وأجور', nameEn: 'Salaries and wages', kind: FinanceCategoryKind.EXPENSE, sortOrder: 80 },
  { code: 'EXP-005', accountCode: 'EXP-005', nameAr: 'صيانة وتشغيل', nameEn: 'Maintenance and operations', kind: FinanceCategoryKind.EXPENSE, sortOrder: 90 },
  { code: 'EXP-006', accountCode: 'EXP-006', nameAr: 'تسويق وهدايا', nameEn: 'Marketing and gifts', kind: FinanceCategoryKind.EXPENSE, sortOrder: 100 },
  { code: 'EXP-007', accountCode: 'EXP-007', nameAr: 'مصروفات مالية أخرى', nameEn: 'Other financial expenses', kind: FinanceCategoryKind.EXPENSE, sortOrder: 110 },
  { code: 'EXP-008', accountCode: 'EXP-008', nameAr: 'أصول ومعدات تاريخية', nameEn: 'Legacy assets and equipment expense', kind: FinanceCategoryKind.EXPENSE, sortOrder: 120 },
  // This is a navigation group. Its reporting account is shared by the leaves.
  { code: 'UTIL-001', accountCode: 'UTIL-001', nameAr: 'مرافق وخدمات', nameEn: 'Utilities and services', kind: FinanceCategoryKind.EXPENSE, sortOrder: 130 },
] as const;

export type FinanceCategoryHierarchySeed = Readonly<{
  code: string;
  parentCode: string;
  nameAr: string;
  nameEn: string;
  kind: FinanceCategoryKind;
  sortOrder: number;
}>;

// The hierarchy follows Noorix's proven restaurant master-data taxonomy.
export const FINANCE_BASE_CATEGORY_HIERARCHY_SEEDS: readonly FinanceCategoryHierarchySeed[] = [
  { code: 'P1-1', parentCode: 'PUR-001', nameAr: 'لحوم', nameEn: 'Meat', kind: FinanceCategoryKind.PURCHASE, sortOrder: 10 },
  { code: 'P1-2', parentCode: 'PUR-001', nameAr: 'دجاج', nameEn: 'Poultry', kind: FinanceCategoryKind.PURCHASE, sortOrder: 20 },
  { code: 'P1-3', parentCode: 'PUR-001', nameAr: 'خضار وفواكه', nameEn: 'Vegetables and fruits', kind: FinanceCategoryKind.PURCHASE, sortOrder: 30 },
  { code: 'P1-4', parentCode: 'PUR-001', nameAr: 'بضاعة تموينية', nameEn: 'Grocery goods', kind: FinanceCategoryKind.PURCHASE, sortOrder: 40 },
  { code: 'P1-5', parentCode: 'PUR-001', nameAr: 'خامات', nameEn: 'Raw materials', kind: FinanceCategoryKind.PURCHASE, sortOrder: 50 },
  { code: 'P1-6', parentCode: 'PUR-001', nameAr: 'مواد غذائية أخرى', nameEn: 'Other food items', kind: FinanceCategoryKind.PURCHASE, sortOrder: 60 },
  { code: 'P2-1', parentCode: 'PUR-002', nameAr: 'غازيات', nameEn: 'Soft drinks', kind: FinanceCategoryKind.PURCHASE, sortOrder: 10 },
  { code: 'P2-2', parentCode: 'PUR-002', nameAr: 'مياه', nameEn: 'Water', kind: FinanceCategoryKind.PURCHASE, sortOrder: 20 },
  { code: 'P2-3', parentCode: 'PUR-002', nameAr: 'عصائر', nameEn: 'Juices', kind: FinanceCategoryKind.PURCHASE, sortOrder: 30 },
  { code: 'P3-1', parentCode: 'PUR-003', nameAr: 'بلاستيكات', nameEn: 'Plastics', kind: FinanceCategoryKind.PURCHASE, sortOrder: 10 },
  { code: 'P3-2', parentCode: 'PUR-003', nameAr: 'علب وأكواب', nameEn: 'Cups and containers', kind: FinanceCategoryKind.PURCHASE, sortOrder: 20 },
  { code: 'P3-3', parentCode: 'PUR-003', nameAr: 'أكياس', nameEn: 'Bags', kind: FinanceCategoryKind.PURCHASE, sortOrder: 30 },
  { code: 'P4-1', parentCode: 'PUR-004', nameAr: 'فحم', nameEn: 'Charcoal', kind: FinanceCategoryKind.PURCHASE, sortOrder: 10 },
  { code: 'P4-2', parentCode: 'PUR-004', nameAr: 'غاز طبخ', nameEn: 'Cooking gas', kind: FinanceCategoryKind.PURCHASE, sortOrder: 20 },
  { code: 'P4-3', parentCode: 'PUR-004', nameAr: 'مواد تشغيلية', nameEn: 'Operational supplies', kind: FinanceCategoryKind.PURCHASE, sortOrder: 30 },
  { code: 'P4-4', parentCode: 'PUR-004', nameAr: 'مواد تنظيف مطبخ', nameEn: 'Kitchen cleaning supplies', kind: FinanceCategoryKind.PURCHASE, sortOrder: 40 },
  { code: 'E2-1', parentCode: 'EXP-002', nameAr: 'رخصة تجارية', nameEn: 'Commercial license', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E2-2', parentCode: 'EXP-002', nameAr: 'رخصة بلدية', nameEn: 'Municipal license', kind: FinanceCategoryKind.EXPENSE, sortOrder: 20 },
  { code: 'E2-3', parentCode: 'EXP-002', nameAr: 'دفاع مدني', nameEn: 'Civil defense', kind: FinanceCategoryKind.EXPENSE, sortOrder: 30 },
  { code: 'E2-4', parentCode: 'EXP-002', nameAr: 'إقامات وجوازات', nameEn: 'Iqama and passports', kind: FinanceCategoryKind.EXPENSE, sortOrder: 40 },
  { code: 'E2-5', parentCode: 'EXP-002', nameAr: 'زيارات', nameEn: 'Visit visas', kind: FinanceCategoryKind.EXPENSE, sortOrder: 50 },
  { code: 'E2-6', parentCode: 'EXP-002', nameAr: 'غرامات', nameEn: 'Fines and penalties', kind: FinanceCategoryKind.EXPENSE, sortOrder: 60 },
  { code: 'E2-7', parentCode: 'EXP-002', nameAr: 'ضرائب ورسوم أخرى', nameEn: 'Other taxes and fees', kind: FinanceCategoryKind.EXPENSE, sortOrder: 70 },
  { code: 'E2-10', parentCode: 'EXP-002', nameAr: 'رسوم منصات حكومية', nameEn: 'Government platform fees', kind: FinanceCategoryKind.EXPENSE, sortOrder: 80 },
  { code: 'E2-11', parentCode: 'EXP-002', nameAr: 'شهادات صحية وتصاريح موظفين', nameEn: 'Health certificates and employee permits', kind: FinanceCategoryKind.EXPENSE, sortOrder: 90 },
  { code: 'E3-1', parentCode: 'EXP-003', nameAr: 'إيجارات', nameEn: 'Rent', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E3-2', parentCode: 'UTIL-001', nameAr: 'كهرباء', nameEn: 'Electricity', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E3-3', parentCode: 'UTIL-001', nameAr: 'اتصالات وإنترنت', nameEn: 'Telecommunications and internet', kind: FinanceCategoryKind.EXPENSE, sortOrder: 20 },
  { code: 'E3-4', parentCode: 'UTIL-001', nameAr: 'مياه وصرف', nameEn: 'Water and sanitation', kind: FinanceCategoryKind.EXPENSE, sortOrder: 30 },
  { code: 'E3-5', parentCode: 'UTIL-001', nameAr: 'غاز', nameEn: 'Gas', kind: FinanceCategoryKind.EXPENSE, sortOrder: 40 },
  { code: 'UTIL-001-OTHER', parentCode: 'UTIL-001', nameAr: 'خدمات ومرافق أخرى', nameEn: 'Other utilities and services', kind: FinanceCategoryKind.EXPENSE, sortOrder: 50 },
  { code: 'E4-1', parentCode: 'EXP-004', nameAr: 'رواتب وأجور', nameEn: 'Salaries and wages', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E4-2', parentCode: 'EXP-004', nameAr: 'التأمينات الاجتماعية', nameEn: 'GOSI employer contributions', kind: FinanceCategoryKind.EXPENSE, sortOrder: 20 },
  { code: 'E5-1', parentCode: 'EXP-005', nameAr: 'صيانة آلات', nameEn: 'Equipment maintenance', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E5-2', parentCode: 'EXP-005', nameAr: 'قطع غيار', nameEn: 'Spare parts', kind: FinanceCategoryKind.EXPENSE, sortOrder: 20 },
  { code: 'E5-3', parentCode: 'EXP-005', nameAr: 'وقود ومواصلات', nameEn: 'Fuel and transportation', kind: FinanceCategoryKind.EXPENSE, sortOrder: 30 },
  { code: 'E6-1', parentCode: 'EXP-006', nameAr: 'حملات تسويقية', nameEn: 'Marketing campaigns', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E6-2', parentCode: 'EXP-006', nameAr: 'هدايا وضيافة', nameEn: 'Gifts and hospitality', kind: FinanceCategoryKind.EXPENSE, sortOrder: 20 },
  { code: 'E7-1', parentCode: 'EXP-007', nameAr: 'رسوم تحويل', nameEn: 'Transfer fees', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E7-2', parentCode: 'EXP-007', nameAr: 'رسوم سحب', nameEn: 'Withdrawal fees', kind: FinanceCategoryKind.EXPENSE, sortOrder: 20 },
  { code: 'E7-3', parentCode: 'EXP-007', nameAr: 'رسوم إدارة حساب', nameEn: 'Account management fees', kind: FinanceCategoryKind.EXPENSE, sortOrder: 30 },
  { code: 'E7-4', parentCode: 'EXP-007', nameAr: 'فوائد ورسوم قروض', nameEn: 'Loan interest and fees', kind: FinanceCategoryKind.EXPENSE, sortOrder: 40 },
  { code: 'E7-5', parentCode: 'EXP-007', nameAr: 'رسوم أخرى', nameEn: 'Other fees', kind: FinanceCategoryKind.EXPENSE, sortOrder: 50 },
  { code: 'E8-1', parentCode: 'EXP-008', nameAr: 'أثاث', nameEn: 'Furniture', kind: FinanceCategoryKind.EXPENSE, sortOrder: 10 },
  { code: 'E8-2', parentCode: 'EXP-008', nameAr: 'معدات مكتبية', nameEn: 'Office equipment', kind: FinanceCategoryKind.EXPENSE, sortOrder: 20 },
  { code: 'E8-3', parentCode: 'EXP-008', nameAr: 'أجهزة وإلكترونيات', nameEn: 'Devices and electronics', kind: FinanceCategoryKind.EXPENSE, sortOrder: 30 },
  { code: 'E8-4', parentCode: 'EXP-008', nameAr: 'مركبات', nameEn: 'Vehicles', kind: FinanceCategoryKind.EXPENSE, sortOrder: 40 },
  { code: 'E8-5', parentCode: 'EXP-008', nameAr: 'آلات ومعدات', nameEn: 'Machinery and equipment', kind: FinanceCategoryKind.EXPENSE, sortOrder: 50 },
  { code: 'E8-6', parentCode: 'EXP-008', nameAr: 'أصول أخرى', nameEn: 'Other assets', kind: FinanceCategoryKind.EXPENSE, sortOrder: 60 },
] as const;
export const STANDARD_SUPPLIER_KEYS = [
  "SAUDI_ENERGY", "STC", "MOBILY", "ZAIN_SAUDI", "SALAM", "GO_TELECOM", "NATIONAL_WATER_COMPANY",
  "GOSI", "ZATCA", "MINISTRY_OF_COMMERCE", "SAUDI_BUSINESS_CENTER", "MUNICIPALITIES_HOUSING", "HRSD", "PASSPORTS", "CIVIL_DEFENSE", "SAUDI_CHAMBERS",
  "QIWA", "ABSHER_BUSINESS", "MUDAD", "MUQEEM", "BALADY", "AJEER", "MUSANED", "WAFID", "MINISTRY_OF_FOREIGN_AFFAIRS", "SAUDI_POST_SPL",
] as const;
export type StandardSupplierKey = (typeof STANDARD_SUPPLIER_KEYS)[number];
export type StandardSupplierSeed = Readonly<{ key: StandardSupplierKey; nameAr: string; nameEn: string; categoryCode: string; taxNumber?: string }>;
export const STANDARD_SUPPLIER_SEEDS: readonly StandardSupplierSeed[] = [
  { key: "SAUDI_ENERGY", nameAr: "الشركة السعودية للكهرباء", nameEn: "Saudi Electricity Company", categoryCode: "E3-2" },
  { key: "STC", nameAr: "شركة الاتصالات السعودية", nameEn: "Saudi Telecom Company", categoryCode: "E3-3" },
  { key: "MOBILY", nameAr: "شركة اتحاد اتصالات (موبايلي)", nameEn: "Etihad Etisalat Company (Mobily)", categoryCode: "E3-3", taxNumber: "300000699600003" },
  { key: "ZAIN_SAUDI", nameAr: "الشركة السعودية للاتصالات المتنقلة (زين)", nameEn: "Mobile Telecommunications Company Saudi Arabia (Zain)", categoryCode: "E3-3" },
  { key: "SALAM", nameAr: "شركة الاتصالات المتكاملة (سلام)", nameEn: "Integrated Telecom Company (Salam)", categoryCode: "E3-3" },
  { key: "GO_TELECOM", nameAr: "شركة اتحاد عذيب للاتصالات (جو)", nameEn: "Etihad Atheeb Telecommunication Company (GO)", categoryCode: "E3-3" },
  { key: "NATIONAL_WATER_COMPANY", nameAr: "شركة المياه الوطنية", nameEn: "National Water Company", categoryCode: "E3-4" },
  { key: "GOSI", nameAr: "المؤسسة العامة للتأمينات الاجتماعية", nameEn: "General Organization for Social Insurance", categoryCode: "E4-2" },
  { key: "ZATCA", nameAr: "هيئة الزكاة والضريبة والجمارك", nameEn: "Zakat, Tax and Customs Authority", categoryCode: "E2-7" },
  { key: "MINISTRY_OF_COMMERCE", nameAr: "وزارة التجارة", nameEn: "Ministry of Commerce", categoryCode: "E2-1" },
  { key: "SAUDI_BUSINESS_CENTER", nameAr: "المركز السعودي للأعمال", nameEn: "Saudi Business Center", categoryCode: "E2-1" },
  { key: "MUNICIPALITIES_HOUSING", nameAr: "وزارة البلديات والإسكان", nameEn: "Ministry of Municipalities and Housing", categoryCode: "E2-2" },
  { key: "HRSD", nameAr: "وزارة الموارد البشرية والتنمية الاجتماعية", nameEn: "Ministry of Human Resources and Social Development", categoryCode: "E2-10" },
  { key: "PASSPORTS", nameAr: "المديرية العامة للجوازات", nameEn: "General Directorate of Passports", categoryCode: "E2-4" },
  { key: "CIVIL_DEFENSE", nameAr: "الدفاع المدني", nameEn: "Civil Defense", categoryCode: "E2-3" },
  { key: "SAUDI_CHAMBERS", nameAr: "اتحاد الغرف السعودية", nameEn: "Federation of Saudi Chambers", categoryCode: "E2-7" },
  { key: "QIWA", nameAr: "قوى", nameEn: "Qiwa", categoryCode: "E2-10" },
  { key: "ABSHER_BUSINESS", nameAr: "أبشر أعمال", nameEn: "Absher Business", categoryCode: "E2-10" },
  { key: "MUDAD", nameAr: "مدد", nameEn: "Mudad", categoryCode: "E4-1" },
  { key: "MUQEEM", nameAr: "مقيم", nameEn: "Muqeem", categoryCode: "E2-4" },
  { key: "BALADY", nameAr: "بلدي", nameEn: "Balady", categoryCode: "E2-2" },
  { key: "AJEER", nameAr: "أجير", nameEn: "Ajeer", categoryCode: "E2-10" },
  { key: "MUSANED", nameAr: "مساند", nameEn: "Musaned", categoryCode: "E2-10" },
  { key: "WAFID", nameAr: "وافد", nameEn: "Wafid", categoryCode: "E2-11" },
  { key: "MINISTRY_OF_FOREIGN_AFFAIRS", nameAr: "وزارة الخارجية", nameEn: "Ministry of Foreign Affairs", categoryCode: "E2-5" },
  { key: "SAUDI_POST_SPL", nameAr: "سبل", nameEn: "Saudi Post SPL", categoryCode: "E2-4" },
] as const;

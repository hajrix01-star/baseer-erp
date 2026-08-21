# Baseer ERP — User-Facing Modules v3

**Status:** Proposed user navigation architecture  
**Supersedes for navigation:** `BASEER_ERP_MODULE_TAXONOMY_V2.md`  
**Keeps from v2:** Its detailed boundaries remain internal implementation subdomains; they are not all separate launcher modules.
## Current navigation clarification — 2026-08-17

Operational entry screens for **Daily Sales**, **Purchases**, and **Expenses & Obligations** belong to the **Operations** module. Finance remains the authority for the ledger, periods, vault definition, tax and reconciled reporting facts. This changes navigation only; it does not create a second financial source of truth.

## 1. Decision

Baseer ERP will use the familiar professional ERP pattern requested by the owner:

1. The user opens a small set of clear, grouped modules from the Baseer ERP launcher.
2. Opening a module keeps the user inside the same Baseer ERP application, company context, session, data, theme, and permissions.
3. The module shows a dedicated side navigation containing its internal sections.
4. Technical subdomains may be separated in code and contracts, but they are not automatically separate cards/apps for the user.

This is the balance between simplicity for the user and clean architecture for the engineering team.

## 2. The eight Baseer ERP modules

```text
Baseer ERP
├─ مركز القيادة
├─ المالية
├─ العمليات
├─ الأشخاص
├─ المستندات
├─ التقارير
├─ الإدارة
└─ المساعد الذكي
```

These are modules inside one ERP. They do not have separate databases, accounts, themes, or accounting engines.

## 3. Module side navigation

### 3.1 مركز القيادة

```text
مركز القيادة
├─ النظرة التنفيذية
├─ التنبيهات والاستثناءات
├─ التقويم والمناسبات السعودية
├─ خط الأداء الزمني
└─ القرارات والمتابعة
```

It is a read-only decision workspace. It links contextually to the responsible module, but does not own or edit its data.

### 3.2 المالية

```text
المالية
├─ إعدادات المالية
├─ السجل المالي الموحّد
├─ الخزائن والبنوك
├─ الحسابات والدفتر
├─ الفئات والتصنيفات
├─ الفترات والسياسات المالية
├─ الضريبة وحجري تاكس
└─ التسويات المالية
```

**Important internal rule:** sales, procurement, expenses, treasury, accounting, VAT, and Hajri Tax remain separate bounded subdomains in code. They appear together because they are one financial workspace for the owner.

`Hajri Tax` is inside this module because it is a financial-compliance workflow. The tax **report** remains available from Reports as a read-only output; the declaration, filing snapshot, evidence, payment tracking, and amendment workflow live here.

### 3.3 العمليات

```text
العمليات
├─ النظرة التشغيلية
├─ المبيعات اليومية
├─ المشتريات والموردون
├─ المصروفات والالتزامات
├─ الأصناف والوحدات
├─ المستودعات والمخزون
├─ التسجيل الداخلي
├─ طلبات المشتريات والعهدة
├─ الاستلام والوثائق التشغيلية
├─ المواد الأولية والوحدات والتحويلات
├─ منتجات المنيو والرسبي
├─ المخزون والجرد والتكلفة
├─ الأصول والضمان
└─ سجل النشاط التشغيلي
```

Financial postings happen through the central Finance contract; Operations never creates a parallel financial truth.

**طلبات العمليات:** ينشئ مدير المطعم طلب شراء متعدد البنود مباشرةً بلا موافقة أو رفض. يبقى الطلب بانتظار الاستلام، ثم يوثق الاستلام الفعلي الكميات والأسعار والمخزون والعهدة عند الحاجة. التسجيل الداخلي ومنتجات المنيو والرسبي والمواد الأولية والمخزون هي دورة تشغيلية مترابطة موثقة في [قرار الطلبات والرسبي والعهدة](OPERATIONS_ORDERS_RECIPE_AND_CUSTODY_DECISION_2026-08-20.md).

### 3.4 الأشخاص

```text
الأشخاص
├─ دليل الموظفين
├─ ملف الموظف والسجل الوظيفي
├─ الإجازات والعودة
├─ الرواتب والتعويضات
├─ السلف والخصومات
├─ الإقامات والسجلات
├─ خدمات الموظفين
├─ إنهاء الخدمة والتسويات
└─ وثائق الموظفين
```

Payroll and settlement invoke approved Finance contracts for financial effects; People owns the employee workflow.

### 3.5 المستندات

```text
المستندات
├─ الفهرس الموحد
├─ المستندات التجارية
├─ سجلات ووثائق الموظفين
├─ المرفقات والملفات
├─ القوالب والطباعة
└─ الأرشيف والصلاحيات
```

Documents provides secure indexing, storage, access, retention, and print infrastructure. The source module still owns the invoice, employee, asset, or operation itself.

### 3.6 التقارير

```text
التقارير
├─ النظرة التحليلية
├─ التقارير المالية
├─ الربح والخسارة
├─ تقارير المبيعات والمشتريات والمصروفات
├─ تقرير الضريبة
├─ تقارير الخزائن والبنوك
├─ تقارير العمليات والمخزون
├─ تقارير الأشخاص والرواتب
└─ الطباعة والتصدير
```

Reports are read-only server projections. They default to the approved gross-with-VAT display and offer server-side tax separation. They do not create a tax declaration or change source data.

### 3.7 الإدارة

```text
الإدارة
├─ الشركات وملفاتها
├─ المستخدمون والعضويات
├─ الأدوار والصلاحيات
├─ السياسات والإعدادات
├─ الهوية والثيم
├─ التسجيل والإعداد الضريبي
├─ النسخ والاستعادة
├─ التكاملات والتشخيص
└─ سجل التدقيق وإدارة المنصة
```

This module governs central configuration. The theme is visual only and can never create a second workflow or “Classic system.”

### 3.8 المساعد الذكي

```text
المساعد الذكي
├─ المحادثة والمساعدة
├─ الأسئلة السريعة
├─ التحليلات المسموح بها
├─ الملفات والسياق
└─ سجل الجلسة والخصوصية
```

It uses permission-filtered contracts from the other modules. It cannot bypass authorization or invent financial values.

## 4. Why this is more professional

| Wrong extreme | Baseer ERP v3 decision |
| --- | --- |
| One giant Finance page containing everything with no structure | One Finance module with a clear side navigation and internally separated subdomains |
| Fifteen small cards/apps that force the owner to guess where to go | Eight stable modules organized around how the owner works |
| Separate databases/applications per module | One platform, one company context, one accounting engine, one theme/identity/audit system |
| A technical boundary forced into a user navigation boundary | Technical boundaries stay in code; user navigation stays simple |
| Tax report, tax declaration, and tax source values mixed in one page | Finance owns Hajri Tax workflow; Reports owns read-only tax reporting; Accounting owns source amounts |

## 5. Navigation contract

- The Baseer ERP launcher shows the eight modules only after permission filtering.
- A module card opens its native route and its module side navigation.
- Sidebar items are internal native routes, not redirects to Noorix.
- Company switch, language, theme, notifications, and session remain central while moving between modules.
- The top-level launcher and every module sidebar use the shared component system, locale, access policy, and mobile behavior.
- A user sees no section for which they lack read access; a visible screen still relies on server authorization for every action.

## 6. Delivery discipline remains unchanged

This visual grouping does not permit building eight modules in parallel. The Single-Module Focus Policy remains mandatory. We build one selected module completely, while the other seven remain planned.

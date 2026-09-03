# ملكية البيانات — Baseer ERP

هذه بطاقة فهرسة، لا تعيد تعريف schema أو قواعد العمل. المرجع التنفيذي هو `apps/api/prisma/schema.prisma` والعقود في `packages/contracts/src/`.

| نطاق البيانات | المالك | الحدود غير القابلة للتجاوز | المصدر التنفيذي |
|---|---|---|---|
| الهوية، الشركة، العضوية والصلاحيات | Platform Identity & Administration | العزل والتفويض يتحققان في الخادم؛ لا قرار صلاحية في المتصفح | `apps/api/src/identity`, `apps/api/src/company-context`, `apps/api/src/administration` |
| القيود، الحسابات، المبيعات، الخزائن والقراءات المالية | Finance & Accounting | الحساب والترحيل والتقريب ومصدر الحقيقة المالي خلفي؛ القراءة لا تكتب الحقيقة | `apps/api/src/finance`, `packages/contracts/src/finance.ts` |
| الكتالوج والمخزون والمشتريات والعهدة | Operations & Inventory | أي أثر مالي يتم بعقد صريح ولا تنقل UI تكلفة أو رصيداً إلى مصدر حقيقة | `apps/api/src/operations`, `packages/contracts/src/operations.ts` |
| الموظفون والحضور والرواتب | People, Attendance & Payroll | سجل الموظف والجدول/الحضور والقرار التشغيلي بخدمة خادمية مع company scope | `apps/api/src/hr`, `apps/api/src/attendance` |
| التسويق والتقارير ومركز القيادة | Marketing, Reports & Decision Intelligence | read models تشرح ولا تنشئ حقيقة مالية أو تشغيلية | `apps/api/src/marketing`, `apps/api/src/reports`, `apps/api/src/decision-intelligence` |
| الملفات والنسخ والرصد | Platform Data & Operations | metadata والأذونات والاحتفاظ لا تستبدل ملكية مستند العمل | `apps/api/src/file-metadata`, `apps/api/src/backup`, `apps/api/src/observability` |

تغيير schema أو migration أو مصدر حقيقة أو حدود عزل هو `ARCHITECTURAL` تلقائياً.

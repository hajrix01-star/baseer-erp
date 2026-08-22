# BASEER ERP — سجل اعتماد المكتبات

**مرجع الحوكمة:** [التفويض التشغيلي لاعتماد المكتبات](LIBRARY_ADOPTION_OPERATING_AUTHORITY.md).
**قاعدة الحالة:** `Installed / dormant` تعني أن الحزمة موجودة في قفل
الاعتمادات فقط؛ لا تُستخدم في شاشة أو مسار تشغيل قبل اجتياز بوابة المكتبة
والـadapter الخاص بها.

| المكتبة | الإصدار الدقيق | الترخيص | الحالة | أول استخدام مسموح | حدود أساسية |
| --- | --- | --- | --- | --- | --- |
| `react-aria-components` | `1.20.0` | Apache-2.0 | Active foundation | كل مستهلك قابل للبحث أو تاريخ تفاعلي مصنف في manifest | خلف `BaseerCombobox` و`BaseerAriaDatePicker` فقط؛ لا استيراد مباشر أو صلاحية أو منطق مالي. |
| `@internationalized/date` | `3.12.3` | Apache-2.0 | Active foundation dependency | مع `BaseerAriaDatePicker` المركزي | قيمة الأعمال تبقى Gregorian `YYYY-MM-DD`؛ لا UTC coercion أو تحويل هجري ضمن هذا الاعتماد. |
| `react-hook-form` | `7.86.0` | MIT | Active foundation | كل نموذج محول عبر `BaseerFormState` | التحقق الخادمي يبقى حتمياً. |
| `@hookform/resolvers` | `5.9.1` | MIT | Active foundation dependency | مع RHF وZod داخل `BaseerFormState` | لا schema ثانية كمصدر حقيقة. |
| `zod` | `4.4.3` | MIT | Active foundation dependency | تحقق تجربة المستخدم عبر `BaseerFormState` و`BaseerValidatedForm` | المال Decimal string فقط؛ لا coercion إلى JS float، والخادم مصدر التحقق الحتمي. |
| `@tanstack/react-query` | `5.101.4` | MIT | Active foundation | قراءات Baseer عبر `BaseerSessionQueryProvider` | cache boundary يعاد عند company/session/token؛ لا mutation أو حساب مالي. |
| `echarts` | `6.1.0` | Apache-2.0 | Active pilot | لوحة HR تشغيلية من `/hr/overview` | `BaseerChart` lazy، HTML summary/table بديل، ولا حساب أو تفويض في المتصفح؛ سقف التفاعل 500 KB. |
| `@tanstack/react-table` | `9.1.2` | MIT | Active foundation | `BaseerDataGrid` لسجلات HR والمالية ذات cursor/pagination خادمي | الفرز/الفلترة/pagination من الخادم؛ الجداول الصغيرة المحدودة تبقى `DataTable` خفيفة مقصودة. |
| `@tanstack/react-virtual` | غير مثبت | MIT | Deferred | مع جدول مثبت البطء | لا يثبت استباقياً. |

## بوابة تفعيل مكتبة dormant

قبل أول import تشغيلي: يسجل المالك التقني المسار المستهدف، ينشئ Baseer
adapter، ويثبت typecheck/build/budget وAR/EN وRTL/LTR وkeyboard/axe وعزل
company/session. أما الرسوم أو Query فتحتاج read model/API خادمي محدد قبل
تفعيلها. فشل البوابة يعيد المكتبة إلى dormant ولا يغير بقية السجل.

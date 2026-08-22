# BASEER ERP — سجل اعتماد المكتبات

**مرجع الحوكمة:** [التفويض التشغيلي لاعتماد المكتبات](LIBRARY_ADOPTION_OPERATING_AUTHORITY.md).
**قاعدة الحالة:** `Installed / dormant` تعني أن الحزمة موجودة في قفل
الاعتمادات فقط؛ لا تُستخدم في شاشة أو مسار تشغيل قبل اجتياز بوابة المكتبة
والـadapter الخاص بها.

| المكتبة | الإصدار الدقيق | الترخيص | الحالة | أول استخدام مسموح | حدود أساسية |
| --- | --- | --- | --- | --- | --- |
| `react-aria-components` | `1.20.0` | Apache-2.0 | Active pilot | فلتر موظف الإجازات والعودة فقط | خلف `BaseerCombobox`؛ لا API أو صلاحيات أو نموذج إنشاء إجازة. |
| `react-hook-form` | `7.86.0` | MIT | Installed / dormant | نموذج موظف أو مستخدم غير مالي | خلف `BaseerFormField`؛ التحقق الخادمي يبقى حتمياً. |
| `@hookform/resolvers` | `5.9.1` | MIT | Installed / dormant | مع RHF وZod في النموذج نفسه | لا schema ثانية كمصدر حقيقة. |
| `zod` | `4.4.3` | MIT | Installed / dormant | تحقق تجربة المستخدم للنموذج التجريبي | مبالغ بصيغة Decimal string؛ لا JS float للمال. |
| `@tanstack/react-query` | `5.101.4` | MIT | Installed / dormant | تدفق قراءة HR مع cache معزول بالشركة والجلسة | key يتضمن company/principal/filter؛ clear عند sign-out أو company switch. |
| `echarts` | `6.1.0` | Apache-2.0 | Installed / dormant | لوحة خادمية واحدة غير مالية | `BaseerChart` lazy، HTML summary/table بديل، ولا حساب أو تفويض في المتصفح. |
| `@tanstack/react-table` | غير مثبت | MIT | Deferred | جدول كثيف بعد قياس الحاجة | لا يثبت قبل server-side pagination/filter/sort وقياس الحجم. |
| `@tanstack/react-virtual` | غير مثبت | MIT | Deferred | مع جدول مثبت البطء | لا يثبت استباقياً. |

## بوابة تفعيل مكتبة dormant

قبل أول import تشغيلي: يسجل المالك التقني المسار المستهدف، ينشئ Baseer
adapter، ويثبت typecheck/build/budget وAR/EN وRTL/LTR وkeyboard/axe وعزل
company/session. أما الرسوم أو Query فتحتاج read model/API خادمي محدد قبل
تفعيلها. فشل البوابة يعيد المكتبة إلى dormant ولا يغير بقية السجل.

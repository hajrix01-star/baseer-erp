# سجل التحقق — إغلاق تحول مكتبات الموارد البشرية

**Delivery ID:** `HR-LIBRARY-MIGRATION-2026-08-22`

**الحالة:** `Closed` — أُغلق موديول الموارد البشرية محلياً بعد اكتمال الجرد،
التحويل، اختبارات المتصفح، وعزل الشركة والتحقق المالي في 2026-08-22.

**مرجع التنفيذ:** `6942b50`، وتسبقه دفعتا selectors/dates `bda49d2`
وlifecycle forms `71d2351`.

## النطاق المنجز

- النماذج: React Hook Form وZod من بوابة `baseer-form-state` فقط، مع رسائل
  عربية/إنجليزية وربط أخطاء الحقول.
- القيم المالية: Decimal(18,4) سلاسل نصية مع حساب BigInt دقيق؛ لا تحويل
  `Number` أو `toFixed` في payload الراتب والتعويض.
- الاختيارات: `BaseerCombobox` المركزي مع إلغاء الطلب القديم ومسح النطاق عند
  تبديل الشركة.
- التواريخ: `BaseerDatePicker` المركزي مع ISO Gregorian ثابت.
- الجداول: سجلات HR المقسمة خادمياً عبر `BaseerDataGrid` المؤجل؛ لا فرز أو
  تجميع مالي على صفحة جزئية في المتصفح.
- القراءة والرسم: `BaseerCompanyReadQuery` و`BaseerChart` فوق read model
  الخادمي، مع ملخص وجدول HTML مطابقين.

## دليل الإغلاق القابل لإعادة التشغيل

| المجال | الدليل | النتيجة |
| --- | --- | --- |
| الجرد والمعمارية | `check:library-migration-inventory` و`check:architecture` | Pass — `unclassified=0` و`staleManifestTargets=0`، ولا استيراد مباشر للمكتبات |
| الواجهة | web typecheck/build، localization، dialog وfinancial-boundary guards | Pass |
| المتصفح والإتاحة | `npm run test:e2e --workspace @baseer-erp/web` | Pass — `73 passed` و`1 intentional skip` على desktop/mobile، AR/EN وRTL/LTR وaxe |
| HTTP والعزل | `verify:hr-http` | Pass — 401/403، company scope، redaction، cursor/filter binding، idempotency وreversal authorization |
| RLS | `check:hr-rls` | Pass — 28/28 ENABLE + FORCE + tenant policy |
| دورة HR | `verify:hr-onboarding` و`verify:hr-lifecycle` | Pass — onboarding، salary، leave، services، advances، payroll، settlement وreversal |
| السلامة المالية | `verify:hr-financial-integrity` و`verify:journal-properties` | Pass — locks، chronology، history، balances وbalanced decimals |
| الفترات والدفتر | `verify:finance-gate-b-db` و`verify:finance-period-race` | Pass |
| ميزانية الويب | `verify:web-budget` | Pass — startup JS `243,994/250,000 B`، أكبر route `81,264/85,000 B`، Form-state `106,523/110,000 B`، DataGrid `32,188/50,000 B` |
| الاعتمادات | `npm audit --omit=dev --omit=optional` | Pass — zero findings في الرسم القابل للنشر |

ثُبتت ساعة `verify:hr-http` عند تاريخ fixture المقصود حتى يبقى اختبار KPI
حتمياً ولا يتغير مع تاريخ تشغيله. هذا تعديل في verifier فقط ولا يغير
`BusinessDateService` أو أي معنى تشغيلي في التطبيق.

## الحدود المستمرة

لا يعني هذا الإغلاق نشر الإنتاج أو Noorix أو تغيير سياسة الرواتب أو RLS أو
الفترات. خطر Prisma/deepmerge يبقى تحت سياسة النشر الشخصي الخاصة: الحزمة غير
موجودة في API runtime، والمهاجرات job داخلي one-shot، مع انتظار الإصلاح الرسمي.
أي قاعدة بيانات جديدة تطبق migrations/RLS بمالك الجداول ثم تعيد بوابات HR
نفسها قبل التمكين.

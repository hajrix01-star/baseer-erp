# سجل التحقق — إغلاق تحول مكتبات التقارير

**Delivery ID:** `REPORTS-LIBRARY-MIGRATION-2026-08-23`

**الحالة:** `Closed` — أُغلق موديول التقارير محلياً بعد اكتمال الجرد
والتحويل واختبارات المتصفح والعقود وسياسات التقرير وHTTP وRLS.

**مرجع التنفيذ:** `82ae65d7a3b882af8ab981ddf131c32552ebad10`.

## النطاق المنجز

- دليل التقارير ومستندات المستخدم قراءات حية عبر
  `BaseerCompanyReadQuery`، مع مفتاح يعزل الشركة والجلسة واللغة.
- ميزان المراجعة، والأداء النقدي، والتقرير الضريبي قراءات snapshot؛ لا يعاد
  إنشاء `ReportRun` تلقائياً عند focus أو reconnect أو remount/retry. إعادة
  المحاولة قرار مستخدم صريح.
- قراءات الدليل والقيد المصدر تلغي الطلب السابق وتستخدم epoch مع فحص الشركة
  والجلسة قبل عرض النتيجة؛ لا تختلط صفحة أو نتيجة قديمة مع تقرير جديد.
- جداول التقارير بقيت جداول snapshot متخصصة ومقصودة: ميزان المراجعة حتى
  1,000 حساب، والأداء النقدي حتى 500 صف هرمي، والضريبة حتى 4 صفوف. لا فرز أو
  تجميع مالي من صفحات جزئية في المتصفح، ولا DataGrid أو Chart بلا حاجة.
- المبالغ وmetadata و`ledgerRevision` وchecksum تأتي من read-model خادمي؛
  المستند يعاد بناؤه من ReportRun مجمد، وليس من صفوف يرسلها المتصفح.
- حوارات الدليل والقيد تعمل داخل dynamic visual viewport، مع Escape وإعادة
  التركيز ونقر طبيعي على الجوال بلا تجاوزات اختبارية.
- قسم `Hajri Tax` لا يملك حالياً مستهلكاً أو عقد API حياً داخل التطبيق؛ لذلك
  لا توجد instance قديمة لترحيلها. بناؤه الوظيفي يبقى نطاقاً مستقلاً، وليس
  بقية legacy من تحول المكتبات.

## دليل الإغلاق القابل لإعادة التشغيل

| المجال | الدليل | النتيجة |
| --- | --- | --- |
| الجرد والمعمارية | `check:library-migration-inventory` و`check:architecture` | Pass — 153 ملفاً، `unclassified=0` و`stale=0`؛ queries والجداول تحمل قرارات نهائية |
| العقود والتطبيق | checks للعقود وAPI والويب + web build | Pass |
| المتصفح والإتاحة | `reports-mocked-auth.spec.ts` ثم المجموعة الكاملة | Pass — التقارير `6/6` على desktop/mobile؛ المجموعة `97 passed` و`1 intentional skip`، وتشمل AR/EN وRTL/LTR وAxe وperiod/evidence/source/cursor/Escape/focus |
| HTTP والتفويض | `verify:reports-http` | Pass — 401/403، `reports.read`، عزل company/tenant/actor، صلاحيات preview/export، حدود evidence/source وتجميد revision/checksum |
| RLS | `check:reports-rls` | Pass — 19 نموذجاً تصل إليها خدمات التقارير فيها ENABLE + FORCE + tenant USING/WITH CHECK |
| سياسات التقرير | `verify:reporting-r0-b-policy`، `verify:personal-cash-performance-policy`، `verify:personal-cash-performance-report-policy`، `verify:ledger-trial-balance-policy` | Pass |
| الواجهة | localization، dialog وfinancial-boundary guards | Pass — لا حساب مالي في المتصفح ولا تكرار snapshot عند focus |
| ميزانية الويب | `verify:web-budget` | Pass — startup `244,200/250,000 B`، أكبر route `84,195/85,000 B`، startup CSS `54,223/58,000 B`، أكبر route CSS `13,018/16,000 B` |
| الاعتمادات | `npm audit --omit=dev --omit=optional` | Pass — zero findings في الرسم القابل للنشر |
| مراجعة اللجنة | UI، data/read-model، security/quality | Pass نهائي — لا P0 أو P1 خاص بإغلاق التقارير |

## الحدود المستمرة

هذا إغلاق تحول مكتبات وقبول محلي، وليس اعتماد تقرير P&L على أساس الاستحقاق
ولا تقريراً ضريبياً رسمياً ولا إثبات حجم إنتاجي أو نشر عام. الأداء النقدي
الموجود يظل cash-performance وفق عقده. سياسة التاريخ المستقبلي، حدود الحجم
عبر سنوات، وHajri Tax تحتاج نطاقات منتج مستقلة. ثغرة Prisma/deepmerge تبقى
`pending-official-fix` في build/migrate تحت سياسة النشر الشخصي، ولا توجد في
صورة API runtime.

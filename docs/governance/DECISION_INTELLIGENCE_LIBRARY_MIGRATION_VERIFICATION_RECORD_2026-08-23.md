# سجل التحقق — إغلاق تحول مكتبات مركز القرار

**Delivery ID:** `DECISION-INTELLIGENCE-LIBRARY-MIGRATION-2026-08-23`

**الحالة:** `Closed` — أُغلق موديول مركز القرار محلياً بعد اكتمال الجرد
والتحويل واختبارات المتصفح والعقود وHTTP وRLS.

**مرجع التنفيذ:** `97c99bf`.

## النطاق المنجز

- جرى فصل المسار إلى shell صغير ومحتوى مؤجل التحميل، وبقيت كل استيرادات
  المكتبات خلف محولات Baseer المركزية.
- القراءات أصبحت حسب القسم فقط عبر `BaseerCompanyReadQuery`، بمفتاح يشمل
  الشركة والجلسة واللغة والقسم والفترة والصلاحيات، مع `AbortSignal` ومنع
  النتيجة القديمة من الظهور بعد تبدل النطاق.
- نماذج أحداث الشركة والسياق العام وإجراءات التنبيه وسياسة تغير المبيعات
  تستخدم `BaseerValidatedFormField`، والتواريخ تستخدم `BaseerDatePicker` مع
  عقد Gregorian `YYYY-MM-DD`.
- المبالغ والنسب تظل سلاسل عشرية دقيقة؛ أزيلت حسابات `Number` و`Math.round`
  من مسارات القرار، ولا ينشئ المتصفح KPI أو تجميعاً مالياً.
- كل أمر يرسل مفتاح idempotency واحداً متطابقاً في الرأس والجسم. اختلاف
  الحمولة لنفس المفتاح يرجع الآن `409 / IDEMPOTENCY_MISMATCH / do-not-retry`
  ويُسجل في observability كـ409، لا كخطأ خادم 500.
- لم يضف Chart أو DataGrid: لا يوجد حالياً عقد series أو cursor يبرر ذلك،
  والبطاقات والقوائم المحدودة بقيت خفيفة مقصودة.
- أصلح هدف النقر اللمسي في التنبيهات، ويعمل فتح الدليل بالنقر الحقيقي على
  الجوال مع Escape وإعادة التركيز، بلا `force` أو التفاف اختباري.

## دليل الإغلاق القابل لإعادة التشغيل

| المجال | الدليل | النتيجة |
| --- | --- | --- |
| الجرد والمعمارية | `check:library-migration-inventory` و`check:architecture` | Pass — 154 ملفاً؛ `unclassified=0` و`stale=0`، وقرارات form/date/query نهائية |
| العقود والتطبيق | checks للعقود وAPI والويب + web build | Pass |
| المتصفح والإتاحة | `decision-intelligence-mocked-auth.spec.ts` ثم المجموعة الكاملة | Pass — مركز القرار `6/6` desktop/mobile؛ المجموعة `103 passed` و`1 intentional skip`، وتشمل الأقسام 0..4 وAR/EN وRTL/LTR وAxe وkeyboard/focus/Escape والنقر اللمسي |
| HTTP والتفويض | `verify:decision-intelligence-http` | Pass — 401/403، capability/company/tenant، الجلسة الملغاة، alert/evidence/policy/feedback، replay والمخالفة 409 بلا تكرار audit |
| RLS | `check:decision-intelligence-rls` | Pass — 19 نموذجاً تصل إليها خدمات مركز القرار فيها tenant UUID وENABLE + FORCE + USING/WITH CHECK |
| أساس القرار | `verify:decision-intelligence-foundation` و`check:permissions` | Pass — 112 صلاحية وسياسات الدليل والسياق الأساسية |
| الواجهة | localization، dialog وfinancial-boundary guards | Pass — لا حساب مالي أو قرار صلاحية في المتصفح |
| ميزانية الويب | `verify:web-budget` | Pass — startup `243,878/250,000 B`، أكبر route `79,814/85,000 B`، startup CSS `54,223/58,000 B`، أكبر route CSS `13,018/16,000 B` |
| الاعتمادات | `npm audit --omit=dev --omit=optional` | Pass — zero findings في الرسم القابل للنشر |
| مراجعة اللجنة | UI، data/metric-contract، security/quality | Pass نهائي — لا P0 أو P1 خاص بإغلاق مركز القرار |

## الحدود المستمرة

هذا إغلاق تحول مكتبات وقبول محلي، وليس اعتماد KPI رسمي جديد أو سياسة قرار
جديدة أو موصل خارجي أو مزود AI أو نشر عام. إضافة رسم مستقبلي تحتاج عقد series
خادمياً يتضمن المصدر والأساس وas-of والجودة، وإضافة DataGrid تحتاج cursor
خادمياً. ثغرة Prisma/deepmerge تبقى `pending-official-fix` في build/migrate
وتخضع لسياسة النشر الشخصي؛ السلسلة المتأثرة غير موجودة في صورة API runtime.

# سجل التحقق — إغلاق تحول مكتبات الإدارة والصلاحيات

**Delivery ID:** `ADMINISTRATION-LIBRARY-MIGRATION-2026-08-22`

**الحالة:** `Closed` — أُغلق موديول الإدارة والصلاحيات محلياً بعد اكتمال
الجرد والتحويل واختبارات المتصفح والعقود والتفويض والجلسات وRLS.

**مرجع التنفيذ النهائي:** `33a7175eda5fbef138fd20c8ab346799f8dde325`
(`4e978f4` لدفعة التحويل، ثم `33a7175` لضمان فشل الإغلاق عند تعذر تحديث
لقطة الخادم).

## النطاق المنجز

- نماذج الشركات والمستخدمين والأدوار تمر عبر
  `BaseerValidatedForm` المركزي، وتُحمّل RHF/Zod عند التفاعل فقط.
- قراءة لوحة الإدارة تمر عبر `BaseerCompanyReadQuery` المعزول بالشركة
  والجلسة، وتلغي الطلب السابق عند تغير النطاق. إعادة التحميل بعد الأمر
  تُنتظر فعلياً وتفشل بوضوح إذا تعذر جلب لقطة الخادم الجديدة؛ لا تحديث
  متفائل لصلاحيات أو عضويات أو جلسات.
- جدول المستخدمين بقي `DataTable` خفيفاً ومقصوداً لأن عقد overview يحد
  اللقطة إلى 500 مستخدم ويحتاج فرزاً محلياً؛ ليس مستهلك legacy معلّقاً.
- القوائم الثابتة القصيرة ومصفوفة الصلاحيات بقيت عناصر خفيفة مقصودة؛ لا
  حاجة لـCombobox أو DataGrid أو DatePicker في هذا السطح.
- تحويل نسبة VAT إلى basis points دقيق ومحصور بنطاق آمن من دون تقريب float،
  بينما الخادم يبقى صاحب التفويض والتحقق النهائي.
- لم يتغير method أو path أو payload أو RBAC أو RLS. إلغاء الجلسات، تنقيح
  التدقيق، حماية آخر مالك وأسباب التغيير بقيت خادمية.

## دليل الإغلاق القابل لإعادة التشغيل

| المجال | الدليل | النتيجة |
| --- | --- | --- |
| الجرد والمعمارية | `check:library-migration-inventory` و`check:architecture` | Pass — 153 ملفاً، `unclassified=0` و`stale=0`، ولا استيراد مكتبة مباشر من شاشات الإدارة |
| العقود والتطبيق | checks للعقود وAPI والويب + web build | Pass |
| المتصفح والإتاحة | `administration-mocked-auth.spec.ts` ثم المجموعة الكاملة | Pass — الإدارة `8/8` على desktop/mobile؛ المجموعة الكاملة `91 passed` و`1 intentional skip`، وتشمل AR/EN وRTL/LTR وAxe ورفض non-owner |
| دورة الإدارة | `verify:administration-lifecycle` | Pass — 401 بلا جلسة، 403 لغير الإدارة، عزل tenant، إلغاء الجلسة والتوكن القديم، last-owner وaudit redaction |
| المصادقة | `verify:auth-throttling` و`check:session-resilience` | Pass — حدود IP والهوية و`Retry-After: 900`، مع بقاء شرط نسخة API واحدة |
| الصلاحيات | `check:permissions` | Pass — 112 capability |
| RLS | `check:administration-rls` | Pass — 9/9 جداول إدارة وهوية فيها ENABLE + FORCE + tenant policy |
| الواجهة | localization، dialog وfinancial-boundary guards | Pass |
| ميزانية الويب | `verify:web-budget` | Pass — startup `244,192/250,000 B`، أكبر route `84,195/85,000 B`، CSS startup `54,162/58,000 B`، form-state `37,144/110,000 B` |
| الاعتمادات | `npm audit --omit=dev --omit=optional` | Pass — zero findings في الرسم القابل للنشر |

## الحدود المستمرة

هذا إغلاق تحول مكتبات وقبول محلي، لا نشر عام ولا Noorix ولا تفعيل دعوات أو
MFA أو تغيير سياسة صلاحيات. حماية throttling في الذاكرة مقصورة على نسخة API
واحدة؛ التوسع الأفقي يحتاج مخزناً ذرياً مشتركاً واختباراً عابراً للنسخ.
ثغرة Prisma/deepmerge ما زالت `pending-official-fix` في build/migrate تحت
سياسة النشر الشخصي، وليست ضمن صورة API runtime.

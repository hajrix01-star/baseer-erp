# سجل التحقق — إغلاق تحول مكتبات المالية والمحاسبة

**Delivery ID:** `FINANCE-LIBRARY-MIGRATION-2026-08-22`

**الحالة:** `Closed` — أُغلق موديول المالية والمحاسبة محلياً بعد اكتمال
الجرد والتحويل واختبارات المتصفح والعقود وHTTP وRLS والدفتر والفترات.

**مرجع التنفيذ:** `a1cbf54e178602820b14a98b840801b2eca2a3da`.

## النطاق المنجز

- النماذج المالية والمصادقة والتهيئة تمر عبر `BaseerFormState` أو
  `BaseerValidatedForm` المركزي؛ Zod/RHF يحمّلان عند التفاعل ولا ترفع المكتبة
  حجم المسار الأولي.
- المبالغ تبقى Decimal strings. الجمع والمقارنة والمتوسطات المالية تستخدم
  arithmetic دقيقاً، وحارس المصدر يمنع إعادة `Number()` إلى مسارات المال.
- تواريخ العمل الحية تستخدم `BaseerDatePicker` وتحافظ على Gregorian
  `YYYY-MM-DD` من دون UTC coercion.
- اختيار المورد والفئة البعيد يستخدم `BaseerCombobox` مع scope للشركة والجلسة
  و`AbortSignal` يصل إلى طلب الشبكة؛ لا تظهر نتيجة بحث قديمة بعد تغير النطاق.
- سجلات المبيعات والفواتير والحسابات والخزينة والدفعات تستخدم
  `BaseerDataGrid` في وضع الخادم، وتبقى الجداول الصغيرة المحدودة خفيفة عمداً.
- ملخص الحسابات يأتي من نفس tenant transaction ويُجمع بـ`Prisma.Decimal`؛ لا
  aggregate مالي من صفحة جزئية في المتصفح.

## دليل الإغلاق القابل لإعادة التشغيل

| المجال | الدليل | النتيجة |
| --- | --- | --- |
| الجرد والمعمارية | `check:library-migration-inventory` و`check:architecture` | Pass — 153 ملفاً، `unclassified=0` و`stale=0`، ولا استيراد مكتبة مباشر من الشاشات |
| العقود والتطبيق | checks للعقود وAPI والويب + web build | Pass |
| المتصفح والإتاحة | `npm run test:e2e --workspace @baseer-erp/web` | Pass — `83 passed` و`1 intentional skip` على desktop/mobile، ويشمل Finance setup وTreasury وAccounts/Invoice cursor وAxe |
| HTTP والمبيعات اليومية | `verify:daily-sales-http` | Pass — auth/company scope، bounded reads، idempotency، preview، VAT، calendar وhistory |
| قاعدة البيانات المالية | `verify:daily-sales-db` و`verify:finance-gate-b-db` | Pass — VAT، العزل، journal seal/balance، dues/loans/recurring، batches والتحويلات |
| الفترات والدفتر | `verify:finance-period-race` و`verify:journal-properties` | Pass — قفل close/post وخصائص توازن Decimal |
| RLS | `check:finance-rls` | Pass — 34/34 Finance models فيها ENABLE + FORCE + tenant policy |
| الواجهة | localization، dialog، session وfinancial-boundary guards | Pass — ويشمل AbortSignal للبحث المالي ومنع JS money coercion |
| ميزانية الويب | `verify:web-budget` | Pass — startup `244,191/250,000 B`، أكبر route `84,164/85,000 B`، form-state `106,503/110,000 B`، DataGrid `32,230/50,000 B` |
| الاعتمادات | `npm audit --omit=dev --omit=optional` | Pass — zero findings في الرسم القابل للنشر |

## الحدود المستمرة

هذا إغلاق تحول مكتبات وقبول محلي، لا نشر إنتاج ولا Noorix ولا تقرير P&L ولا
ربط بنكي أو إثبات حجم إنتاجي. ثغرة Prisma/deepmerge ما زالت `pending-official-fix`
في build/migrate تحت سياسة النشر الشخصي؛ لا توجد في API runtime. أي قاعدة بيانات
جديدة تطبق migrations/RLS بمالك الجداول ثم تعيد بوابات Finance قبل التمكين.

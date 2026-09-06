# بطاقة أثر — تقييمات Google Business والتحليل

**المعرف:** `BASEER-IMPACT-2026-09-06-GOOGLE-BUSINESS-REVIEWS-SYNC`
**المرجع:** `BASEER-ARCH v1.0` / `ADR-MKT-001` / `ADR-MKT-003`
**التصنيف:** `ARCHITECTURAL`
**الحالة:** G5 مكتمل محلياً؛ G6–G8 مرشح قبول ونشر بعد مراجعة مستقلة وCI.

## الهدف ومعيار القبول

ينتقل المدير من اتصال Google Business الموجود إلى صفحة واحدة تعرض تقييماته
الحقيقية وتحليلها المبسط وحالة الردود الموجودة، عبر زر «مزامنة الآن». لا توجد
خطوة ربط إضافية، ولا اختيار حساب/موقع، ولا إدخال مفاتيح، ولا اتصال Google من
المتصفح.

يجب أن يثبت التنفيذ أن:

1. لا يقرأ أو يكتب Google إلا اتصال الشركة الحالي وموقعها المختار.
2. يرفض sync غير المتصل أو المتداخل قبل egress، ولا يسرب secret أو raw payload؛ lease
   لمدة 30 دقيقة يغطي حد القراءة الأقصى، ولا تكتب نتيجة run مستبدل facts.
3. يحفظ كل تقييم idempotently ويعرض أرقاماً محسوبة من الخلفية مع المصدر ووقت
   القراءة، أو حالة صادقة بلا أصفار وهمية.
4. تبقى الردود المعروضة read-only؛ سياسة الرد التلقائي لا تنشر في هذه الشريحة.
   يحل ADR-MKT-004 محل احتفاظ النسخة الأولى: يبقى سجل التقييم الذي تعيده Google
   كاملاً ما دام الاتصال قائماً، ويحذف عند فصل الاتصال.
5. يعمل العرض عربي/إنجليزي وRTL/LTR وجوال/سطح مكتب، بالمكونات المركزية.

## المسارات والعقود المتأثرة

| الطبقة | الملكية والتغيير |
| --- | --- |
| Prisma/migration | جدول fact إضافي مقيد tenant/company/mapping، RLS/FORCE RLS وفهارس القائمة |
| API | `GET /v1/marketing/reputation/reviews` و`POST /v1/marketing/reputation/reviews:sync` |
| service | refresh token خادمي، Google v4 reviews pagination، lease، upsert، تحليل وread model |
| contracts | schemas لصفحة reviews وreceipt المزامنة فقط؛ لا credential أو raw payload |
| web | صفحة السمعة: زر مزامنة، KPIs، تحليل خادمي، جدول التقييمات وحالة الردود |

## خارج النطاق

Google Ads، GA4، اختيار مورد يدوي، scheduler/backfill، نقل token القديم، نشر
رد أو إنشاء رد تلقائي، حذف التطبيق القديم، وتغيير أي حقيقة مالية.

## دليل المصدر

المصدر السابق `D:/Codex/Baseer/apps/web/src/lib/google-business-sync.ts` يثبت
المسار الرسمي `GET https://mybusiness.googleapis.com/v4/{location}/reviews`
والترقيم بـ`pageToken`. راجعنا مرجع Google الرسمي في 2026-09-06؛ يؤكد أن
`accounts.locations.reviews.list` يتطلب `business.manage` ويعيد averageRating
وtotalReviewCount وnextPageToken. يعيد Baseer استخدام هذا الجزء فقط، لا مسار
النشر القديم.

## دليل التنفيذ المحلي — 2026-09-06

- نجحت contracts build وAPI/web typecheck وAPI/web production build و`prisma validate`.
- نجحت بوابات architecture وNest registration وpermissions وauthorization وweb transport
  وحارسا Google Business القائمان.
- نجح verifier الشريحة: يثبت رفض الاتصال غير الجاهز قبل أي Google egress، وحفظ
  facts المعزولة، وملخص الخلفية والرد الموجود للقراءة فقط.
- لم تطبق migration على قاعدة اختبار في هذه النسخة المعزولة لغياب ملف
  `apps/api/.env.baseer-test`؛ تبقى بوابة migration/RLS الحية مطلوبة قبل G8.

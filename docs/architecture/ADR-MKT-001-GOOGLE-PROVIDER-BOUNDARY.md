# ADR-MKT-001 — حد موصلات Google للتسويق والسمعة

**الحالة:** Accepted for the first implementation slice — `2026-09-05`
**المرجع:** `BASEER-ARCH v1.0` / `BASEER-IMPACT-2026-09-05-MARKETING-REPUTATION-MIGRATION-PROGRAM`
**المالكون:** Marketing, Reports & Decision Intelligence؛ Platform Data & Operations؛ Platform Identity & Administration

## السياق

يرحل Baseer ERP قدرات Google Business والسمعة وGoogle Ads من التطبيق السابق،
مع بقاء Google Ads للقراءة فقط وإبقاء النشر الآلي للردود محصوراً بسياسة وموافقة
صريحة. النظام الحالي يملك control plane محدوداً وبدء OAuth محمياً، لكنه لا يملك
vault دائماً أو اختياراً صريحاً للحساب/الموقع أو حقائق مزود أو ناشراً.

## القرار

1. تبقى React واجهة عرض وإدخال فقط. لا تدخلها رموز OAuth، ولا تحسب CTR/CPC/CPA
   أو إجماليات حقائق المزوّد، ولا تستدعي Google مباشرة.
2. يعيش كل موصل داخل `apps/api/src/marketing` في modular monolith؛ لا SDK أو
   خدمة مستقلة في هذه المرحلة. Google Business وGoogle Ads اتصالان مستقلان ولا
   يتشاركان credential أو mapping.
3. يفصل credential المشفر عن `MarketingProviderConnection`. لا يحمل صف الاتصال
   token أو secret، ولا يظهر credential في عقد أو audit أو سجل تشغيل.
4. لا يصبح الاتصال صالحاً لأن OAuth نجح فقط: بعد callback الخادمي، يكتشف الخادم
   الموارد ثم يطلب اختيار حساب/موقع صريحاً وموافقة تدقيق قبل أي sync.
5. تخزن حقائق المزوّد مع المورد والفترة والمنطقة الزمنية والعملة عند انطباقها
   و`sourceFreshAt` والتغطية والجودة؛ الغائب أو المتأخر لا يحول إلى صفر. لا
   تتحول هذه الحقائق إلى قيد أو مبيعات ERP أو ROAS.
6. أي أثر خارجي لاحق يمر بخلفية خادمية: حارس سياسة → outbox بــ idempotency →
   worker محدود → receipt/reconcile. لا ينشر المتصفح، ولا تعاد محاولة timeout
   غير المحسوم بالنشر الأعمى.
7. البداية fail-closed: egress وOAuth الفعلي والكتابة على Google تظل معطلة حتى
   تكتمل بوابات الموصل وpilot وموافقة المالك. لا يستورد رمزاً مشفراً من التطبيق
   السابق؛ يعاد التفويض أو ينفذ مسار re-encryption مدقق ومصرح به لاحقاً.
8. لـGoogle Ads، يختار كل company-admin Customer ID وسياق MCC صراحةً بعد
   discovery خادمي. لا يقبل الخادم GAQL من المتصفح؛ يسمح فقط باستعلامات daily
   read-only مثبتة. يحمل كل fact العملة والمنطقة الزمنية و`sourceFreshAt` وحالة
   التغطية؛ ويبقى `cost_micros` وقيم التحويل حقائق Ads، لا مبالغ أو إيرادات ERP.

## البدائل المستبعدة

| البديل | سبب الرفض |
| --- | --- |
| اتصال Google من المتصفح | يسرّب حدود OAuth ويجعل العزل والحصص والتدقيق غير موثوقين. |
| إعادة استخدام refresh token القديم | اختلاف مفاتيح التشفير وغياب سلسلة موافقة قابلة للتحقق. |
| وضع credentials داخل صف الاتصال | يخلط الحالة المرئية بسر المصادقة ويوسع خطر القراءة والتدقيق. |
| استيراد raw payload دائماً | يخالف مبدأ الاحتفاظ الأدنى ويعوق التطهير. |
| Google Ads mutate أو اعتبار التحويل إيراداً | خارج تفويض المنتج ومصدر الحقيقة المالي. |

## أثر التنفيذ والتوافق

- يوسع schema والعقود عبر migrations تدريجية وRLS/`FORCE RLS` لكل جدول جديد.
- تظل عقود الحالة الحالية متوافقة إلى أن تصدر read model versioned للاتصال.
- لا حذف أو تغيير للتطبيق السابق في هذه الشريحة؛ مسار الرجوع هو تعطيل connection
  ووقف worker وإبقاء المصدر للقراءة والمطابقة.

## معايير التحقق قبل التفعيل الحي

- عزل tenant/company وRBAC وaudit وidempotency مثبتة بالاختبارات.
- لا secret في API response أو logs أو audit أو browser bundle.
- اختيار صريح للموارد، disconnect/revoke وglobal/company kill switch مثبتة.
- pilot محدود ومطابقة موثقة قبل التوسع أو القطع.
- مسار Ads يثبت بالمخزون والاختبارات غياب عمليات mutate، ويحترم quota وrate limit
  ويعرض قيمة التحويل وحدود attribution/lag للمستخدم.

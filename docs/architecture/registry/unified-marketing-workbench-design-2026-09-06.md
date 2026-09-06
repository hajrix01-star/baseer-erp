# تصميم G2 — مركز التسويق والسمعة الموحد

**المعرف:** `BASEER-MKT-UNIFIED-DESIGN-2026-09-06`
**يرتبط بـ:** `BASEER-IMPACT-2026-09-06-UNIFIED-MARKETING-WORKBENCH`
**الحالة:** معتمد للتنفيذ المرحلي؛ لا يعني تشغيل مزامنة أو نقل بيانات قديمة.

## قرار المنتج

يتعامل المستخدم مع Google من موضع واحد فقط: **المصادر والربط**. يضغط المسؤول
«ربط Google Business»، يكمل موافقة Google، ثم يحفظ Baseer المورد الوحيد فقط
عند عدم وجود التباس. لا ننسخ سلوك Baseer السابق الذي يختار أول حساب وأول موقع.
لا صفحة اختيار، ولا مفتاح، ولا token، ولا مرحلة ثانية للمستخدم.

توجد خمس صفحات مرئية مرتبة كما يلي:

1. **النظرة والنتيجة:** ملخص ERP المعتمد وحالة كل مصدر وما يستطيع المدير فعله.
2. **الحملات والعروض:** سجل الحملات، التقويم ضمنه، وروابط المستندات المالية
   والسياق وبصيرة.
3. **السمعة والتقييمات:** حقائق التقييمات عندما تصل، وصف سياسة الرد الداخلية؛
   لا نشر.
4. **Google Ads:** facts القراءة فقط، وفصل واضح بين conversion من Ads والمبيعات
   الرسمية من ERP.
5. **المصادر والربط:** الحالة وزر Google Business الوحيد وسياسات المصدر.

`التقويم التسويقي` لا يختفي وظيفياً؛ ينتقل كعرض داخل «الحملات والعروض»، ولذلك
لا يعد المستخدم صفحة مستقلة إضافية.

## الملكية ومصادر الحقيقة

| المجال | المالك | ما لا يملكه |
| --- | --- | --- |
| الحملات والسياق | `MarketingService` | لا يكتب قيداً أو مستنداً مالياً. |
| المصروف الفعلي والمبيعات | Finance/Reports القائمان | لا يقبلان رقم Ads أو نتيجة بصيرة كحقيقة مالية. |
| اتصال Google وcredential | `MarketingProviderConnection` + vault وOAuth state | لا يخزنان facts أو raw payload في connection. |
| facts المزود | read models company-scoped، بعد الشريحة المخصصة | لا تعود إلى المتصفح ولا تصبح مبيعات. |
| الردود | policy ثم outbox مستقبلي | لا تنشر بمجرد OAuth أو تغيير policy. |
| بصيرة | حد خادمي قائم وanalysis readiness | لا تنشئ رقماً، أو سبباً مؤكداً، أو قراراً مالياً/نشرًا. |

## العقود والقراءة

الشريحة الأولى تعيد استعمال `GET /v1/marketing` و`GET
/v1/marketing/provider-connections`، ولا تكسر عقدهما. تضيف الواجهة فقط تفسيراً
موحداً لحالة المصدر. في شريحة facts لاحقة تكون العقود خادمية ومحدودة:

| العقد المستقبلي | الصلاحية | الضمان |
| --- | --- | --- |
| `GET /v1/marketing/reputation/reviews?cursor&from&to` | `marketing.google-business.profile.read` | cursor opaque، حد 50، `sourceStatus` و`asOf`، لا صفر صامت. |
| `GET /v1/marketing/google-ads/performance?from&to` | `marketing.google-ads.reporting.read` | facts مجمعة، الفترة/العملة/التغطية، ووسم «ليست مبيعات». |
| `POST /v1/marketing/provider-connections/google-business/pilot/authorization` | `marketing.google-connection.manage` | الإجراء الوحيد؛ OAuth PKCE خادمي؛ سياق الشركة المفتوحة. |
| `PUT /v1/marketing/reputation/reply-policy` | `marketing.reputation.policy.manage` | سياسة داخلية فقط؛ لا تشغيل عامل أو outbox. |

لا يضاف endpoint لإرسال review reply أو لتعديل Ads في هذه الخطة.

## نموذج البيانات المرحلي

لا تنسخ جداول legacy ولا raw provider response. عند اعتماد شريحة fact، تكون
migration additive وتضيف (أسماء العمل قابلة للمراجعة قبل migration):

- `MarketingGoogleBusinessReviewFact`: tenant/company/connection scoped، مع
  provider review identifier، rating، وقت الإنشاء/التحديث، النص والاسم
  المتنقحين، reply state، `fetchedAt` وhash. مفتاح فريد company + connection +
  provider identifier وفهارس للقائمة والتاريخ.
- `MarketingProviderDailyFact`: tenant/company/connection/provider/date scoped؛
  قيم Ads المجمعة فقط، العملة والتغطية و`asOf`. مفتاح فريد لكل اليوم/النطاق.
- توسيع `MarketingProviderSyncRun`: checkpoint مشفر/محمي، kind، counts،
  safe failure code وattempt، من دون token أو raw payload.
- `MarketingProviderSyncDeadLetter`: metadata فقط، TTL تشغيلي؛ لا نص تقييم أو
  response من Google.

كل foreign key وunique constraint يستعملان `tenantId` و`companyId`. لا يوجد
استعلام أو فك vault أو mapping يعتمد على شركة مغايرة.

## مزامنة، استيراد، وإتاحة

المتصفح لا يصل Google. العامل الخادمي يقرأ credential في سياق الشركة، ويحصل على
lease لrun واحد، ويكتب صفحة (≤100 record) وcheckpoint في transaction واحدة.
backfill محدود إلى 100 page/run، والقائمة للمستخدم cursor ≤50. يعاد الخطأ 1، 5،
15، 60 دقيقة ثم يحول إلى `BLOCKED` مع message آمن؛ لا retry لا نهائي. لا يُشغّل
أي worker أو scheduler في هذه الشريحة قبل migration، اختبارات idempotency،
قياسات rate limit، ومراجعة تشغيل مستقلة.

عند عدم وجود اتصال أو facts، يعرض السطح `غير متصل` أو `لا توجد بيانات بعد` مع
سبب ووقت تحديث، وليس `0`. التحديث المباشر للوحة لا يسبب egress؛ يقرأ آخر facts
محفوظة فقط.

## فصل ARZ والمعلم الشامي

ARZ هو pilot الحالي فقط. يدخل المعلم الشامي بنفس الزر والرحلة بعد بوابة قبول
خاصة به: eligibility منفصل، credential/mapping منفصلان، حقائق منفصلة، واختبار
RLS/e2e يرفض كل cross-company request. لا migration لtoken ولا مورد من Baseer
السابق، ولا من ARZ إلى المعلم الشامي.

## خطة التنفيذ العمودية

| الشريحة | القيمة المرئية | لا تتضمن |
| --- | --- | --- |
| A — السطح الموحد | الصفحات الخمس، اسم/ترتيب صحيحان، حالة اتصال موحدة، إصلاح ظهور/رفض الصلاحية | facts أو egress أو migration. |
| B — Google Business facts | reviews read-only وcursor وsource quality بعد تشغيل sync آمن | automated replies أو نشر. |
| C — Google Ads facts | قراءة performance ووسم عدم المساواة بالمبيعات | إنشاء/تعديل Ads. |
| D — الردود المحكومة | outbox، مراجعة، approval، receipt، guardrails | auto-publish من policy وحدها. |
| E — المعلم الشامي | تفعيل مستقل واختبارات عزل | مشاركة ARZ أو نقل أسرار. |

## قرار G3 — المكتبات والمكوّنات

لا تضاف مكتبة. `apps/web/package.json` يملك React وReact Aria والمكونات المركزية
والـchart runtime القائم؛ الشريحة A لا تحتاج chart أو modal أو animation جديداً.
تستخدم `BaseerCard` و`BaseerSummaryMetric` و`BaseerButton` و`BaseerInfoHint`
و`BaseerCompanyReadQuery` وحالات `BaseerEmptyState` الموجودة. أي قائمة reviews
كبيرة في B تستعمل الـcursor الخادمي أولاً؛ لا تركّب virtualization قبل قياس يثبت
الحاجة. الحركة، إن أضيفت لاحقاً، CSS قصيرة تحترم reduced motion ولا تؤخر التنقل.

## تصميم G4 — تجربة الشريحة A

- الرأس يعرّف الشركة والسياق ثم «آخر تحديث» وحالة المصدر؛ لا بطاقة رقم بلا مصدر.
- كل حالة مزود بطاقة واحدة ذات نص ظاهر: متصل للقراءة فقط، بانتظار Google، غير
  متصل، أو متعذر مع إعادة المحاولة. `؟` يظهر فقط لشرح المصطلح مثل «قراءة فقط»
  أو «تحويل Ads»، لا لإخفاء تحذير مهم.
- **النظرة** تجمع KPI المالية الحالية وحالتي Google الصحيحتين، مع رابط إلى
  الموضع المناسب؛ لا تكرر إعدادات الربط.
- **الحملات والعروض** تستضيف سجل الحملة ثم التقويم والأرقام الرسمية؛ لا ينقل
  المستخدم بين قسمين للهدف نفسه.
- **السمعة والتقييمات** تظهر اتصال Google Business وسياسة الرد فقط، وتحفظ نبرة
  الرد/الحارس مع شرح واضح أن لا نشر حالياً.
- **Google Ads** بطاقة مصدر مستقلة وempty state أمينة حتى وصول facts؛ لا تُعرض
  بطاقة «صفر تكلفة».
- **المصادر والربط** تحتوي زر Google Business الرئيسي وحده. لا توجد قوائم
  حساب/موقع ولا طلب إعداد منفصل للمستخدم. Ads لا يتصل من هذه الشريحة.

يستعمل كل سطح direction من اللغة، النص الطويل يلتف، الأرقام `0–9`، وزر اللمس
لا يقل عن معيار Baseer. لا `transition: all` ولا حركة لتنقل لوحة متكرر.

## AI / بصيرة

بصيرة تستعمل skill التحليل الموجود فقط بعد وجود facts موثقة وفترة حملات ومبيعات
رسمية كافية. يدخلها `sourceStatus` و`asOf` وdata quality، وتخرج تفسيراً محدوداً
ومعنوناً بأنه غير سببي. البديل عندما لا توجد readiness هو شرح قاعدي صريح لحالة
المصدر؛ لا استدعاء AI. لا prompt/provider key في المتصفح، ولا external effect من
مخرج AI.

## أدلة G5 المطلوبة

- عرض الصفحات مطابق للمسميات والترتيب أعلاه، عربي/إنجليزي، جوال/سطح مكتب،
  loading/error/empty/access-denied واضحة.
- `AUTHORIZED_READ_ONLY_SELECTED` يظهر موحداً في النظرة والسمعة والمصادر.
- صفحة لا تظهر لدور لا يسمح مسارها الخادمي، والعكس.
- بدء OAuth مرة واحدة لا يفعّل sync/reply/publish، وتعدد المورد يرفض التخمين.
- اختبارات عزل ARZ/المعلم الشامي، وidempotency/checkpoint/retry قبل B أو E.
- لا fake review/Ads facts ولا رقم مالي من Google أو بصيرة.

# برنامج انتقال التسويق والسمعة إلى Baseer ERP

**المعرف:** `BASEER-MARKETING-REPUTATION-PROGRAM-2026-09-05`
**الحالة:** `MKT-01A وMKT-01B غير المتصلتان مقفلتان` — لا نقل أسرار أو بيانات حية أو إيقاف للتطبيق السابق.
**المرجع المعماري:** `BASEER-ARCH v1.0` / `marketing-decision-reports` و`platform-data-contracts`
**المصدر السابق:** `D:\Codex\Baseer`، ويظل تشغيلياً إلى أن تجتاز كل بوابات القطع.

## الهدف المعتمد

يصبح قسم التسويق والسمعة في Baseer ERP النسخة المرجعية المتقدمة للتطبيق السابق:
نتائج قصيرة قابلة للفهم لغير المختص، مع تعريف واضح لكل رقم ومصدره وحداثته،
وتفاصيل أدق عند الحاجة. يحافظ على سياسة الردود الآلية المعتمدة: 4–5 نجوم تلقائياً
عند اجتياز الحارس، و3 نجوم فقط عند الأمان، و1–2 نجمة مسودة ومراجعة بشرية.

لا يجعل هذا البرنامج إنفاق Google Ads أو التحويلات أو نقرات Maps حقيقة مالية أو
إثباتاً للسببية. تبقى قيود ERP ومبيعاته المقفلة مصدر الحقيقة المالي الوحيد.

## اللجنة والمسؤوليات

| الاختصاص | المخرج المملوك | حد القرار |
| --- | --- | --- |
| قائد ألفا للبناء ومحلل الرحلات | رحلة المدير غير المختص ومعايير قبولها | لا يبدأ البناء قبل G0–G4 |
| المعماري ومالك البيانات | عقود الموصلات، العزل، source-to-target lineage | لا schema أو API بلا قرار موثق |
| Google Business/Maps | OAuth، اختيار الحساب/الموقع، السمعة، الإشعارات والمزامنة | لا رد أو نشر قبل consent وحارس السياسة |
| Google Ads والقياس | قراءة فقط، تعريف KPI، العملة والفترات والجودة | لا mutate أو إنفاق أو نسبة سبب للمبيعات |
| الأمن والتشغيل | الأسرار، الإبطال، kill switches، المراقبة والاسترجاع | لا رموز في Git أو المتصفح أو audit |
| حارس الجودة والبوابات | الاختبارات وقائمة القطع والقرار المستقل | لا إغلاق للمصدر السابق بلا دليل |

## المنهجية

1. **دليل قبل بناء:** يثبت كل ادعاء عن Google بمصدر رسمي وتاريخ وصول؛ يعاد التحقق
   قبل تشغيل أي تكامل حي لأن الواجهات والسياسات والحصص قابلة للتغير.
2. **حقيقة واحدة لكل رقم:** تحمل كل قراءة provider المصدر، المورد، العملة، المنطقة
   الزمنية، فترة المصدر، `sourceFreshAt`، التغطية والجودة. الغائب أو المتأخر ليس صفراً.
3. **سلم فهم للمدير:** ملخص «ما الذي تغير؟ لماذا يهم؟ ما الخطوة التالية؟» ثم تعريف
   KPI ومصدره وتفاصيله؛ لا مخطط أو نسبة بلا مقام وفترة معلنين.
4. **فصل القياس عن المحاسبة:** `Ads reported spend` و`conversion value` حقائق مزود؛
   لا تصبح مصروفاً أو مبيعات ERP. لا ROAS إلا بعد قرار إسناد متوافق ومثبت.
5. **أمان خارجي افتراضي:** OAuth authorization-code مع PKCE/state/nonce، callback
   خادمي، اختيار صريح للحساب/الموقع، أسرار مشفرة وإبطال/فك ربط وkill switch عالمي
   ولكل شركة. لا يستدعي المتصفح Google مباشرة.
6. **أتمتة ردود ضيقة:** intake غير قابل للثقة → حارس سياسة/محتوى → outbox مع
   idempotency → عامل محدود retry/backoff → إيصال Google → إعادة مزامنة وتدقيق.
   لا يعاد النشر تلقائياً بعد timeout غير محسوم.
7. **قطع تدريجي قابل للرجوع:** قراءة متوازية ومطابقة قبل تحويل الكتابة؛ تظل قاعدة
   المصدر والرموز قائمة حتى إثبات الاستقرار. الإغلاق هو آخر موجة وليس أداة اختبار.

## لوحة المؤشرات المعتمدة

| المجال | المؤشرات الأساسية لغير المختص | تنبيه الدقة |
| --- | --- | --- |
| Google Maps/Profile | الظهور، نقرات الموقع، نقرات الاتصال، طلبات الاتجاهات، متوسط التقييم، مراجعات بلا رد | النقر ليس زيارة أو اتصالاً مكتملًا أو مبيعاً؛ بعض المقاييس لا تظهر لكل ملف |
| السمعة | عدد المراجعات، متوسط التقييم، جديد/بلا رد، نسبة الرد، وقت الرد، الردود المعطلة بالحارس | لا تخفِ التقييمات 1–2 ولا تجعل الصفراً بديلاً عن نقص المصدر |
| Google Ads | الإنفاق المبلّغ، مرات الظهور، النقرات، CTR، CPC، التحويلات، قيمة التحويل | التحويل وقيمته حقائق Ads لا فواتير أو مبيعات ERP |
| القرار | تغير موثوق، فجوة بيانات، تنبيه سمعة، خطوة تشغيلية مقترحة | لا ROAS أو سببية قبل سياسة إسناد وجودة/عملة وفترة متوافقة |

تعرّف واجهات Google الرسمية نقرات الاتصال وطلبات الاتجاهات ونقرات الموقع كأفعال على
الملف، لا نتائج بيع؛ وتذكر أن البيانات المتاحة تختلف بين الملفات. [Google Business
Profile Help](https://support.google.com/business/answer/9918094). ويعرّف Google Ads
`average_cpc` بأنه كلفة النقرات مقسومة على النقرات، لا رقم واجهة مستقل.
[Google Ads Metrics](https://developers.google.com/google-ads/api/reference/rpc/v24/Metrics).

## موجات التنفيذ والقطع

| الموجة | التسليم | بوابة الخروج |
| --- | --- | --- |
| 0 — التحضير | inventory غير سري، خريطة شركات/مواقع، سجل قرار وبيئة اختبار | G0–G4 مقفلة ومفتاح الإيقاف مفعل افتراضياً |
| 1 — Google Business قراءة | consent، اكتشاف الحسابات والمواقع ثم اختيار صريح، vault، snapshot/mapping ومزامنة محدودة | تطابق عينة مراجعات ومؤشرات مع المصدر، RLS وrevoke وdisconnect مثبتة |
| 2 — السمعة والنشر | طابور المراجعات، الحارس، المسودة، outbox/worker، الرد الآلي الآمن وmanual publish | pilot موقع واحد بلا تكرار وبإيصالات وkill-switch drill |
| 3 — Google Ads قراءة | حساب Ads مختار صراحة، GAQL ثابت، facts يومية محدودة وجودة/عملة | pilot حساب واحد، لا mutate، فحوص quota وfreshness وreconciliation |
| 4 — تجربة القرار | ملخصات عربية/إنجليزية، drill-down، حالات missing/stale/error، مراقبة | اختبارات desktop/mobile/RTL وإتاحة وفهم المستخدم |
| 5 — نقل وإغلاق | backfill موثق، parallel run، تحويل traffic، مراقبة استقرار، archive للمصدر | checklist 100% وموافقة تسليم مستقلة؛ لا RUNNING أو FAILED |

## قرارات المالك المعتمدة

| القرار | القيمة المعتمدة | أثر التنفيذ |
| --- | --- | --- |
| مشروع Google الانتقالي | استخدام مشروع Google القديم الموثق للتطبيق السابق مؤقتاً | لا تنقل رموزه؛ تحديث redirect URI وإعادة التفويض ضمن بوابة callback/egress لاحقة فقط، بعد تصميمها وموافقتها. |
| الشركات المستهدفة | `ARZ` و`المعلم الشامي` | لكل شركة connection وcredential envelope وaccount/location mapping وconsent وسجل sync مستقل. لا مشاركة token أو اختيار مورد بالاسم أو تلقائياً بينهما. |

هذا قرار نطاق، لا إثبات وصول ولا تفويض لاستخدام credential. يبقى التطبيق السابق
والربط القديم عاملين إلى أن ينجح pilot ومطابقة مستقلان **لكل شركة**.

## جرد المصدر والهدف المثبت

| القدرة | التطبيق السابق `D:\Codex\Baseer` | Baseer ERP الحالي | قرار البرنامج |
| --- | --- | --- | --- |
| Google Business | OAuth/callback، sync للملف والأداء والمراجعات وإشعارات Pub/Sub | OAuth start/PKCE وفحص إعداد فقط؛ لا callback أو vault أو mapping أو sync | تبنى موجة 1 من جديد داخل حدود Nest/Prisma وRLS، لا تنسخ كود Next/Drizzle. |
| الردود | publisher يدوي وauto-reply 4–5 مع freshness/dedupe/batching | سياسة واجهة محفوظة فقط؛ لا queue/outbox/publisher | تبنى موجة 2 بحارس versioned وoutbox وworker وإيصال/إعادة مصالحة. |
| Google Ads | OAuth مستقل، account discovery، sync/read-only وbackfill وتقارير | حالة اتصال فقط؛ لا provider facts ولا account mapping أو sync | تبنى موجة 3 كموصل read-only، GAQL ثابت وfacts يومية قابلة للمطابقة. |
| Google Analytics | OAuth ومزامنة قراءة في المصدر | ليس ضمن عقد Marketing الحالي | خارج موجة التكافؤ الأولى؛ يضاف بقرار موصل مستقل حتى لا يؤخر Maps/Ads/سمعة. |

**تصحيح سياسة المصدر:** التطبيق السابق لا يرد تلقائياً على 1–2 نجمة؛ يستبعد كل
تقييم أقل من 4. تبقى سياسة Baseer المعتمدة: 4–5 تلقائي، 3 آمن فقط، 1–2 يدوي.
لا يفسر طلب «الإبقاء على الرد الآلي» كصلاحية أوسع من ذلك.

## الحوكمة والمراقبة

- كل sync يسجل company/location/account، نافذة المصدر، عدد الصفوف، checksum،
  freshness، حالة الجودة وsafe error code؛ لا يسجل token أو نص مراجعة حساساً في logs.
- مقياس التشغيل: معدل نجاح المزامنة، العمر منذ آخر مصدر، صفوف الحجر، quota/error
  rate، طابور الردود، dedupe، مدة النشر، حالات `RECONCILE_REQUIRED` وkill switch.
- توقف تلقائي: credential revoked، mapping غير متحقق، مصدر stale/partial، quota أو
  خطأ متكرر، فشل حارس المحتوى، اختلاف المطابقة أو محاولة mutate في Ads.
- كل خطوة تسجل في `BUILD-GOVERNANCE.md` قبلها وبعدها، وترتبط ببطاقة أثر ونتيجة
  فحص. لا تنقل قيمة سرية أو بيانات إنتاجية إلى الوثائق أو الاختبارات.

## سجل التنفيذ الحي

| المعرّف | الموجة | الحالة | شرط البدء | دليل الخروج | المالك |
| --- | --- | --- | --- | --- | --- |
| MKT-00 | 0 | مكتمل | طلب المالك والمرجع المعماري | منهجية، مصادر، أثر وchecklist | قائد ألفا للبناء |
| MKT-01 | 1 | MKT-01A مكتمل؛ MKT-01B محجوب | MKT-01A: منع OAuth تجريبي. MKT-01B: قيم تشغيل وG0–G4 جديدة | OAuth/vault/mapping/read pilot ومطابقة | المنصة + Google Business |
| MKT-02 | 2 | غير مبدوء | MKT-01 وموافقة آلية محددة للموقع | outbox/pilot/kill-switch/dedupe/reconcile | السمعة + التشغيل |
| MKT-03 | 3 | غير مبدوء | قرار Ads ومالك MCC/CID/token | read-only daily facts وquota/reconciliation | بيانات التسويق |
| MKT-04 | 4 | غير مبدوء | MKT-01–03 وcontracts للقراءة | تجربة مبسطة RTL/LTR وE2E/إتاحة | الواجهة + الجودة |
| MKT-05 | 5 | غير مبدوء | اكتمال كل الموجات وparallel run | تسليم مستقل وقرار قطع/archive قابل للاسترداد | الترحيل + التسليم |

## عقد الشريحة الأولى — MKT-01A (المنع الخادمي الآمن)

**النطاق:** خطوة أمان مكتملة حول مسار OAuth التجريبي لـGoogle Business فقط: تثبت أن مسار OAuth
التجريبي الموجود لا يمكنه إنشاء رابط موافقة، حتى إن عُيّن متغير بيئي بالخطأ. لا
تضيف الشريحة schema أو credential vault أو account/location mapping أو sync-run.
هذه عناصر MKT-01B التالية بعد قرارات التشغيل. لا تستدعي Google في الإنتاج، ولا
تقبل token قديماً، ولا تنشر رداً، ولا تستورد review أو performance facts.
Google Ads خارجها تماماً.

### G0 — الحوكمة والقبول

- أثناء MKT-01A المسار معطل عالمياً قبل التحقق من الهوية؛ لا يكشف بيانات ولا
  ينفذ عملية. في MKT-01B يصبح المستخدم مسؤول الشركة المخول، لا المدير العادي
  ولا المتصفح العام.
- الرحلة: محاولة تشغيل route تجريبي → رفض خادمي ثابت → لا URL ولا redirect ولا
  كتابة OAuth state. لا يوجد اختيار أول مورد أو أي اتصال في هذه الشريحة.
- القبول: لا يكشف سر؛ لا يتصل أو ينشر افتراضياً؛ ولا يصبح حفظ سياسة الرد موافقة
  Google أو صلاحية نشر. يعيد route الرفض نفسه مع وجود متغير البيئة أو غيابه.
- خارج النطاق: نقل الأسرار/البيانات الحية، vault، mapping، callback، Google Ads،
  Pub/Sub، sync facts، queue/worker، نشر الردود، وإغلاق التطبيق السابق.
- مراجعة ERP: لا يرحل الموصل قيداً ولا مبيعات ولا مصروفاً؛ كل مبلغ مزود يبقى
  factual marketing read فقط.

### G1 — السعة والاستمرارية (افتراضات معلنة)

| البند | افتراض الإطلاق المحافظ | الحارس |
| --- | --- | --- |
| الشركات/التزامن | لا عملية OAuth أو sync ولا كتابة جديدة | الرفض لا ينشئ state أو job |
| الموارد | لا account أو location أو provider payload | لا pagination أو lookup في هذه الشريحة |
| OAuth | لا محاولة صالحة | route/service يرفضان قبل قراءة config أو إنشاء state |
| البيانات والاحتفاظ | لا بيانات جديدة؛ لا review/raw provider payload/token | لا secret في audit/log |
| الأداء والاستعادة | رفض خادمي ثابت سريع؛ لا يعتمد على Google أو config | لا تتعطل مبيعات/محاسبة إذا توقف الموصل |

هذا ليس وعد قدرة إنتاجية. تعاد G1 بالكامل قبل vault أو callback أو sync أو
worker، بعد تحديد الاحتفاظ وSLO وincident/kill-switch owners والـpilot.

### G2 — البيانات والعقود والعزل

| الكيان/العقد | المالك والحقيقة | العزل والتزامن | القراءة أو الأثر |
| --- | --- | --- | --- |
| العقد/الكيان الموجود | المالك والحقيقة | قرار MKT-01A | الأثر |
| `MarketingProviderConnection` | marketing control-plane، لا credential | لا تغيير للحالة أو schema؛ يبقى `NOT_CONNECTED` صادقاً | حالة مرئية فقط |
| `MarketingProviderOAuthState` | محاولة OAuth قصيرة العمر موجودة سابقاً | لا كتابة أو استهلاك أو callback في الشريحة | لا يظهر في API أو audit |
| vault/mapping/sync-run/facts | خارج الشريحة | لا schema ولا route ولا API ولا migration | لا أثر أو بيانات |

مصدر الحقيقة للأرقام يبقى خدمة الخلفية. لا يوجد رقم أو read model جديد هنا.
تعاد G2 قبل أي migration، وتشمل حينها RLS وFORCE RLS وسياسات tenant وindexes
واختبارات cross-company وcredential redaction.

### G3 — الرصة والمكتبات والمسار المباشر

- NestJS/Prisma/PostgreSQL/React/Zod الموجودة هي الرصة المعتمدة؛ لا مكتبة أو SDK
  Google في MKT-01A، ولا `fetch` خادمي أو browser redirect. كل egress في MKT-01B.
- لا يتغير التشفير أو إعداد Google هنا؛ لا اعتماد جديد ولا حزمة OAuth جديدة.
- المكوّن المركزي للواجهة لا يدخل هذه الشريحة؛ واجهة MKT-04 تستعمل catalog
  Baseer القائم، وقاموس اللغة، وتنسيق الأرقام المركزي. `BaseerInfoHint` يظل
  مساعدة عامة مستقلة ولا يحمل منطق الموصل.
- سبب المسار المباشر: نكمل حد Nest/Prisma الحالي ونبني vertical slice قابلاً
  للاختبار بدلاً من نسخ Next/Drizzle أو إنشاء microservice/queue قبل الحاجة.

### قرار البدء

`MKT-01A` مسموح له فقط بتعديل الحارس الخادمي واختبار الانحدار **بعد** مراجعة
حارس بوابات مستقل لهذا العقد. لا يعني ذلك موافقة OAuth حي أو نقل API keys؛
يبقيان، مع vault/mapping/callback، في `MKT-01B` بعد قيم التشغيل وموافقة المالك.

**نتيجة الإقفال:** راجع الحارس المستقل التنفيذ وأقفل G0–G3 لـMKT-01A فقط.
الاختبار يثبت الرفض عبر Fastify في حالتي المتغير القديم، ولا URL/redirect، ولا
OAuth state أو provider connection write. لا يغير ذلك G0–G4 أو نطاق MKT-01B.

### متطلبات MKT-01B قبل البناء

- مالك key lifecycle وkill switch وincident/revocation، والاحتفاظ الصريح لكل
  credential envelope وmapping وsync receipt.
- نموذج access يمنع قراءة credential حتى من واجهات الإدارة العامة، وتعريف كامل
  لـsync-run metadata من دون raw review/token/payload.
- تصميم Prisma نهائي: credential منفصل، AAD/key-version/IV/tag/expiry/revoke،
  mapping صريح، RLS/`FORCE RLS`، migration بلا backfill من المصدر السابق.
- قرار منفصل للـcallback/egress والمكتبة المحتملة وقياس pilot معزول.

## عقد MKT-01B — أساس الخزنة والربط (غير متصل)

### G0 — النطاق والقبول

ينشئ MKT-01B بنية خادمية وPrisma فقط لـGoogle Business: credential envelope
منفصل، mapping صريح للشركة/الحساب/الموقع، وsync-run metadata بلا payload. لا
يدخل سر فعلي ولا يوجد callback أو HTTP أو OAuth أو Google SDK أو worker أو route
عام للكتابة. الشركتان المستهدفتان `ARZ` و`المعلم الشامي` لهما عزل كامل.

القبول: AES-256-GCM مع AAD يربط tenant/company/provider؛ لا يستطيع envelope
لشركة أن يفك في أخرى؛ لا يظهر أي حقل سر في عقد عام أو audit؛ RLS وFORCE RLS
لكل جدول؛ لا تغير `NOT_CONNECTED` أو سياسة الرد أو الحقيقة المالية.

### G1 — السعة والاحتفاظ (قرار محافظ)

| البند | القيمة |
| --- | --- |
| الإطلاق | شركتان، مزود Google Business فقط، حتى 25 موقعاً مختاراً لكل شركة |
| credential | واحد نشط كحد أقصى لكل company/provider؛ لا قيمة حية في هذه الشريحة |
| mapping | حتى 25 موقعاً للشركة، server pagination لاحقاً؛ لا اختيار بالاسم |
| sync metadata | لا sync فعلي الآن؛ الحد المستقبلي 365 receipt للشركة/الموقع قبل أرشفة مدققة |
| الاحتفاظ | credential يحذف فور disconnect/revoke؛ metadata بلا payload تحتفظ 90 يوماً؛ audit بلا سر 365 يوماً |
| الاستعادة | فشل المفتاح أو AAD أو RLS يفشل مغلقاً؛ لا fallback لنص صريح أو token قديم |

**المالكون:** `Platform Data & Operations` يملك lifecycle لمفتاح التشفير
والـglobal kill switch؛ `Platform Identity & Administration` يملك incident/
revocation وقطع credential؛ ومسؤول الشركة المخول يملك company kill switch عند
تفعيل المرحلة اللاحقة. لا ينفذ أي منهم إجراءً حياً في MKT-01B.

هذه حدود شريحة foundation وليست وعد تشغيل أو سياسة لبيانات review. تعاد G1 قبل
إدخال secret أو تشغيل sync أو توسعة المواقع.

### G2 — نموذج البيانات والعقود

- يضاف لـ`MarketingProviderConnection` مفتاح فريد `[id, tenantId, companyId,
  provider]` كي لا يستطيع envelope أو mapping ربط اتصال Ads بالشريحة GBP.
- `MarketingProviderCredentialEnvelope`: FK مركب إلى Company وConnection بما
  فيه provider، وunique `[connectionId, tenantId, companyId, provider]`؛ ويضمن
  مفتاح Connection الفريد للشركة/المزود عدم وجود credential ثانٍ للشركة نفسها؛ `ciphertext/iv/tag/
  keyVersion/status/revokedAt` فقط. AAD هو UTF-8 canonical:
  `baseer.marketing-provider-credential.v1:{tenantId}:{companyId}:{provider}`.
  لا response serializer عام ولا API عام أو audit payload للغلاف.
- `MarketingGoogleBusinessLocationMapping`: يحمل provider ثابتاً `GOOGLE_BUSINESS`
  وقيد SQL يمنع غيره، FK مركب إلى اتصال GBP، وunique `[tenantId, companyId,
  connectionId, googleAccountResourceName, googleLocationResourceName]`.
  كما يحمل المفتاح `[id, tenantId, companyId, provider]` لـsync receipts، ويرتبط
  `selectedByUserId` بعضوية الشركة المركبة لا بمستخدم حر. `selectedAt` و`selectedByUserId` موجودان لكن لا ينشأ mapping قبل discovery
  واختيار صريح في بوابة لاحقة.
- `MarketingProviderSyncRun`: FK مركب إلى mapping (المرتبط بدوره بـconnection)، lifecycle
  `QUEUED|RUNNING|FAILED|BLOCKED` فقط في foundation (لا `SUCCEEDED`)، وحقول
  correlation/attempt/window/counters/checksum/freshness/safeError/adapterVersion.
  لا provider payload ولا route أو service writer في MKT-01B.
- كل جدول compound FK إلى company/connection وRLS/`FORCE RLS` وسياسة tenant
  وgrants لـ`baseer_app` عند نمط migrations القائم. تلتزم الخدمات اللاحقة
  بفلترة trusted tenant **وcompany**؛ تختبر migration cross-company كتابة/قراءة.
  لا backfill من `D:\Codex\Baseer` ولا تعديل للقديم.

### G3 — التقنية والمسار المباشر

Node crypto وNest/Prisma/PostgreSQL الموجودة فقط؛ لا dependency أو SDK أو queue.
الخزنة تستعمل AES-256-GCM وAAD وkey version بدلاً من نسخ خزنة AI لأن AAD في
هذا الموصل يجب أن يربط company/provider. الاختبارات: round-trip صحيح، رفض AAD
أجنبي، رفض envelope معطوب، RLS، وعقد static يمنع egress/callback/secret route.

**حالة البوابات:** اعتمدت مراجعة مستقلة G0–G3 وراجعت الكود النهائي بلا P0/P1.
اكتمل قبول G5 للشريحة غير المتصلة: الخزنة والمخطط والترحيل والحارس الثابت،
وترحيل/RLS حي على قاعدة الاختبار. لا يدخل
redirect URI أو callback أو egress في MKT-01B؛ له بوابة لاحقة مستقلة.

## عقد MKT-02A — تفويض Google Business وCallback التجريبي

### G0 — النطاق والقبول

هذه شريحة تفويض خادمي لـ`GOOGLE_BUSINESS` و`ARZ` فقط. يبدأ الخادم من allowlist
إلزامي `BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_COMPANY_ID` (UUID لشركة ARZ)،
ويرفض غيابه أو عدم تطابقه أو أي provider غير Google Business قبل قراءة config
أو إنشاء state. تبدأ من مسؤول شركة
مخوّل، وتنتهي بعد callback ناجح بحالة `AUTHORIZED_AWAITING_SELECTION`؛ لا
تكتشف الحسابات/المواقع، ولا تنشئ mapping، ولا تقرأ مراجعات أو أداء، ولا تنشر
رداً، ولا تمس Google Ads أو `المعلم الشامي`. لا ينقل token أو secret من التطبيق
القديم، ولا يُظهر المتصفح refresh token أو client secret أو التفصيل الداخلي
للشركة.

القبول: authorization-code مع PKCE S256 وسر state عشوائي 32-byte؛ يسبقه tenant
routing prefix غير مخوّل لا يحمل company أو user، ثم يعاد التحقق من hash في قاعدة
البيانات. صالح عشر دقائق ويستهلك مرة واحدة. callback عام لا يثق بـcompany أو user
من query؛ يستعيدهما من state المقيد، ويعيد نتيجة عامة فقط. عند نجاح token exchange، يخزن refresh token
الموجود حصراً داخل `MarketingProviderCredentialEnvelope` المشفر؛ لا يخزن access
token. فشل أو غياب refresh token ينتهي مغلقاً إلى `BLOCKED` بلا envelope نشط.

### G1 — السعة والتشغيل

pilot واحد لشركة ARZ واتصال Google Business واحد؛ محاولة OAuth غير مستهلكة واحدة
كحد أقصى لكل شركة/مزود، TTL عشر دقائق، وcallback واحد لكل state. لا retry تلقائي
لتبادل code أو طلبات Google؛ يعيد المستخدم بدء التفويض بعد خطأ واضح. يبقى global
kill switch `BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED` false افتراضياً، ولا
يصبح true قبل إعداد secret manager وredirect URI وموافقة المالك في Google.

### G2 — البيانات والعقود والعزل

يضاف status `AUTHORIZED_AWAITING_SELECTION` إلى connection، وجدول جديد
`MarketingGoogleBusinessOAuthState` بدلاً من إعادة استعمال جدول OAuth العام.
يحمل `connectionId/tenantId/companyId/provider/initiatedByUserId` وPKCE المشفر
وhash/expiry/consumed. له FK مركب إلى Company وCompanyMembership وConnection،
وقيد SQL `provider='GOOGLE_BUSINESS'`، وRLS/`FORCE RLS`. يفرض partial unique index
لـ`tenant/company/provider WHERE consumedAt IS NULL`؛ داخل transaction مقفلة تستهلك
الخدمة المحاولة السابقة ثم تنشئ الجديدة، فيمنع السباق.

يرتبط PKCE verifier بتشفير AEAD وAAD للشركة/Google Business، ويستبدل credential
envelope في معاملة واحدة بعد token exchange. لا يحمل audit أو API contract أو
response محتوى token/code/state أو client secret. callback يقبل فقط `state` و`code`
أو `error`، ويتحقق من hash/expiry/عدم الاستهلاك، ثم يفحص kill switch/config مجدداً
**مباشرة قبل أي exchange**. claim الـcallback ذري داخل transaction/locking: تحديث مشروط
بـ`stateHash` و`consumedAt IS NULL` و`expiresAt > now()`؛ الفائز وحده يعالج `code`
أو `error`، وأي callback لاحق يعاد إليه رد آمن من دون طلب Google.

### G3 — التقنية والمسار المباشر

Nest/Prisma وNode crypto و`fetch` الموجودة فقط؛ لا SDK ولا حزمة جديدة. تستخدم
Google OAuth token endpoint حصراً بعد بوابة environment الدقيقة، وبمهلة زمنية
قصيرة وخطأ آمن بلا logs حساسة. عميل OAuth مخصص لـBaseer Google Business يُنشأ
لاحقاً في مشروع `n8n hajrix` بدلاً من توسيع عميل Ads قائم؛ ولا تُفعّل API أو scope
أو callback في Google ضمن MKT-02A. الاختبارات المحلية تثبت: رفض ARZ allowlist
الغائب أو شركة/مزود خارج النطاق قبل state أو egress، وعدم توليد URL عندما kill
switch/config ناقص، PKCE/state، رفض state من شركة أو callback مكرر/منتهي، فحص
kill switch/config ثانية قبل exchange، callbackان متزامنان (ومن ذلك مسار `error`)
لا يطالبان state إلا مرة واحدة، وحفظ refresh token المشفر فقط عند نجاح exchange mock.

**حالة البوابات:** اعتمدت مراجعة مستقلة G0–G3 ثم قبلت تنفيذ MKT-02A بلا P0/P1.
أضيف callback تجريبي منفصل عن المسار العام المغلق، وschema/RLS وقيود state
والاختبارات السلوكية والمحلية. يبقى kill switch false افتراضياً، ولا تفعيل حي أو
إضافة `business.manage` أو client/redirect في Google قبل قرار لحظي من المالك بعد
نشر callback.

### MKT-02A-UI — بدء تجربة ARZ المقيدة

يعرض Baseer زر «بدء موافقة Google» لمسؤول ARZ فقط عندما يصرح الخادم بأن
allowlist التجريبية وإعدادها مكتملان. يستدعي الزر endpoint التجريبي القائم ثم
ينتقل إلى عنوان Google الذي يعيده الخادم؛ لا يحمل URL الشركة أو المستخدم أو سراً.
لا يظهر الزر لـGoogle Ads أو المعلم الشامي، ولا يفتح اختيار حساب/موقع أو قراءة أو
مزامنة أو نشر أو رد آلي. فشل البدء أو الإلغاء يبقيان الاتصال غير مكتملين برسالة
آمنة، وتبقى تجربة ARZ خطوة الإثبات المطلوبة قبل طلب Data Access Verification.

## قائمة تحقق احترافية

### قبل البناء

- [ ] اعتماد G0: النطاق، الشركات، المستخدمون، سياسة الرد والحدود المالية.
- [ ] اعتماد G1: الحجم، الاحتفاظ، cadence، recovery وSLOs بأرقام معلنة.
- [ ] اعتماد G2: schema، RLS، vault، OAuth، outbox، facts، lineage والمطابقة.
- [ ] اعتماد G3: لا SDK جديد إلا بعد مبرر وترخيص وحجم ومراجعة؛ الاعتماد الحالي أولاً.
- [ ] اعتماد G4: قاموس KPI، اللغة والاتجاه، mobile/desktop، إتاحة وحالات النقص.

### قاعدة الشرح عند الطلب

- [x] تستخدم علامة `؟` صغيرة بجوار المصطلحات الحسابية أو التقنية فقط، لا بجوار كل نص.
- [x] يبقى الرقم والتحذير والمصدر وحالة الجودة ظاهرة خارج النافذة الصغيرة.
- [x] يشرح النص: ما الذي يقيسه الرقم، وما الذي **لا** يثبته، والفترة/المصدر عند انطباقهما.
- [x] تفتح العلامة بالنقر واللمس ولوحة المفاتيح، وتقرأ باسم واضح؛ لا تعتمد على hover.
- [x] لا تدخل النافذة نص HTML أو بيانات provider خامة، ولا تضيف طلب شبكة أو حركة معيقة.

### قبل كل موصل حي

- [ ] موافقة Google/Cloud وredirect URI الدقيق؛ OAuth صالح وPKCE/state/nonce مختبر.
- [ ] اختيار صريح لحساب/موقع مع company isolation وعدم التطابق بالاسم.
- [ ] السر مشفر خادمياً، غير موجود في Git أو DOM أو audit، والإبطال/فك الربط مثبت.
- [ ] حدود القراءة والحصص والـbackoff وDLQ ومراقبة freshness مثبتة.
- [ ] Ads: inventory آلي يثبت عدم وجود mutation أو budget/bid/spend endpoint.
- [ ] Business: سياسة الحارس والموافقة والموقع وkill switch وإعادة المزامنة مثبتة.

### قبل إغلاق التطبيق السابق

- [ ] كل بيانات مطلوبة في حالة `مكتوب ومطابق` أو `دليل تاريخي بمعالجة معتمدة`.
- [ ] لا موجة `RUNNING` أو `FAILED` ولا فرق غير مفسر في الأعداد أو الحدود الزمنية.
- [ ] اختبار دخول/Consent/قراءة/رد/Ads/إبطال/استرداد على الإنتاج المعزول وفق التفويض.
- [ ] parallel run ناجح للفترة المتفق عليها، وdashboard الجديد واضح لغير المختص.
- [ ] مراجعة تسليم ألفا مستقلة وقرار مكتوب؛ يبقى archive المصدر قابلاً للاسترداد.

## الأدلة الرسمية المستخدمة في هذه النسخة

- [Google Business Profile OAuth](https://developers.google.com/my-business/content/implement-oauth):
  موافقة صريحة ورمز OAuth لكل طلب؛ يدعم العمل نيابة عن المالك بعد الموافقة.
- [Google Business Profile review data](https://developers.google.com/my-business/content/review-data):
  القراءة والرد والحذف عبر المورد المقيد بالموقع.
- [Google Business Profile basic setup](https://developers.google.com/my-business/content/basic-setup):
  يلزم اعتماد المشروع وتمكين APIs وOAuth؛ لا sandbox فعلي للاتصال الحي.
- [Google Ads quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas):
  الحصص تعتمد على developer token، ويجب التعامل مع `RESOURCE_EXHAUSTED` وحدود الحجم.

## سجل أدلة اللجنة — 2026-09-05

| الادعاء التنفيذي | المصدر الرسمي | قرار المنهجية |
| --- | --- | --- |
| Business Profile يتطلب مشروع Cloud مقبولاً وOAuth، ويكتشف الحسابات والمواقع من الهوية المخولة | [Basic setup](https://developers.google.com/my-business/content/basic-setup)، [OAuth](https://developers.google.com/my-business/content/implement-oauth)، [Accounts list](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list) | لا نقل refresh token؛ تعيد كل شركة consent وتختار الموقع صراحةً، ثم يحفظ mapping معزولاً ومدققاً. |
| Reviews تُقرأ بصفحات وتقبل updateReply، لكن لا يسمح النشر الآلي بلا موافقة مالك صريحة ومحددة | [Review data](https://developers.google.com/my-business/content/review-data)، [GBP API policies](https://developers.google.com/my-business/content/policies) | consent قابل للإبطال لكل موقع ونسخة سياسة شرط تشغيل؛ outbox والـkill switch يمنعان النشر عند أي شك. |
| إشعارات GBP في الزمن القريب عبر Pub/Sub؛ الرسائل قد تتكرر أو تصل بغير ترتيب | [Notifications setup](https://developers.google.com/my-business/content/notification-setup) | Pub/Sub يشغل intake، لكن reconciliation دوري محدود يحسم التكرار والحذف وفق `review ID/update time`. |
| بيانات Maps/Profile تشمل أفعالاً مثل click-to-call وdirection requests لا نتيجة مبيعات؛ availability تختلف | [Business Profile performance](https://support.google.com/business/answer/9918094) | لغة واجهة وصفية دقيقة؛ لا «مكالمات مؤكدة» أو «زيارات» أو «عملاء» من هذه المقاييس. |
| محتوى GBP لا يحتفظ به كتاريخ خام دائم؛ سياسة Google تحدد حداً للمحتوى المخزن | [GBP API policies](https://developers.google.com/my-business/content/policies) | فصل نصوص المراجعات عن audit؛ TTL قابل للتدقيق لا يتجاوز السياسة، مع حفظ أقل قدر من receipt غير الحساس. |
| Ads يتطلب OAuth وdeveloper token؛ `ListAccessibleCustomers` لا يكشف شجرة MCC كاملة | [Ads authentication](https://developers.google.com/google-ads/api/rest/auth)، [List accounts](https://developers.google.com/google-ads/api/docs/account-management/listing-accounts) | شاشة اختيار CID/MCC صريحة تعرض العملة والمنطقة الزمنية؛ لا تطابق بالاسم أو اختيار أول حساب. |
| Ads reports عبر GAQL Search/SearchStream، والحصص وحدود السرعة عملية وليست نظرية | [Search](https://developers.google.com/google-ads/api/rest/common/search)، [Quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas)، [Rate limits](https://developers.google.com/google-ads/api/docs/productionize/rate-limits) | استعلامات ثابتة قراءة فقط، queue/rate limit/backoff، قياس request/resource consumption وتنبيهات 70/85/95%. |
| conversion/ROAS لا تعني تلقائياً إيراداً أو ربحاً، وقد تتغير مع attribution والـconversion lag | [Conversion tracking](https://support.google.com/google-ads/answer/6270625)، [Conversion lag](https://support.google.com/google-ads/answer/9347141)، [Attribution models](https://support.google.com/google-ads/answer/6259715) | تعرض النتائج كـprovider facts وفترة ناضجة؛ يمنع ROAS المالي حتى يعتمد تعريف conversion/القيمة/الإسناد والعملة. |

## القيود المفتوحة

حُدد نطاق الشركتين، احتفاظ foundation، ومالكو key/incident/kill switch لشريحة
MKT-01B غير المتصلة. تبقى قيم التفعيل الحي فقط مفتوحة: الحسابات والمواقع المختارة
بعد discovery، cadence وSLO الفعليان، مدة parallel run، وSecret Manager/deployment
للعميل التجريبي. أنشئ redirect URI/callback لـBaseer ERP في مشروع Google المعتمد،
لكن لا تُستنتج أو تنسخ قيمة secret. لا تستنتج هذه القيم من الكود أو الإنترنت، ولا يفعل موصل
أو يغلق المصدر قبل قرار المالك والـpilot.

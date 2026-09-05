# عقد MKT-03 — Google Ads للقراءة فقط

**الحالة:** اعتمدت مراجعة مستقلة G0–G3 للكود المحلي فقط. لا تسمح بإعداد حي أو
discovery أو نقل اعتماد أو مزامنة إنتاجية بعد.

**النطاق:** نقل قراءة تقارير Google Ads من بصير السابق إلى Baseer ERP، بدءاً بحساب
واحد تختاره شركة ARZ صراحةً. شركة `المعلم الشامي` مستقلة: لا discovery ولا Customer
ID ولا facts قبل تفويضها واختيارها الصريحين.

## الحدود الثابتة

- قراءة فقط: لا إنشاء أو إيقاف أو تعديل حملة أو إعلان أو ميزانية أو bid أو استهداف
  أو إنفاق.
- لا ينسخ refresh token أو client secret أو developer token من بصير السابق؛ لا سر في
  Git أو المتصفح أو API أو audit أو السجل التشغيلي.
- conversion value وROAS حقائق Google Ads، وليسا إيراداً أو ربحاً أو قيداً في ERP.
- لا حذف أو إيقاف لـ`arz_observatory_prod` قبل التكافؤ والـparallel run ومراجعة
  تسليم مستقلة لـAds وBusiness والردود الآلية.

## G0 — النطاق والقبول

1. يبدأ مسؤول الشركة المخول OAuth من ERP؛ ينشئ الخادم فقط PKCE/state قصير العمر
   مربوطاً بجلسة المستخدم والشركة وintent للاتصال وredirect URI المثبتين خادمياً.
2. callback خادمي ذري يتحقق من state غير المستهلك **ومن tenant والمستخدم والشركة
   والجلسة والصلاحية الحالية وredirect URI وprovider** قبل تبادل code، ثم يستهلك
   state مرة واحدة ويخزن refresh token مشفراً خارج صف الاتصال، أو يفشل مغلقاً. لا
   يحدد callback شركة أو Customer ID من query parameters ولا يزامن هنا.
3. يكتشف الخادم الحسابات المسموح بها وسياق MCC ثم يعرض Customer ID والاسم والعملة
   والمنطقة الزمنية فقط عند توفرها.
4. يختار المسؤول Customer ID واحداً وسياق `login-customer-id` صراحةً؛ لا مطابقة
   بالاسم ولا اختيار أول حساب.
5. يقرأ الخادم daily facts محدودة، ثم يعرض ERP الفترة والمصدر والعملة والحداثة
   والجودة وحدود المؤشرات بلغة واضحة.

| قرار المالك | الأثر |
| --- | --- |
| الشركات | ARZ pilot أولاً؛ المعلم الشامي تفويض/اختيار/mapping ومزامنة منفصلة. |
| GA4 | مستبعد؛ Google Ads وGoogle Business فقط. |
| الإعداد القديم | دليل configuration فقط؛ لا تصدير أو نسخ token/secret. |
| الإغلاق | قرار MKT-05 فقط بعد الأدلة، وليس نتيجة وجود إعداد Ads قديم. |

القبول: لا يبدأ OAuth أو discovery أو sync إلا مع feature flag خادمية صحيحة، وإعداد
OAuth وdeveloper token، وallowlist الشركة، وصلاحية المستخدم. لا يرى callback
credentials أو intent من شركة أو مستخدم أو جلسة أخرى، ويرفض أي اختلاف قبل exchange.
لا ترى شركة اتصالاً
أو Customer ID أو fact تابعاً للأخرى. لا تقبل الواجهة GAQL أو Customer ID حرّاً.

## G1 — السعة والاستمرارية

| البند | حد pilot المحافظ | الحارس |
| --- | --- | --- |
| الشركات/الحسابات | ARZ وCustomer ID واحد فقط | mapping فريد وfeature flag لكل شركة |
| cadence | يدوي أولاً، ثم run واحد/24 ساعة للحساب | lease/idempotency لمفتاح نافذة اليوم |
| نافذة القراءة | آخر 32 يوماً، daily aggregate فقط | `coverage` و`sourceFreshAt` ولا صفر بديل للغياب |
| البيانات | لا creative/search terms أو PII أو raw payload دائم | GAQL ثابت وحد أعلى للصفوف/pagination |
| quota | توقف عند `RESOURCE_EXHAUSTED` أو rate limit | retry محدود مع jitter، counters وتنبيه 70/85/95% |
| الاستعادة | kill switch عالمي وآخر للشركة، revoke/disconnect | runs قابلة للاستئناف بلا تكرار |

لا تعد هذه الأرقام سعة إنتاج. قبل التنفيذ يحدد مالك التشغيل quota الفعلية وSLO وRPO/RTO
والاحتفاظ ومالك incident/revocation.

## G2 — البيانات والعقود والعزل

```text
Google Ads API (GAQL read-only)
  -> receipt/run محدد للشركة والنافذة
  -> daily provider facts (resource / currency / timezone / freshness / quality)
  -> read model خادمي
  -> واجهة ERP للعرض والشرح
```

لا يدخل المسار Finance أو invoices أو payments أو revenue. تحول خدمة الخلفية فقط
`cost_micros` إلى Decimal بالعملة الأصلية، وتحسب CTR/CPC/CPA من نافذة متجانسة بلا
قسمة على صفر؛ React لا تحسب أو تجمع facts.

| الكيان المقترح | الغرض والقيود |
| --- | --- |
| `MarketingGoogleAdsCustomerMapping` | Customer ID المختار وMCC/login context والعملة/المنطقة؛ FK مركب وRLS/`FORCE RLS` وقيد active mapping واحد لـcompany/provider في pilot. الاختيار transaction مقفل؛ ولا sync إن خالف CID أو login context المحفوظين. |
| `MarketingGoogleAdsOAuthState` | `tenantId` و`companyId` و`initiatingUserId` و`connectionIntentId` و`redirectUri` وPKCE verifier مشفر؛ hash للـstate فقط، TTL واستهلاك ذري، provider ثابت `GOOGLE_ADS`. |
| `MarketingProviderCredentialEnvelope` | refresh token مشفر بـAAD tenant/company/provider وkey version وrevoke؛ لا API/audit. |
| `MarketingGoogleAdsDailyFact` | pilot على مستوى customer/day فقط: impressions/clicks/costMicros/conversions/conversionValue مع click-date، currency/timezone/coverage/freshness و`metricDefinitionVersion`. لا campaign breakdown قبل عقد لاحق. |
| sync receipt | correlation، صفوف، checksum، نافذة وحالة؛ لا SUCCESS قبل الكتابة والمطابقة ولا raw response حساس. |

قبل migration: مفاتيح FK المركبة وindexes وRLS/`FORCE RLS` واختبارات cross-company
وprovider mismatch وredaction. تثبت الاختبارات أن callback لا يلحق credential بشركة
خاطئة قبل الحفظ، وأن اختيارين متزامنين لا ينتجان CIDين نشطين. توسم الأيام الحديثة
غير الناضجة بحسب conversion lag ولا تدخل في حكم CPA/ROAS النهائي. لا يعاد استعمال
mapping أو OAuth state الخاص بـGoogle Business.

| المؤشر | الحد الظاهر للمستخدم |
| --- | --- |
| الإنفاق | إنفاق Ads المبلّغ بالعملة الأصلية، وليس مصروف ERP مثبتاً. |
| الانطباعات/النقرات/CTR/CPC | نشاط وكفاءة داخل Ads، لا زيارة أو بيع مؤكد. |
| التحويلات وقيمتها | تتبع إعداد Ads وقد تتغير مع attribution وconversion lag؛ ليست فواتير أو إيراد ERP. |
| ROAS | لا يعرض افتراضياً؛ يحتاج قراراً مستقلاً لقيمة التحويل والعملة والإسناد ولا يسمى ربحاً. |

تستعمل الواجهة المكونات المركزية وRTL/LTR وقاموس اللغة. توضع علامة `؟` بجوار
المصطلحات المتخصصة لتشرح القياس والحد من دون HTML خام أو طلب شبكة.

## G3 — التقنية والمسار المباشر

- NestJS + Prisma + PostgreSQL + Zod + Node `fetch` و`crypto` فقط. لا SDK أو
  مكتبة OAuth جديدة قبل مراجعة منفصلة للترخيص وSBOM والحاجة.
- authorization-code مع PKCE/state خادميين وscope الوحيد
  `https://www.googleapis.com/auth/adwords` و`access_type=offline`. يحتاج Ads
  redirect URI خاصاً بـERP وGoogle Ads API مفعلة وOAuth consent verification قبل
  production؛ يعالج فشل 2SV/passkey برسالة قابلة للتصرف. لا يعدل callback أو عميل
  Ads القديم قبل دليل أن ذلك لا يؤثر في بصير السابق.
- يبدأ الخادم بـ`ListAccessibleCustomers` (الوصول المباشر فقط)، ثم يقرأ
  `customer_client` ضمن MCC بحدود صريحة، ويرفض manager/test/cancelled/suspended
  كهدف pilot إلا بسياسة لاحقة. بعد الاختيار فقط يستدعي `GoogleAdsService.Search`
  أو `SearchStream` باستعلام GAQL ثابت allowlisted.
- egress له timeout وcorrelation ID آمن وredaction وrate limiter وbackoff محدود
  وreceipt. يثبت إصدار Google Ads API ومسارات HTTP/services المسموح بها في عميل
  مركزي لا يمكن أن يتحول proxy عاماً، ويراقب deprecation. لا يسجل Authorization
  header أو payload حساس.
- OAuth وdiscovery وsync وواجهة facts مغلقة افتراضياً وتفتح بالتسلسل بعد الاختبارات.

## قائمة التنفيذ

- [x] راجع مختص Ads مستقلاً العقد المصحح: G0–G3 `GO` للكود المحلي فقط، بلا P0.
- [ ] إثبات مالك MCC/Customer ID/developer token وصلاحية القراءة بلا كشف سر.
- [ ] OAuth client/redirect مخصصان أو قرار re-use موثق لا يعطل التطبيق السابق.
- [ ] migration/RLS/vault/mapping/runs/facts واختبارات isolation وrevoke.
- [ ] قبل خدمة المزامنة: تثبيت GAQL customer/day النهائي وhash/معرف allowlist له،
  وتعريف `coverage` الصريح للسطر الغائب وصفر الأداء.
- [ ] حارس static وintegration mock يثبتان غياب mutate وGAQL allowlist فقط.
- [ ] ARZ: consent → discovery → اختيار → daily facts → reconciliation.
- [ ] parallel run موثق، ثم قبول مستقل للمعلم الشامي.
- [ ] MKT-05 فقط: تسليم يغطي Ads وBusiness والردود قبل حذف المصدر.

## الأدلة الرسمية

- [Google Ads authentication](https://developers.google.com/google-ads/api/rest/auth)
- [Listing accounts](https://developers.google.com/google-ads/api/docs/account-management/listing-accounts)
- [GAQL Search](https://developers.google.com/google-ads/api/rest/common/search)
- [Quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas)
- [Rate limits](https://developers.google.com/google-ads/api/docs/productionize/rate-limits)
- [Conversion tracking](https://support.google.com/google-ads/answer/6270625)
- [Conversion lag](https://support.google.com/google-ads/answer/9347141)
- [Attribution models](https://support.google.com/google-ads/answer/6259715)

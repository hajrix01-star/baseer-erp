# مسودة قرار الموصل — Google Ads للقراءة فقط

**الحالة:** مسودة بوابة P4؛ ليست موافقة تشغيل ولا تفعل اتصالاً أو إعداداً.

## النتيجة المقترحة

يكون Google Ads موصلاً خادمياً **للقراءة فقط** لحسابات محددة وموافَق عليها
لكل شركة. يجلب حقائق أداء يومية موثقة المصدر، ثم يستطيع مركز القرار قراءتها
لاحقاً ضمن غلاف الجودة. لا ينشئ الموصّل حملة أو إعلاناً أو ميزانية، ولا يغيّر
bid أو حالة حملة، ولا ينفق. لا يصبح أي تحويل أو إنفاق من Google حقيقة مالية
في ERP أو مبيعات مؤكدة.

هذه المسودة لا تغيّر حالة `NOT_CONNECTED` الحالية، ولا تسمح بإضافة OAuth أو
أسرار أو SDK أو callback أو worker أو طلب شبكة إلى Google.

## تفعيل الشركة من الواجهة

هذا الموصل ليس إجراءً برمجياً يتكرر عند إضافة شركة. بعد أن يعتمد مالك المنصة
إعداد Google المركزي وقرار الموصل، يتولى مسؤول الشركة المخول عملية الربط من
داخل قسم **الأداء التسويقي والسمعة**:

1. يختار «ربط Google Ads» للشركة النشطة.
2. ينشئ الخادم طلب OAuth قصير العمر مرتبطاً بالشركة والجلسة، مع PKCE و`state`
   و`nonce`، ثم يفتح Google للموافقة.
3. يعود إلى التطبيق، فيعرض الخادم فقط حسابات Ads المسموح بها لهذه الهوية.
4. يختار المسؤول customer ID صراحة ويراجع النطاق وحالة القراءة فقط، ثم يؤكد.
5. ينشئ الخادم mapping معزولاً وإيصال تدقيق؛ يبدأ الاستيراد فقط بعد نجاح
   التحقق والـpilot المعتمد.

لا تختار الواجهة الحساب الأول أو حساباً بالاسم، ولا تطلب developer token أو
أسراراً من المستخدم. الإيقاف وفك الربط وإعادة التفويض رحلات واجهة مدققة أيضاً.
إعداد تطبيق Google المركزي وdeveloper token ومالك kill switch متطلبات منصة
مرة واحدة، لا متطلبات برمجة لكل شركة.

## نطاق القراءة الأول المقترح

| العنصر | القراءة المسموحة | الحظر الصريح |
| --- | --- | --- |
| اكتشاف الحساب | قائمة حسابات يمكن للهوية المخولة الوصول إليها، ثم اختيار حساب بموافقة مسؤول الشركة | اختيار حساب تلقائياً أو ربطه بالتشابه الاسمي |
| تعريف الحملة | `customer.id` و`campaign.id/name/status/advertising_channel_type` | أي عملية mutate أو budget أو bidding |
| الأداء اليومي | `segments.date`، `metrics.impressions`، `metrics.clicks`، `metrics.cost_micros`، `metrics.conversions`، `metrics.conversions_value` | اعتبار conversion مبيعات ERP أو `cost_micros` دفعة محاسبية |
| حدود الاسترجاع | فترات يومية محدودة، pagination/limits، وإعادة مزامنة آمنة | `SearchStream` غير محدود أو استيراد سجل خام كامل |

الاستعلامات تكون GAQL ثابتة يملكها الكود، لا SQL أو GAQL حر من المتصفح أو
بصيرة. يشير Google إلى أن `Search` و`SearchStream` هما طريقتا التقرير؛ يوصى
هنا بـ`Search` المحدود في البداية لأنه يسهل الاستئناف والتحديد. [مرجع Google
الرسمي](https://developers.google.com/google-ads/api/rest/common/search).

## الهوية والأسرار

- OAuth authorization-code مع PKCE و`state`/`nonce` أحادية الاستعمال ومشفرة
  وقصيرة العمر؛ callback خادمي ذو redirect URI ثابت فقط.
- النطاق الوحيد هو `https://www.googleapis.com/auth/adwords`.
- يلزم OAuth وdeveloper token في كل طلب، و`login-customer-id` فقط حين يكون
  الدخول عبر MCC معتمد. لا يدخل أي منها المتصفح أو السجل أو Audit payload.
- تحفظ رموز OAuth وdeveloper token في غلاف أسرار خادمي مشفر ومُرقّم وقابل
  للإبطال؛ لا تحفظ ضمن `ProviderConnection` أو قاعدة analytics أو React.
- يملك Ads اتصالاً مستقلاً عن Google Business، ولا يعيد استخدام رمز أو mapping
  ذلك الموصل.

تتطلب Google OAuth وdeveloper token، وتوثق حقل `login-customer-id` لحالة MCC.
[التفويض الرسمي](https://developers.google.com/google-ads/api/rest/auth) و[بنية
الطلب](https://developers.google.com/google-ads/api/docs/concepts/call-structure).

## نموذج البيانات والقراءة

بعد إقرار هذه المسودة فقط، تنفذ P2 الجداول التالية بعزل tenant/company وRLS
وFORCE RLS:

1. `ProviderConnection` بحالة `NOT_CONNECTED | PENDING_CONSENT | CONNECTED |
   DISCONNECTED | REVOKED | BLOCKED`، من دون سر داخل الصف.
2. `GoogleAdsAccountMapping` بموافقة صريحة بين الشركة وcustomer ID؛ MCC ليس
   شركة ولا فرعاً ولا موقعاً مالياً.
3. `GoogleAdsSyncRun` بإيصال تشغيل، نافذة مصدر، coverage، freshness،
   request ID آمن، checksum وحالة قابلة للتدقيق.
4. `GoogleAdsDailyFact` append-only/deduplicated بمفاتيح الشركة والحساب
   والحملة وتاريخ المصدر والعملة وchecksum المصدر ووقت الاستيراد.

كل قراءة رسمية تصف timezone، أيام النقص، الفترة، العمر، العملة، المصدر وحالة
`READY | NO_DATA | INCOMPLETE | STALE | UNAVAILABLE | CONFLICTED`. المفقود
ليس صفراً، ولا تخلط عملات متعددة، ولا تربط حملة يدوياً بالمبيعات بمجرد تشابه
الاسم.

## التشغيل والسلامة

- يملك كل اتصال kill switch للشركة، ويوجد kill switch عالمي مستقل؛ أي منهما
  يمنع القراءة والـrefresh فوراً.
- job واحد بخط lease/قفل PostgreSQL، idempotency، backoff، rate limit،
  timeout وDLQ؛ لا `setInterval` داخل كل API replica.
- تحتفظ Audit receipts بالفاعل والعملية والنتيجة وrequest ID الآمن ونسخة
  السياسة، لا access/refresh token ولا الاستجابة الخام الحساسة.
- تحدد مدة حفظ الحقائق والإيصالات من المالك قبل التفعيل. لا تفترض هذه المسودة
  مدة احتفاظ أو منطقة بيانات أو تكلفة.
- لا تفتح بصيرة هذه الحقائق حتى تنجح عقود القراءة والجودة وتقييمات عربية
  مستقلة؛ عندها تتلقى حزمة أدلة مقيدة لا بيانات الموصل الخام.

## قرارات المالك المطلوبة قبل التنفيذ

| القرار | القيمة المطلوبة |
| --- | --- |
| نموذج الاستخدام | مالك حساب واحد أم أداة عملاء/وكالة |
| مالك Google Cloud والمشروع | الجهة المسؤولة وبيانات الخصوصية/الشروط العامة |
| developer token ودرجة الوصول | إثبات أنه مملوك ومسموح للاستخدام المقصود |
| الحسابات المسموح بها | customer IDs وMCC إن وجد، وموافقة الربط لكل شركة |
| الهوية التي تمنح consent | مسؤول الشركة وصاحب صلاحية الإلغاء |
| cadence والنوافذ | التكرار، backfill المسموح، ونقطة بدء البيانات |
| الاحتفاظ والمنطقة | facts، receipts، الحذف، الوصول والدعم |
| التشغيل | مالك kill switch، quota/cost، incident/revocation owner |

لا تملأ هذه القيم من صفحة Google أو من المستخدم في المتصفح، ولا تبدأ طلب
OAuth قبل توثيقها واعتمادها.

## بوابة القبول P2

1. يراجع الأمن/الخصوصية العقد وقرار الاحتفاظ، ويعتمد المالك جدول الحسابات.
2. تثبت الاختبارات أن لا route أو adapter يستطيع إرسال Google Ads mutate
   operation؛ وتشمل inventory للكود ومراقبة egress allowlist.
3. تثبت RLS وCompanyContext وRBAC عزل mapping وfacts وsync receipts بين
   الشركات، واختبارات revocation وdisconnect وkill switch.
4. تثبت مزامنة محدودة على حساب اختبار مع checksum/dedupe/retry وبيان freshness
   وcoverage؛ لا تكتب أي حقيقة مالية.
5. يقبل المالك pilot محدوداً قبل توسعة الحسابات أو إدخال بصيرة.

## مراجع رسمية

- [Google Ads authorization and request headers](https://developers.google.com/google-ads/api/rest/auth)
- [Google Ads Search and SearchStream](https://developers.google.com/google-ads/api/rest/common/search)
- [Google Ads credential security](https://developers.google.com/google-ads/api/docs/productionize/secure-credentials)

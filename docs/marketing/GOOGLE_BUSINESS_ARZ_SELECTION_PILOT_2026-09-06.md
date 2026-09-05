# عقد MKT-02B — اختيار حساب وموقع Google Business لـ ARZ

**الحالة:** G0–G4 معتمدة للتنفيذ المحلي؛ لا تشغيل حي أو مزامنة أو نشر في هذه الشريحة.
**المرجع:** `BASEER-ARCH v1.0` / `BASEER-IMPACT-2026-09-05-MARKETING-REPUTATION-MIGRATION-PROGRAM` / ADR-MKT-001.
**المالك:** شركة ARZ فقط في تجربة واحدة؛ يكرر المعلم الشامي العقد والدليل لاحقاً باتصال مستقل.

## G0 — النطاق ومعيار القبول

بعد OAuth الناجح وحالة `AUTHORIZED_AWAITING_SELECTION`، يستطيع مسؤول ARZ المخوّل أن يطلب
حسابات Google Business من الخادم، ثم يختار حساباً وموقعاً واحداً صراحةً ويؤكد الحفظ. لا يوجد
اختيار بالاسم أو تلقائياً، ولا تدخل شركات أخرى أو Google Ads. لا تبدأ مزامنة تقييمات أو أداء،
ولا نشر أو رد آلي؛ سياسة الرد التلقائي لا تتغير.

لا يعاد إلى المتصفح refresh/access token أو client secret أو raw provider payload. النتيجة
بعد الحفظ هي `selectedReadOnly=true` فقط، لا دليل على وصول التقييمات أو تشغيل الردود.

## G1 — السعة والاستمرارية

- رحلة حرجة: عرض الحسابات → عرض المواقع → اختيار مؤكد؛ حتى 4 طلبات Google متسلسلة (الأخيرة تعيد التحقق من ملكية الموقع قبل الحفظ) و`12s` لكل طلب.
- حد أولي: `100` حساب و`100` موقع للحساب. لا تخزين cache لنتائج discovery أو عناوينها؛ يحفظ mapping المختار فقط.
- لا retry أعمى. اختيار الشركة يقفل transactionally؛ النقر المكرر آمن. تسجل قياسات الفشل 401/403/429/5xx والمدة لاحقاً.

## G2 — البيانات والعقود والعزل

- يفك الخادم فقط `MarketingProviderCredentialEnvelope` الموجود مع AAD tenant/company/provider؛ access token مؤقت في الذاكرة فقط.
- يستخدم `MarketingGoogleBusinessLocationMapping` القائم، ويحدّث mapping واحداً مقيداً بالشركة أو ينشئه؛ لا migration أو token جديد.
- `GET .../pilot/resources` يعرض الحسابات، و`GET .../pilot/resources/locations?accountResourceName=accounts%2F...` يعرض المواقع، و`PUT .../pilot/selection` يحفظ `accountResourceName` و`locationResourceName` و`idempotencyKey`.
- تتحقق الخدمة من allowlist ARZ، الصلاحية، حالة الاتصال وenvelope قبل egress. تقبل فقط `accounts/{id}` و`locations/{id}` وتثبت أن الموقع جاء من الحساب قبل الحفظ.
- العقد يعرض resource name واسم الحساب/نوعه وعنوان الموقع المختصر فقط؛ لا HTML أو raw payload. audit لا يسجل معرف Google أو عنواناً أو token.

## G3 — التقنية والمسار المباشر

لا SDK ولا حزمة جديدة. يعيد الخادم استخدام `fetch` وvault وplatform service القائمة، ويقصر egress على:

- `https://oauth2.googleapis.com/token` لتحديث access token.
- `https://mybusinessaccountmanagement.googleapis.com/v1/accounts` للحسابات.
- `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/*/locations` للمواقع.

لا يستدعي المتصفح Google مباشرة ولا يسمح بأي host/method إضافي. هذا يعيد استخدام vault وmapping بدلاً من cache أو worker جديد.

## G4 — تجربة المدير

خطوات واضحة: «الموافقة مكتملة → اختر الحساب → اختر الموقع → أكد». تستخدم الواجهة `BaseerCard` و`BaseerButton` و`BaseerSelect` و`BaseerConfirmDialog` المركزية، عربي/إنجليزي، RTL/LTR، جوال/سطح مكتب. تظهر دائماً عبارة: «اختيار الموقع لا يبدأ مزامنة التقييمات ولا الرد الآلي» مع حالات تحميل وفراغ وخطأ.

## التحقق وتكرار المعلم الشامي

اختبارات mock ترفض شركة غير ARZ قبل egress، وتثبت allowlist، pagination/limits، ملكية الموقع للحساب، عدم تسريب token/raw payload وعزل الاختيار المتزامن. اختبار الواجهة يثبت عدم الحفظ قبل التأكيد وعدم ظهور التجربة للمعلم الشامي أو Ads. بعد نشر ARZ: عرض الحسابات واختيار الموقع ومطابقته بلقطة يملكها المالك؛ لا يفتح sync أو الردود أو حذف القديم.

للمعلم الشامي لا ينسخ token أو mapping أو UUID: allowlist مستقل → OAuth مستقل/مخوّل → discovery → اختيار صريح → لقطة دليل → مطابقة.

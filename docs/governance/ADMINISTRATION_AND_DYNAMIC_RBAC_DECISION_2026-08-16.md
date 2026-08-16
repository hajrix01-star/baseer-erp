# قرار إدارة BASEER ERP والصلاحيات الديناميكية

الحالة: قيد البناء التنفيذي — 16 أغسطس 2026.

## القرار

يعتمد BASEER ERP نموذج صلاحيات `RBAC + قيود سياقية خادمية`:

`مستخدم ← عضوية شركة ← دور ← صلاحيات معتمدة`.

الدور لا يمنح وصولاً خارج الشركة. يراجع الخادم العضوية وحالة المستخدم والجلسة في كل طلب، وتبقى قاعدة البيانات معزولة بالـRLS. لا تحتوي رموز الدخول على صلاحيات أو شركة.

## الإدارة المركزية

يوجد تعيين إداري على مستوى Tenant منفصل عن عضوية التشغيل داخل الشركة. مالك الـTenant هو فقط من يستطيع إنشاء الشركات أو المستخدمين أو الأدوار المخصصة أو تغيير عضوياتهم. لا يمنح ذلك تلقائياً أي أثر مالي؛ كل عملية مالية تظل مقيدة بصلاحية الشركة.

## ديناميكية آمنة

- الإدارة تختار من كتالوج صلاحيات ثابت ومترجم من الخادم، ولا تكتب رموز صلاحيات حرة.
- الأدوار الافتراضية (مدير شركة، محاسب، مشرف مبيعات، كاشير، قارئ) نقطة بداية قابلة للتعديل من المالك؛ رمز الدور ثابت، لكن الاسم والصلاحيات قابلان للتعديل.
- يجوز حذف أي دور، افتراضياً كان أو مخصصاً، فقط بعد نقل كل المستخدمين المرتبطين به إلى دور آخر؛ لا حذف صامت أو فقدان وصول غير مقصود.
- تغيير دور المستخدم أو عضويته يلغي جلساته النشطة، ويسجل سجل تدقيق قبل/بعد.
- الكاشير: عرض السجل + الإدخال. المشرف: السجل الكامل + الإدخال/التصحيح في النسخة الحالية. ستفصل صلاحية التصحيح والعكس عن الإدخال قبل تسليم المبيعات النهائي.

## الشركات والشعار

إعداد الشركة يحتفظ بالاسمين والمنطقة الزمنية وربط اختياري إلى `FileMetadata` لشعار صورة من نوع `company.branding/logo`. لا يقبل النظام رابطاً عاماً أو مسار تخزين من المتصفح. رفع بايتات الشعار وإعادة عرضه ينتظر موصل التخزين والفحص الأمني؛ لا يجوز تمثيله كأنه مكتمل قبل ذلك.

## تجربة المستخدم وصورة الموظف

- تعرض صفحة المستخدمين جدولاً مركزياً يوضح المستخدم واسم الدخول والشركات والأدوار والواجهة والحالة؛ اختيار الاسم يفتح نافذة إدارة وصوله.
- نافذة المستخدم تعتمد دوراً واحداً ومربعات اختيار للشركات النشطة؛ يُحفظ الدور وكل الشركات المختارة بمعاملة خادمية واحدة، ثم تُلغى جلسات المستخدم.
- يحق للمالك تعديل اسم الدخول من نافذة المستخدم؛ يتحقق الخادم من فريدية الاسم داخل المؤسسة ويسجل السبب، ولا يغيّر ذلك دور المستخدم أو شركاته.
- تضيف الإدارة الموظف من زر مستقل ثم نافذة مخصصة، وتضيف الدور من زر مستقل ثم محرر صلاحيات كامل مقسم إلى: موديول ← قسم ← خانات اختيار.
- يحتفظ المستخدم الآن بصورة رمزية محفوظة من ثلاثة خيارات: حرف الاسم، رجل، أو امرأة. لا تحفظ الصورة الشخصية كبايتات أو رابط متصفح قبل تشغيل خدمة الملفات الآمنة؛ عند اكتمالها ستربط الصورة بـ`FileMetadata` مع تفويض تنزيل وفحص نوع الملف.
## الوصول والتدقيق

لا حذف صامت للشركة أو المستخدم أو الملفات. يضاف التعطيل والأرشفة، وحماية آخر مالك، ومراجعة الصلاحيات الدورية في المرحلة التالية. كل إضافة شركة/مستخدم/دور أو تعديل عضوية/إعدادات يسجل في `AuditEvent`.

## مصادر المنهج

- OWASP Authorization Cheat Sheet: deny-by-default، least privilege، وفحص الخادم لكل كائن.
- NIST RBAC: الدور يضم الصلاحيات، ويدعم فصل المهام.

## بوابة القبول

قبل اعتماد الإدارة كواجهة تشغيلية: اختبارات HTTP لعزل Tenant/Company، مستخدم معطل، جلسة ملغاة بعد تغيير الدور، منع تعيين دور أو شركة عابرة للـTenant، ومنع حذف دور مرتبط بمستخدم أو خفض آخر مالك.
## Company-logo storage exception — 2026-08-16

The earlier generic file-storage deferral remains in force for documents, receipts, employee images, and all general attachments. A deliberately narrow exception is approved for an owner-managed company logo only. The server accepts PNG, JPEG, or WebP bytes up to 512 KiB, verifies the signature and SHA-256 hash, generates an opaque storage reference, writes to private server storage, creates immutable FileMetadata version lineage, and records an audit event. The prior logo is marked `SUPERSEDED` and its private blob remains retained until a future approved retention command. Logo preview/download is an authenticated owner-only endpoint with no public URL, browser-supplied storage path, or reusable file URL. `BASEER_COMPANY_LOGO_STORAGE_ROOT` identifies the private server volume root; it is excluded from Git and must be included in the approved Hostinger server backup when deployment begins.
## ملحق تشغيل الإدارة — 16 أغسطس 2026

- المنطقة الزمنية للشركات لا تظهر في النموذج التشغيلي الحالي: القيمة المعتمدة افتراضياً هي `Asia/Riyadh`، ولا يغيرها المستخدم من الواجهة.
- سبب أرشفة/إعادة تفعيل الشركة اختياري، أما تغييرات الوصول الحساسة (دور المستخدم، تعطيله، سحب وصوله، أو كلمة المرور) فتظل بحاجة سبب مدقق.
- تبقى قائمة التطبيقات ثابتة في سطح المكتب؛ التمرير محصور في مساحة العمل الداخلية، وعلى الجوال يعود التمرير الطبيعي للصفحة.
- حالة «جارٍ التحميل» معلوماتية ومحايدة؛ اللون الأحمر مخصص فقط لفشل فعلي من الخادم أو نقص صلاحية.

### قبول هذه الزيادة

يجب أن تثبت الفحوص: تعديل الدور ينهي جلسات المستخدم، تعديل/حذف دور يعملان للمالك فقط، حذف دور مستخدم يرفض بأمان، سبب حالة الشركة اختياري، وبناء الواجهة والباكند والعقود يمر.
## User identity and display-name rule — 2026-08-16

- Every user has an immutable internal `User.id`. Changing a name or a login never changes memberships, historical audit records, reports, or the user ID.
- `nameAr` and `nameEn` are the editable **display names**. Arabic reports and tables show `nameAr` first, then `nameEn` where needed; the login is not used as a person label except as a fallback.
- Users may sign in with a short username such as `ahmed`; the server resolves it to `ahmed@hajrix.com`. A full email remains accepted when deliberately entered.
- The default domain for new and converted internal users is `hajrix.com`. The migration converts every existing user login to the same local name under `hajrix.com`; it aborts safely if that would create a duplicate.
- Password entry and reset fields include an explicit, local-only show/hide control. Passwords remain hashed server-side; neither audit events nor API responses expose them.
- Display-name and login changes require the owner role and an audited reason. They do not grant extra access and do not alter the user identifier.
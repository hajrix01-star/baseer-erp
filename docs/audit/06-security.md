# المرحلة 6 — تدقيق الأمان

## الخلاصة

أساس الهوية والعزل جيد: كلمات المرور `bcrypt` بكلفة 12، JWT من نوع HS256 بتوقيع ثابت الزمن وسر أدنى 32 بايت، refresh rotation/replay revocation، تفويض خادمي لكل مسار أعمال تمت مراجعته، معاملات مقيدة بالمستأجر مع RLS، وتشفير AES-256-GCM للملفات الحساسة. توجد، مع ذلك، فجوة إطلاق مؤكدة في نشر التخزين: حاوية API للقراءة فقط ولا تحمل volume تخزين ولا مفاتيح/ماسح ملفات، بينما ثلاث قدرات ظاهرة تكتب إلى مسار محلي. كما أن أسماء أسرار CI لا تطابق الأسماء التي يقرأها التطبيق.

## النتائج

### SEC-01 — قدرات الملفات لا تعمل ولا تستمر في تعريف النشر الإنتاجي

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة من الكود والإعداد
- **الدليل:** خدمة `api` في `docker-compose.private-online.yml:49-83` تستخدم `read_only: true` ولا تملك volume سوى `/tmp`. في المقابل تكتب:
  - مستندات الموظفين إلى `storage/employee-documents` افتراضيًا: `apps/api/src/hr/hr-employee-document.service.ts:21,112`.
  - مرفقات Gmail إلى `storage/inbound-evidence`: `apps/api/src/inbound-evidence/inbound-evidence-gmail.service.ts:25,258`.
  - شعارات الشركات إلى `storage`: `apps/api/src/administration/administration.service.ts:249-250,298`.
  لا يمرر compose أيًا من جذور التخزين ولا volume دائمًا، ولا `BASEER_EMPLOYEE_DOCUMENT_ENCRYPTION_KEY` ولا مفاتيح inbound ولا `BASEER_DOCUMENT_SCANNER_ENDPOINT`.
- **الأثر:** رفع الشعار يفشل بالكتابة؛ مستندات الموظف تفشل قبل الحفظ لغياب المفتاح ثم لا تملك مسارًا قابلًا للكتابة؛ مرفقات Gmail لا يمكن حفظها. توجيهها إلى `/tmp` وحده سيجعلها تفقد عند إعادة التشغيل ولن تدخل نسخة PostgreSQL الاحتياطية.
- **هل يمنع الإطلاق؟** نعم إذا كانت أي قدرة رفع/تنزيل ضمن نطاق الإطلاق؛ وبما أن الشعار ومستندات HR ظاهرة كوظائف مكتملة، فهي مانع حالي.
- **المطلوب:** volume دائم مشفر ومملوك لمستخدم الحاوية، مفاتيح من secret manager، scanner إنتاجي، نسخ/استعادة تشمل blobs وقاعدة البيانات مع اتساق مرجعي، واختبار restart/restore.

### SEC-02 — أسماء أسرار CI قديمة ولا تشغّل هوية التطبيق الحالية

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة من الإعداد؛ أثر الفشل يحتاج تشغيل CI نظيف
- **الدليل:** `.github/workflows/verify.yml:32-34` يعرّف `BASEER_ACCESS_TOKEN_SECRET` و`BASEER_REFRESH_TOKEN_SECRET` و`BASEER_AI_CREDENTIAL_ENCRYPTION_KEY`. الهوية تقرأ فقط `IDENTITY_JWT_SECRET` في `apps/api/src/identity/identity-token.service.ts:148-150`؛ خزنة AI تقرأ `AI_CREDENTIAL_ENCRYPTION_KEY` في `apps/api/src/ai-platform/ai-credential-vault.ts:86-95`. ملف `.env.baseer-test` غير متتبع ولن يوجد في checkout نظيف. اختبارات HTTP مثل `scripts/run-administration-lifecycle-verification.mjs` تنشئ tokens فعلية.
- **الأثر:** بوابة CI الحالية غير موثوقة، ويرجح أن تتوقف أول مرة تصدر token أو تخزن إعداد AI؛ لا يمكن الاعتماد عليها كشهادة release.
- **هل يمنع الإطلاق؟** نعم حتى نجاح workflow على commit المرشح.
- **المطلوب:** توحيد أسماء المتغيرات بقيم CI غير إنتاجية صحيحة، وإضافة فحص startup/config صريح قبل الاختبارات.

### SEC-03 — access وrefresh tokens متاحان لأي JavaScript في الصفحة

- **الحالة:** أصفر
- **الخطورة:** متوسط
- **الثقة:** مؤكدة من الكود
- **الدليل:** `apps/web/src/daily-sales-client.ts:196-217` يحفظ الرمزين في `sessionStorage`.
- **الأثر:** أي XSS ناجح في نفس الأصل يستطيع سرقة access وrefresh token. لم يعثر البحث الساكن على `dangerouslySetInnerHTML` أو `eval/new Function` في المصدر، وCaddy يفرض `script-src 'self'` بلا inline scripts في `docker/Caddyfile.private-online`، ما يخفض الاحتمال ولا يزيل الأثر.
- **المطلوب:** تقييم انتقال refresh token إلى cookie `HttpOnly; Secure; SameSite=Strict` مع CSRF مناسب، والإبقاء على access token قصير العمر في الذاكرة إن أمكن، مع اختبار XSS/dependency supply-chain.

### SEC-04 — التفويض موزع يدويًا على controllers بدل guard افتراضي مغلق

- **الحالة:** أصفر
- **الخطورة:** متوسط
- **الثقة:** مؤكدة من الكود
- **الدليل:** لا يوجد global authentication guard؛ controllers تستخرج `Authorization` وتستدعي خدمات التفويض بنفسها، مثل `apps/api/src/ai-platform/ai-platform.controller.ts:350-359` و`apps/api/src/inbound-evidence/inbound-evidence.controller.ts:132-134`.
- **الأثر:** لم يثبت endpoint أعمال مكشوف في المراجعة الحالية (راجع [04-backend-and-api.md](04-backend-and-api.md))، لكن إضافة route لاحقة قد تنسى التفويض دون أن يفشل framework افتراضيًا.
- **المطلوب:** guard عالمي fail-closed ووسم صريح للمسارات العامة المحدودة، مع اختبار يسرد كل route ويثبت تصنيفها.

### SEC-05 — دورة حياة مفاتيح تشفير الملفات غير موثقة في النشر

- **الحالة:** أصفر
- **الخطورة:** متوسط
- **الثقة:** مؤكدة من الإعداد
- **الدليل:** خدمات HR وinbound تشترط مفاتيح base64 بطول 32 بايت (`hr-employee-document.service.ts:103-105` و`inbound-evidence-gmail.service.ts:245-250`)، لكن `ops/private-online/.env.private-online.example` لا يسردها، و`docker-compose.private-online.yml` لا يمررها، ولا يوجد key version/rotation runbook لملفات HR/inbound.
- **الأثر:** فقد المفتاح يفقد المستندات نهائيًا، وتدويره دون migration يجعل النسخ القديمة غير قابلة للقراءة.
- **المطلوب:** سجل إصدارات مفاتيح، escrow/backup محمي، rotation/re-encryption واختبار استعادة.

## ضوابط نجحت في المراجعة الساكنة

| المجال | الدليل والحكم |
|---|---|
| كلمات المرور | `apps/api/src/identity/password.util.ts:4-27`: bcrypt cost 12، قبول صيغ محددة، وفشل مغلق |
| JWT | `identity-token.service.ts:25,86-179`: HS256 مثبت، claims محصورة، توقيع timing-safe، انتهاء، وسر أدنى 32 بايت |
| الجلسات | `auth.service.ts:189-314`: refresh token hash، rotation، كشف replay وسحب الجلسة، session version |
| عزل المستأجر | `DatabaseService.inTenantTransaction` يضبط سياق RLS؛ migrations عديدة تفعل وتفرض RLS؛ الفحوصات التشغيلية المؤجلة ستعيد حراس RLS |
| الاستعلامات | لم يعثر البحث على `$queryRawUnsafe` أو `$executeRawUnsafe` في المصدر غير المولد؛ SQL الخام المستخدم tagged/ثابت |
| XSS/headers | لا sinks مباشرة معروفة في المصدر؛ Caddy يفرض CSP/HSTS/nosniff/frame deny/referrer/permissions/COOP |
| CSRF/CORS | الواجهة تستخدم bearer header لا cookies؛ لا CORS browser opt-in، والنشر same-origin عبر Caddy. CSRF التقليدي غير قابل للتطبيق على الطلبات الحالية |
| رفع مستندات HR | حد 5 MiB، magic bytes لـPDF/JPEG/PNG، AES-GCM، path allowlist، scanner fail-to-quarantine؛ `hr-employee-document.service.ts:98-112` |
| أسرار متتبعة | فحص أنماط مفاتيح خاصة/AWS/GitHub لم يجد تطابقات؛ تطابق `sk-` الوحيد داخل blob مولد لـPrisma، لا ملف إعداد/سر. هذا فحص نمطي وليس secret scan احترافيًا |
| السجلات | طبقة observability تحصر أحداثًا وحقولًا منخفضة الحساسية؛ لم يظهر تسجيل token أو password أو API key في المسارات المفحوصة |

## الوصول الأفقي والرأسي

- خدمات الشركات تستخدم سياقًا موثوقًا يحوي tenant/company/actor، وتكرر مرشحات `tenantId/companyId` فوق RLS.
- مسارات owner الحساسة تستدعي `authorizeOwner`، ومسارات المالية تستدعي صلاحيات محددة؛ مراجعة 46 controller لم تثبت route أعمال بلا تحقق.
- لا يثبت الفحص الساكن وحده منع كل IDOR؛ يلزم تشغيل مجموعة HTTP/RLS الحالية على قاعدة اختبار مقيدة في CI، وهو شرط بوابة لا ادعاء ناجح.

## قرار المرحلة

**مكتملة مع ملاحظات.** الضوابط البرمجية الأساسية جيدة، لكن SEC-01 وSEC-02 مانعان مثبتان/مرجحان بقوة للإطلاق الحالي، والتحقق الديناميكي للأمن مؤجل إلى بيئة CI آمنة.

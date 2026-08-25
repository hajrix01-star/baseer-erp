# خارطة العلاج

## مبادئ التنفيذ

- كل إصلاح يربط بمرشح Git ونتيجة اختبار قابلة للحفظ؛ لا تقبل لقطات محلية مجهولة الـSHA.
- الأولوية ليست عدد الملاحظات، بل إزالة احتمالات فقد البيانات والتعطل الصامت ثم استعادة موثوقية بوابة CI.
- أي وظيفة لا يمكن جعلها آمنة ضمن نافذة الإطلاق تُخرج من النطاق عبر feature flag وصلاحية ورسالة واضحة على الواجهة والخادم معًا.

## قائمة الإصلاحات المرقمة المعتمدة

1. إصلاح متغيرات CI لتطابق أسماء أسرار runtime، وإضافة فحص إعدادات يفشل عند النقص.
2. إصلاح فشل التعريب في الملفات الثلاثة ثم جعل بوابة localization خضراء.
3. تقليل حزمة الويب حتى تجتاز ميزانية الإصدار على build نظيف.
4. تنفيذ صفحة Hajri Tax «قيد البناء» مع منع أي عملية أو بيانات مضللة، مع إبقائها ظاهرة.
5. إخفاء Admin Backup أو تنفيذ صفحة حالة صحيحة؛ يمنع استمرار fallback إلى صفحة الإدارة العامة.
6. تركيب bind mount دائم على نفس الخادم لمسار ملفات التطبيق، مع صلاحيات مستخدم الحاوية.
7. تهيئة مفاتيح تشفير الملفات وفاحص الملفات والتحقق منهما عند بدء التطبيق من دون كشف القيم.
8. اختبار مسار الملفات كاملًا: رفع، فحص، تنزيل، إعادة تشغيل، ثم استعادة.
9. إنشاء نسخة احتياطية مشفرة على وسيط مستقل عن الخادم، وتنفيذ restore/reconciliation وقياس RPO/RTO.
10. تثبيت مراقبة إنتاجية: healthchecks، جمع سجلات، metrics، وتنبيه مجرب للأخطاء والتوقف.
11. تشغيل مرشح نظيف كامل: build وtype/lint وE2E وHTTP متعدد الأدوار وDB/RLS/migrations، وحفظ النتائج مع SHA.
12. إصلاح شجرة npm (`ajv-formats`) وتشغيل dependency audit وSBOM/license report في CI.
13. فرض pagination وحدود تاريخ وتجميع SQL للتقارير الكبيرة، ثم EXPLAIN واختبار حمل مقابل SLO.
14. تطبيق rate limiting موزع للتقارير والتصدير والرفع والتكاملات، مع اختبار 429 صحيح.
15. إضافة قيود قاعدة بيانات دفاعية لأرصدة وحركات المخزون، واختبار التزامن والعكس.
16. جعل واجهة الصلاحيات fail-closed أثناء التحميل أو الفشل بدل إظهار الوحدات مؤقتًا.
17. توحيد التحقق من إعدادات التكاملات/الملفات، وإضافة guard خادمي افتراضي fail-closed للمسارات الجديدة.
18. لاحقًا: تحسين دورة refresh token، تفكيك الملفات والوحدات الكبيرة، وتحسين حارس architecture وتوافق DELETE والتغطية.

## عاجل خلال 48 ساعة

| الأولوية | المشكلة/الأثر | الدليل | الإجراء المقترح | التبعيات | الجهد التقديري |
|---|---|---|---|---|---|
| P0-01 | لا مرشح موحد ولا CI موثوق؛ لا يمكن إصدار شهادة | R-03، R-04 | تجميد SHA مرشح، تصحيح `IDENTITY_JWT_SECRET` و`AI_CREDENTIAL_ENCRYPTION_KEY` وأسماء env، إضافة config preflight، وتشغيل checkout نظيف | مالك CI وsecret store غير إنتاجي | 0.5–1 يوم |
| P0-02 | بوابة التعريب تفشل | R-05 | نقل النصوص الثلاثة إلى copy dictionaries أو إصلاح false-positive موثق، ثم نجاح `check:web-localization` | لا شيء | 2–4 ساعات |
| P0-03 | حزمة الويب تتجاوز السقف | R-06 | تحليل bundle، فصل chart/provider/runtime، إزالة startup imports غير اللازمة، build نظيف ونجاح جميع حدود budget | P0-01 | 0.5–1.5 يوم |
| P0-04 | صفحتان غير مكتملتين مرئيتان | R-07 | قرار المالك: تبقى Hajri Tax ظاهرة، فتنفذ صفحة «قيد البناء» صريحة بلا عمليات/بيانات وتختبر navigation. أما Backup فتخفى أو تعرض حالة صحيحة فقط؛ لا fallback إلى شاشة أخرى. | تنفيذ واجهة Hajri وحسم نطاق Backup | 2–6 ساعات |
| P0-05 | ملفات HR/logos/Gmail قد تفشل أو تضيع | R-01 | قرار المالك: bind mount لمسار دائم على المضيف نفسه إلى جذر التخزين الفعلي في API؛ يضبط ownership، encryption keys، scanner وstartup validation ثم يختبر upload/restart/restore. النسخ الاحتياطية المشفرة تذهب إلى وسيط مستقل؛ التخزين الأولي المحلي وحده لا يكفي للاستعادة من فقد المضيف. | مسار بيانات المضيف، secret manager/ملف أسرار محمي، scanner، وسيط نسخة احتياطية | 1–3 أيام |
| P0-06 | لا إثبات لمسارات الأعمال | R-03 | تشغيل pipeline كامل: build، unit/policy، Playwright desktop/mobile، HTTP متعدد الأدوار، DB/RLS، migrations fresh/restore؛ حفظ التقارير مع SHA | P0-01، staging DB | 1–2 يوم |
| P0-07 | لا تنبيه عند العطل | R-08 | حد أدنى قبل الإطلاق: healthchecks، جمع JSON logs، error-rate/latency/availability alerts، قناة استلام وsynthetic login/readiness؛ اختبر تسليم تنبيه | منصة observability/on-call | 1–2 يوم |
| P0-08 | لا استعادة حالية ولا rollback مثبت | R-02 | أخذ نسخة staging مماثلة، استعادة DB+blobs، checksums/reconciliation، قياس RPO/RTO، وتجربة rollback/roll-forward للإصدار الحالي | P0-05، staging، مسؤول بيانات | 1–3 أيام |

> إذا تجاوز P0-05 أو P0-08 نافذة 48 ساعة فلا يُخفف المانع؛ يؤجل الإطلاق حتى اكتمالهما. الزمن تصنيف أولوية لا وعد بموعد جاهزية.

## أولوية خلال أسبوعين

| الأولوية | المشكلة/الأثر | الدليل | الإجراء المقترح | التبعيات | الجهد التقديري |
|---|---|---|---|---|---|
| P1-01 | تقارير O(n) على كامل المدة | R-09 | فرض حد تاريخ/page size، aggregation في SQL، keyset pagination، rollups/snapshots عند الحاجة، EXPLAIN وload test بأحجام مماثلة | dataset آمن وSLO | 3–6 أيام |
| P1-02 | rate limiting جزئي/محلي | R-10 | limiter موزع أو edge gateway، quotas حسب actor/company/IP/route، حدود export/upload/report، تصحيح Retry-After واختبار 429 | Redis/gateway وسياسة استخدام | 2–4 أيام |
| P1-03 | أرصدة المخزون تعتمد على الخدمة فقط | R-12 | migration تضيف CHECKs الممكنة، trigger/constraint لاتساق before/after، اختبار تزامن وعكس، وخطة فحص بيانات قبل التفعيل | staging reconciliation | 2–4 أيام |
| P1-04 | الصلاحيات البصرية fail-open | R-11 | state machine `loading/error/loaded`، shell fail-closed، retry واضح، واختبارات انقطاع permission API وتبديل الشركة | لا شيء | 1–2 يوم |
| P1-05 | لا guard خادمي افتراضي | R-14 | global auth/authz guard fail-closed، decorator صريح للمسارات العامة، route inventory test يفشل عند route غير مصنف | تنسيق كل controllers | 3–5 أيام |
| P1-06 | إعدادات integrations/files موزعة | R-16 | schema مركزي typed لكل capability، validation مشروط بالـfeature flags، readiness يشرح السبب دون أسرار، وتوثيق rotation | P0-05 | 2–4 أيام |
| P1-07 | شجرة الاعتماديات غير متسقة والتدقيق offline | R-13 | `npm ci` نظيف، حل `ajv-formats`/resolver، `npm ls` صفر، SBOM وaudit online في CI، وحسم advisory Prisma وفق runtime exposure | نافذة شبكة CI | 0.5–2 يوم |
| P1-08 | cutover Noorix غير محسوم | R-18 | إعلان fresh-start أو replacement؛ عند replacement نفذ mapping/rehearsal ومصالحة العملاء/الموردين/الأرصدة/المخزون | مالك أعمال ونسخة بيانات آمنة | 3–10 أيام |
| P1-09 | pipeline ملفات HR يبقي DB transaction مفتوحة | جزء R-01 | quarantine/scan خارج المعاملة، معاملة metadata قصيرة، outbox وحالات retry/cleanup durable | P0-05 | 3–5 أيام |

## تحسينات لاحقة

| الأولوية | المشكلة/الأثر | الدليل | الإجراء المقترح | التبعيات | الجهد التقديري |
|---|---|---|---|---|---|
| P2-01 | refresh token قابل لـJavaScript | R-15 | spike لـHttpOnly Secure SameSite cookie مع CSRF/rotation واختبارات انتقال؛ إبقاء access قصيرًا في الذاكرة | مراجعة نموذج النشر | 3–6 أيام |
| P2-02 | وحدات ضخمة وAppModule يدوي | R-17 | تقسيم workspaces/services حسب use-case، module manifests/registration helpers، ownership وحدود imports | بعد استقرار الإصدار | 2–4 أسابيع تدريجيًا |
| P2-03 | حارس architecture محدود ودورة type-only | R-21 | dependency graph/lint للحدود والدورات، budget لحجم الملفات والتبعيات، إزالة الدورة دون churn | P2-02 | 2–4 أيام |
| P2-04 | DELETE bodies غير متوافقة | R-19 | نقل السبب/الإصدار إلى path/query أو POST action idempotent، مع فترة توافق وعقد API | تنسيق web/API | 1–3 أيام |
| P2-05 | شهادة تراخيص غير كاملة | R-20 | SBOM CycloneDX/SPDX، license allow/deny policy، مراجعة الحزم الست وتخزين artifact في CI | P1-07 | 1–2 يوم |
| P2-06 | لا coverage أو mutation baseline | فجوة المرحلة 8 | coverage للطبقات الحرجة وحدود واقعية، property/concurrency tests للمالية والمخزون، mutation sampling للعقود | pipeline مستقر | 3–7 أيام |

## ترتيب إعادة فتح بوابة الإطلاق

1. إنهاء P0-01 إلى P0-04 وإثبات CI/build نظيف.
2. إغلاق P0-05 فعليًا، لا بمجرد تغيير مسار محلي.
3. تنفيذ P0-06 على staging مماثل للإنتاج.
4. إغلاق P0-07 وP0-08 مع receipts وتجربة تسليم/استعادة.
5. تنفيذ حد أدنى من P1-01 وP1-02 يثبت SLO والحماية تحت الحمل.
6. إعادة تقييم كل صف في [08.5-release-gate.md](08.5-release-gate.md)؛ لا يتحول القرار إلى GO إلا إذا نجحت الشروط الحرجة، أو إلى GO WITH CONDITIONS فقط للشروط غير الحرجة ذات مالك وموعد ورصد واضح.

## مؤشرات قبول العلاج

- CI أخضر من checkout نظيف، SHA واحد، وتقارير build/E2E/DB محفوظة.
- صفر صفحة مرئية بلا تنفيذ/رسالة/flag متسق.
- upload → scan → download → restart → backup → restore ناجح، مع checksum وعزل شركة.
- restore كامل ومصالحة رصيد دفتر/مخزون/رواتب/ملفات ضمن RPO/RTO.
- تنبيه 5xx/readiness مصطنع يصل للمالك ويغلق وفق runbook.
- p95/الذاكرة/DB pool ضمن SLO على أقصى فترة مسموحة، و429 صحيح تحت الاندفاع.
- `npm ls` وlicense/SBOM/audit gates قابلة لإعادة التشغيل ومن دون أخطاء غير مقبولة.

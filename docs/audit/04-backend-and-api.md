# المرحلة 4 — الخلفية وواجهات API

## الحكم

سطح API كبير لكنه يتبع نمطاً أمنياً متسقاً: Zod عند الحدود، سياق شركة/tenant حي، عقود response، أخطاء موحدة، ومعاملات/idempotency لعمليات الأعمال. لم يظهر endpoint أعمال حساس بلا تفويض في الجرد الحالي. توجد فجوتان تشغيليتان واضحتان: rate limiting غير شامل، وإرشاد Retry-After خاطئ لمسار AI؛ كما أن النجاح التاريخي لا يغطي التغييرات غير الملتزم بها الحالية.

## الجرد والتوافق

- 46 controller و310 route decorators: 117 GET، 173 POST، 16 PUT، 4 DELETE.
- تدقيق navigation السابق طابق 224 مسار Web ثابتاً مع 309 endpoints. المسار الجديد رقم 310 هو `POST /v1/reports/official-runs`، وهو مسجل في `AppModule` ويستخدمه `report-run-client.ts`.
- فحص registration الحالي: 46/46 controller مسجّل.
- كل controller يحتوي `@Body` يستخدم عقد parse/safeParse. UUID/date/boolean/query inputs تُفحص بعقود أو pipes/validators محلية.
- responses الحساسة تمر غالباً عبر schema `.parse`؛ أي خرق عقد يتحول إلى 500 آمن بدلاً من إرسال shape غير متوقع.

## مصفوفة التفويض المهمة

| السطح | الضبط المرصود | النتيجة |
|---|---|---|
| sign-in/owner activation/refresh | public مع Zod وIP+identity throttles | مناسب |
| sign-out | Bearer مطلوب وإبطال server-side | مناسب |
| Administration | tenant admin session؛ كل mutation الحساسة تستدعي `ownerOnly` في service | مناسب |
| Finance/HR/Operations | Bearer + company UUID + membership + capability حي؛ queries تحمل tenant/company | مناسب من الكود، RLS في المرحلة 6/7 |
| Reports | `reports.read`؛ preview/export تضيف `platform.output.preview/export` | مناسب؛ `official-runs.controller.ts:57-62` |
| Marketing | read/write/provider permissions منفصلة؛ OAuth التجريبي server-gated | مناسب ضمن النطاق المشروط |
| AI runtime | `platform.ai.use` + capability المصدر + feature gate/budget/idempotency | مناسب ضمن pilot |
| Inbound Evidence/Gmail | tenant owner فقط؛ callback public مربوط state أحادي الاستخدام | مناسب من الكود |
| Owner daily brief | tenant owner فقط ولا يقبل company من العميل | مناسب |
| Observability summary | company context وصلاحية مخصصة | مناسب |
| Health/live readiness | public ومقصود للبنية | مناسب |

ملاحظة: إرجاع 401 لمسارين محميين ثبت سابقاً، لكنه لا يثبت 403/200 أو العزل الأفقي لكل 310 مساراً. لذلك تبقى اختبارات DB/HTTP الحالية جزءاً إلزامياً من بوابة الإطلاق.

## المدخلات والمخرجات والأخطاء

- `ApiExceptionFilter` يحول 400/401/403/404/409/429/503/500 إلى عقد error موحد ويحجب تفاصيل 500، مع correlation id (`api-exception.filter.ts:23-58`).
- client يعيد refresh مرة واحدة عند 401، ويعيد المحاولة تلقائياً لطلبات GET فقط عند network/502/503/504؛ لا يعيد commands (`daily-sales-client.ts:252-301`).
- كل طلب مصادق عليه يحصل على `Cache-Control: no-store, private` من hook الخادم.
- رفع مستند الموظف يضبط `@RouteConfig({bodyLimit: 8 MiB})` على create/replace، بينما الحجم المفكوك محدود بـ5 MiB مع magic MIME؛ لا توجد فجوة body-limit في هذا المسار.
- downloads تضبط `nosniff` و`no-store` وattachment disposition، وتتحقق من حالة scanner/record/company قبل القراءة.

## المعاملات والتزامن وidempotency

- `IdempotencyService` يستخدم INSERT/ON CONFLICT ذرياً ومفتاحاً مكوناً من tenant/company/actor/operation/key، ويتحقق من hash الطلب ويرفض mismatch (`idempotency.service.ts:114-153`).
- 40 من 84 service files تذكر idempotency صراحة؛ ليس كل service command، لذلك النسبة ليست مقياس تغطية. التدفقات المالية/HR/operations ذات الأثر تستخدم receipts مخصصة أو الخدمة المركزية.
- web يولد UUID لكل command ولا يعيد POST تلقائياً.
- transaction/race invariants التفصيلية تؤجل للمرحلة 7 والفحوص الفعلية للمرحلة 8.

## النتائج

### API-01 — Retry-After الخاص بـAI غير مطابق لنافذة الحد

- **الحالة:** أصفر؛ **الخطورة:** متوسطة؛ **الثقة:** مؤكدة من الكود.
- `AiRuntimeRateLimitService` يحد 30 طلباً/5 دقائق ثم يرمي 429 بلا header (`ai-runtime-rate-limit.service.ts:14-29`).
- `ApiExceptionFilter.retryAfterSeconds` لا يعرف إلا headers الخاصة بـauth، ثم يعيد fallback قدره 900 ثانية (`api-exception.filter.ts:85-97`).
- الأثر: مستخدم AI يطلب منه الانتظار 15 دقيقة رغم انتهاء نافذة الخادم بعد 5 دقائق، والـAPI لا يرسل وقتاً دقيقاً.
- الإجراء: exception/response header مخصص يحمل seconds المتبقية، مع اختبار عقد 429.

### API-02 — لا rate limiting عام أو محدد للعمليات المكلفة خارج auth/AI

- **الحالة:** أصفر؛ **الخطورة:** متوسطة؛ **الثقة:** مؤكدة من الكود.
- `AppModule:140-146` يصرح بعدم وجود global guard؛ استعمال ThrottlerGuard محصور في ثلاث عمليات auth، وAI يستخدم Map داخلياً.
- لا حد مثبت للتصدير/إنشاء المستندات، Gmail sync، تنزيل الملفات، التقارير الثقيلة، أو uploads.
- الأثر: إساءة استخدام مستخدم مصادق أو client loop يمكنها استنزاف CPU/DB/provider/storage، حتى في نشر خاص.
- الإجراء: حدود per-user/company للعمل المكلف وconcurrency caps؛ لا تضع reads العادية كلها في ميزانية auth نفسها.

### API-03 — rate limiting داخل الذاكرة لا يدعم تعدد النسخ

- **الحالة:** أصفر؛ **الخطورة:** منخفضة حالياً/متوسطة عند التوسع؛ **الثقة:** مؤكدة من الكود.
- auth throttler وAI windows محلية للعملية؛ قرار الحوكمة يقبل نسخة API واحدة فقط. لا يوجد shared atomic store.
- لا يمنع private single-replica إذا وثق، لكنه يمنع horizontal scale.

### API-04 — DELETE bodies تقلل قابلية التوافق

- **الحالة:** أصفر؛ **الخطورة:** منخفضة؛ **الثقة:** مؤكدة من الكود.
- أربعة DELETE routes؛ ثلاثة منها تعتمد على body (حذف labels/rules وwithdraw membership)، بينما حذف role يقرأ body شكلياً ولا يستخدمه.
- بعض proxies/clients لا تتعامل بثبات مع DELETE body. الإجراء: نقل idempotency/reason إلى header أو POST command واضح، مع backward compatibility.

### API-05 — الدليل التشغيلي الحالي غير مكتمل

- **الحالة:** أحمر لبوابة الإطلاق؛ **الخطورة:** عالية؛ **الثقة:** مؤكدة من الأثر.
- `test-results/.last-run.json` الحالي يقول `passed`، لكنه لا يحمل SHA أو عدد حالات أو تقريرًا قابلًا للتتبع؛ والتغييرات الحالية تشمل controller جديداً ومسارات تقارير وعقوداً وCI.
- لا يعني وجود الخلل في API بعينه، لكنه يمنع تأكيد توافق 401/403/200 والعزل/الفشل الشبكي على الشجرة الحالية حتى تنجح الفحوص.

## نقاط قوة إضافية

- Gmail callback يهرب البريد قبل HTML (`inbound-evidence.controller.ts:93-99,136`).
- Marketing OAuth غير المكتمل لا يصبح متاحاً بمجرد وجود secrets؛ يحتاج gate صريح (`marketing.controller.ts:108-119`).
- Report snapshot refresh مرتبط بكود `REPORT_RUN_EXPIRED` فقط ولا يجدد عند 403/404 عام/شبكة.
- إخفاقات 500 تسجل server-side مع correlation id ولا تُعرض تفاصيلها للعميل.

## تحقق معايير القبول

- [x] جردت routes والـcontrollers وربط التغيير الجديد.
- [x] فُحص validation/authz/error contracts/network retries.
- [x] فُحصت idempotency/rate limiting/transaction patterns.
- [x] فُصلت عيوب الكود عن نقص الدليل التشغيلي.

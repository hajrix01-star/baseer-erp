# المرحلة 8 — الاختبارات والأداء والتشغيل

## الخلاصة

نجحت type-check لكل الحزم وأغلب الحراس الساكنة، ونجحت 20 حالة policy/output مستقلة على artifacts المبنية محليًا. فشلت بوابتان مطلوبتان داخل CI الحالي: localization guard، وميزانية حزمة الويب. كما فشل فحص شجرة الاعتماديات لعدم توافق `ajv-formats`. لم يسمح نطاق المهمة ببناء جديد أو Playwright أو اختبارات DB التي تنشئ fixtures، لذلك لا يوجد release-candidate build/E2E/database certificate. التشغيل يملك runbooks وhealth/readiness وسجلات JSON، لكنه لا يملك collector/alert/backup job مثبتًا، وتعريف النشر لا يدعم التخزين الملفي.

## سجل الفحوصات الآمنة

| الفحص | النتيجة | الدليل/التفسير |
|---|---|---|
| Contracts type-check | ناجح | `npm run check --workspace @baseer-erp/contracts`، exit 0 |
| API type-check | ناجح | `npm run check --workspace @baseer-erp/api`، exit 0 |
| Web source type-check | ناجح | `npx tsc -p apps/web/tsconfig.json --noEmit --pretty false`، exit 0 |
| Web Vite config type-check | ناجح بعد تصحيح وضع incremental | الناتج الوسيط حُصر في `docs/audit/08-web-node.tsbuildinfo` |
| Output platform type-check | ناجح | `npx tsc -p packages/output-platform/tsconfig.json --noEmit --pretty false` |
| Architecture/registration | ناجح | 46 controller مسجلة؛ حارس architecture نجح مع محدوديته الموثقة في المرحلة 3 |
| Permission catalogue | ناجح | 124 capability |
| RLS static guards | ناجح | Finance 34، Administration 9، Command 2، Decision 19، HR 28، Reports 19 model |
| AI/Marketing/session guards | ناجح | AI boundary، Marketing A1، session/scheduler resilience |
| Web boundary/dialog/numeric | ناجح | 3 حراس مستقلة |
| Web localization | **فاشل** | literals عربية خارج copy dictionaries في `administration-ai-settings-panel.tsx` و`baseer-chart.tsx` و`command-center-workspace.tsx` |
| `git diff --check` | ناجح | لا whitespace error؛ ظهرت تحذيرات LF→CRLF فقط |
| Web release budget | **فاشل** | initial JS 265,004 B > 250,000 B؛ artifact يضم `baseer-chart` حجمه 573,082 B مقابل سقف 500,000 B |
| Output platform tests | ناجح | 6/6: XLSX formula injection، contracts، formatting، print/payroll outputs |
| API compiled policy checks | ناجح | 14/14: journal، P&L، cash، trial balance، report run، HR EOS، Decision/Basira/AI policies |
| `npm ls --omit=dev --depth=1` | **فاشل** | `ajv-formats@3.0.1` invalid أمام طلب `^2.1.1` ضمن شجرة `@hookform/resolvers`؛ optional peers غير المثبتة ليست وحدها سبب الفشل |
| `npm audit --offline --omit=dev --omit=optional` | ناجح بتحفظ | 0 vulnerabilities من بيانات offline المتاحة؛ لا يعادل استعلام advisory حديثًا |
| فحص التراخيص من lock | مكتمل بتحفظ | 392 package entry، 6 بلا حقل license، ولا AGPL/GPL/SSPL/BUSL/Commons-Clause معلنة في lock |

## اختبارات لم تنفذ ولماذا

| الفحص | الحالة | السبب الآمن والأثر |
|---|---|---|
| Production build نظيف | غير قابل للتحقق | `tsc build`/Vite يكتبان `dist` وcache خارج `docs/audit/`. artifact الموجود أحدث من ملفات المصدر الحالية لكنه غير مبني في هذا التدقيق؛ ميزانيته فاشلة أصلًا |
| Playwright E2E | غير قابل للتحقق | يشغل dev server ويكتب traces/screenshots/test-results خارج نطاق الكتابة الافتراضي؛ الأثر المحلي الحالي في `.last-run.json` يقول `passed` لكنه بلا SHA أو تفاصيل حالات |
| DB/HTTP/RLS/period-race | غير قابل للتحقق | تنشئ/تعدل fixtures وتطبق migrations على قاعدة اختبار، وهو محظور صراحة في هذه المهمة |
| Docker image/compose runtime | غير قابل للتحقق | daemon غير متاح للمستخدم، والبناء يكتب images/cache؛ اكتفي بالفحص الثابت |
| Online dependency advisory | غير قابل للتحقق | الشبكة محظورة؛ لم يشغل `npm audit` online ولا `check:prisma-advisory-status` |
| Load/EXPLAIN/p95 | غير قابل للتحقق | لا dataset staging/production-safe ولا baseline حالي |

## النتائج

### TEST-01 — بوابة localization في CI فاشلة

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة باختبار
- **الدليل:** `npm run check:web-localization` خرج 1 وأبلغ مخالفات في `apps/web/src/administration-ai-settings-panel.tsx` و`apps/web/src/baseer-chart.tsx` و`apps/web/src/command-center-workspace.tsx`. Workflow يشغله في `.github/workflows/verify.yml:59` تقريبًا.
- **الأثر:** CI لا يمكنه المرور على اللقطة الحالية؛ كما أن نصوصًا عربية لا تتبع نمط الترجمة المركزي.
- **المطلوب:** نقل النصوص المرئية إلى copy dictionaries أو تحسين الحارس إذا ثبت false positive، ثم نجاح الأمر في checkout نظيف.

### TEST-02 — لا شهادة build/E2E/DB حالية لمرشح الإصدار

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة من الأدلة المتاحة
- **الدليل:** أثر Playwright المحلي الحالي يقول `passed`، لكنه بلا SHA أو تفاصيل قابلة للتتبع؛ الشجرة غير نظيفة ولا يوجد run CI حالي، والاختبارات الديناميكية لم تنفذ بسبب حدود القراءة.
- **الأثر:** لا إثبات end-to-end قابل للتتبع للدخول والصلاحيات والفواتير والمخزون والتقارير والاستيراد/التصدير والجوال بعد التغييرات الحالية.
- **المطلوب:** commit مرشح نظيف وworkflow ناجح كامل مع تقارير محفوظة.

### PERF-01 — ميزانية الويب تفشل على artifact الحالي

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة باختبار artifact؛ تحتاج إعادة بناء نظيفة للتأكيد النهائي
- **الدليل:** `npm run verify:web-budget` خرج 1: initial JS 265,004 مقابل 250,000. ملف `apps/web/dist/assets/baseer-chart-DLrA4YkN.js` حجمه 573,082 مقابل حد chart lazy 500,000 في `scripts/check-web-release-budget.mjs:56`.
- **الأثر:** CI يفشل، وزمن التحميل/التفاعل على الجوال يتدهور.
- **المطلوب:** تحليل bundle، فصل provider/chart/runtime وتخفيف startup imports، ثم build نظيف ونجاح كل الحدود.

### PERF-02 — تقارير مهمة تحمّل كامل النطاق قبل التصفية/الصفحات

- **الحالة:** أصفر
- **الخطورة:** متوسط
- **الثقة:** مؤكدة من الكود
- **الدليل:** `internal-vat-report.service.ts:89-97` يجلب كل أسطر VAT للفترة؛ evidence يعيد التحميل والفرز قبل أخذ 100. `operations-execution.service.ts:49-66` يجلب كل أسطر الاستلام ثم يجمعها قبل slicing، والسطور 80-96 تجلب تاريخ العهدة حتى `to` كاملًا. `operations-internal-registration.service.ts:97-104` يعيد كل التسجيلات/السطور بلا `take` إذا غابت التواريخ. Contracts لا تحد مدة الفترة.
- **الأثر:** زمن وذاكرة O(n) لكل طلب، واحتمال timeouts/ضغط pool على سنوات أو شركات كبيرة.
- **المطلوب:** تجميع SQL، keyset pagination قبل materialization، حدود فترة، snapshots/rollups، وbenchmarks ببيانات مماثلة للإنتاج.

### DEP-01 — شجرة npm غير متسقة

- **الحالة:** أصفر
- **الخطورة:** متوسط
- **الثقة:** مؤكدة باختبار
- **الدليل:** `npm ls --omit=dev --depth=1` خرج `ELSPROBLEMS` بسبب `ajv-formats@3.0.1` غير مطابق لـ`^2.1.1` المطلوب في subtree لـ`@hookform/resolvers`.
- **الأثر:** reproducibility/support risk؛ الاستخدام الحالي يعتمد Zod لا AJV، لذلك لم يثبت runtime failure.
- **المطلوب:** `npm ci` نظيف ثم `npm ls` ناجح، أو إزالة/تسوية dependency غير المستخدمة بقفل متوافق.

### OPS-01 — المراقبة والإنذار غير مكتملين تشغيليًا

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة من الكود والوثائق
- **الدليل:** health/readiness وملخص metrics محمي موجودان (`health.controller.ts`, `observability.controller.ts`)، لكن metrics داخل `Map` في العملية وتفقد عند restart؛ logs إلى stdout/stderr. `docs/foundation/PRODUCTION_OPERATIONS_GATE_A_DISCOVERY.md:12-22` يصرح بعدم وجود collector أو alert receiver أو backup job. compose لا يعرّف healthcheck للـapi/web/caddy ولا log rotation/collector.
- **الأثر:** أخطاء 5xx/تعطل/نفاد الموارد قد لا تصل لأحد، ولا توجد retention أو SLO evidence.
- **المطلوب:** healthchecks، collector/retention/redaction، alerts واختبار تسليم، dashboard/SLO، وon-call ownership قبل GO.

### OPS-02 — backup/restore الحالي لا يغطي مرشح الإصدار والملفات

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة من الأدلة
- **الدليل:** تجربة 2026-08-15 المحلية نجحت على 12 جدولًا؛ المخطط الآن 149 model. لا backup job في compose ولا restore receipt حديث. كما أن blobs خارج PostgreSQL بلا volume وفق SEC-01.
- **الأثر:** RPO/RTO وسلامة استعادة DB+files غير مثبتة.
- **المطلوب:** rehearsal كامل حديث على نسخة staging مع تشفير/checksum، DB+blobs، حسابات وتقارير reconciliation، ووقت RPO/RTO مسجل.

## التغطية وجودة الاختبارات

- 10 ملفات E2E و61 تصريح `test(`؛ مع مشروعي desktop/mobile قد تتكرر الحالات بحسب شروط المشروع. 8 ملفات تتضمن `axe` أو `AxeBuilder`، وتوجد اختبارات RTL/viewport/keyboard/Escape.
- لا يوجد تقرير coverage حالي؛ كثرة اختبارات policy/HTTP مفيدة لكنها لا تعطي line/branch coverage.
- CI الحالي واسع نظريًا: install/generate/migrate/restricted-role/static/type/build/images/DB/HTTP/web budget/audit. SEC-02 وTEST-01/PERF-01 تعني أنه غير قابل للاعتماد حتى ينجح فعليًا.

## التشغيل الإيجابي

- PostgreSQL داخلي بلا منفذ عام، migrate image منفصلة بدور bootstrap، runtime image تستبعد Prisma CLI/advisory toolchain، وcontainers read-only/no-new-privileges.
- Caddy يفرض HTTPS headers ويجمع API والSPA على origin واحد.
- startup يرفض الاستماع قبل اتصال DB و`SELECT 1`، وتوجد liveness/readiness منفصلة.
- `docs/operations/` يتضمن baseline وincident/release/recovery؛ هذه أساس جيد يحتاج receipts فعلية حديثة.

## قرار المرحلة

**مكتملة مع ملاحظات.** نجحت الفحوص الآمنة المستقلة، لكن بوابات localization/bundle الحالية فاشلة، وE2E/DB/build/monitoring/restore غير مثبتة؛ لا يمكن عبور بوابة الإنتاج.

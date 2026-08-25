# المرحلة 9 — سجل المخاطر الموحّد

## منهج التوحيد

رُبطت النتائج المتشابهة بعلاج واحد: فجوة كتابة/فحص مستند HR داخل transaction أدمجت مع قدرة الملفات الإنتاجية (R-01)، وحالة قاعدة البيانات وغياب E2E/build أدمجت في شهادة المرشح (R-03)، ومحددات auth/AI المتفرقة أدمجت في تغطية rate limiting (R-10). لا تعني «أحمر» وحدها خطورة حرجة؛ اللون يعبر عن حالة الإطلاق، بينما عمود الخطورة يعبر عن شدة الأثر.

## المخاطر المفتوحة

| ID | الحالة | الخطورة | الثقة | الخطر والأثر | الدليل المحدد | يمنع الإطلاق | الأصل المرتبط |
|---|---|---|---|---|---|---|---|
| R-01 | أحمر | حرج | مؤكدة من الكود | تخزين الملفات الإنتاجي غير قابل للكتابة/الدوام ولا يملك دورة مفاتيح وفحص واستعادة مكتملة؛ تفشل مستندات HR والشعارات وGmail أو تضيع بعد restart. القرار المعتمد: bind mount دائم على المضيف نفسه، لكنه لا يغني عن نسخة مستقلة. إبقاء scan/file I/O داخل معاملة HR يزيد ضغط الاتصالات عند تفعيله. | `docker-compose.private-online.yml:49-83`؛ `hr-employee-document.service.ts:21,98-112`؛ `inbound-evidence-gmail.service.ts:25,245-258`؛ `administration.service.ts:249-250,298`؛ [SEC-01/05](06-security.md#sec-01--قدرات-الملفات-لا-تعمل-ولا-تستمر-في-تعريف-النشر-الإنتاجي) | نعم | SEC-01، SEC-05، DB-02 |
| R-02 | أحمر | حرج | تحتاج تحققًا تشغيليًا | لا توجد نسخة/استعادة حديثة تشمل المخطط الحالي والـblobs، ولا RPO/RTO أو reconciliation مثبتة؛ الفشل قد يسبب فقدًا غير قابل للاسترجاع. | `docs/operations/RELEASE_AND_RECOVERY_RUNBOOK.md`؛ أثر 2026-08-15 المهمل يغطي 12 جدولًا مقابل 149 model حاليًا؛ [OPS-02](08-testing-performance-and-operations.md#ops-02--backuprestore-الحالي-لا-يغطي-مرشح-الإصدار-والملفات) | نعم | DB-04، OPS-02 |
| R-03 | أحمر | حرج | تحتاج تحققًا تشغيليًا | لا توجد شهادة موحدة للـSHA الحالي تشمل clean build وE2E وHTTP وmigrations وRLS/DB؛ أثر Playwright المحلي الحالي ناجح لكنه بلا SHA أو تقرير حالات. قد توجد فجوة تكامل أو مخطط لا تظهر ساكنًا. | `apps/web/test-results/.last-run.json`؛ 116 migration؛ [TEST-02](08-testing-performance-and-operations.md#test-02--لا-شهادة-builde2edb-حالية-لمرشح-الإصدار)؛ [DB-03](07-database-and-erp-integrity.md#db-03--حالة-schemarls-والبيانات-الفعلية-لمرشح-الإصدار-غير-متحققة) | نعم | UX-04، API-05، DB-03، TEST-02 |
| R-04 | أحمر | عالٍ | مؤكدة من الكود | بيئة CI تعرّف أسماء أسرار هوية وAI لا يقرأها runtime، فيرجح فشل اختبارات إصدار token/خزنة AI ولا يمكن الاعتماد على workflow كشهادة. | `.github/workflows/verify.yml:32-34` مقابل `identity-token.service.ts:148-150` و`ai-credential-vault.ts:86-95`؛ [SEC-02](06-security.md#sec-02--أسماء-أسرار-ci-قديمة-ولا-تشغّل-هوية-التطبيق-الحالية) | نعم | SEC-02 |
| R-05 | أحمر | عالٍ | مؤكدة باختبار | بوابة التعريب الإلزامية تفشل، فتمنع CI وتثبت خروج نصوص عربية عن قاموس النسخ المركزي. | `npm run check:web-localization`، exit 1؛ الملفات الثلاثة موثقة في [TEST-01](08-testing-performance-and-operations.md#test-01--بوابة-localization-في-ci-فاشلة) | نعم | TEST-01 |
| R-06 | أحمر | عالٍ | مؤكدة باختبار | حزمة الويب تتجاوز budget المعلن، ما يفشل CI ويهدد تحميل/تفاعل الجوال. | initial JS 265,004 > 250,000 B؛ chart chunk 573,082 > 500,000 B؛ `scripts/check-web-release-budget.mjs:56`؛ [PERF-01](08-testing-performance-and-operations.md#perf-01--ميزانية-الويب-تفشل-على-artifact-الحالي) | نعم | PERF-01 |
| R-07 | أحمر | عالٍ | مؤكدة من الكود | Hajri Tax وBackup معلنتان ومرئيتان لكنهما لا تعرضان تنفيذًا مطابقًا؛ الأولى تسقط إلى فراغ والثانية إلى overview مضلل. قرار المالك يبقي Hajri Tax، لذلك علاجه هو صفحة «قيد البناء» صريحة بلا عمليات؛ يبقى Backup بحاجة إلى إخفاء أو تنفيذ صحيح. | `page-registry.ts:79,87`؛ `App.tsx:280`؛ `administration-workspace.tsx:38`؛ [UX-01/02](05-frontend-and-ux.md#ux-01--صفحة-hajri-tax-ظاهرة-لكنها-تسقط-إلى-شاشة-ترحيب-فارغة) | نعم حتى تصحح الحالتان | UX-01، UX-02 |
| R-08 | أحمر | عالٍ | مؤكدة من الكود | لا collector/retention/alert receiver أو backup job مثبت؛ metrics داخل ذاكرة العملية، لذلك قد لا يكتشف أحد 5xx أو توقفًا أو ضغط موارد. | `health.controller.ts`؛ `observability.controller.ts`؛ `docs/foundation/PRODUCTION_OPERATIONS_GATE_A_DISCOVERY.md:12-22`؛ [OPS-01](08-testing-performance-and-operations.md#ops-01--المراقبة-والإنذار-غير-مكتملين-تشغيليًا) | نعم | OPS-01 |
| R-09 | أحمر | عالٍ | مؤكدة من الكود | تقارير VAT والمواد والعهد والتسجيل الداخلي تحمل كامل النطاق وتجمع/ترتب قبل pagination، وقد تستهلك ذاكرة وpool أو timeout على بيانات إنتاجية. | `internal-vat-report.service.ts:89-97`؛ `operations-execution.service.ts:49-96`؛ `operations-internal-registration.service.ts:97-104`؛ [PERF-02](08-testing-performance-and-operations.md#perf-02--تقارير-مهمة-تحمّل-كامل-النطاق-قبل-التصفيةالصفحات) | نعم حتى وجود حدود/اختبار حمل | PERF-02 |
| R-10 | أحمر | عالٍ | مؤكدة من الكود | تحديد المعدل جزئي وداخل الذاكرة؛ التقارير والتصدير والرفع والتكاملات المكلفة غير محمية بصورة متسقة، ونسخ API متعددة لا تشترك في العدادات. | [API-01–03](04-backend-and-api.md#api-01--retry-after-الخاص-بـai-غير-مطابق-لنافذة-الحد)؛ AI يعيد `Retry-After` غير مطابق للنافذة عند فشل backend | نعم ما لم تعتمد بوابة خارجية موثقة | API-01، API-02، API-03 |
| R-11 | أصفر | متوسط | مؤكدة من الكود | `permissionCodes === null` يعامل كسماح بصري؛ عند فشل جلب الصلاحيات قد تظهر وحدات غير مسموحة وتطلق طلبات سيرفضها الخادم. لم يثبت كشف بيانات. | `apps/web/src/module-access.ts:20`؛ `App.tsx:304,335-351,380`؛ [UX-03](05-frontend-and-ux.md#ux-03--حالة-الصلاحيات-غير-المحملة-تعامل-كالسماح-في-الواجهة) | لا إذا نجحت ضوابط الخادم، لكنه يجب إصلاحه | UX-03 |
| R-12 | أصفر | متوسط | مؤكدة من الكود | جداول رصيد/حركات المخزون لا تملك CHECK نهائيًا يمنع قيمة سالبة أو عدم اتساق before/after؛ الخدمة تقفل وتتحقق لكن أي مسار لاحق أو SQL إداري قد يتجاوزها. | `apps/api/prisma/schema.prisma` لنماذج `OperationsInventoryBalance/Movement`؛ [DB-01](07-database-and-erp-integrity.md#db-01--لا-قيود-قاعدة-بيانات-تمنع-أرصدة-مخزون-سالبةغير-متسقة) | لا للإطلاق المحدود بعد نجاح DB tests؛ أولوية عالية للصلابة | DB-01 |
| R-13 | أصفر | متوسط | مؤكدة باختبار | شجرة npm غير متسقة، والتدقيق الأمني كان offline فقط؛ قد تتفاوت قابلية إعادة البناء وتبقى advisories غير مرئية. | `npm ls --omit=dev --depth=1` = ELSPROBLEMS بسبب `ajv-formats@3.0.1`؛ `npm audit --offline` فقط؛ [DEP-01](08-testing-performance-and-operations.md#dep-01--شجرة-npm-غير-متسقة) | نعم حتى نجاح install/tree/audit على المرشح | DEP-01 + تحذير Prisma السابق |
| R-14 | أصفر | متوسط | مؤكدة من الكود | التفويض موزع يدويًا داخل controllers بلا guard عالمي fail-closed؛ لم يظهر route أعمال مكشوف الآن، لكن أي route جديد معرض للنسيان. | أمثلة `ai-platform.controller.ts:350-359` و`inbound-evidence.controller.ts:132-134`؛ [SEC-04](06-security.md#sec-04--التفويض-موزع-يدويًا-على-controllers-بدل-guard-افتراضي-مغلق) | لا للنسخة الحالية بعد نجاح route inventory الديناميكي | SEC-04 |
| R-15 | أصفر | متوسط | مؤكدة من الكود | access وrefresh tokens في `sessionStorage` قابلان للسرقة عند أي XSS على الأصل نفسه؛ CSP وغياب sinks مباشرة يخفضان الاحتمال. | `apps/web/src/daily-sales-client.ts:196-217`؛ [SEC-03](06-security.md#sec-03--access-وrefresh-tokens-متاحان-لأي-javascript-في-الصفحة) | لا، مع قبول خطر موثق وتقوية لاحقة | SEC-03 |
| R-16 | أصفر | متوسط | مؤكدة من الكود | إعدادات التشغيل موزعة عبر 19 ملفًا يستخدم `process.env`، والتحقق المركزي لا يغطي التكاملات/الملفات؛ ينتقل الفشل إلى أول طلب بدل startup. | [ARCH-04](03-architecture-and-code-quality.md#arch-04--إعدادات-التشغيل-موزعة)؛ أمثلة مفاتيح الملفات في [SEC-05](06-security.md#sec-05--دورة-حياة-مفاتيح-تشفير-الملفات-غير-موثقة-في-النشر) | لا بعد إغلاق R-01/R-04؛ يبقى دينًا | ARCH-04، SEC-05 |
| R-17 | أصفر | متوسط | مؤكدة من الكود | AppModule وخدمات/workspaces وعقود ضخمة تزيد احتمال التداخل والانحدار وتصعب ownership والمراجعة. | `apps/api/src/app.module.ts`؛ ملفات كبيرة موثقة في [ARCH-01/02](03-architecture-and-code-quality.md#arch-01--appmodule-مركزي-وتجميع-يدوي-واسع) | لا | ARCH-01، ARCH-02 |
| R-18 | أصفر | عالٍ | تحتاج تحققًا تشغيليًا | نمط بدء البيانات/الانتقال من Noorix غير محسوم؛ إطلاق replacement بلا rehearsal ومصالحة أرصدة قد يفقد أو يكرر بيانات. | `docs/foundation/NOORIX_MIGRATION_CLOSURE.md` ومطابقة [01](01-previous-audits-reconciliation.md) | نعم إذا كان Replacement؛ وإلا يلزم استثناء مكتوب | ملاحظة انتقال سابقة + G20 |
| R-19 | أصفر | منخفض | مؤكدة من الكود | ثلاثة DELETE endpoints تعتمد body، ما قد تكسره proxies/clients وتقلل idempotency/observability. | [API-04](04-backend-and-api.md#api-04--delete-bodies-تقلل-قابلية-التوافق) | لا | API-04 |
| R-20 | أصفر | منخفض | تحتاج تحققًا تشغيليًا | تقرير التراخيص من lock غير مكتمل لست حزم بلا license field، فلا توجد شهادة قانونية كاملة رغم عدم ظهور copyleft قوي معلن. | جرد 392 entry و6 بلا حقل license في [المرحلة 8](08-testing-performance-and-operations.md#سجل-الفحوصات-الآمنة) | لا | فحص التراخيص |
| R-21 | أصفر | منخفض | مؤكدة من الكود | حارس architecture يفحص مؤشرات وثائق/سياسة أكثر من حدود imports، وتوجد دورة import type-only؛ قد تمر تدهورات بنيوية لاحقًا. | [ARCH-03/05](03-architecture-and-code-quality.md#arch-03--اسم-بوابة-architecture-أوسع-من-فحصها-الفعلي) | لا | ARCH-03، ARCH-05 |

## ترتيب أخطر عشرة مخاطر

1. R-01 — التخزين الملفي الدائم والمفاتيح والفحص.
2. R-02 — النسخ والاستعادة الشاملة غير المثبتة.
3. R-03 — غياب شهادة مرشح build/E2E/DB حالية.
4. R-04 — عدم تطابق متغيرات أسرار CI/runtime.
5. R-08 — غياب المراقبة والتنبيه الإنتاجيين.
6. R-07 — وظيفتان غير مكتملتين ظاهرتان للمستخدم.
7. R-06 — فشل ميزانية حزمة الويب.
8. R-05 — فشل بوابة التعريب في CI.
9. R-09 — materialization غير محدود في تقارير حرجة.
10. R-10 — rate limiting غير شامل وغير موزع.

## ضوابط/ملاحظات مغلقة أو خضراء

| ID | الحالة | الخطورة | الثقة | الحكم والدليل |
|---|---|---|---|---|
| C-01 | أخضر | منخفض | مؤكدة من الكود | ملاحظة السماح الافتراضي القديمة في backend مصححة؛ `BaseerAuthorizationService` يفشل مغلقًا، ونجح جرد 124 permission. لا يزيل هذا UX-03 البصري. |
| C-02 | أخضر | منخفض | مؤكدة من الكود | سباق تداخل الفترات المالية محمي بـexclusion constraint في migration `20260815211000_finance_integrity_hardening`، فلا يسجل كخطر مفتوح. |
| C-03 | أخضر | منخفض | مؤكدة باختبار | لم يثبت خلل توازن أو تكرار محاسبي: اختبارات journal/P&L/cash/trial-balance نجحت، والكود يفرض double-entry/sealing/reversal/unique serials. يظل التحقق الديناميكي جزءًا من R-03. |
| C-04 | أخضر | منخفض | مؤكدة من الكود | Google/Gmail/AI غير المهيأة تعرض readiness وتعطل الأفعال؛ هي خارج نطاق الإطلاق المقبول ما دامت البوابات الخادمة مغلقة. |

## حكم المرحلة

السجل يحوي 21 خطرًا مفتوحًا بلا تكرار علاجي، منها ثلاثة حرجة وثمانية عالية. اثنا عشر خطرًا تمنع الإطلاق حاليًا بصورة مباشرة أو مشروطة واضحة. لا توجد نتيجة بلا دليل أو تصنيف ثقة؛ الحالات التي لم تسمح حدود التدقيق بإثباتها صُنفت «تحتاج تحققًا تشغيليًا» ولم تُحتسب نجاحًا.

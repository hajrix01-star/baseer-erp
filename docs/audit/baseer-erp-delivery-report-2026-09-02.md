# تقرير تسليم ألفا — Baseer ERP

**تاريخ الفحص:** 2026-09-02 (Asia/Riyadh)
**المرشح:** `85ab15a3baf384be3dcf9312320219208bdd51bb` — `docs(migration): consolidate Noorix completion evidence`
**النطاق:** مراجعة جاهزية إصدار Baseer ERP الحالي للإطلاق الإنتاجي/التسليم التشغيلي.
**بيئة الهدف المفترضة:** private-online وفق `docker-compose.private-online.yml`. لم تُفحَص بيئة منشورة أو أسرار أو بيانات حقيقية.

## القرار

**NO-GO للإطلاق الإنتاجي أو تسليم تشغيلي نهائي.**

القرار لا ينفي أدلة القبول المحلي للموديولات المغلقة، لكنه يمنع وصف المرشح بأنه إنتاجي: توجد موانع P1 مفتوحة، ومسارات حرجة بلا دليل قابل لإعادة التحقق، ولا توجد سلسلة موثقة تربط commit المرشح بملف صورة ثابت ووجهة نشر.

## خريطة الفهم

- [الخريطة التفاعلية](baseer-erp-delivery-architecture.html) و[مواصفتها](baseer-erp-delivery-architecture.json) تم التحقق منهما: 9/9 فحوص تركيب وعرض بلا تحذيرات. SHA-256 للمواصفة `8713a6af8ae2c9faaf1bf273e9fcea8717153adcb1213dfedd87437a5ee2c654` ولـHTML `9ea49ef72112f3a20dff2846a8f10d09be87045a3964baa3b6adb30b2ade2adf`.
- **مثبت:** modular monolith يتكون من React/Vite (`apps/web`)، وNestJS/Fastify (`apps/api`)، وPostgreSQL/Prisma/RLS، مع Caddy كحافة TLS في النشر الخاص. الأدلة: `docs/architecture/ADR-001-GREENFIELD-BASEER-ERP.md`، `apps/api/src/main.ts`، `docker-compose.private-online.yml`، `docker/Caddyfile.private-online`.
- **حدود الثقة الحرجة:** المتصفح→Caddy، Caddy→API، API→PostgreSQL/RLS، والتخزين الخاص/فاحص المستندات، والتكاملات الخارجية الاختيارية (Google/Gmail/AI). Noorix ليس تكامل تشغيل وقتي وفق ADR-001.
- **مسارات الفحص العميق:** الهوية وسياق الشركة، القيود المالية، HR/الحضور، النسخ والاستعادة، الملفات الحساسة، والترحيل من Noorix.

## عمق التغطية والدليل المنفذ

| المنطقة | العمق | الدليل |
|---|---|---|
| المرشح والتشغيل | عميق | مراجعة Git، Docker/Compose، CI، ووثائق الحوكمة |
| الهوية والعزل والأمان | عميق | مراجعة خادم API وRLS وصلاحيات وجلسات وفحص `check:hr-rls` |
| الجودة والرحلات | مركّز | مراجعة حزمة القبول وCI وفحوص معمارية وأنواع وضوابط مختارة |
| السعة والحقيقة المالية | عميق بالتحليل الساكن | وثائق معيار القراءة والحسابات؛ لا benchmark آمن متاح ضمن هذا الفحص |

**فحوص نجحت:** `check:architecture`، فحوص TypeScript للعقود/API/Web، `check:backup-gate-1`، `check:backup-worker`، `check:company-archive-exporter`، `check:authorization-consistency`، و`check:session-resilience`.

**فحص فشل وأعيد التحقق منه:** `npm run check:hr-rls` يفشل لأن `HrEmployeeWorkTerms` موجود في migration وليس في Prisma schema. لا يُعامل ما لم يُشغّل (build كامل، DB/HTTP/E2E، ترحيلات، restore، benchmark) على أنه سليم.

## سلسلة إثبات المرشح

| العنصر | الحالة |
|---|---|
| commit المرشح | مثبت: `85ab15a3baf384be3dcf9312320219208bdd51bb` |
| ملف القفل | موجود: `package-lock.json` |
| artifact إصدار ثابت | غير مثبت |
| digest للصورة مرتبط بالـcommit | غير مثبت |
| وجهة النشر وrollback عملي | غير مثبتان |

## النتائج

### تدقيق الوثائق الحاكمة والأحدث

- أحدث التزام للمرشح يضيف إقفال Noorix الرسمي المحلي للشركات الثلاث. لكنه يحدد `baseer_erp_test` بيئةً مستهدفة ويصرح أنه **ليس قرار إطلاق تشغيلي**؛ لذا لا يصح وصف الترحيل بأنه غير منجز محليًا، ولا يصح اعتباره دليلاً على cutover إنتاجي. الأدلة: `docs/migration/NOORIX_FINAL_CLOSURE_2026-09-02.md` و`NOORIX_THREE_COMPANY_CLOSURE_2026-09-02.md`.
- وثائق private-online ما زالت تشترط backup/restore معزولًا، وrehearsal للتشغيل وcutover عند استخدام بيانات Noorix. وتظل سلطة التسليم وسجل الموديولات يعلنان أن production/cutover منفصلان. الأدلة: `docs/operations/PRIVATE_ONLINE_DEPLOYMENT_REHEARSAL.md` و`docs/governance/CURRENT_DELIVERY_AUTHORITY.md` و`MODULE_DELIVERY_REGISTER.md`.
- وحدة الحضور موثقة كـ**أساس/Pilot قيد البناء** ولا إطلاق لها قبل بوابات API/RLS/QR/location/E2E وpilot فعلي. لكنها حاليًا ظاهرة في سجل الصفحات ومسجلة في التطبيق وبوابة الموظف قابلة للوصول عبر `#attendance`، ولا يوجد استثناء أو تعطيل نشر موثق. لذلك نتائج SEC-001 وSEC-002 موانع P1 **إذا شمل الإصدار الحضور كما يفعل المرشح الحالي**؛ أما العلاج فيبدأ بقرار مالك: احتواء/إخفاء الحضور أو إكمال بوابات الـPilot، لا مجرد توسيع صلاحيات المتصفح تلقائيًا. الدليل: `docs/architecture/ATTENDANCE_AND_TIMEKEEPING_IMPLEMENTATION_BLUEPRINT_AR_2026-08-27.md` و`apps/web/src/page-registry.ts` و`apps/web/src/App.tsx`.

| المعرّف | الوكيل | الخطورة | الدليل | الأثر | العلاج | الثقة |
|---|---|---:|---|---|---|---:|
| SEC-001 | حارس الأمان | P1 مشروط بالنطاق | `docker-compose.private-online.yml` لا يمرر `ATTENDANCE_PIN_PEPPER` أو `ATTENDANCE_QR_SECRET`؛ و`apps/api/src/attendance/attendance.service.ts` يطلبهما عند الاستخدام، بينما `private-deployment-config.ts` لا يتحقق منهما عند الإقلاع | تتعطل رحلة الحضور وقت الاستخدام بدل الرفض المبكر إذا شحنت | قرار مالك: احتواء/إخفاء الحضور غير الجاهز، أو جعل السرّين required وفحصهما عند الإقلاع ثم smoke خلف TLS | عالية |
| SEC-002 | حارس الأمان | P1 مشروط بالنطاق | `docker/Caddyfile.private-online:10` يفرض `camera=(), geolocation=()`؛ البوابة تستدعي الموقع والكاميرا/`getUserMedia` في `apps/web/src/attendance-employee-portal.tsx` | حظر مسار حضور QR إذا شحن، حتى لو وُجدت الأسرار | قرار مالك: احتواء/إخفاء الحضور غير الجاهز، أو سياسة مسار تسمح بالكاميرا والموقع ثم اختبار Pilot خلف Caddy/TLS | عالية |
| DATA-001 | حارس البيانات / أمين الدليل | P1 | `npm run check:hr-rls` فشل في `scripts/check-hr-rls.mjs:37`؛ migration `20260828170000_hr_employee_work_terms/migration.sql` يتضمن الجدول وRLS لكن Prisma schema لا يتضمنه | بوابة عزل HR وفحص schema-history غير قابلين لإعادة التحقق؛ لا يعد ذلك وحده دليلاً على اختراق عزل قائم | وحّد Prisma وmigration أو عدّل البوابة بوضوح، ثم أعد الفحص على قاعدة مرشح معزولة | عالية |
| OPS-001 | أمين التشغيل | P1 | أحدث المرشح يوثق إغلاق ترحيل Noorix **محلياً** ومطابقة ثلاث شركات، لكن `CURRENT_DELIVERY_AUTHORITY.md` ما زال يطلب restore معزولاً على الاستضافة الفعلية، staging/dry-run/reconciliation/cutover approval، وbenchmark/query plans | لا دليل إنتاجي كافٍ لاسترداد البيانات أو cutover أو تحمل الحجم المستهدف | rehearsal معزول وسجل استعادة، ترحيل staging متصالح، benchmarks وخطط استعلام، ثم قبول المالك | عالية |
| OPS-002 | حارس المرشح | P1 | `.github/workflows/verify.yml` لا ينتج أو يوقع أو ينشر artifact؛ Compose يعتمد `BASEER_RELEASE_TAG` ويتيح build من context | لا يمكن إثبات أن ما اختُبر هو ما سيعمل | pipeline: commit ثابت → صور ذات digest/SBOM → migration image → rollout/rollback موثّق | عالية |
| QUAL-001a | رقيب الجودة | P1 | CI لا يشغّل `check:hr-rls` رغم أن البوابة تفشل فعلياً؛ `verify-acceptance.mjs` لا يُستدعى من `.github/workflows/verify.yml` | يمكن قبول مرشح في CI رغم أن دليل عزل HR فاشل | أضف بوابة HR RLS إلى CI وعالج DATA-001 | عالية |
| QUAL-001b | رقيب الجودة | P2 | حزمة القبول تضم 36 خطوة؛ CI لا يطابقها بالكامل: unit، RLS متعددة، session، وعدة رحلات HR/Operations/Reports/Command Center/Decision/Marketing/Backup | قصور دليل وضبط إصدار، لا برهان على عيب منتج مستقل | job قبول CI أو manifest مكافئ مع PostgreSQL معزول وحفظ النتائج | عالية |
| DEP-001 | حارس الأمان | P2 — خطر مقبول ومراقب للنشر الخاص فقط | `npm run check:prisma-advisory-status`: `GHSA-ggr8-5vv4-36mx` ما زال `pending-official-fix`؛ `npm ls` يثبت `prisma/@prisma-config 7.9.1` و`deepmerge-ts 7.1.5` | مسار build/migrate يحوي advisory؛ قرار مالك موثق يقبله مؤقتاً فقط مع عزل runtime/migrate، ولا يسمح به لـSaaS أو التعرض العام | ابقِ العزل الحالي، وشغّل migrate داخليًا فقط، وحدّث Prisma stack مع إصلاح ثابت | عالية |
| SEC-003 | حارس الأمان | P2 | `daily-sales-client.ts` و`attendance-employee-portal.tsx` يخزنان access/refresh token في `sessionStorage`؛ refresh token قد يعيش 30 يومًا | أي XSS بنفس الأصل قد يسرق رمزًا قابلاً لإعادة الاستخدام | Cookie HttpOnly + CSRF/origin، أو تقصير العمر/النطاق مع CSP أقوى | عالية |
| SEC-004 | حارس الأمان | P2 | `private-deployment-config.ts` يسمح بفاحص مستندات HTTP، و`hr-employee-document.service.ts` يرسل مستندات HR إليه | احتمال نقل مستندات حساسة بلا TLS إذا أسيء الضبط | HTTPS إلزامي أو allowlist صريحة لخدمة داخلية موثقة، مع مراجعة egress والاحتفاظ | متوسطة |
| OPS-003 | أمين التشغيل | P2 | صور Node/Nginx/PostgreSQL/Caddy في Docker/Compose تستخدم tags لا digests | إعادة إنتاج البناء ليست حتمية | pin إلى SHA-256 وتحديثها في PR مخصص | عالية |
| GOV-001 | أمين الدليل | P2 | سلطة التسليم الأساسية مؤرخة 23/26 أغسطس بينما توجد وثائق ترحيل حتى 2 سبتمبر | قد ينفصل سجل القرار عن المرشح الحالي | حدّث سجل السلطة/الموديولات مع commit المرشح وأدلة القبول | متوسطة |
| QUAL-002 | رقيب الجودة | P3 | لا توجد lint/formatter gate في `package.json` أو CI | فجوة جودة ساكنة، وليست مانعًا بذاتها | ESLint type-aware وformatter تدريجيًا في CI | عالية |

## الموانع المفتوحة وخطة الإغلاق

1. **الأمان والحضور:** إغلاق SEC-001 وSEC-002 ثم اختبار PIN وQR والكاميرا والموقع خلف Caddy/TLS.
2. **العزل:** إصلاح DATA-001 وإعادة جميع بوابات RLS في قاعدة مرشح معزولة.
3. **الاستعادة والترحيل والسعة:** إثبات restore، Noorix reconciliation/cutover rehearsal، وbenchmark بالحجم المستهدف مع query plans وp95.
4. **المرشح والنشر:** إنشاء سلسلة commit→image digest→deployment، مع rollback ثابت.
5. **القبول:** تشغيل بوابة HR RLS الإلزامية وحزمة قبول CI مكافئة كاملة وحفظ مخرجاتها، ثم توقيع مالك الأعمال وحزمة استلام تشغيلية.

## ما لم يُفحص

لم يُجرَ اتصال ببيئة منشورة أو قاعدة إنتاج، ولم تُقرأ أسرار، ولم تُشغل migrations أو seeds أو restore أو benchmark أو E2E/HTTP يكتب بيانات. لم يُنفّذ اختبار اختراق؛ لا يدّعي هذا التقرير ذلك.

## افتراضات نموذج التهديد المفتوحة

الحكم يفترض نشرًا خاصًا متعدد الشركات كما تصفه الوثائق، مع بيانات مالية وHR حساسة، وأن Caddy هو الحافة العامة الوحيدة. يتغير ترتيب مخاطر نموذج التهديد إذا كان النشر داخليًا بالكامل أو إذا كانت بوابة الحضور/التكاملات الخارجية خارج نطاق الإصدار. يلزم تأكيد المالك قبل إصدار نموذج تهديد نهائي مستقل.

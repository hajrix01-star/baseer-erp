# بطاقة أثر — برنامج انتقال التسويق والسمعة

**المعرف:** `BASEER-IMPACT-2026-09-05-MARKETING-REPUTATION-MIGRATION-PROGRAM`
**المرجع:** `BASEER-ARCH v1.0`
**التصنيف:** `ARCHITECTURAL`
**الحالة:** G0–G4 مقفلة لشريحة تجربة «الشرح عند الطلب»؛ وG0–G3/G5 مقفلة لـMKT-01A وMKT-01B غير المتصلين فقط. لا OAuth حي أو نشر أو قطع للتطبيق السابق.
**المالكون:** Marketing, Reports & Decision Intelligence؛ Platform Data & Operations؛ Platform Identity & Administration.

## سبب التصنيف

المطلوب يغير عقد Google الخارجي، OAuth والأسرار، schema والترحيل، source-to-target
lineage، صلاحيات النشر الآلي، تشغيل worker وقطع تطبيق حي. لا يغطيه foundation
التسويق الحالي الذي يتعمد منع credential أو location أو provider fact أو publishing.

## المراجع المعاد استخدامها

- `docs/marketing/MARKETING_REPUTATION_REPLY_AUTOMATION_POLICY_2026-08-23.md`
- `docs/marketing/GOOGLE_ADS_READ_ONLY_PROVIDER_DECISION_DRAFT_2026-08-23.md`
- `docs/marketing/GOOGLE_PLATFORM_CONFIGURATION_HANDOFF_2026-08-23.md`
- `docs/marketing/MARKETING_METRIC_CATALOG_V1_2026-08-15.md`
- `docs/marketing/MARKETING_REPUTATION_MIGRATION_PROGRAM_2026-09-05.md`

## الحدود التي لا تتغير

- Google Ads قراءة فقط؛ لا إنشاء حملة أو تعديل أو إنفاق أو budget/bid mutation.
- حقائق المزود لا تصبح مبيعات أو قيود أو مدفوعات ERP.
- 1–2 نجمة لا تنشر آلياً؛ 3 نجوم لا تنشر إلا بحارس أمان؛ 4–5 تلقائية فقط بعد
  consent وموقع متحقق وworker/outbox وإيصال.
- لا سر أو refresh token أو response حساس في Git أو المتصفح أو audit.
- لا إيقاف أو حذف للمصدر السابق قبل المطابقة وparallel run ومراجعة التسليم.

## قرارات المالك المسجلة

- يستخدم MKT-01B مشروع Google القديم الموثق للتطبيق السابق فقط كمسار انتقال؛ لا
  ينقل refresh token أو secret منه. يعاد التفويض بعد callback/vault المعتمدين.
- النطاق الأول شركتان: `ARZ` و`المعلم الشامي`. لكل منهما عزل كامل للاتصال
  والـcredential وaccount/location mapping والموافقة والمزامنة؛ لا mapping أو
  token أو مورد مشترك، ولا اختيار تلقائي بالاسم.

## أثر متوقع قبل التنفيذ

| المجال | المسارات المتوقعة |
| --- | --- |
| العقود والخدمة | `packages/contracts/src/marketing.ts`, `apps/api/src/marketing/*` |
| البيانات/الأمان | `apps/api/prisma/schema.prisma`, migrations, RLS, server secret configuration |
| التشغيل | worker/lease/outbox، telemetry، alerts، runbook وcutover checklist |
| الواجهة | `apps/web/src/marketing-*.tsx` ومكونات Baseer المركزية فقط |
| الترحيل | writers قابلة للاستئناف ومطابقة source/target، لا نقل مباشر للأسرار |

## قرار البوابات

### قرار MKT-01A: المنع الخادمي الآمن

- **G0–G3:** موثقة في برنامج الترحيل وADR-MKT-001: لا egress أو callback أو
  schema أو credential؛ الحارس الخادمي يرفض المسار التجريبي حتى مع متغير بيئة.
- **G4:** لا شاشة اتصال جديدة في MKT-01A؛ أي عرض لاحق يستعمل الكتالوج المركزي
  والقاموس الثنائي والـRTL/LTR ولا يضع حسابات KPI في React.
- **المنع الصريح:** لا egress أو callback حي أو credential import أو vault أو sync أو
  publisher أو worker أو قطع للتطبيق السابق قبل مراجعة مستقلة وقيم التشغيل.
- **دليل الإقفال:** route وservice يرفضان دائماً؛ smoke عبر Fastify يثبت `403`
  بلا redirect/`authorizationUrl` مع متغير البيئة `false` و`true`، وتثبت قاعدة
  الاختبار عدم إنشاء OAuth state أو تغيير connection. راجع
  `scripts/run-marketing-gate-a1-verification.mjs` و`MKT-MIG-006`.

### قرار MKT-01B: foundation غير متصل

- **التصنيف:** ARCHITECTURAL؛ schema/migration/vault/mapping/receipt جديدة.
- **النطاق:** Google Business فقط، شركتا ARZ والمعلم الشامي مع company scope
  مستقل؛ لا secret أو OAuth/callback/egress أو worker أو data migration.
- **المرجع:** عقد MKT-01B في برنامج الانتقال وADR-MKT-001؛ اعتمدت المراجعة
  المستقلة التصميم والكود بلا P0/P1، واجتاز الترحيل وRLS على قاعدة الاختبار.
  التنفيذ يبقى غير متصل؛ أي تفعيل يحتاج بوابة مستقلة.

### قرار MKT-02A: تفويض Google Business التجريبي

- **التصنيف:** ARCHITECTURAL؛ يعيد فتح OAuth/callback وcredential lifecycle
  والحالة التشغيلية، لكنه لا يفتح discovery أو sync أو publisher.
- **النطاق:** ARZ وGoogle Business فقط عبر allowlist خادمي UUID؛ PKCE/state قصير
  العمر في جدول مخصص مقيد بـCompany/Membership/Connection، callback خادمي
  يطالب state atomically قبل exchange، وتخزين refresh token المشفر فقط بعد exchange
  ناجح. لا Google Ads أو المعلم
  الشامي أو mapping/location/review/publish أو نقل token قديم.
- **الحدود:** يبقى `BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED` false
  افتراضياً؛ إنشاء client مخصص أو تفعيل API/scope/redirect في Google ليس ضمن
  هذا البناء ويحتاج تأكيد المالك عند لحظة الحفظ.
- **المرجع:** عقد MKT-02A في برنامج الانتقال؛ اعتمدت مراجعة مستقلة G0–G3 ثم
  التنفيذ بلا P0/P1. اجتازت اختبارات callback mock وRLS قبل أي تفعيل خارجي.

### قرار MKT-02A-OPS: تسليم إعداد النشر الخاص

- **التصنيف:** `CONTROLLED`؛ يمرر متغيري تجربة Google Business من ملف بيئة
  الخادم إلى حاوية API ولا يغير عقد OAuth أو البيانات أو الصلاحيات.
- **الحدود:** يبقى كل من `BASEER_GOOGLE_OAUTH_ENABLED` و
  `BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED` بقيمة `false` في القالب.
  `BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_COMPANY_ID` يقبل UUID شركة ARZ فقط؛
  لا يُكتب secret أو UUID في Git. لا يستهلك النشر الخاص Google Secret Manager
  مباشرة؛ مصدر القيم الحي هو `.env.private-online` المحمي على الخادم.
- **دليل الإقفال:** يمرر Compose المتغيرين بلا قيم افتراضية مفعلة، ويثبت فحص
  config أن صورة API تبقى صحيحة مع ملف المثال. لا deploy أو OAuth حي ضمن هذه
  الشريحة.

### قرار شريحة G0–G4: الشرح عند الطلب

- **G0:** الشريحة تخدم المدير غير المختص: علامة `؟` مجاورة لمصطلح تسويقي تشرح
  معناه وحدوده عند الطلب. لا تخفي التحذير أو الرقم أو مصدره، ولا ترسل بيانات.
- **G1:** لا قراءة أو كتابة أو polling أو بيانات جديدة؛ state محلي قصير العمر فقط.
- **G2:** لا تغيير API/schema/صلاحية. المكوّن يعرض نصاً يمرره المالك ولا يقبل HTML
  أو محتوى مزود غير موثوق.
- **G3:** React/CSS والمكتبات الموجودة فقط؛ رُفضت مكتبة tooltip خارجية لأن
  `details/summary` وCSS يقدمان لوحة مفاتيح ولمساً من دون اعتماد جديد.
- **G4:** المكوّن المركزي `BaseerInfoHint` له اسم وصولي، يفتح بالنقر أو لوحة
  المفاتيح، يظل مقروءاً على الجوال وRTL/LTR، ولا يعرض hover وحده أو حركة لازمة.

حارس البوابات يعتمد هذه الشريحة المحلية فقط بعد مراجعة الكود وفحص الويب. تبقى
G0–G4 للموصلات والترحيل مانعة لأي OAuth أو schema أو secret أو نقل بيانات إلى أن
تعتمد القيم التشغيلية وقرار الموصل.

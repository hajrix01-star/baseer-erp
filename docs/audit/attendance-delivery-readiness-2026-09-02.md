# تسليم ألفا — جاهزية الحضور والانصراف

تاريخ الفحص: 2026-09-02
المرشح: مرشح إصدار قيد التثبيت فوق `85ab15a3baf384be3dcf9312320219208bdd51bb`
البيئة المستهدفة: `private-online` عبر Caddy + Nest + PostgreSQL

## النطاق

- تحقق موقع اختياري لكل شركة واحتفاظ بالإحداثيات 14 يوماً.
- اتفاق ساعات عمل الموظف المؤرخ، وفصل جدول الحضور عن الراتب.
- إغلاق مدير الشركة للجلسة المفتوحة بوقت فعلي وسبب إلزامي.
- عرض جميع قواعد الراحة الأسبوعية، ووقت ما بعد الجدول كمرجع غير مالي.

## الخريطة

الخريطة التفاعلية المعتمدة: `docs/audit/attendance-delivery-map-2026-09-02.html`.
تم التحقق من الرسم بـ 9/9 فحوصات showcase ومن احتواء الشاشات حتى 2048×1320. يوضح المسار: PWA/ERP → Caddy HTTPS → Nest Attendance وHR → Prisma/PostgreSQL، مع مجدول حذف الإحداثيات.

## أدلة التحقق المنفذة

| الأمر | النتيجة |
|---|---|
| `npm run build --workspace @baseer-erp/contracts` | ناجح |
| `npm run check --workspace @baseer-erp/api` | ناجح |
| `npm run check --workspace @baseer-erp/web` | ناجح |
| `npm run check:hr-rls` | ناجح: 29 نموذجاً |
| `npm run check:permissions` | ناجح |
| `npm run check:authorization-consistency` | ناجح |
| `npm run check:nest-registration` | ناجح |
| `npm run check:architecture` | ناجح |
| `npm run prisma:test:deploy` ثم `prisma:test:status` | ناجح على `baseer_erp_test` المعزولة؛ 148 ترحيلاً |
| `npm run check:local-prisma-migration-history` | ناجح: 148 مطبق، 0 فشل، 0 اختلاف checksums |
| `npm run verify:attendance-http` | ناجح: المدير/المالك، إغلاق إداري وحدوده وidempotency، الموقع off/on، حذف 14 يوماً، و12 تسجيلًا متزامنًا بلا 429 أو 500 |
| `git diff --check` | ناجح |

## قبول الأعمال

| المتطلب | الدليل في المرشح | الحالة |
|---|---|---|
| الموقع اختياري ولا يطلب عند الإيقاف | Company setting + PWA + service | مقبول برمجياً |
| الإحداثيات تحذف بعد 14 يوماً | scheduler مفعّل إلزامياً في private-online + اختبار HTTP/قاعدة معزول | مقبول ومختبر؛ يصفّر الإحداثيات فقط ويمنع أي تعديل آخر للحدث |
| المالك يدير؛ المدير يغلق فقط | owner-only administrative APIs + manager-scoped open sessions/close | مقبول برمجياً |
| المدير يختار وقت الخروج ويكتب السبب | close contract/service/UI، الوقت بعد الدخول وليس مستقبلياً | مقبول برمجياً |
| لا أثر رواتب أو أوفر تايم تلقائي | WorkTerms منفصل عن compensation؛ report reference-only | مقبول برمجياً |
| ساعات الموظف مرجع أولي للحضور | WorkTerms effective-dated + first schedule validation | مقبول برمجياً |

## نتائج المراجعة المستقلة

لا يوجد P0 أو P1 وظيفي مفتوح في الشفرة بعد إعادة الفحص. أغلقت المراجعة السابقة المسار العملي للمدير عبر `GET /attendance/sessions/open` المحدود، وأغلقت قابلية تعطيل حذف الموقع بصمت عبر شرط تشغيل deployment.

### موانع الإطلاق الرسمي المتبقية

| المعرّف | الشدة | الأثر | الإغلاق المطلوب |
|---|---|---|---|
| REL-001 | P1 | الترحيلات طبقت بنجاح على PostgreSQL معزول، لكن لم يثبت مسار الاستعادة من نسخة احتياطية | backup/restore في قاعدة معزولة ثم smoke check |
| REL-004 | P1 | لا يوجد commit أو artifact/digest ثابت للمرشح | تثبيت commit، بناء صور runtime/migrate منه، تسجيل hashes وخطة رجوع |

## القرار

**NO-GO للإطلاق الرسمي حالياً.** أغلقت أدلة الترحيل المعزول والرحلات والسعة: طبقت 148 ترحيلاً ونجح اختبار HTTP المعزول عند 12 عملية متزامنة. يبقى فقط إثبات backup/restore ومرشح نشر ثابت (REL-001 وREL-004). لا ينبغي النشر قبل إغلاقهما.

## حزمة الاستلام بعد الإغلاق

1. commit مرشح وصور موثقة digest.
2. نسخة احتياطية واستعادة ناجحتان لقاعدة معزولة ثم تطبيق الترحيل.
3. تقرير E2E للموقع، المدير، الاتفاق/الجدول، وعبور منتصف الليل.
4. نتيجة قياس 12/دقيقة وخطة rollback forward-fix أو restore.

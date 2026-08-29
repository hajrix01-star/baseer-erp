# قالب جرد ومواءمة بيانات نوركس → بصير

يملأ هذا القالب **لكل شركة ولكل مصدر/كيان**. لا توجد مواءمة تلقائية افتراضية؛ أي قيمة غير مثبتة تذهب إلى `REVIEW_REQUIRED` ولا تمر إلى staging.

## سجل الكيان

| الحقل | قيمة يملؤها فريق الترحيل |
| --- | --- |
| `migration_run_id` / `company_legacy_id` |  |
| اسم المصدر في نوركس / schema.table أو API export |  |
| اسم الملف وSHA-256/row_count |  |
| الكيان المقصود في بصير |  |
| owner أعمال / owner تقني / مراجع مالي |  |
| نوع الملكية | company-owned / tenant-global / security / derived / excluded |
| قرار النطاق | `PRESERVE`, `TRANSFORM`, `DERIVE`, `EXCLUDE`, `DEFER`, `REVIEW_REQUIRED`, `BLOCKED` |
| سبب القرار ومصدر الدليل |  |
| ترتيب export/import وdependencies |  |
| درجة PII/سرية والاحتفاظ |  |
| acceptance test / rejection test |  |

## جدول مواءمة الحقول

| source field | type/nullability/source example | target entity.field | التحويل المسموح | validation/failure | source ID → target ID policy | القرار/المراجع |
| --- | --- | --- | --- | --- | --- | --- |
| `legacy_id` |  |  | يحفظ فقط في mapping ledger؛ لا يصبح ID بصير | duplicate/missing → reject | UUID جديد في target |  |
| `company_id` |  | `companyId` | resolve عبر company map موثق | foreign/unknown → reject | company target واحد |  |
| `status` |  |  | enum map صريح فقط | unknown → `REVIEW_REQUIRED` | n/a |  |
| `business_date` |  | `businessDate` | timezone rule مصادق عليها | ambiguous/missing → reject | n/a |  |
| `amount` |  |  | Decimal string لا float | precision/currency mismatch → reject | n/a |  |

## سجل العلاقات والتحويلات

| source child | source FK | target parent | phase | الاستراتيجية | test |
| --- | --- | --- | --- | --- | --- |
| Journal line | `legacy_entry_id` | FinanceJournalEntry | بعد إدخال entry | lookup mapping ledger | missing/mismatched company → reject |
| Document allocation | `legacy_document_id`, vault | FinanceOutflowDocument/Vault | بعد document | mapped IDs فقط | total allocation mismatch → reject |
| Attachment | entity type/id | target entity + file metadata | wave مستقلة | copy/re-key/hash/quarantine | hash/type/owner mismatch → reject |

## سجل التحويلات والاستثناءات

| source key | rule/version | قبل | بعد | reason | approved by | status |
| --- | --- | --- | --- | --- | --- | --- |
|  | category mapping |  |  |  |  | pending/approved/rejected |

تستعمل قرارات فئات نوركس الموجودة في `apps/api/src/finance/noorix-category-mapping.ts` كـ**دليل rule versioned** فقط. قرار `SEMANTIC` أو `REVIEW_REQUIRED` يحتاج اعتماد الأعمال ولا يبرر إنشاء فئة target تلقائياً.

## mapping ledger الإلزامي

يحفظ داخل قاعدة staging/سجل ترحيل محمي، لا داخل client ولا كحقل أعمال عادي:

| run | source system | source entity | source ID | source company | target entity | target ID | transform version | hash | state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

قواعده: unique على `(run, source entity, source ID)` و`(run, target entity, target ID)`؛ append-only؛ checksum للصف المصدر؛ ولا يمكّن استيراد صف من شركة ثانية.

## قواعد target المهمة التي يجب اختبارها لا افتراضها

- المدى الموثوق من الشركة في بصير هو `tenantId + companyId`، وتظهر علاقات FK المركبة في `apps/api/prisma/schema.prisma`.
- القيود في `FinanceJournalEntry/Line` مصدر المحاسبة؛ يجب أن تتساوى debit/credit لكل قيد، وتبقى العكوس سجلات منفصلة.
- الأرصدة اليومية/الشهرية وcash-performance projections مشتقة؛ تقارن ثم تعاد بناؤها ولا تستورد كبديل للقيود.
- مستندات الشراء/المصروفات مرتبطة بقيود وخزائن/موردين/فئات وسداد أو التزام؛ راجع `apps/api/src/finance/purchase-expense.service.ts` و`supplier-dues.service.ts`.
- المستخدم المصدر لا ينسخ تلقائياً. كل `createdByUserId` أو actor يحتاج restore-actor provenance معتمد، لا mapping silent إلى مستخدم حي.

## مخرجات mapping التي يعتمدها المراجع

1. ملف inventory مكتمل، وقاموس statuses/enums/timezones/currencies.
2. mapping ledger قابل للاستعلام وموقّع checksum لكل snapshot.
3. قائمة `BLOCKED/REVIEW_REQUIRED` مع أثر count/amount، لا تخفى داخل log.
4. خطة derived rebuild وخطة files/PII لكل كيان.
5. reconciliation query definition وowner الذي يوقعها قبل التجربة.

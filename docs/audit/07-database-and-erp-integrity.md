# المرحلة 7 — قاعدة البيانات وسلامة منطق ERP

## الخلاصة

طبقة سلامة ERP أقوى من المتوسط بوضوح: دفتر مزدوج القيد ومغلق بآليات تطبيق وقاعدة بيانات، قيود منع تداخل الفترات، أرقام ذرية، منع تكرار فواتير المورد، سجلات عكس بدل الحذف، أقفال advisory مرتبة في التدفقات المتزامنة، وRLS مفروض على نطاقات المستأجر. لم يظهر خلل محاسبي مؤكد يغيّر رصيدًا في المسارات المفحوصة. لا تزال حالة قاعدة بيانات مرشح الإصدار غير متحققة، وتوجد فجوة دفاعية في قيود أرصدة المخزون، كما أن خط مستندات HR يبقي معاملة قاعدة البيانات مفتوحة أثناء I/O خارجي ومحلي.

## أرقام المخطط

- Prisma 7.9.1 مع PostgreSQL 16.
- 149 model و114 enum في `apps/api/prisma/schema.prisma`.
- 116 migration؛ 53 ملف migration على الأقل يتضمن تفعيل/فرض/سياسات RLS.
- العلاقات الحساسة تستخدم غالبًا مفاتيح مركبة تشمل `tenantId/companyId` و`onDelete: Restrict`.
- الفهارس الأساسية موجودة للـkeyset في دفتر اليومية، الخزائن، التقارير، HR والعمليات.

## النتائج

### DB-01 — لا قيود قاعدة بيانات تمنع أرصدة مخزون سالبة/غير متسقة

- **الحالة:** أصفر
- **الخطورة:** متوسط
- **الثقة:** مؤكدة من المخطط والمهاجرات
- **الدليل:** `OperationsInventoryBalance` في `apps/api/prisma/schema.prisma:4732-4749` يخزن `baseQuantity/totalValue/weightedUnitCost` دون `CHECK`. جدول الحركة عند السطور 4751 وما بعدها يخزن `quantityAfter/valueAfter/weightedUnitCostAfter` دون قيود غير السالب. Migration الإنشاء `20260820121000_operations_o2_o3_execution/migration.sql` يضيف checks لأسطر الاستلام، لا لجدول الرصيد أو snapshots الحركة.
- **الحد الحالي:** الخدمات تقفل المخزون لكل item وتمنع الاستهلاك/العكس إذا نتج رصيد سالب، مثل `operations-internal-registration.service.ts:58-65` و`operations-execution.service.ts:278-286`.
- **الأثر:** خطأ برمجي لاحق، script داخلي، أو كتابة privileged يمكنه تخزين حالة مستحيلة دون رفض DB، ثم تصبح الحركة المصدر الظاهر لإسقاطات خاطئة.
- **المطلوب:** `CHECK >= 0` للأرصدة والسعر المرجح وحقول after، وقيد اتساق الصفر (`quantity=0` يستلزم قيمة/تكلفة صفرية حسب السياسة)، مع migration يفحص البيانات القائمة أولًا.

### DB-02 — فحص وكتابة مستند HR يجريان داخل transaction قاعدة البيانات

- **الحالة:** أصفر
- **الخطورة:** متوسط
- **الثقة:** مؤكدة من الكود
- **الدليل:** `apps/api/src/hr/hr-employee-document.service.ts:45-66` يبدأ `inTenantTransaction` ثم يستدعي scanner قد ينتظر 10 ثوانٍ ويكتب الملف قبل إنشاء metadata والـdocument. مسار replace عند السطور 70-83 يفعل الشيء نفسه.
- **الأثر:** بطء/تعطل scanner أو filesystem يحتجز connection ومعاملة RLS وأقفالها، وقد يضغط pool عند عدة uploads. cleanup يزيل الملف عند rollback، لذلك لم يثبت فساد دائم.
- **المطلوب:** pipeline مرحلي: quarantine write/scan خارج transaction، ثم transaction قصيرة لربط metadata بحالة جاهزة، مع outbox/cleanup durable وحالات retry.
- **ارتباط:** يتحد هذا علاجيًا مع SEC-01؛ لا يسجل كمانع منفصل في سجل المخاطر النهائي.

### DB-03 — حالة schema/RLS والبيانات الفعلية لمرشح الإصدار غير متحققة

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** تحتاج تحققًا تشغيليًا
- **الدليل:** قيود المهمة تمنع migrations والكتابة إلى قاعدة البيانات، لذلك لم تنفذ `prisma migrate status` على بيئة الإصدار، ولا حراس RLS/finance/period race/HTTP التي تنشئ fixtures. `test-results/.last-run.json` يسجل `passed` لكنه بلا SHA أو تقرير تفصيلي، وشجرة العمل الحالية غير ملتزم بها.
- **الأثر:** لا دليل أن 116 migration مطبقة بالترتيب نفسه، أو أن triggers/RLS/indexes الموجودة في الملفات موجودة فعلاً في قاعدة مرشح الإصدار.
- **المطلوب:** قاعدة staging جديدة من الصفر + restore clone من backup فعلي؛ تشغيل migrate deploy كدور bootstrap، ثم كل فحوص RLS/finance/HR/operations كدور التطبيق المقيد، ومقارنة checksums.

### DB-04 — runbooks موجودة لكن لا يوجد إثبات restore/rollback حديث للمخطط الحالي

- **الحالة:** أحمر
- **الخطورة:** عالٍ
- **الثقة:** مؤكدة من المستودع
- **الدليل:** `docs/operations/RELEASE_AND_RECOVERY_RUNBOOK.md` و`PRIVATE_ONLINE_DEPLOYMENT_REHEARSAL.md` يحددان السياسة والخطوات. شهادة `.rehearsal/gate-c/receipt-20260815-022842.json` تثبت restore اصطناعيًا محليًا ناجحًا لـ12 جدولًا بتاريخ 2026-08-15، لكنها مهملة من Git وتسبق توسع المخطط إلى 149 model/116 migration. compose يشترط label للنسخة فقط ولا ينفذ backup job.
- **الأثر:** migration فاشلة أو إصدار يحتاج تراجعًا لا يملك مسار عودة مثبتًا؛ مع migrations تحويلية وtriggers كثيرة، rollback بالتخمين خطر على البيانات.
- **المطلوب:** backup قبل migration، تحقق checksum/retention، restore drill مقاس، strategy roll-forward/compatibility، وتوثيق نقطة اللاعودة لكل migration.

## تحقق منطق ERP حسب النطاق

### دفتر اليومية والفترات

- `journal-line-normalization.ts:25-45` يرفض أقل من سطرين، السطر ثنائي الجانب، عدم التوازن، والمجموع غير الموجب.
- migrations `20260815210000_finance_journal_kernel` و`20260815212000_finance_journal_sealing` تضيف checks وconstraint triggers مؤجلة للتوازن وتمنع تعديل/حذف السطور المقفلة؛ التصحيح عكس جديد.
- `JournalPostingService` يقفل `(company,sourceType,sourceReference)`، ويتحقق من حسابات الشركة، ويقدم ledger revision داخل المعاملة.
- `20260815211000_finance_integrity_hardening` يضيف exclusion constraint بنطاق تاريخ على فترات الشركة؛ لذلك يمنع DB السباق الذي لا يغطيه فحص الخدمة وحده.
- النتيجة: **لا خلل توازن/تكرار مؤكد من الكود**؛ يلزم تحقق DB-03.

### أرقام المستندات ومنع التكرار

- `DocumentSerialCounter` مفتاحه `(tenantId, companyId, series, businessDate)`؛ `document-serial.service.ts:51-64` يستخدم atomic `INSERT ... ON CONFLICT ... lastValue + 1 RETURNING` داخل transaction.
- دفتر اليومية يفرض `@@unique([companyId, sourceType, sourceReference])`، والـidempotency يفرض `(tenant,company,actor,operation,key)`.
- migration `20260816208000_purchase_expense_financial_documents:63` يفرض partial unique index لفاتورة المورد المنشورة `(company,supplier,normalized invoice number)`.
- Daily sales يفرض سجلًا واحدًا لكل `(company,businessDate,scope)`، والمدفوعات/التسويات/التشغيل تملك أرقامًا فريدة ضمن الشركة.
- النتيجة: **منع التكرار جيد ومتعدد الطبقات**.

### المالية والفواتير والخزائن

- الحسابات والفئات والخزائن مرتبطة بالمستأجر والشركة؛ الحسابات غير النشطة ممنوعة من posting بينما يسمح عكس تاريخي للحساب المؤرشف.
- الفواتير والمصروفات تسجل gross/net/VAT بدقة 4 منازل، دفترًا متوازنًا، revision وعكسًا بدل الحذف؛ supplier invoice normalization يحمي duplication.
- التسويات والخزائن والقروض الشاملة تربط كل حركة مالية بـjournal entry فريد وتتحقق من الرصيد المتبقي تحت advisory lock.
- تقارير ledger/cash تستخدم ledger revision وsnapshots/reversal events؛ التغيير الحالي حول انتهاء ReportRun يحتاج نجاح الاختبارات قبل اعتماده.

### المخزون والمشتريات

- recipe/conversion versions المنشورة immutable وبفهرس جزئي يمنع أكثر من نسخة منشورة.
- الاستلام يحسب base quantity وWAC، ويخزن حركة append-only؛ العكس يرفض إن استهلكت حركة لاحقة الكمية/القيمة.
- التسجيل الداخلي يجمع الاحتياج لكل مادة، يقفل المفاتيح بترتيب ثابت، ثم يتحقق من الكمية قبل الخصم؛ يمنع deadlock/negative stock على مسار التطبيق.
- DB-01 هو فجوة defense-in-depth، لا دليل حاليًا على رصيد خاطئ.

### HR والرواتب

- run واحد نشط لكل شركة/شهر عبر partial unique index، مع snapshots لسياسة التعويض والأهلية.
- advances/deductions/payroll/final settlements تستخدم advisory locks مشتركة قبل الاستهلاك والتسوية، وأرقامًا ذرية، وjournal links فريدة، وعكسًا/إلغاءً بدلاً من محو التاريخ.
- الفحوص التاريخية للـfinancial concurrency موجودة لكن لم تنفذ على اللقطة الحالية وفق DB-03.

## الأداء والاستعلامات

- توجد keyset indexes للتقارير الكبيرة ودفتر الحساب وHR؛ معظم القوائم تستخدم `take/pageSize`.
- `ReportRun` يفهرس `(tenant,company,reportCode,createdAt)`, `(status,expiresAt)`, وledger revision.
- لا توجد خطط `EXPLAIN (ANALYZE, BUFFERS)` أو p95 على حجم قريب من الإنتاج؛ لا يمكن إثبات كفاية الفهارس من الشكل وحده، ويرحل ذلك للمرحلة 8.

## قرار المرحلة

**مكتملة مع ملاحظات.** لم يثبت خطأ أرصدة أو قيد غير متوازن في الكود؛ DB-03 وDB-04 يمنعان الاعتماد الإنتاجي، وDB-01/DB-02 يحتاجان تقوية قبل توسيع الحمل والقدرات الملفية.

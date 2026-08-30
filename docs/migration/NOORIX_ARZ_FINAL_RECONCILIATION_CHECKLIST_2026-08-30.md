# ARZ — final Noorix-to-Baseer reconciliation checklist

## Release-gate result

The verified Excel migration package is eligible to unlock: package fingerprint verified, **100 executions completed and one explicitly authorised cancellation**, plus **145 committed waves and two explicitly authorised cancellations**. No execution or wave is running or failed. This eligibility applies to the reviewed **financial and HR package**. It does not claim that unexported operating domains have been migrated.

## فريق ألفا — مراجعة الإغلاق الشاملة (بعد موجة كتالوج العمليات)

**قرار الفريق:** الترحيل **مغلق من ناحية البيانات**: الحزم المالية والموارد البشرية والكتالوج مكتملة ومطابقة. اعتمد المالك في 2026-08-30 بداية مخزون صفرية، لذلك أغلقت موجة الرصيد الافتتاحي دون إنشاء رصيد أو قيد. لا توجد موجة `RUNNING` أو `FAILED` أو `PENDING`. التنفيذ الملغى الوحيد هو معالجة مرخصة لملف دوري صفري، واستبدلت بإصلاح معتمد ولا تمثل عائقاً.

| النطاق | الحالة | الدليل الحالي |
|---|---|---|
| المبيعات والتقفيلات | مكتوب ومطابق | 217 عملية نشطة بقيمة 2,064,177.0000؛ 216 منشورة + عكس معتمد واحد. الملغي محفوظ دليلاً فقط. |
| المشتريات والمصروفات | مكتوب ومطابق | 663 شراء بقيمة 227,501.1000 و71 مصروفاً بقيمة 83,569.0500. |
| المصروفات الدورية | مكتوب ومطابق | 32 دفعة بقيمة 237,273.3800؛ الملف الصفري مستبعد بدليل معتمد. |
| الموارد البشرية والرواتب | مكتوب ومطابق أو دليل تاريخي معتمد | 24 موظفاً، 5 مسيرات تاريخية/73 سطراً، وفاتورتا SAL المرحلتان كمسيرين مدفوعين مستقلين (2,500 و750). |
| السلفيات والخدمات | مكتوب ومطابق | 34 سلفة، 25 تسوية، رصيد مفتوح صحيح 7,600، و6 خدمات موظفين بقيمة 7,413.0000. |
| البنك وVAT والأصول | دليل تاريخي مع معالجة معتمدة | لم تُنشأ قيود أو أرصدة تشغيلية مصطنعة؛ تحفظ الأدلة وروابط الفواتير. |
| كتالوج العمليات | مكتوب ومطابق | 4 أقسام، 27 وحدة، 37 تصنيفاً، 686 صنفاً، 691 وحدة صنف، 4 تحويلات/6 حواف، ووصفة واحدة. |
| الطلبات والتسجيلات والعهدة التاريخية | دليل تاريخي مع معالجة معتمدة | مستثناة عمداً؛ لا تنشأ طلبات أو حركات حالية مزيفة. |
| رصيد المخزون الافتتاحي | قرار مالك معتمد | 171 رصيداً غير صفري في نوركس مستبعدة عمداً؛ تبدأ ARZ من الصفر، بلا رصيد أو قيد افتتاحي. |

### حالة الإغلاق

اكتملت بيانات الترحيل وفق قرار المالك. يبقى قفل الشركة التشغيلي قرار إطلاق منفصل؛ لا تفتحه هذه المراجعة تلقائياً. العمليات التاريخية المستثناة لها معالجة معتمدة وليست عملاً مفقوداً.

### فحص المصاريف والالتزامات — فريق ألفا

فحص مستقل بعد الإغلاق أكد أن القسم مكتمل: 71 مصروفاً قياسياً بإجمالي **83,569.0500**، و32 دفعة دورية بإجمالي **237,273.3800**، و6 خدمات موظفين بإجمالي **7,413.0000**؛ المجموع **109** مستندات `EXPENSE/POSTED` بإجمالي **328,255.4300** وتخصيصات دفع مطابقة. لا توجد ذمم موردين أو التزامات مفتوحة (`0` في المصدر والهدف). الإلغاءات محفوظة كدليل تاريخي ولا تتحول إلى مصروفات حالية.

### دليل التحقق التقني النهائي — 2026-08-30

| التحقق | النتيجة |
|---|---|
| `npm run build --workspace @baseer-erp/contracts` | ناجح |
| `npm run build --workspace @baseer-erp/api` | ناجح |
| `node scripts/verify-local-database.mjs` | ناجح |
| `node scripts/run-finance-gate-b-db-verification.mjs` | ناجح؛ يعمل على مستأجر اختبار معزول |
| `node scripts/run-operations-purchase-cycle-verification.mjs` | ناجح؛ يعمل على شركة اختبار معزولة |
| `npm run verify:hr-lifecycle` | ناجح؛ تتحقق حالة إنهاء الموظف مع سبب مطلوب، وتبقى سجلات التدقيق غير القابلة للحذف في المستأجر المعزول كدليل اختبار |
| ثبات ARZ بعد الاختبارات | 686 صنف كتالوج، 0 رصيد مخزون، 1,065 قيد يومية، 773 مستند صرف و999 حدث أداء نقدي؛ لم تتغير أثناء اختبارات العزل |

## Package closure checklist

| Check | Noorix source | Baseer result | State |
| --- | ---: | ---: | --- |
| Suppliers in verified package | 108 | 108 mapped | ✅ |
| Accounts / categories / vaults | 27 / 42 / 5 | 27 / 42 / 5 | ✅ |
| Employees | 24 | 24 | ✅ |
| Purchase and expense invoices | 647 | 647 | ✅ |
| Invoice allocations / source ledgers | 647 / 647 | 647 maps / 647 maps | ✅ |
| Recurring profiles | 14 | 13 mapped + 1 zero-amount excluded evidence | ✅ |
| Recurring payments | 32 / 237,273.3800 | 32 / 237,273.3800 | ✅ |
| Employee services and service costs | 6 / 7,413.0000 | 6 / 7,413.0000 | ✅ |
| Historical payroll evidence | 5 runs / 73 lines | 5 runs / 73 lines | ✅ evidence-only |
| Employee advances / settlements | 34 / 25 | 34 / 25 | ✅ |
| Daily sales closings / allocations | 228 / 436 | 228 / 436 | ✅ |
| Daily-sales value | 2,064,414.0000 raw | 2,064,177.0000 posted after approved 237.0000 reversal | ✅ |
| Bank, VAT, and asset package sheets | 3 / 754 / 4 | retained immutable evidence | ✅ evidence-only |
| Category review | 38 (34 high, 4 medium, 0 low) | 38 owner-approved receipts | ✅ |

## Corrections made during the final review

- Corrected Sifi and Abduljalil vault metadata to `BANK / BANK_CARD`, preserving all 27 existing allocations and all journals.
- Added six unreferenced Noorix suppliers as non-financial active supplier masters; source coverage is now 116/116. No document, journal, or payable was created for them.
- Issued and linked four missing source-backed HR-service invoices. The two previously corrected residency invoices remain posted. All six service costs use the original operation date and bank V-002; no invented service start/end date was added.
- Approved the 38 verified category mappings and retained their checksums.
- Excluded the zero-value tobacco-license recurring profile as explicit evidence: zero invoices, zero amount, and no target profile, document, or journal.

## تحديث نطاق العمليات

الجدول القديم للنطاقات التشغيلية استبدلته موجة الكتالوج الموثقة أعلاه: الأصناف والوحدات والأقسام والتصنيفات والتحويلات والوصفة نُقلت وطابقت المصدر. الطلبات والاستلامات والتسجيلات والعهدة والأصول التاريخية لا تُنشأ كحركات تشغيلية جديدة؛ حفظها كدليل تاريخي هو المعالجة المعتمدة. رصيد المخزون الافتتاحي مستبعد بقرار مالك معتمد، وتبدأ ARZ من الصفر.

## Guardrails

No running or failed package execution may be accepted. Never manufacture an inventory opening balance, operational order, or asset cost: a zero-opening decision or any future write must have an explicit owner decision, idempotency keys, reconciliation counts, and a release gate.

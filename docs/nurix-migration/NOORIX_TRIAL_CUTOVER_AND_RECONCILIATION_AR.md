# بروفة ترحيل نوركس والقطع ومعايير Go / No-Go

## مبدأ التشغيل

بصير لا يكتب في نوركس. كل بروفة تعمل على snapshot معرّف checksum وفي بيئة staging معزولة. الاستيراد ليس endpoint عادي ولا يعيد تشغيل أوامر posting؛ الشركة الهدف جديدة وغير مفعلة حتى اكتمال التقرير. القرار النهائي يوافق ميثاق بصير: freeze قصير، snapshot أخيرة، import نهائي، reconciliation، موافقة المالك، ثم نوركس read-only مؤرشف.

## مراحل بروفة الترحيل

| المرحلة | الإجراء | الدليل المطلوب | شرط الخروج |
| --- | --- | --- | --- |
| 0. الاكتشاف | استلام intake وDDL/codes/sample data؛ تصنيف ownership وPII. | delivery manifest checksums؛ inventory/mapping template مكتمل جزئياً. | لا unknown company scope أو secret intake. |
| 1. profile | قياس counts/dates/duplicates/orphans/amount ranges لكل شركة. | quality report + exception ledger. | كل نقص معلن ويملك قراراً. |
| 2. mapping freeze | اعتماد maps للـcompany/accounts/categories/status/timezone/tax؛ إصدار rule version. | mapping ledger وقرار الأعمال. | لا `REVIEW_REQUIRED` ضمن نطاق التجربة. |
| 3. dry-run | parse/validate فقط، بلا كتابة business data. | number of accepted/rejected by entity/reason; hash report. | 100% صفوف النطاق مقبولة أو استثناء معتمد. |
| 4. staged import | شركة target جديدة معطلة؛ mapping IDs؛ import حسب graph؛ لا jobs/schedules. | import stage/counters/correlation IDs. | zero unresolved FK/unknown enum/tenant violation. |
| 5. rebuild | إعادة projections/balances/counters/events المسموح بها؛ لا import projections. | rebuild version/log/counts. | output deterministic من snapshot نفسه. |
| 6. reconciliation | تنفيذ checklist أدناه لكل شركة وشهر/فترة. | signed reconciliation report وفرق كل مبلغ. | كل critical delta = 0 أو waiver مكتوب. |
| 7. UAT | مالك الأعمال يتصفح المستندات/العكوس/التقارير في target المعطلة. | scenarios passed وArabic/English evidence عند اللزوم. | approval أو defects مصنفة. |
| 8. rehearsal repeat | حذف target staging فقط وإعادة run من نفس snapshot. | hashes/counts/results متماثلة أو تفسير versioned. | repeatable وidempotent. |

## خطة القطع النهائي

1. **T-14 إلى T-3 أيام:** بروفة ناجحة، owners والتفويضات وقناة الدعم وخطة rollback معتمدة؛ capacity وbackup للـBaseer جاهزة.
2. **T-2 أيام:** تجميد mapping/adaptor versions؛ قائمة deltas معتمدة؛ إعلان نافذة العمل وتعليمات عدم dual-write.
3. **T-0 freeze:** أوقف الكتابة في نوركس فقط بعد تأكيد المالك؛ التقط آخر snapshot + manifest + attachment manifest؛ سجّل بداية/نهاية freeze وchecksums.
4. **T+0 import:** شغّل dry-run على snapshot النهائي ثم staging import داخل شركة جديدة معطلة. عند أي P0 أوقف فوراً ولا تحاول “إصلاحاً يدوياً” في target.
5. **T+ reconciliation:** طبق checklist؛ أعد بناء projections؛ افتح UAT مع فريق صغير read-only.
6. **قرار المالك:** لا تفعّل Company target ولا تجعل Baseer الكاتب الوحيد قبل توقيع Go.
7. **بعد Go:** فعّل target، امنح العضويات الجديدة، اضبط schedules صراحة بعد مراجعة، واجعل نوركس read-only مؤرشفاً. لا يحذف نوركس أو snapshot.
8. **بعد No-Go:** أبق Baseer target معطلة/معزولة، ارجع للكتابة في نوركس وفق نافذة العمل، احتفظ بالـlogs/snapshot/exceptions للتحليل، ثم عالج السبب في بروفة جديدة.

## Checklist المطابقة

### الهوية والعزل

- [ ] كل `legacy_company_id` يطابق شركة target واحدة؛ لا مصدر متعدد الشركات في target نفسه.
- [ ] كل FK target داخل `tenantId+companyId` الصحيح؛ zero cross-company rows.
- [ ] عدد الصفوف المستوردة والمستبعدة والمتوقفة موثق لكل entity؛ لا صف “مفقود بصمت”.
- [ ] legacy IDs في mapping ledger فقط؛ لا استخدام IDs المصدر كـBaseer business IDs.

### المالية — لكل شركة ولكل فترة/شهر

- [ ] count/status للنشاط: documents، supplier dues/payments، daily closings، VAT/loans بحسب النطاق.
- [ ] `Σ debit == Σ credit` لكل قيد، ولكل الفترة، ولكل الحساب؛ reversal chain مكتمل ولا قيد يتيم.
- [ ] trial balance وas-of balance وحركة الفترة تطابق نوركس ضمن قاعدة التقريب المعتمدة؛ أي rounding difference مفصل.
- [ ] gross/net/VAT، ageing الموردين، paid/remaining، allocations والخزائن تطابق المصدر.
- [ ] document/receipt/payment serials وحالات الإلغاء محفوظة ولا تعاد أرقام الأدلة.
- [ ] حسابات الفترات المغلقة/المقفلة لا تصبح قابلة للتعديل بسبب الترحيل.

### ملفات وPII

- [ ] لا مرفق بلا source entity/type/hash؛ count/bytes/SHA-256 متطابقة.
- [ ] فحص MIME/size/malware/quarantine وre-key/copy evidence مكتمل قبل عرض الملف.
- [ ] لا passwords/tokens/storage keys/source paths أو بيانات جلسات في target أو logs.

### التشغيل والقبول

- [ ] target تبقى inactive حتى توقيع التقرير؛ لا recurring/schedule/automation تعمل تلقائياً.
- [ ] logs/correlation IDs ونسخ artifacts قابلة للمراجعة؛ لا تتضمن بيانات حساسة زائدة.
- [ ] فشل جزئي لا يفعّل target ولا يغير نوركس؛ run قابل للإعادة من snapshot نفسه.
- [ ] UAT يغطي فتح مستند، قيد، عكس، مورد/دفع، تقرير فترة، وصلاحية مستخدم جديد.

## Go / No-Go

### Go فقط إذا

1. كل checksums وcounts المطلوبة صحيحة، ولا P0/P1 مفتوح في نطاق القطع.
2. reconciliation المالية صفرية أو waiver محدد بقيمة/سبب/مالك/تاريخ انتهاء.
3. لا cross-company/tenant data، ولا unresolved mapping أو FK أو enum.
4. مسار rollback ونوركس read-only archive ونسخة Baseer مثبتة وقابلة للاستعادة.
5. اعتماد صريح من المالك المالي ومالك النظام ومسؤول الخصوصية عند وجود PII/ملفات.

### No-Go تلقائي إذا

- snapshot غير قابل للتحقق أو يوجد تغير في نوركس بعد freeze بلا delta موثق.
- عدم اتزان قيد، فرق أرصدة/ضريبة مادي، عكس مفقود، أو رقم دليل مكرر/مفقود.
- source company/tenant غير محسوم، أو row يتيم، أو mapping `REVIEW_REQUIRED` في نطاق القطع.
- ظهور secret/credential في intake/log أو failure في PII/attachment validation.
- importer استخدم أمر posting عادي أو فعّل company/schedule قبل reconciliation.

## مصادر بصير التي استندت إليها الحزمة

- `docs/BASEER_ERP_MASTER_BUILD_CHARTER.md`، قسم 15–16.
- `apps/api/prisma/schema.prisma` لعلاقات Company والكيانات المالية/HR/Operations.
- `apps/api/src/finance/journal/journal-posting.service.ts`, `purchase-expense.service.ts`, `supplier-dues.service.ts`.
- `docs/backup-recovery/ARCHIVE_COMPLETE_COMPANY_DATA_INVENTORY_2026-08-27.md` لحدود restore-as-new وإعادة بناء projections.

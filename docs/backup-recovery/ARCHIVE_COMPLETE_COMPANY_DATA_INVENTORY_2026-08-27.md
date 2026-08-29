# ARCHIVE_COMPLETE — جرد بيانات الشركة وخطة الدفعات

**الحالة:** جرد read-only للتخطيط، وليس إقراراً بأن أي مجموعة أدناه قابلة للتصدير أو الاستعادة الآن.  
**تاريخ المراجعة:** 2026-08-27  
**القاعدة الحاكمة:** الأرشيف الحالي `PARTIAL_CONFIGURATION_ONLY` فقط. لا يصبح `ARCHIVE_COMPLETE` إلا بعد إغلاق تبعيات كل مجموعة، واستيرادها إلى شركة جديدة معطّلة، والتحقق من علاقاتها ومجاميعها ومرفقاتها.

## منهج الجرد وحدود الملكية

- مصدر الحقيقة البنيوي: `apps/api/prisma/schema.prisma`، ولا سيما علاقة `Company` الجامعة في الأسطر 882–1015 تقريباً. كل جدول في هذا المستند يجب أن يقرأ بـ`tenantId` **و**`companyId` من نطاق موثوق. RLS في `DatabaseService.inTenantTransaction` يعزل المستأجر، وليس الشركة؛ لذلك لا يكفي `tenantId` وحده.
- مصدر سلوك الكتابة والعلاقات المالية: `apps/api/src/finance/**/*.service.ts`، وبالذات `journal/journal-posting.service.ts`, `purchase-expense.service.ts`, `supplier-dues.service.ts`, `daily-sales-*.service.ts`, `treasury.service.ts`, و`finance-vat-settlement.service.ts`.
- لا يوجد “تفريغ كل الجداول”. كل مصدر يحتاج `select` صريحاً، ترتيباً ثابتاً، وvalidator للمفاتيح الأجنبية؛ يظل سجل `CompanyArchiveExporter` في `apps/api/src/backup/company-archive-exporter.ts` هو النمط المطلوب.
- الاستعادة تنشئ IDs مستهدفة جديدة؛ لا تنسخ Users أو Roles أو Sessions أو مفاتيح/رموز OAuth أو مفاتيح تشفير أو مسارات تخزين. لا تستدعي أوامر posting العادية أثناء الاستعادة لأنها تنشئ قيوداً يومية/مراجعات/سجلات تدقيق جديدة.

## مصفوفة كامل نطاق البيانات

| النطاق والجداول ذات الشركة | علاقات الإغلاق وترتيب export → import | الحساسية/الاشتقاق | قرار ARCHIVE_COMPLETE |
| --- | --- | --- | --- |
| **جذر الشركة والإعداد المحلي** — `Company`, `CompanyBranding`, `CompanyFinanceProfile`, `DocumentSerialCounter` | أنشئ Company مستهدفة معطّلة أولاً؛ ثم profile/branding. branding تشير عملياً إلى `FileMetadata` عبر `logoFileMetadataId` ولكن علاقة Prisma غير مغلقة. counters تعاد بناؤها من الوثائق أو تستورد بعد آخر رقم. | branding ملف؛ counters state مشتق قابل لإعادة البناء. | Company/profile موجودان في slice الحالي. branding لا تدخل قبل خطة ملفات، وcounters ليست مصدراً مالياً. |
| **الأمن والإدارة المحلية** — `CompanyMembership`, `AuditEvent`, `IdempotencyReceipt` | مراجع إلى `User` و`Role` المستأجرين. | أمان وسجل تشغيل، وليس business truth للشركة الجديدة. | **مستبعدة**؛ تنشئ الاستعادة audit جديداً، وتُمنح العضويات يدوياً. |
| **نسخ Baseer نفسها** — `BackupPolicy`, `BackupJob`, `BackupArtifact`, `BackupAuditEvent` | تابعة لعملية الأرشفة المصدرية، لا للشركة المستهدفة. | مفاتيح تخزين، hashes، checkpoints، audit. | **مستبعدة دائماً**؛ لا تعيد استيراد archive داخل archive. |
| **تهيئة المالية** — `FinanceAccount`, `FinanceFiscalPeriod`, `FinanceVault`, `FinanceCategory`, `FinanceSupplier`, `FinanceRecurringExpenseProfile` | Company → accounts/periods → vaults؛ categories/suppliers cycle بحل ثنائي؛ recurring بعد category/supplier/vault. | configuration؛ recurring schedule يجب أن يبقى inert. | موجودة حالياً، لكنها لا تكفي للاستعادة. `SupplierCopyProvenance` لا يدخل لأنه يشير إلى شركات/Users مصدرية. |
| **خرائط التقارير المالية** — `FinancePnlMappingVersion`, `FinancePnlStatementLine`, `FinancePnlAccountMapping` | accounts → mapping version/lines → mappings؛ mapping يربط account وstatement line/version. | إعداد/إصدارات، لا قيد يومي. | دفعة إعداد مستقلة قبل تقارير P&L، وليست جزء 5B الأصغر. المصدر: `finance-pnl-mapping.service.ts`. |
| **دفتر الأستاذ (المصدر المحاسبي)** — `FinanceJournalEntry`, `FinanceJournalLine`, `FinanceLedgerRevision` | fiscal period + accounts → entries (الأصل قبل reversal) → lines. `reversalOfEntryId` self-FK؛ يصدّر بـ`ledgerRevision,id` ويستورد الأصل قبل عكسه. | immutable financial truth؛ actor/source fields تحتاج provenance. daily/monthly balances مشتقة من lines؛ ledger revision يعاد ضبطه إلى max بعد الاستيراد. | عنصر حتمي لكل استعادة مالية؛ لا يستورد عبر `JournalPostingService`. المصدر: `journal/journal-posting.service.ts`. |
| **مشتريات/مصروفات** — `FinanceOutflowBatch`, `FinanceOutflowDocument`, `FinanceOutflowAllocation`, `FinanceOutflowDocumentRevision`, `FinanceRecurringExpenseCoverage` | prerequisites المالية + journals. batch → document؛ document → allocation (vault), revision (وثيقة + journalين), coverage (profile + document). | وثائق مالية؛ revision JSON تاريخ تصحيح؛ بعض الوثائق مرتبطة بـHR/marketing/assets في دفعات لاحقة. | مرشح 5B، لكن closure يضم الاعتمادات المذكورة فقط ولا يدّعي HR/marketing/assets. المصدر: `purchase-expense.service.ts`. |
| **التزامات ومدفوعات الموردين** — `FinanceSupplierDue`, `FinanceSupplierDuePayment` | supplier/category + journal → due؛ due + vault + journal → payment؛ original payment قبل reversal. document number علاقة منطقية لا FK. | financial truth ومبالغ حالة قابلة للمصالحة؛ snapshots للفئة. | مرشح 5B مع outflows والjournals، وليس منفرداً. المصدر: `supplier-dues.service.ts`. |
| **الخزينة وضريبة القيمة المضافة** — `FinanceVaultReconciliation`, `FinanceVatSettlement` | reconciliation → vault فقط. VAT → vault + journal + self reversal. | reconciliation control observation؛ VAT financial/event truth. | vault reconciliation يمكن دفعة control بعد 5B. VAT يحتاج closure journals/cash-performance ويؤجل للدفعة التالية. المصدر: `treasury.service.ts`, `finance-vat-settlement.service.ts`. |
| **المبيعات اليومية والتقويم** — `FinanceOperationalDay`, `FinanceDailySalesClosing`, `FinanceDailySalesAllocation`; `FinanceDailyFinancialSummary`, `FinanceDailySalesChannelSummary` | day → closing (journal/category/supplier/vaults) → allocations. summaries/channel summaries projections من closings. | closing مالي؛ summary مشتق قابل لإعادة البناء. | دفعة revenue مستقلة بعد 5B. لا تصدّر summaries كمصدر. المصدر: `daily-sales-write.service.ts`, `daily-sales-projection.service.ts`. |
| **القروض** — `FinanceInclusiveLoan`, `FinanceInclusiveLoanInstallmentPlan`, `FinanceInclusiveLoanPayment` | loan + opening journal → instalments؛ payment يحتاج loan+vault+journal، مع reversal chain. | financial truth وجدولة. | دفعة مستقلة بعد journal adapter؛ المصدر: `inclusive-loan.service.ts`, `inclusive-loan-repayment.service.ts`. |
| **أحداث الأداء النقدي والتقارير** — `FinanceCashPerformanceEvent`, `FinanceCashPerformanceCoverage`, `FinanceCashPerformanceHistoricalImport`, `FinanceAccountDailyBalance`, `FinanceAccountMonthlyBalance`, `ReportRun`, `ReportDocument`, `VatSimulation`, `OwnerDailyBriefSnapshot` | events/projections تتبع journals وdocuments؛ ReportRun/Document/evidence يشير إلى snapshot/actors. owner brief tenant-wide. | أغلبها projections أو ephemeral snapshots؛ report documents قد تحمل payloads. | **إعادة بناء أو استبعاد**. لا تدخل cash events/balances/summaries كـtruth. لا يستورد owner brief. المصادر: `finance-cash-performance-event.service.ts`, `reports/*.service.ts`. |
| **HR** — `HrEmployee`, `HrEmployeePromotion`, `HrEmployeeLeave`, `HrEmployeeService`, `HrEmployeeFinancialMovement`, `HrEmployeeAdvance*`, `HrEmployeeAdministrativeDeduction*`, `HrEmployeeCompensationProfile`, `HrCompensationPolicy*`, `HrPayroll*`, `HrFinalSettlement*` | policy → versions; employee → comp/promotions/leaves/docs/services; advances/deductions/payroll/final settlement تتصل بموظف وبـjournals/vaults/outflow docs. | PII شديد، salary، national ID/passport، immutable payroll journals. | لا يدخل 5B. يتطلب wave HR مستقلة وprovenance للموظف/actors وإغلاق كل journals والمدفوعات. المصادر: `apps/api/src/hr/*.service.ts`. |
| **ملفات HR وملفات عامة** — `HrEmployeeDocumentBlob`, `HrEmployeeDocument`, `HrEmployeeDocumentVersion`, `HrEmployeeLetter`, `FileMetadata` | metadata/blob → document → version؛ branding وكيانات أخرى قد تشير إلى metadata. | PII شديد، encrypted blob/scan/revocation/storage keys. | **P0 قبل إدخال المرفقات**: manifest للملفات، copy/re-key، anti-malware/quarantine وhash count؛ لا نسخ لمسار أو مفتاح. المصدر: `apps/api/prisma/schema.prisma`, `apps/api/src/hr/hr-employee-document.service.ts`. |
| **العمليات والمخزون** — `OperationsSection`, `OperationsUnit`, `OperationsItem`, `OperationsItemUnit`, `OperationsItemConversionVersion/Edge`, `OperationsRecipeVersion/Line`, `OperationsPurchaseRequest/Line`, `OperationsPurchaseReceipt/Line`, `OperationsCustodyProfile/Event`, `OperationsInternalRegistration/Line/Consumption`, `OperationsInventoryMovement/Balance`, `OperationsAssetWarrantyAsset/Line` | catalog/units → item-unit/conversions → recipes; requests → lines → receipts → receipt lines → inventory movements; registrations → lines → consumption → movements. warranty links `FinanceOutflowDocument`. | balances مشتقة من immutable movements؛ snapshots للأسعار/التكلفة؛ warranty links finance document. | wave operations منفصلة. لا تصدّر InventoryBalance كمصدر؛ أعد بناءه من movements. المصادر: `apps/api/src/operations/*.service.ts`. |
| **قرارات وذكاء إداري** — `DecisionMetricDefinition`, `DecisionSalesChangePolicy`, `DecisionRuleDefinition`, `DecisionCompanyContextEvent`, `DecisionEvaluationRun`, `DecisionEvidenceSnapshot`, `DecisionAlert`, `DecisionAlertAction`, `DecisionFeedback` | local context → evidence/evaluation → alert → actions/feedback; evidence قد تشير إلى `ReportRun` أو self supersession. Global context tables tenant-wide لا تنسخ للشركة. | evidence JSON، source reports، human provenance. | اختيارية بعد financial/report restore؛ events الشركة فقط ممكنة بعد actor provenance. المصادر: `decision-intelligence/*.service.ts`. |
| **التسويق** — `MarketingCampaign`, `MarketingCampaignAnalysisFeedback`, `MarketingCampaignFinancialLink`, `MarketingCampaignContextLink`, `MarketingSalesTarget`, `MarketingProviderConnection`, `MarketingReputationReplyPolicy`, `MarketingProviderOAuthState` | campaign → links؛ financial link → outflow doc؛ context link → company/global decision events. | OAuth verifier encrypted/short-lived؛ provider readiness ليس business history. | campaigns/targets/links دفعة اختيارية بعد finance+decision. **استبعد OAuth state** ولا تنسخ credentials. المصدر: `marketing/marketing.service.ts`, `marketing-google-oauth.service.ts`. |
| **AI** — `AiCompanyIdentity`, `AiCompanyContext`, `AiSkillActivation`, `AiExecutionReceipt`, `AiInterpretation*`, `AiHumanInsight`, `AiEvaluationFeedback`, `AiSkillEvaluationRun`, `AiBudgetReservation`, `AiUsageLedger` | identity/context/activation قبل retained interpretations؛ interpretations ترتبط evidence/placement؛ provider configuration وmodel price tenant-wide. | prompts/usage/cost/budget ومراجع evidence. | لا تدخل ARCHIVE_COMPLETE المالي الأول. استعد فقط configuration آمن لاحقاً؛ لا تنسخ provider secrets أو rate/budget leases. المصدر: `ai-platform/*.service.ts`. |
| **Inbound evidence** — `InboundEvidence*` | غالبها tenant-scoped ولا تحمل `companyId`؛ labels/rules/messages/attachments قد تكون مشتركة. | Gmail/OAuth/attachments/AI extraction حساس. | **مستبعدة من company archive** إلى أن توجد ownership graph صريحة للشركة. المصدر: `inbound-evidence/*.service.ts`. |

## الدفعة 5B المقترحة: العمليات المالية الأصغر المتماسكة

### النطاق

لا تبدأ بـكل `FinanceJournalEntry`: ذلك generic dump مقنّع وسيُدخل تحويلات خزينة ومبيعات وHR وVAT وقروضاً لا تملك 5B closure لها. بدلاً منه يُبنى set من وثائق المشتريات/المصروفات والتزامات الموردين، ثم يسير إلى قيودها حصراً:

1. **Prerequisites موجودة ومجمدة:** Company target inactive، `CompanyFinanceProfile`, accounts, fiscal periods, vaults, categories/suppliers (two-pass)، recurring profiles inert.
2. `FinanceOutflowBatch`.
3. `FinanceOutflowDocument`، مع closure للـjournals التي تشير إليها الوثائق أو revisions أو dues/payments.
4. `FinanceJournalEntry` ثم `FinanceJournalLine`، بترتيب `(ledgerRevision, id)`، وإدخال الأصل قبل reversal. لا تدخل قيود source domains الأخرى.
5. `FinanceOutflowAllocation`, `FinanceOutflowDocumentRevision`, `FinanceRecurringExpenseCoverage`.
6. `FinanceSupplierDue` ثم `FinanceSupplierDuePayment`، مع إغلاق reversal chain.
7. **لا تصدّر:** `FinanceLedgerRevision`, `FinanceAccountDailyBalance`, `FinanceAccountMonthlyBalance`, `FinanceCashPerformanceEvent`. بعد الاستيراد المبدئي: أعد بناء projections، ثم اجعل revision الحالي مساوياً لأعلى journal revision بعد reconciliation.

### مصفوفة التنفيذ

| المصدر | FK/closure يجب التحقق منه في المصدر | ترتيب ثابت مقترح | استيراد restore-as-new | اختبار رفض إلزامي |
| --- | --- | --- | --- | --- |
| `FinanceOutflowBatch` | company فقط | `businessDate, batchNumber, id` | بعد config، remap IDs؛ لا تشغّل serial generator. | batch خارج scope/duplicate number. |
| `FinanceJournalEntry` | fiscal period، self reversal، source closure selected فقط | `ledgerRevision, businessDate, postedAt, id` | staging adapter يكتب IDs جديدة؛ original قبل reversal؛ actor يستبدل بـrestore actor مع immutable source provenance. | period/account/source journal غير موجود، duplicate source reference، reversal بلا original، ledger non-monotonic. |
| `FinanceJournalLine` | journal entry + account؛ debit=credit per entry | `journalEntry.ledgerRevision, lineNumber, id` | بعد entries؛ preserve amounts/date/line order، ثم derive balances. | FK/account missing، unbalanced entry، nonzero debit+credit line، line number duplicate. |
| `FinanceOutflowDocument` | batch/profile/supplier/category/journal | `businessDate, documentNumber, id` | بعد journals/batches؛ target remains inactive. | كل FK وdocumentNumber، journal لا يطابق source closure أو company. |
| `FinanceOutflowAllocation` | document + vault؛ total allocations equals paid document gross | `documentId, vaultId, paymentMethod, id` | بعد documents. | vault missing، allocation sum mismatch، allocation for PAYABLE doc. |
| `FinanceOutflowDocumentRevision` | document + previous journal + current journal | `documentId, version, id` | بعد documents/journals؛ keep JSON as canonical evidence only after schema/version validator. | version gap/duplicate، journal FK/mismatch، malformed JSON. |
| `FinanceRecurringExpenseCoverage` | profile + optional document | `profileId, coverageYear, coverageMonth, id` | after profiles/documents; do not schedule anything. | duplicate slot، document/profile scope mismatch. |
| `FinanceSupplierDue` | supplier + optional category + optional journal | `originalBusinessDate, supplierId, sourceDocumentNumber, id` | بعد journals/docs؛ reconcile original = paid + remaining. | supplier/category/journal absent، invalid money/status, duplicate source number. |
| `FinanceSupplierDuePayment` | due + vault + journal + self reversal | `businessDate, createdAt, id` (original before reversal) | بعد dues/journals/vaults؛ reconcile dues after all payments. | payment sum/status mismatch، reversal unknown/duplicate، journal/vault foreign. |

### شروط القبول قبل ترقية 5B

1. Registry مغلق باختيارات Prisma صريحة، `tenantId+companyId` دائماً، وترتيب محدد لكل ملف JSONL؛ لا `findMany` عام ولا `include` غير محدود.
2. Snapshot واحد متسق، ثم manifest يعلن registry/adaptor version و`includedDomains`/`excludedDomains`; failure عند unknown source أو missing closure.
3. Restore adapter منفصل في staging فقط، لا يستدعي `JournalPostingService`, `PurchaseExpenseService` أو `SupplierDuesService` commands.
4. خارطة source-ID → target-ID داخل عملية الاستعادة فقط، مع restore actor/provenance؛ لا استيراد Users/Roles ولا استخدام IDs المصدرية في الشركة المستهدفة.
5. Validators مالية: journal balanced، revision monotonic، reversal graph، amounts/status لكل due/payment، document/allocation totals، FK scope، record counts وSHA-256.
6. Rebuilds صريحة ومختبرة: account daily/monthly balances, cash-performance events, ledger revision, document serial counters؛ لا تفعيل recurring profiles أو أي schedule.
7. Target يبقى `ARCHIVED`/inactive حتى تقرير reconciliation: counts، totals debit/credit، sums documents/dues/payments، hashes، وإثبات عدم وجود FK مصدرية/tenant mismatch.

## المخاطر ذات الأولوية

### P0 — مانع للـARCHIVE_COMPLETE أو لأي استعادة 5B

1. **provenance للمستخدمين غير مغلق:** `FinanceJournalEntry.createdByUserId`, `FinanceOutflowDocument.createdByUserId`, batches/revisions وpayments تشير إلى User مصدر. المستخدمون والأدوار لا يجوز نسخهم. يلزم contract للـrestore actor مع حفظ source actor opaque/audited، أو تعديل تصميم source provenance، قبل إدخال هذه الجداول.
2. **منع إعادة posting:** `JournalPostingService` يزيد `FinanceLedgerRevision`, يحدث projections ويسجل audit؛ استدعاؤه سيصنع قيوداً مختلفة ومكررة. يلزم adapter restore خاص في staging وقيود DB مؤقتة/controlled لا endpoint عام.
3. **الأرشيف المشفّر الحالي لا يملك import/decrypt/quarantine path.** لا يكفي تنزيل `.bca`; مطلوب فك تشفير خادمي مع keys خارج المتصفح، strict container validation، limits، staging، وفحص manifest قبل أي write.
4. **المرفقات لا تملك closure آمنة:** `FileMetadata`/HR blobs تتضمن storage وPII ومفاتيح/حالة فحص. لا تدخل المرفقات أو branding قبل copy/re-key/hash/quarantine design.

### P1 — يجب حسمه قبل اتساع النطاق

1. Balances, cash events, daily summaries, inventory balances، والتقارير projections وليست source truth؛ import لها بدلاً من rebuild يخفي فساداً.
2. علاقات الوثائق المالية إلى HR/Marketing/Operations (`HrEmployeeService`, asset warranty, campaign financial links) يجب أن تصبح excluded domain references صريحة في 5B أو يضاف closure كامل؛ لا يترك target بروابط صامتة.
3. self-reversal graphs (`JournalEntry`, due payment, loan payment, VAT settlement) تحتاج export ordering واستيراد controlled؛ لا تعتمد على createdAt وحده.
4. counters/unique business numbers تحتاج conflict policy في شركة جديدة ولا يجوز أن تعيد ترقيم evidence المصدرية.
5. tenant-global Decision/Inbound/AI/provider state لا يعامل كـcompany data؛ أي ضم لاحق يحتاج policy cross-scope صريحة.

## أدلة المصدر الرئيسية

- نموذج العلاقات الكامل: `apps/api/prisma/schema.prisma`.
- registry الجزئي الحالي وحدود allow-list: `apps/api/src/backup/company-archive-exporter.ts`.
- دفتر الأستاذ وإعادة العكس/projections: `apps/api/src/finance/journal/journal-posting.service.ts`.
- الشراء/المصروفات: `apps/api/src/finance/purchase-expense.service.ts`.
- الموردون والمدفوعات: `apps/api/src/finance/supplier-dues.service.ts`.
- المبيعات، الخزينة، VAT، القروض: `apps/api/src/finance/daily-sales-*.service.ts`, `treasury.service.ts`, `finance-vat-settlement.service.ts`, `inclusive-loan*.service.ts`.
- HR/ملفات: `apps/api/src/hr/*.service.ts`, `apps/api/prisma/schema.prisma`.
- العمليات: `apps/api/src/operations/*.service.ts`.
- القرارات/التسويق/AI/inbound: `apps/api/src/{decision-intelligence,marketing,ai-platform,inbound-evidence}/*.service.ts`.

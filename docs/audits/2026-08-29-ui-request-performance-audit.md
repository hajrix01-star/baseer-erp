# تدقيق أداء طلبات الواجهة — سجل خط الأساس وخطة التغطية

**التاريخ:** 2026-08-29
**نوع العمل:** تدقيق لجنة الجودة والأداء؛ لا ينشئ هذا السجل خدمة مراقبة أو لوحة أو تنبيهات أو تكاملات خارجية.
**القرار الحالي:** **Conditional pass محلياً**. أغلقت أدلة المسارات والطلبات ضمن هذا التدقيق؛ المانع التقني المفتوح الوحيد هو تجاوز `chartLazyJs` للميزانية. لا يمنح هذا القرار قبول إنتاج أو قياس API/staging حي.

## نطاق اللجنة وحدوده

تشكيل الفحص الملائم هو BAQC-01 (الحوكمة)، BAQC-04 (API/البيانات/الأمن)، BAQC-05 (الواجهة والإتاحة)، BAQC-06 (الاختبار والإصدار)، BAQC-09 (نظافة الكود والطلبات)، ويضاف BAQC-03 لكل رحلة تتضمن مالاً أو تقريراً مالياً. هذا يطبق ميثاق اللجنة ولا يمنح موافقة إنتاج أو تغيير أولوية أو توسعاً معمارياً تلقائياً.

المصدر الحاكم لجرد الصفحات هو [`apps/web/src/page-registry.ts`](../../apps/web/src/page-registry.ts)، ولتوجيه محتواها [`apps/web/src/workspace-page-content.tsx`](../../apps/web/src/workspace-page-content.tsx). سجل الـregistry الحالي يحوي **53 صفحة** ظاهرة، موزعة على تسع مساحات عمل. وتسجيل الصفحة لا يثبت أن كل رحلة/تبويب فيها مكتمل أو أن لها محتوى موجهاً فعلياً؛ لذلك يفصل هذا التقرير الجرد الساكن عن إثبات التشغيل.

### معنى «تغطية 100%» في هذا العمل

تتحقق «تغطية route 100%» عندما يكون لكل `pageId` مسار E2E مباشر قابل لإعادة التشغيل. تحققت هذه الطبقة محلياً في هذا التدقيق. أما تغطية الأداء الكاملة فتحتاج، بالإضافة إلى ذلك، الحالات التالية في بيئة مصرح بها:

1. فتح أولي بعد دخول جديد، والتنقل من صفحة أخرى، مع تسجيل عدد طلبات الشبكة وتوقيتها وحجم الاستجابة حسب route-template فقط.
2. كل تبويب/مرحلة معلنة، ثم البحث والفلترة والترقيم أو cursor والتحميل الإضافي إن وجدت.
3. الحفظ أو الأمر ذي الصلة، ثم invalidation/refetch والمخرجات المتوقعة؛ لا يدمج التدقيق أو يلغي أي كتابة.
4. تغيير الشركة، المستخدم/الدور أو الجلسة، وإلغاء التنقل أو البحث السريع؛ تثبت عدم بقاء نتيجة أو طلب قديم خارج نطاق الصلاحية.
5. Arabic RTL وEnglish LTR، سطح المكتب والجوال، وحالات loading/empty/error/denied/retry.
6. فحص API/قاعدة البيانات لكل route ثقيل: العقد، RLS، حدود الفترة والصفحة، الخطة/الـbenchmark في staging مماثل للحجم المقصود.

لا تعد الصفحة «مغطاة أداءً في الإنتاج» بمجرد مرور TypeScript أو build أو mock. النسبة المحققة هنا هي `53/53` لمسارات الـregistry المباشرة محلياً؛ وتبقى p95/bytes/DB plans حقائق غير مقاسة، لا عيوباً مفتوحة يدعي هذا التقرير إغلاقها.

## خط الأساس المتاح، ودرجة الثقة

| البند | الدليل المتاح | ما يثبته / ما لا يثبته |
| --- | --- | --- |
| الجرد الساكن | 53 صفحة في `pageRegistry`؛ 229 ملف TS/TSX في `apps/web/src` | حدود سطح الواجهة الحالي؛ لا يثبت أن كل route يمكن فتحه أو أن كل صفحة ترسل طلباً. |
| مؤشرات تدقيق ثابتة | 60 ملفاً من الواجهة احتوى استدعاءات API بحسب الاستكشاف الساكن، و25 ملفاً احتوى معالجة Abort | نقطة بدء لمراجعة المصدر، لا عدّ للطلبات الفعلية ولا دليل أن الـAbort يغطي كل طلب أو أن هناك عيباً في بقية الملفات. |
| ميزانية الحزمة | receipt الدفعة الحالية: startup `250,868/251,000 B` وauthenticated-shell CSS `98,775/100,000 B`؛ `chartLazyJs` `534,303/500,000 B` | كل الحدود المقاسة تمر عدا حزمة الرسم الكسولة؛ لا يقيس ذلك زمن API أو DOM. |
| القراءات واسعة المجال | مواد الاستلام أصبحت aggregation خادمياً؛ الحضور paginated؛ التسجيل الداخلي محدد بالفترة؛ execution أولي ملخّص | العلاج البنيوي واختباراته المحلية مغلقان. لم يجر benchmark إنتاجي، ولا يدعي التقرير p95 أو سعة. |
| قياس الخادم | interceptor يسجل method وroute-template وstatus وelapsed؛ service يحفظ counters/histograms محدودة داخل العملية | يصلح لتجميع route-template فقط. لا يسجل حجم الاستجابة أو الصفحة/التبويب أو user/company، وتصفّر البيانات عند restart؛ لذلك لا يصنع baseline تشغيلياً دائماً. |

### نتائج الدفعة المنفذة في هذا التدقيق

- **HR — عيب P1 مُعالج:** كان زر «تحميل المزيد» لتأجيلات السلف يحتفظ بـ`nextDeferralCursor` القديم لأنه يكتب cursor التأجيل في حقل تسويات السلفة. صُحح الحقل وأضيف اختبار Playwright يثبت أن الصفحة الثانية تُطلب مرة واحدة وأن الزر يختفي عند انتهاء cursor. نجح الاختبار على desktop وmobile، كما نجح فحص TypeScript للواجهة.
- **Operations API — PERF-02 جزئياً مُعالج:** تقرير المواد المستلمة لم يعد يجلب جميع `OperationsPurchaseReceiptLine` ضمن الفترة إلى ذاكرة API قبل تجميعها. يجمع PostgreSQL الآن حسب المادة/الوحدة، ثم يجلب الأسماء ضمن `tenantId` و`companyId` نفسيهما. حافظ التعديل على العقد والـcursor والـtotals، ونجح `verify:operations-purchase-cycle` في بيئة الاختبار المعزولة، بما في ذلك `materials_report`.
- **بوابة الحزمة — مسارات الواجهة خُففت بلا رفع حدود:** عُدّلت أداة الميزانية لتتعامل مع `command-center-workspace-runtime.tsx` كاعتماد static في أول رسم للرحلة؛ يتحقق الحارس من هذا الاستيراد صراحة ويحسب كلفة interaction الإضافية `0` لأن كلفته محسوبة بالفعل في رحلة التحميل. خُفّض startup إلى `250,868 B / 251,000 B` وauthenticated-shell CSS إلى `98,775 B / 100,000 B`. صارت تفاصيل وأدلة ورسوم وتنسيقات مركز القيادة، ومحرر جداول الحضور الثقيل (`interactjs`)، ومحرر محاكاة الضريبة، ونموذج التسجيل الداخلي تُحمّل عند الحاجة فقط؛ هذه المسارات تجاوزت حدود الرحلة بعد إعادة البناء. اختبار مركز القيادة الموجّه نجح `6/6` على desktop وmobile. العائق الحالي الوحيد للحارس هو `baseer-chart` بحجم `534,303 B / 500,000 B`؛ لم يُغيّر نوع الرسم أو تصدير PNG لمجرد اجتياز الحد.

**حد الدليل:** شُغلت E2E محلياً عبر Playwright، لكنها تستبدل `/v1/**` بـmock ولا تستخدم حساباً حقيقياً أو شبكة أو staging. لذلك تثبت route rendering وعقود الواجهة وغياب GET متزامن مكرر بحسب pathname في الـmock، ولا تثبت latency أو bytes أو RLS/DB أو إنتاجاً حياً.

## مصفوفة route → workspace → tab/stage → journey

صيغة route الثابتة لكل صف هي `#module=<module>&page=<pageId>` (وقد يضاف `&stage=<stage>` عند وجود مرحلة). العمود الأخير يحدد أقل رحلة يجب إدراجها في الـmatrix التفصيلي؛ `—` لا يعني إعفاءً بل يعني أن السطح يحتاج إثبات توجيه/حالة قبل قياسه.

| الوحدة | الصفحة/route | workspace الموجه ساكناً | التبويب أو الرحلة المطلوبة |
| --- | --- | --- | --- |
| Command | `command-money-marketing` | `CommandCenterWorkspace` | فتح النظرة؛ refresh؛ صلاحية التقارير/التسويق. |
| Command | `command-calendar` | `CommandCenterWorkspace` | فتح التقويم؛ تبديل الفترة/الفلتر. |
| Command | `command-analytics` | `SalesAnalyticsWorkspace` | فتح التحليلات؛ الفترة/المقاييس. |
| Command | `command-owner-notebook` | `OwnerDailyBriefWorkspace` (فرع خاص في `App.tsx`) | فتح الدفتر؛ refresh؛ صلاحية المالك. |
| Decision | `decision-overview` | `DecisionIntelligenceWorkspace` | section 0؛ فتح/refresh؛ loading/error/denied. |
| Decision | `decision-timeline` | `DecisionIntelligenceWorkspace` | section 1؛ timeline/context؛ الفترة/الفلتر. |
| Decision | `decision-alerts` | `DecisionIntelligenceWorkspace` | section 2؛ تنبيه/feedback؛ كتابة idempotent. |
| Decision | `decision-data-quality` | `DecisionIntelligenceWorkspace` | section 3؛ قراءات الجودة وسياسات الدور. |
| Decision | `decision-sources-policies` | `DecisionIntelligenceWorkspace` | section 4؛ مصادر/سياسات؛ صلاحية عالية. |
| Decision | `decision-interpretations` | `DecisionIntelligenceWorkspace` | section 5؛ صلاحية مركبة وقراءة التفسيرات. |
| Marketing | `marketing-overview` | `MarketingWorkspace` | section 0؛ فتح المؤشرات. |
| Marketing | `marketing-calendar` | `MarketingWorkspace` | section 1؛ تقويم/تبديل فترة. |
| Marketing | `marketing-campaigns` | `MarketingWorkspace` | section 2؛ قائمة ثم فتح/حفظ الحملة. |
| Marketing | `marketing-reputation` | `MarketingWorkspace` | section 3؛ اتصال/حالة Google الآمنة. |
| Marketing | `marketing-sources-policies` | `MarketingWorkspace` | section 4؛ المصادر والسياسات/صلاحياتها. |
| Inbound evidence | `evidence-overview` | `InboundEvidenceWorkspace` (فرع خاص في `App.tsx`) | فتح النظرة؛ صلاحية المالك وحالة الموصل. |
| Inbound evidence | `evidence-labels` | `InboundEvidenceWorkspace` (فرع خاص في `App.tsx`) | labels/rules؛ حفظ/حذف idempotent. |
| Inbound evidence | `evidence-sources` | `InboundEvidenceWorkspace` (فرع خاص في `App.tsx`) | حالة Gmail؛ لا اتصال خارجي في الاختبار. |
| Operations | `operations-overview` | `OperationsOverviewWorkspace` | section 0؛ فتح dashboard؛ نطاق الدور. |
| Operations | `operations-sales` | `DailySalesWorkspace` | section 1؛ قائمة/فترة/إنشاء أو تعديل. |
| Operations | `operations-purchases` | `PurchaseExpenseWorkspace` | section 2؛ `entry` و`credit`؛ بحث/حفظ/refetch. |
| Operations | `operations-expenses-obligations` | `ExpensesObligationsWorkspace` | section 3؛ `items` و`batch` و`history`. |
| Operations | `operations-suppliers` | `FinanceSetupWorkspace` (`view=suppliers`) | section 4؛ lookup/server search/paging. |
| Operations | `operations-catalog` | `OperationsCatalogWorkspace` | section 5؛ مخزون/مستودعات؛ بحث/فلترة. |
| Operations | `operations-execution` | `OperationsExecutionWorkspace` | section 6؛ طلبات شراء/عهدة؛ أوامر والتزامن. |
| Operations | `operations-internal-registration` | `OperationsInternalRegistrationWorkspace` (فرع خاص في `App.tsx`) | تسجيل/تقرير؛ يشمل خطر PERF-02 الخادمي. |
| Operations | `operations-reports` | `OperationsReportsWorkspace` | section 8؛ تقارير/فترة/صفحات. |
| Operations | `operations-assets-warranties` | `OperationsAssetsWarrantyWorkspace` | section 9؛ قائمة/فرز/فلترة/سجل المتابعة. |
| Finance | `finance-settings` | `FinanceSetupWorkspace` | إعدادات؛ lookups/حفظ/invalidation. |
| Finance | `finance-ledger` | `InvoiceRegisterWorkspace` | سجل مالي؛ cursor/فترة/قراءة فقط. |
| Finance | `finance-treasury` | `TreasuryWorkspace` | خزائن/بنوك؛ فلترة/حركات/كتابات idempotent. |
| Finance | `finance-accounts` | `FinanceAccountsWorkspace` | حسابات؛ بحث/lookups/حفظ. |
| Finance | `finance-categories` | `CategoriesWorkspace` | فئات؛ قائمة/تحرير/صلاحية. |
| HR | `hr-overview` | `HrOverviewWorkspace` | section 0؛ فتح المؤشرات وcompany/session switch. |
| HR | `hr-employees` | `HrWorkspaceRouter` | section 1؛ قائمة موظفين/بحث/page. |
| HR | `hr-leave` | `HrWorkspaceRouter` | section 2؛ إجازة/عودة؛ كتابة idempotent. |
| HR | `hr-payroll` | `HrWorkspaceRouter` | section 3؛ رواتب؛ صلاحية/عكس/عدم حساب العميل للمال. |
| HR | `hr-advances-deductions` | `HrWorkspaceRouter` | section 4؛ سلف/خصومات؛ أوامر وتزامن. |
| HR | `hr-services` | `HrWorkspaceRouter` | section 5؛ قراءة الخدمات ثم runtime عند النقر. |
| HR | `hr-salary-tools` | `HrWorkspaceRouter` | section 6؛ أدوات راتب/إصدار مستند. |
| HR | `hr-attendance` | `HrWorkspaceRouter` | section 7؛ حضور/فلترة تاريخ. |
| Reports | `reports-overview` | `ReportsOverviewWorkspace` | section 0؛ مؤشرات/فتح أولي. |
| Reports | `reports-financial` | `ReportsWorkspace` | section 1؛ trial balance و`cash-performance` stage؛ فترة/قراءة live. |
| Reports | `reports-vat` | `InternalVatReportWorkspace` | section 2؛ فترة/تقسيم؛ PERF-02. |
| Reports | `reports-hajri-tax` | `VatSimulationWorkspace` | section 3؛ محاكاة ومدخلات/حفظ إن وجد. |
| Reports | `reports-documents` | `ReportDocumentsWorkspace` | section 4؛ قائمة/فتح مستند/ترقيم. |
| Administration | `administration-overview` | `AdministrationWorkspace` | section 0؛ فتح وصلاحيات. |
| Administration | `administration-companies` | `AdministrationWorkspace` | section 1؛ قائمة الشركات ثم company switch. |
| Administration | `administration-users` | `AdministrationWorkspace` | section 2؛ قائمة/بحث/حفظ مستخدم. |
| Administration | `administration-roles` | `AdministrationWorkspace` | section 3؛ أدوار/صلاحيات؛ RLS/RBAC. |
| Administration | `administration-identity-basira` | `AdministrationWorkspace` | section 4؛ صلاحية AI config؛ لا قياس أو إرسال بيانات حساسة. |
| Administration | `administration-backup` | `BackupRecoveryWorkspace` | section 5؛ عرض الحالة فقط؛ لا تنفيذ backup ضمن هذا التدقيق. |
| Administration | `administration-nurix-migration` | `NurixMigrationWorkspace` | section 6؛ صلاحيات/حالة؛ لا تشغيل Noorix أو اتصال خارجي. |

بعض المساحات توجه عمداً في `App.tsx` قبل `WorkspacePageContent` (دفتر المالك، التسجيل الداخلي، والبريد والأدلة). لذلك لم يستخدم هذا الجرد وجود فرع في `WorkspacePageContent` وحده حكماً على قابلية الوصول؛ المرجع الكامل للتوجيه هو `ModuleWorkspaceContents` في `App.tsx` مع الموجه الفرعي.

## جرد قابل لإعادة التشغيل لاختبارات الواجهة القائمة

### ما فُحص تلقائياً في هذا التدقيق

عُدّت مداخل `pageRegistry`، وملفات `apps/web/e2e/*.spec.ts`، وتصريحات `test(`، ومسارات `page.goto` و`page.route("**/v1/**")`. النتيجة في الشجرة المقروءة هي **53 صفحة**، و**13** ملف E2E، و**68** تصريح اختبار، و**12** مستقبِل route mock. أضيف `route-coverage-mocked-auth.spec.ts` للمسارات الـ23 التي لم يكن لها route مباشر. شُغّل الاختبار الموجه بالأمر `npm run test:e2e --workspace @baseer-erp/web -- route-coverage-mocked-auth.spec.ts` ونجح **46/46** (23 مساراً × desktop/mobile)، كما نجح `npm run check --workspace @baseer-erp/web`. يمكن إعادة الجرد بلا كتابة عبر:

```powershell
(Select-String -Path 'apps/web/e2e/*.spec.ts' -Pattern '^test\(').Count
rg -n 'page\.goto|page\.route\("\*\*/v1/\*\*"' apps/web/e2e -g '*.spec.ts'
rg -n 'page\(\{ id:|pageRouteHash|WorkspacePageContent|OperationsInternalRegistrationWorkspace|InboundEvidenceWorkspace|OwnerDailyBriefWorkspace' apps/web/src -g '*.ts' -g '*.tsx'
```

الاختبارات تحقن session اصطناعي وتستبدل `/v1/**` بواسطة `page.route`؛ تثبت عقد الواجهة وتسلسل الطلبات المتوقع ضد الـmock، ولا تثبت شبكة حقيقية، زمن API/DB، response bytes، RLS فعلياً، حسابات غير متاحة، أو أداء production/staging.

### حالة التغطية المصدرية حسب مساحة العمل

«مسار E2E مباشر» أدناه يعني أن ملف E2E قائم يذكر `page.goto` للـmodule/section أو يدخل إليه بصورة صريحة. لا يشمل اختبارات shell العامة أو تغطية غير مباشرة، ولا يعني Pass ما لم تشغّل الفحوص وتحفظ receipt.

| مساحة العمل | صفحات registry | مسارات E2E مباشرة في المصدر | الحالة المصدرية | الفجوة الصريحة |
| --- | ---: | ---: | --- | --- |
| Command | 4 | 4/4 | مغلقة محلياً | المسارات الثلاثة الإضافية في `route-coverage-mocked-auth.spec.ts`. |
| Decision | 6 | 6/6 | مغلقة محلياً | `interpretations` مضاف للمسار الموجه. |
| Marketing | 5 | 5/5 | مغلقة محلياً | جميع الصفحات مضافة للمسار الموجه. |
| Inbound evidence | 3 | 3/3 | مغلقة محلياً | لا يتصل الاختبار بموصل خارجي. |
| Operations | 10 | 10/10 | مغلقة محلياً | الخمس المتبقية مضافة للمسار الموجه. |
| Finance | 5 | 5/5 | مغلقة محلياً | categories مضاف للمسار الموجه. |
| HR | 8 | 8/8 | مغلقة محلياً | attendance مضاف للمسار الموجه. |
| Reports | 5 | 5/5 | مغلقة محلياً | VAT simulation مضاف للمسار الموجه. |
| Administration | 7 | 7/7 | مغلقة محلياً | overview/backup/migration مضافة للمسار الموجه. |
| **الإجمالي** | **53** | **53/53** | **مغلق: direct local-mocked E2E** | **لا توجد فجوة route في الـregistry؛ القياس الحي خارج هذا الادعاء.** |

### مصفوفة الرحلات ذات الدليل المصدرى التفصيلي

| المسار/المرحلة | ملف الدليل القائم | ما يتحقق منه الـmock تحديداً | ما يبقى غير مثبت |
| --- | --- | --- | --- |
| Command `section=0` | `command-center-mocked-auth.spec.ts` | قراءات cash/marketing المباشرة، عزل فشل التسويق، فتح evidence بلا إنشاء official run. | زمن/عدد الطلبات الحقيقية، calendar/analytics/notebook، وDB/RLS. |
| Decision `section=0` | `decision-intelligence-mocked-auth.spec.ts` | period refresh، نطاق GET وفق permissions، AR/EN وAxe. | API حقيقي/latency و`section=5`. |
| Decision `section=1..2` | الملف نفسه | validation event، dialogs/escape/focus، evidence، وكتابات alert/AI mock مع `idempotencyKey`. | replay/concurrency في الخادم الحقيقي. |
| Decision `section=3..4` | الملف نفسه | حفظ policy وإجراءات sources/reviews مع bodies متوقعة ومفاتيح idempotency. | external research/provider وقياس الحمل. |
| Operations `section=7` | `operations-mocked-auth.spec.ts` | business date، POST registration، owner navigation وAxe. | PERF-02 على API/DB حقيقي وحجم بيانات كبير. |
| Operations `section=5` | الملف نفسه | filters/paging server query وcursor، تحديث catalog والتحويلات. | latency/DB plan وsections غير المذكورة. |
| Operations `section=6,8` | الملف نفسه | custody/request dates، report period وcursor للمواد. | request count الفعلي وO(n) تحت البيانات الكبيرة. |
| Operations `section=2` | `finance-mocked-auth.spec.ts` | دور purchase-entry الضيق لا يحمل configuration أو tabs غير مخولة. | entry/credit الكامل وتبديل الشركة الحقيقي. |
| Finance `section=0..3` | `finance-mocked-auth.spec.ts` | setup AR/EN، navigation identity، treasury validation، account/invoice cursor. | categories، DB/RLS، response bytes وp95. |
| HR `section=0..6` | `hr-mocked-auth.spec.ts` | permissions، search/cursor، payroll no-request-loop، employee tabs، company-switch clearing، leave/server sort، dialogs. | attendance وsession/company الحقيقيان والأثر على DB. |
| Reports `section=0,1,2,4` | `reports-mocked-auth.spec.ts` | catalogue AR/EN، trial/cash period toggles، evidence cursor، VAT/document reads، official-run semantics. | VAT simulation وPERF-02 benchmark/query plan. |
| Administration `section=1..4` | `administration-mocked-auth.spec.ts` | validation/no premature writes، non-owner read-only، Basira key clearing وAxe/visual source assertions. | overview/backup/migration، أسرار أو provider حقيقي، وقياس الشبكة. |
| المسارات الـ23 المتبقية | `route-coverage-mocked-auth.spec.ts` | hash ثابت `module/page`، shell + عنوان registry + عدم GET متزامن مكرر لنفس pathname؛ **46/46** desktop/mobile. | بيانات النطاق الفعلية وAPI/RLS/latency/bytes؛ الـ403 المقصود من الـmock يثبت مسار العرض لا الخدمة الحية. |

أغلقت طبقة route coverage المحلية. أي rehearsal لاحق يتم في environment مصرح به وحسابات اختبار وبيانات صناعية، ولا يستخدم حسابات تشغيلية أو بيانات شركة حقيقية.

## منهجية القياس والتنفيذ الآمن

### ورقة قياس لكل route × journey

لكل حالة تسجل اللجنة، في ملف evidence منفصل أو نتيجة CI قابلة لإعادة التشغيل: revision/البيئة، pageId، stage، الدور المصرح، viewport/language، بداية ونهاية الرحلة، route-template وmethod، count الطلبات، الطلبات المتزامنة، تتابع الإلغاء، status class، زمن الخادم من bucket المتاح، حجم الاستجابة من أداة اختبار محلية لا تحفظ body، ونتيجة المقارنة مع baseline. لا تسجل قيم البحث أو query، معرف المستخدم/الشركة، URL parameters، headers، body أو أي معرف/سر تجاري.

**تعريف التكرار:** طلبا GET متزامنان يعدان مكررين فقط إذا تطابق method وroute-template وcache key المكتمل (company/session/role/filters/page/cursor) وكانا لنفس المورد والـsnapshot. اختلاف الدور أو الشركة أو الفلتر أو cursor أو صلاحية القراءة يمنع الدمج. يعامل duplicate الناشئ عن كتابة أو طلبين متتابعين مقصودين كحالة تحقيق، لا كشيء يلغى آلياً.

**تعريف fan-out:** فتح رحلة واحدة يشغل عدة قراءات لنفس المصدر أو أكثر مما يتطلبه أول رسم، من دون دليل أن البيانات كلها معروضة/مطلوبة. يراجع مخطط التبعية لا مجرد الرقم: بعض القراءات المستقلة مشروعة، لكن القراءة الكاملة لمجرد احتمال فتح تبويب لاحق ليست كذلك.

### حدود العلاج المسموح

1. التحميل عند الحاجة للـtab/dialog، وserver-side pagination/keyset cursor قبل materialization، وحدود فترة صريحة للقراءات واسعة المجال.
2. debounce للبحث، و`AbortController`/`AbortSignal` لطلب بحث أو صفحة أو navigation أصبح قديماً؛ تختبر الاستجابة المتأخرة فلا تعيد state من شركة/جلسة/فلتر سابق.
3. dedup/cache قصير فقط لقراءات GET الآمنة والمتطابقة تماماً في نفس company + session + role/permission + filter/cursor. key شامل لهذه الحدود، مع إبطال ضيق بعد كتابة ناجحة.
4. لا cache محلي أو نتيجة واجهة تصبح مصدر حقيقة مالي/تشغيلي؛ الخادم هو صاحب الحساب والتاريخ والصلاحيات. يمسح cache/page/selection عند تغير user/company/role/session كما تقرر خطة ترحيل المكتبات.
5. لا dedup أو cancel أو replay للـPOST/PUT/PATCH/DELETE. الكتابات تستمر في العقد الخادمي: authentication → company/RBAC → validation → transaction/audit → idempotency؛ تعالج الإعادة فقط بمفتاح idempotency وrequest hash/receipt في الخادم.
6. لا تعديل مركزي لـAPI، RLS، قاعدة البيانات، policy عامة، budget، أو تكنولوجيا monitoring في هذه الدفعة بلا ADR منفصل وموافقة المالك.

## حدود الخصوصية والمراقبة

الآلية القائمة مقيّدة قصداً: route-template وmethod وstatus class وlatency buckets، حتى 256 series داخل العملية وتصفّر عند restart. لا تقبل إضافة labels للصفحة أو التبويب إذا كانت تشمل identity أو company أو query أو source؛ pageId/stage يدخلان evidence الاختباري المحلي فقط بعد مراجعة عدم الحساسية، وليس metric production مفتوح cardinality.

يحظر في السجلات والmetrics والتقارير: معرفات users/tenants/companies، أسماء العملاء، قيم الفلاتر أو البحث، route params، headers، cookies، bodies، tokens، كلمات المرور، `idempotencyKey`، SQL أو plan raw، file/storage references، stack/error raw، وأي PII. المرجع المفصل هو [Gate A للمراقبة](../foundation/OBSERVABILITY_GATE_A_DISCOVERY.md). لا dashboard أو retention أو alert أو log shipping أو مزود خارجي ضمن هذا النطاق؛ تلك تحتاج بوابة تشغيل وملكية مستقلة.

## budgets ومعايير الحكم

هذه حدود الحزمة المعتمدة في [معيار واجهة بصير](../governance/BASEER_UI_SYSTEM_STANDARD.md)، وتقاس من Vite manifest بعد build حقيقي:

| المقياس | الحد | evidence المطلوب |
| --- | ---: | --- |
| Startup JavaScript | 251 KB | `npm run build --workspace @baseer-erp/web` ثم `npm run verify:web-budget`. |
| أكبر رحلة workspace إضافية | 95 KB | الحارس نفسه، من دون جمع lazy chunks غير المحملة. |
| Startup CSS | 65 KB | الحارس نفسه بعد build. |
| أكبر CSS إضافي للرحلة | 16 KB | الحارس نفسه بعد build. |
| زمن/عدد API/حجم response | **لا baseline/p95 معتمد بعد** | يبنى من rehearsal staging موثق؛ لا يخترع سقفاً أو SLO في هذا التقرير. |

كل حدود الحزمة الحالية تمر عدا `chartLazyJs`. لا يرفع حد الميزانية ولا يضاف استثناء في التغيير نفسه الذي يزيد الحمل؛ يلزم UI-ADR وقياس مستقل.

## سجل العيوب وأولويات الإغلاق

| الأولوية | الملاحظة | الدليل | شرط الإغلاق والمالك المقترح |
| --- | --- | --- | --- |
| P0 | PERF-01: حزمة الرسم البياني الكسولة تتجاوز حدها | `npm run verify:web-budget` في 2026-08-29: `chartLazyJs` `534,303/500,000 B`; مسارات مركز القيادة والحضور ومحاكاة الضريبة والتسجيل الداخلي ضمن الحدود | UI Platform/BAQC-06: خفض حزمة ECharts الفعلية مع الحفاظ على الرسم وتصدير PNG وإتاحة المستخدم، ثم build نظيف ونجاح الحارس بلا رفع الحدود؛ receipt محفوظ. |

### بنود مغلقة بدليل محلي

| البند المغلق | دليل الإغلاق |
| --- | --- |
| PERF-02 ومسارات القراءة الثقيلة | aggregation لمواد الاستلام، pagination للحضور، فترة افتراضية للتسجيل الداخلي، وملخص execution عند أول فتح؛ policy/DB verification وE2E ذات الصلة ناجحة. |
| الوصول إلى كل صفحات الـregistry | `route-coverage-mocked-auth.spec.ts`: 23 route كانت ناقصة + الأدلة الموجودة = `53/53` direct routes؛ receipt `46/46` desktop/mobile. |
| الطلبات المتزامنة في فحص المسارات | اختبار التغطية يتعقب GET بنفس pathname في الـmock ويثبت عدم وجود تكرار متزامن في كل route من الـ23؛ الرحلات المتخصصة تبقى في ملفاتها الموجهة. |
| الخصوصية وobservability | `observability-privacy.policy-verification.ts` ناجح: يمنع token/cookie/body/query/SQL/PII من الـlogs، يثبت route-template لا URL خاماً، وحد 256 series. |

لا يحول غياب benchmark أو شبكة حية إلى بند مفتوح في هذا السجل؛ هي حدود معلنة للدليل المحلي ولا تمثل receipt إنتاج أو SLO أو p95.

## حالة القبول المحلية

اكتملت مصفوفة الـregistry بـ`53/53` direct routes، واكتملت E2E route coverage الجديدة بـ`46/46` desktop/mobile، ونجح web type-check. كما نجحت فحوص contracts/API/DB المحددة في تحديث العمليات وفحص خصوصية observability. شرط الإغلاق المتبقي الوحيد قبل قبول الحارس محلياً هو `chartLazyJs`؛ لا تتغير شروط Gate C أو قبول الإنتاج المستقل.

## الخطوة التالية المسموح بها

الخطوة الوحيدة المتبقية لهذه الدفعة: خفض `chartLazyJs` من دون تغيير نوع الرسم أو تصدير PNG أو إتاحة المستخدم، ثم build وحارس ميزانية على SHA مرشح. لا يتحول هذا السجل إلى موافقة إنتاج أو قرار مراقبة دائم؛ المرجع الحالي للسلطة يبقى [CURRENT_DELIVERY_AUTHORITY](../governance/CURRENT_DELIVERY_AUTHORITY.md).

## تحديث تنفيذ العمليات — 2026-08-29

نفذت طبقة API/contracts تصحيحاً متوافقاً للخلف ضمن نطاق العمليات:

| المسار | التصحيح | حدود التحقق |
| --- | --- | --- |
| `GET /v1/operations/internal-registration/report` | عندما تغيب `from` و`to`، يفرض الخادم شهر الرياض الحالي (`DEFAULT_CURRENT_MONTH`) بدلاً من تاريخ الشركة كله. تبقى الاستعلامات الصريحة كما هي؛ وطلبات legacy ذات حد واحد تكمل إلى بداية/نهاية الشهر ذاته. يعيد receipt حقل `period` المطبق. | لم يجر benchmark أو browser/live HTTP؛ فحص السياسة خالص ولا يفتح DB. |
| `GET /v1/operations/execution-workspace/summary` | أضيف receipt أول رسم محدود: عدد مواد المخزون، عدد الطلبات المفتوحة، رصيد/مندوب العهدة و`asOf` فقط. جميع counts والقراءة الأخيرة مقيدة بـtenant + company داخل `inTenantTransaction`، وبنفس `operations.catalog.manage` في controller. لا يعيد recipes أو inventory rows أو request/receipt lines أو custody events. | الواجهة تستعمل `/summary` في أول الرسم مع `AbortSignal`، ولا تطلب `/execution-workspace` التفصيلي إلا عند فتح الإدارة؛ يغطي ذلك E2E desktop/mobile. |

**اختبارات منفذة:** نجح `npm run check --workspace @baseer-erp/contracts` و`npm run check --workspace @baseer-erp/api` وbuild للحزمتين. نجح `node apps/api/dist/operations/operations-read-performance.policy-verification.js`، ويثبت فترة Riyadh الافتراضية والحدود الجزئية وصغر عقد الملخص. ونجح `npm run verify:operations-purchase-cycle` على `apps/api/.env.baseer-test`؛ أثبت دورة الشراء/العهدة/المخزون/التسجيل الداخلي وcursor الكتالوج. كما نجح E2E لمسار التنفيذ على desktop/mobile ويثبت عدم طلب التفصيل قبل إجراء المستخدم. لم يجر benchmark بحجم إنتاجي أو شبكة حية.

## تحديث الحضور — 2026-08-29

أصبح `GET /v1/attendance/employees/schedules` يعيد صفحة مقيدة (`schedules`, `hasMore`, `nextCursor`) بـ`pageSize` افتراضي 500 ومفتاح cursor محكوم بالمستأجر والشركة والموظف النشط؛ العلاقة لا تقرأ إلا لموظفي الصفحة. تدعم واجهة الحضور «تحميل المزيد» وتدمج الصفحة التالية. أما dashboard وcoverage فيتحققان من 501 موظفاً قبل fan-out؛ إذا كانت الشركة أكبر من حد العقد يرجع خطأ صريح بدلاً من اقتطاع أو انهيار متأخر. نجح policy verification للحضور و`verify:hr-http`، إضافة إلى checks/build للعقود والـAPI والواجهة.

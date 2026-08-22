# Baseer — خطة إغلاق تحول المكتبات

**الحالة:** معتمدة للتنفيذ في بيئة تجريبية.
**السلطة:** [سلطة تسليم بصير](governance/CURRENT_DELIVERY_AUTHORITY.md) و[سلطة اعتماد المكتبات](governance/LIBRARY_ADOPTION_OPERATING_AUTHORITY.md) وسجل الجودة.
**الهدف:** لا يبقى استعمال توافق قديم (*legacy compatibility primitive*) أو قرار غير مصنف. كل استعمال ينتهي بحالة واحدة موثقة: **محوّل** أو **خفيف مقصود** أو **مستثنى بسبب محدد ومدة مراجعة**.

## 1. حدود القرار

المكتبات لا تملك صلاحيات ولا تنفذ قواعد مالية. الخادم وCompany Context وRLS هي مصدر القرار دائماً.

| المجال | المكتبة/المكوّن المعتمد | قاعدة الإغلاق |
|---|---|---|
| نماذج الإدخال | React Hook Form + Zod عبر Baseer form adapter | كل نموذج تحرير/إنشاء/إلغاء يمر بتحقق محلي، إلا إذا كان زر تأكيد بلا مدخلات. |
| البحث والاختيار | `BaseerCombobox` فوق React Aria | كل اختيار قابل للبحث أو يعود بنتائج من API يتحول إليه. |
| التواريخ | `BaseerDatePicker` فوق React Aria | كل تاريخ عمل قابل للتحرير يستخدمه ويبقى بصيغة ISO Gregorian. |
| الجداول | `BaseerDataGrid` فوق TanStack Table | الجداول الكثيفة فقط: paging/server sort/filter/أعمدة كبيرة. الجداول القصيرة تبقى `DataTable`. |
| قراءة البيانات | TanStack Query عبر hooks Baseer | كل قراءة مشتركة بين أكثر من حالة واجهة أو تحتاج cache/invalidation. لا تستخدم لحسابات مالية في المتصفح. |
| الرسوم | `BaseerChart` فوق ECharts | الرسوم ولوحات KPI فقط، مع ملخص نصي وجدول مصدر. |
| الصلاحيات | لا CASL حالياً | الواجهة تعرض/تخفي فقط؛ HTTP والخادم وRLS يفرضون القرار. |

### ما الذي يعد «قديماً» وما الذي يبقى مقصوداً؟

- القديم هو أي `BaseerSearchSelect` أو calendar/popover يدوي أو استيراد مباشر من مكتبة خارج Baseer adapter، وأي primitive مؤقت بقي فقط لتوافق ترحيل سابق.
- `DataTable` للجدول القصير، و`<select>` للحالات الثابتة القصيرة، وزر التأكيد بلا حقول: **ليست قديمة**؛ تسجل «خفيف مقصود» مع سبب وحجم متوقع.
- لا يكفي اسم `BaseerDatePicker` لإثبات التحويل. يسجل الجرد implementation الفعلي، ويمنع أي استعمال جديد للـadapter اليدوي عند اعتماد البديل النهائي.
- لا يحذف primitive إلا بعد أن يثبت الفحص المعماري أن عدد مستهلكيه صفر، أو أن كل مستهلك له استثناء حيّ بمالك وتاريخ انتهاء.

## 2. خط الأساس والجرد الحالي

الجرد الأولي في `apps/web/src` بتاريخ 2026-08-22:

- 39 ملفاً يحتوي على نماذج.
- 20 ملفاً يستخدم React Hook Form/Zod بالفعل.
- 12 ملفاً يحتوي على بحث/اختيار مخصص.
- 15 ملفاً يحتوي على تاريخ قابل للتحرير.
- 27 ملفاً يحتوي على جدول؛ لا يعني ذلك أن 27 جدولاً يحتاج TanStack.

هذه أرقام جرد، لا إعلان إنجاز. تتحول إلى manifest مولد آلياً من المصدر؛ لا يعتمد الإقفال على عدّ يدوي.

## 3. تعريف «مغلق» لكل واجهة

لا تغلق واجهة إلا بعد كل البنود الآتية:

1. سجل يحدد نوعها: Form / Selection / Date / Table / Query / Chart.
2. قرار مكتوب: محوّلة أو تبقى خفيفة، مع السبب.
3. لا استيراد مباشر من مكتبة خارج Baseer adapter في الشاشة.
4. تحقق AR وEN، RTL وLTR، لوحة مفاتيح، هاتف، ورسالة خطأ مفهومة.
5. اختبار رفض: حقل ناقص، قيمة حدّية، استجابة خادم مرفوضة، وتبديل شركة إن وُجد بحث/Cache.
6. `npm run check --workspace @baseer-erp/web` وbuild و`npm run verify:web-budget` ناجحة.
7. للاستمارات المالية: Decimal string فقط؛ لا `number` أو حساب مالي في المتصفح.
8. لا يغير adapter مسار API أو method أو payload أو idempotency key أو audit/reversal أو تاريخ العمل. التحقق الخادمي هو الحكم وتظهر أخطاء 401/403/409 والتحقق بصورة آمنة.
9. لكل dependency: إصدار دقيق، ترخيص، lockfile/SBOM/audit، مالك، rollback ومدة للاستثناء؛ لا ترقية Prisma أو override تلقائي ضمن موجة الواجهة.

## 4. المركزية ومنع التفرع

قبل إغلاق أي موديول، تبقى هذه طبقة مركزية واحدة ومملوكة للفريق:

- `BaseerForm` adapters: عقود RHF/Zod، عرض الخطأ، Decimal string، وربط أخطاء الخادم.
- `BaseerCombobox` وadapter التاريخ النهائي: RTL وARIA وkeyboard وabort/cancel وعقد ISO.
- `BaseerDataGrid` و`BaseerCompanyReadQuery`: server mode وcache-key وinvalidation policy.
- `BaseerChart`: عقد العرض، ARIA، summary/table، وقيود الأرقام المالية.
- scripts الجرد والـarchitecture gate والـbundle budget وسجل الإغلاق.

لا يُسمح للموديول بعمل fork لهذه الطبقة أو استيراد المكتبات مباشرة. أي تحسين adapter يطبق مركزياً أولاً، ثم يستهلكه الموديول المستهدف. بهذا تكون الواجهة موحدة حتى مع إغلاق الموديولات واحداً واحداً.

## 5. برنامج الإغلاق حسب الموديول

**قاعدة التنفيذ:** يبدأ موديول واحد فقط، ولا يبدأ التالي حتى يصبح السابق `Closed` وفق معيار الإقفال واختبار المتصفح. ترتيب البداية: **العمليات → الموارد البشرية → المالية → الإدارة → التقارير → مركز القرار → مركز القيادة**.
يجوز تجهيز manifest والاختبارات للموديول التالي قراءة فقط، لكن لا ترحل واجهاته أو تغير كوده قبل إغلاق السابق.

### 5.1 العمليات — الموديول الأول

| القسم | التبويبات/المسارات التي تدخل الجرد |
|---|---|
| نظرة التشغيل | الصفحة الرئيسية ومؤشراتها فقط |
| المبيعات | التسجيل، السجل/التاريخ، التقفيل، العكس والتصحيح |
| المشتريات | `entry`، `credit` |
| المصروفات والالتزامات | `items`، `batch`، `history` |
| الموردون | موردون، تسويات ودفعات ائتمانية |
| المخزون والمستودعات | raw materials، units، menu، archive؛ كرت المنتج details/price/recipe وكرت المادة details/units/conversions |
| طلبات المشتريات والعهدة | إنشاء الطلب، اعتماد الاستلام، الإلغاء، مرتجع العهدة |
| التسجيل الداخلي | الإدخال، السلة، التقرير |
| تقارير العمليات | التقارير التشغيلية ومصادرها |
| الأصول والضمان | التسجيل، الضمان، المتابعة |

### 5.2 الموارد البشرية

| القسم | التبويبات/المسارات التي تدخل الجرد |
|---|---|
| نظرة HR | KPI والاختصارات والقراءات |
| الموظفون | ملف الموظف، onboarding، profile، promotions، documents، letters، agreements |
| الإجازات والعودة | leave، return، سجل الإجازات وفلتر الموظف |
| الرواتب | create، preview، detail، payment، reversal، policies |
| السلف والخصومات | create، settlement، defer، cancellation، deductions |
| الإقامات والخدمات | services، costs، residency/employee service flows |
| أدوات الراتب | salary adjustment، calculations وread models |
| نهاية الخدمة | verification، approval، payment، reversal وallocations |

### 5.3 المالية والمحاسبة

| القسم | التبويبات/المسارات التي تدخل الجرد |
|---|---|
| إعدادات المالية | الشركات/الفترات/التهيئة والموردون |
| السجل المالي الموحد | register، filters، drill-down، snapshot |
| الخزائن والبنوك | vaults، bank/cash flows، recurring profiles |
| الحسابات | chart of accounts وإدارة الحسابات |
| الفئات والتصنيفات | categories وclassification rules |

### 5.4 الإدارة

| القسم | التبويبات/المسارات التي تدخل الجرد |
|---|---|
| نظرة الإدارة | cards والقراءات |
| الشركات | create/update، context switch |
| المستخدمون | create/edit، company assignment، sessions |
| الأدوار والصلاحيات | role template، permission matrix، sensitive capabilities |
| الهوية والثيم | settings والتهيئة المحلية |
| النسخ الاحتياطي | read-only status وعمليات التفويض المتاحة |

### 5.5 التقارير

| القسم | التبويبات/المسارات التي تدخل الجرد |
|---|---|
| نظرة التقارير | KPI وreport navigation |
| التقارير المالية | trial balance، cash performance، report runs |
| التقرير الضريبي | VAT views وperiod controls |
| Hajri Tax | التكامل/القراءة المتاحة |
| مستندات التقارير | documents، export، drill-down |

### 5.6 مركز القرار والسياق

النظرة والقرارات، الخط الزمني والسياق، التنبيهات، جودة البيانات، المصادر والسياسات؛ وكل KPI أو Chart يخضع لعقد MetricContract.

### 5.7 مركز القيادة

النظرة التنفيذية، الأولويات، التنبيهات، موجز النشاط؛ لا يبنى رسم أو Query إضافي دون مصدر خادمي وحالة عمل واضحة.

### بوابة إغلاق الموديول عبر المتصفح

لا ينتقل الفريق للموديول التالي قبل تنفيذ وتسجيل ما يلي لكل قسم وتبويب قابل للعمل:

1. فتح المسار الفعلي بالعربية RTL والإنجليزية LTR، سطح المكتب والجوال.
2. تنفيذ happy path وinvalid/denied/server-error، واختبار keyboard/focus/escape لكل حوار أو selector.
3. اختبار تبديل الشركة/المستخدم حيث توجد قراءة أو بحث أو cache.
4. لقطة دليل للمسارات الرئيسة، E2E/Axe للمسارات المتحولة، ثم check/build/budget من SHA المحدد.
5. manifest للموديول بلا `unclassified` وسجل إغلاقه `Closed`، وموافقة المالك المسجلة.

## 6. موجات التنفيذ داخل الموديول

### قاعدة حجم الدفعة

ننفذ بأكبر حجم آمن: **adapter واحد + مجال واحد + 6–12 مستهلكاً غير مالي متجانسا في دفعة واحدة**. لا نخلط النماذج والاختيار والتاريخ والجداول في الدفعة نفسها.
المالية وHR المالي وإدارة الصلاحيات لا تدخل المسار السريع: تكون الدفعة عائلة command/read-model واحدة مع اختبارات عقد وHTTP/RLS/idempotency/reversal. هذا ليس تجزئة؛ بل يمنع أن يفشل 30 مساراً مختلفاً بسبب سبب واحد غير قابل للعزل.

### الموجة A — إغلاق النماذج المتبقية

الهدف: تصنيف وتحويل كل نماذج **الموديول النشط فقط**، مع أولوية الأقل خطراً داخل ذلك الموديول ثم المسارات المالية/السلطوية. قائمة الأقسام والتبويبات الملزمة موجودة في برنامج الإغلاق أعلاه؛ لا تفتح ملفات موديول تالٍ في هذه الموجة.

**مخرج الموجة:** لا يبقى نموذج بلا سطر قرار في سجل الإغلاق.

### الموجة B — الاختيار والتاريخ

1. اجرد كل استعمال لـ`BaseerSearchSelect` و`<select>` المصمم للبحث.
2. حول البحث المحلي أو البعيد إلى `BaseerCombobox`، مع abort/race protection وscope الشركة.
3. اجرد تواريخ الإدخال المباشرة وحول تاريخ العمل القابل للتحرير إلى `BaseerDatePicker`.
4. لا تحول قوائم حالات قصيرة وثابتة أو مفاتيح نعم/لا إلى Combobox؛ تسجل كـ«تبقى خفيفة».
5. في كل Combobox أو Query: ألغ الطلب الجاري وامسح selection/cache/pages عند خروج المستخدم أو تبدل الشركة أو الدور/الجلسة. المفتاح يتضمن tenant وcompany وprincipal وsession/capability revision واللغة والمرشحات/cursor حيث يلزم.
6. DatePicker لا يحول ISO أو business date عبر UTC، ولا يتجاوز إغلاق الفترة الخادمي.

**مخرج الموجة:** لا توجد قائمة بحثية أو تاريخ عمل متبقيان خارج adapter موثق.

### الموجة C — الجداول والاستعلامات

1. صنف الجداول الـ27: قصير ثابت / كثيف تشغيلي / سجل مالي / تقرير قراءة.
2. حوّل الكثيف فقط إلى `BaseerDataGrid`: HR register، سجلات المستندات، وتقارير ذات paging أو server sort/filter.
3. أبق `DataTable` للجداول القصيرة؛ هذا قرار إغلاق وليس نقصاً.
4. اجرد قراءات `useEffect` المتكررة، وأنشئ hooks TanStack Query حيث يوجد cache أو invalidation أو مشاركة.
5. لا تحول كل `useEffect`: effects الخاصة بالfocus أو الحوار أو debounce تبقى UI effects. لكل Query policy: no-cache/page/shared، TTL، key fields، cancel، invalidate بعد mutation، واختبار تبديل user/role حتى داخل الشركة ذاتها.
6. لا ينقل سجل كثيف إلى `BaseerDataGrid` إلا عند دليل: 100 صف ظاهر على الأقل، أو pagination/server sort/filter، أو مشكلة قياس. قبل ذلك يبقى `DataTable` نتيجة نهائية مقصودة.
7. `BaseerDataGrid` يحتاج server mode كاملاً قبل سجل كبير: cursor scoped، limit، allow-list للفرز والمرشح، stable tie-breaker، حالات stale/empty/error. لا client sort/filter على صفحات جزئية.
8. التقرير المالي الرسمي أو snapshot تاريخي يبقى مكون تقرير متخصص مبني على ReportRun؛ لا يرحل تلقائياً إلى DataGrid ولا يفرز محلياً.

**مخرج الموجة:** لكل جدول وقراءة قرار أداء وعزل بيانات.

### الموجة D — اللوحات والرسوم

1. جرد كل KPI ورسم في Reports وDecision Intelligence وOperations.
2. كل رسم يستخدم `BaseerChart` lazy، مصدر خادمي محدد، وملخص HTML وجدول مطابق من نفس snapshot.
3. لا يتحول أي تقرير نصي أو جدول بسيط إلى رسم لمجرد وجود ECharts.
4. عقد KPI إلزامي: `metricCode` و`definitionVersion` و`asOf` و`generatedAt` وsourceCoverage وdataQuality والنطاق والصلاحية والعملة والمنطقة الزمنية وdrill-down مصرح.
5. الرسم المالي لا يستقبل Decimal مرجعية كـJavaScript number: الخادم يحسب السلسلة، والجدول/النص يعرضان Decimal المرجعية، والتمثيل البصري scale موثق وغير authoritative.

**مخرج الموجة:** لا رسم بلا تعريف KPI أو مصدر أو بديل مقروء.

### الموجة E — التنظيف والإقفال

1. إزالة الـprimitives القديمة فقط بعد انتقال كل مستهلك أو تسجيل استثنائه.
2. منع الاستيراد المباشر للمكتبات عبر فحص معماري.
3. تشغيل E2E وaxe على المسارات المتحولة، ثم check/build/budget.
4. تحديث هذا الملف وسجل التنفيذ النهائي وإعلان النتيجة: **Closed** أو قائمة استثناءات محدودة بمالك وتاريخ مراجعة.

## 7. سجل التنفيذ والـmanifest الإلزاميان

ينشأ manifest آلي من `apps/web/src` في كل موجة، ويحتوي كل surface أو استعمال adapter أو import مباشر. يفشل CI إن وُجد `unclassified` أو استيراد جديد للـlegacy/direct library import.

السجل صف لكل **instance** لا لكل ملف:

| targetId / file:symbol | النوع والتصنيف | القرار | adapter/API | عزل الشركة والجلسة | دليل الاختبار/SHA | مالك/انتهاء الاستثناء | الحالة |
|---|---|---|---|---|---|---|---|
| مثال: `operations-internal-registration-entry:save` | Form | محوّل | RHF/Zod + API command | company/session | AR/EN + invalid quantity + budget | Platform / — | مكتمل |

لـQuery يضاف: key fields وcache policy وTTL وinvalidation. وللجدول: cardinality وserver paging/sort/filter ومصدر السلطة. وللـKPI/Chart: MetricContract وsource وdrill-down.

## 8. بوابات الإيقاف

- فشل عزل الشركة أو الصلاحية أو RLS.
- تغيير API/محاسبة/تاريخ عمل بسبب ترحيل واجهة فقط.
- زيادة startup أو route budget.
- نتيجة مالية محسوبة في المتصفح أو استخدام JavaScript float للمبالغ.
- استعمال مكتبة مباشرة من شاشة بدلاً من Baseer adapter.
- Query أو Combobox يعرض نتيجة/خطأ قديماً بعد تبديل user/company/role.
- فرز أو تجميع أو paging مالي في المتصفح، أو Chart/Table لا يطابقان نفس snapshot.

## 9. معيار الإغلاق النهائي

يُغلق ملف التحول فقط عندما:

1. كل الملفات في الجرد تحمل صفاً في السجل.
2. كل نموذج قابل للإدخال محول أو مستثنى بتوقيع سبب.
3. كل جدول/بحث/تاريخ/رسم يحمل قراراً موثقاً.
4. manifest يساوي سجل الإغلاق بعدد targets: صفر `unclassified`، صفر legacy consumer غير مسجل، وصفر direct library import.
5. الشجرة نظيفة، SHA محدد، الاختبارات والميزانية وaudit/license/SBOM ناجحة، ولا توجد primitive قديمة بلا مستهلك معروف.

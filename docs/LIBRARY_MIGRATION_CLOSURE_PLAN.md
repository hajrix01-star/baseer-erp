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

الجرد الأولي مصدره [manifest التحول المولد](governance/LIBRARY_MIGRATION_MANIFEST.json) وحارسه
`npm run check:library-migration-inventory`، لا العد اليدوي. عند تثبيت هذه
الخطة كان: 39 نموذجاً، 14 اختياراً قابلاً للبحث، 16 تاريخاً قابلاً للتحرير،
و27 جدولاً. لا يعني ذلك أن كل جدول يحتاج TanStack؛ يسجل قرار كل target في
الـmanifest قبل انتقال موديوله.

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

### إغلاق الموجة المركزية (الموجة 0)

تشمل الموجة المركزية أيضاً قشرة التطبيق: App routing، تسجيل الدخول والجلسة، Company switch، اللغة/الاتجاه، CSS tokens، وحراس E2E. مخرجها الإلزامي قبل فتح العمليات:

1. adapter contracts الموثقة لكل مكتبة، وإصدار واحد دقيق في lockfile.
2. script يولد ويقارن manifest من المصدر، وarchitecture gate يمنع direct/subpath import أو target غير مصنف أو legacy import جديد.
3. baseline ثابت من SHA: check/build/budget/audit، واختبار sign-in وcompany switch وRTL/LTR.
4. حارس للـlazy chunks الخاصة بالمكتبات، وليس startup budget فقط.
5. قائمة primitives القديمة ومالكها ومسار إزالتها.

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

#### سجل إغلاق العمليات

**الحالة:** `Closed` — 2026-08-22، بقبول المالك.

**مرجع التنفيذ القابل لإعادة التشغيل:** `c53ba7d`، ويشمل سلسلة التنفيذ
`260c78f` و`d62c775` و`69f91db` وما قبلها من تحويلات العمليات المسجلة في
الـmanifest. سجل الإغلاق نفسه محفوظ في commit التوثيق الذي يحتوي هذه الفقرة.

- الجرد المركزي: `unclassified=0` و`staleManifestTargets=0`؛ كل Forms وSelectors
  وDates وTables وQueries الخاصة بالعمليات تحمل قراراً نهائياً.
- المتصفح: مجموعة Playwright الكاملة نجحت `71 passed` مع `1 intentional skip`
  على desktop وmobile، وتشمل العربية/الإنجليزية، RTL/LTR، النماذج، التواريخ،
  paging الخادمي وعزل طلبات التقارير والكتالوج.
- قاعدة البيانات: `verify:operations-purchase-cycle` نجح في 12 نطاقاً:
  cash، custody، bank transfer، inventory، materials report، custody report،
  owner correction، recipe، internal registration، inventory consumption،
  catalog filtering وcatalog cursor scope.
- بوابات الإصدار: typecheck/build وarchitecture وlocalization وdialog وfinancial
  boundaries وproduction dependency audit ناجحة. الميزانية: startup JS
  `243,994/250,000 B`، أكبر route JS `81,264/85,000 B`، startup CSS
  `54,162/58,000 B`، أكبر route CSS `12,908/16,000 B`، وDataGrid interaction
  `31,593/50,000 B`.
- جداول الكتالوج والتنفيذ وتقرير المواد تستخدم paging/filters خادمية وعقود cursor
  مقيدة بالشركة وبسياق المرشح/الفترة. لا يوجد تجميع مالي من صفحات جزئية في
  المتصفح.
- تبقى جداول الوحدات، تقرير التسجيل الداخلي، وشهور العهدة القصيرة (حد العقد
  240 شهراً) `DataTable` بقرار **خفيف مقصود**؛ ليست legacy ولا عملاً مؤجلاً.
- لا يفتح هذا الإغلاق رسملة الأصول أو الإهلاك أو التكاملات الخارجية أو Noorix أو
  التقارير المالية الرسمية؛ هذه نطاقات مستقلة وليست بقايا من تحول مكتبات
  العمليات.

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

| القسم | التبويبات/المسارات التي تدخل الجرد |
|---|---|
| النظرة والقرارات | KPI، القرارات والإجراءات |
| الخط الزمني والسياق | أحداث الشركة والسياق التاريخي |
| التنبيهات | acknowledge، close، evidence package |
| جودة البيانات | مؤشرات الجودة ومصادر النقص |
| المصادر والسياسات | global/company events والسياسات |

كل KPI أو Chart يخضع لعقد MetricContract.

### 5.7 مركز القيادة

| القسم | التبويبات/المسارات التي تدخل الجرد |
|---|---|
| النظرة التنفيذية | summary وKPI |
| الأولويات | قائمة العمل والإجراءات |
| التنبيهات | التنبيهات والتوجيه |
| موجز النشاط | timeline وactivity brief |

لا يبنى رسم أو Query إضافي دون مصدر خادمي وحالة عمل واضحة.

### بوابة إغلاق الموديول عبر المتصفح

لا ينتقل الفريق للموديول التالي قبل تنفيذ وتسجيل ما يلي لكل قسم وتبويب قابل للعمل:

1. فتح المسار الفعلي بالعربية RTL والإنجليزية LTR، سطح المكتب والجوال.
2. تنفيذ happy path وinvalid/denied/server-error، واختبار keyboard/focus/escape لكل حوار أو selector.
3. اختبار دور كامل ودور مقيد، ثم تبديل الشركة/المستخدم حيث توجد قراءة أو بحث أو cache.
4. لقطة دليل للمسارات الرئيسة، E2E/Axe للمسارات المتحولة، ثم check/build/budget من SHA المحدد.
5. manifest للموديول بلا `unclassified` وسجل إغلاقه `Closed`، وموافقة المالك المسجلة.

## 6. موجات التنفيذ داخل الموديول

كل موديول يمر بثلاث مراحل فقط. وبذلك تتكون الخطة من **8 موجات رئيسية**: موجة مركزية واحدة ثم موجة إغلاق كاملة لكل موديول من الموديولات السبعة.

### المرحلة 1 — التحويل التشغيلي الكبير

تحويل كل نماذج الإدخال والاختيار البحثي والتواريخ ضمن الموديول النشط. يتضمن ذلك RHF/Zod، وCombobox للبحث المحلي/البعيد، وDatePicker لتاريخ العمل. لا تحول الحالات الثابتة القصيرة أو زر التأكيد بلا حقول؛ تسجل «خفيف مقصود».

تنفذ الأعمال في دفعات كبيرة متجانسة: adapter واحد ومجال واحد و6–12 مستهلكاً غير مالياً في الدفعة. المالية وHR المالي وإدارة الصلاحيات تكون عائلة command واحدة، مع HTTP/RLS/idempotency/reversal/audit؛ لا تختصر هذه الضمانات.

يلغى الطلب الجاري وتمسح selection/cache/pages عند تبدل المستخدم أو الشركة أو الدور/الجلسة. لا يحول DatePicker تاريخ ISO أو business date عبر UTC، ولا يغير adapter API أو payload أو تاريخ العمل أو قرار الخادم.

**مخرج المرحلة:** لا نموذج أو اختيار بحثي أو تاريخ عمل في الموديول بلا قرار وسجل اختبار.

### المرحلة 2 — البيانات والعرض

تصنيف كل جدول وقراءة وKPI في الموديول:

- `DataTable` للجدول القصير؛ `BaseerDataGrid` فقط عند 100 صف ظاهر، أو paging/server sort/filter، أو مشكلة قياس مثبتة.
- `BaseerDataGrid` لا يستقبل سجلاً كبيراً قبل server mode: cursor scoped وlimit وallow-list للفرز/المرشحات وstable tie-breaker. لا sort/filter محلي على صفحات جزئية.
- TanStack Query للقراءات المشتركة أو cache/invalidation فقط؛ لا يحول UI effects أو draft form. يسجل key وTTL وcache policy وcancel/invalidate، ويختبر تبديل user/role داخل الشركة.
- التقرير المالي الرسمي يبقى ReportRun/snapshot متخصصاً، ولا يفرز أو يجمع في المتصفح.
- كل Chart/KPI يستخدم `BaseerChart` lazy مع summary وtable من نفس snapshot وعقد `metricCode` و`definitionVersion` و`asOf` وcurrency/timezone/dataQuality/drill-down. الرسم المالي لا يعتمد JavaScript number كقيمة مرجعية.

**مخرج المرحلة:** لكل قراءة وجدول ومؤشر قرار أداء وعزل ومصدر حقيقة.

### المرحلة 3 — الإغلاق عبر المتصفح والتنظيف

تطبيق بوابة الإغلاق على كل قسم وتبويب: العربية RTL والإنجليزية LTR، سطح المكتب والجوال، happy/invalid/denied/server-error، keyboard/focus/escape، وتبديل الشركة/المستخدم عند الحاجة. ثم E2E/Axe وcheck/build/budget/audit من SHA محدد.

يحذف القديم فقط بعد أن يثبت architecture gate أن مستهلكيه صفر. يحدث manifest وسجل الإغلاق ويعلن الموديول `Closed` أو يبقى مفتوحاً مع استثناء محدود له مالك وتاريخ انتهاء.

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

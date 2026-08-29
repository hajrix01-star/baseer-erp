# مصفوفة تغطية الأسطح والمسافات — 2026-08-29

هذه المصفوفة سجل إغلاق لمرحلة **الحصر ثم الترحيل**. راجعت كل صفحة معرفة في `page-registry.ts` (53 صفحة)، مع المكونات المشتركة والتبويبات والحاويات التي ترث منها. لا تعني خانة «تمت المراجعة» اختبار دخول حي؛ فجلسة المتصفح المحلية لا تملك بيانات اعتماد. لذلك يلزم تنفيذ جولة قبول بصرية مسجلة بعد تسجيل الدخول قبل إعلان الإغلاق التشغيلي.

**القرار المحدث:** استبدلت صور خلفيات الـLauncher بألوان هادئة قابلة للاختيار؛ تبقى `.module-page` شفافة كي يظهر اللون الموحد بين الأسطح الداخلية الصلبة.

| الوحدة | الصفحات التي تمت مراجعتها | نمط السطح/التبويبات المعتمد | الحالة |
| --- | --- | --- | --- |
| مركز القيادة | `command-money-marketing`, `command-calendar`, `command-analytics` | `BaseerCard`/الشبكات وتوكنات مساحة الصفحة | مراجع ومهاجر |
| مركز القيادة | `command-owner-notebook` | استثناء «دفتر/ورقة» موثق؛ التباعد فقط أصبح دلالياً | مراجع، استثناء مقصود |
| القرار | `decision-overview`, `decision-timeline`, `decision-alerts`, `decision-data-quality`, `decision-sources-policies`, `decision-interpretations` | `BaseerWorkspaceTabs` و`BaseerCard`/أسطح دلالية | مراجع ومهاجر |
| التسويق | `marketing-overview`, `marketing-calendar`, `marketing-campaigns`, `marketing-reputation`, `marketing-sources-policies` | `BaseerWorkspaceTabs` و`BaseerCard`/أسطح دلالية | مراجع ومهاجر |
| الأدلة الواردة | `evidence-overview`, `evidence-labels`, `evidence-sources` | المكونات المشتركة ومسافة الصفحة | مراجع ومهاجر مركزياً |
| العمليات | `operations-overview`, `operations-sales`, `operations-purchases`, `operations-expenses-obligations`, `operations-suppliers` | بطاقات، ملخصات، جداول وتباعد قسم دلالي | مراجع ومهاجر |
| العمليات | `operations-catalog` | rails الكتالوج وبطاقة الصنف والجداول | مراجع ومهاجر |
| العمليات | `operations-execution`, `operations-internal-registration` | نموذج/سلة/بحث/تقارير بأسطح صلبة | مراجع ومهاجر |
| العمليات | `operations-reports`, `operations-assets-warranties` | تقارير/جداول متخصصة ومكونات مشتركة | مراجع ومهاجر |
| المالية | `finance-ledger`, `finance-treasury`, `finance-accounts`, `finance-categories`, `finance-settings` | المكونات المشتركة؛ ألوان المدين/الدائن تظل دلالية لا أسطح حاوية | مراجع ومهاجر مركزياً |
| الموارد البشرية | `hr-overview`, `hr-employees`, `hr-leave`, `hr-payroll`, `hr-advances-deductions`, `hr-services`, `hr-salary-tools` | حاويات HR والجداول والحوارات بأسطح وتباعد دلالي | مراجع ومهاجر |
| الموارد البشرية | `hr-attendance` | rail/لوحات الحضور وجداول التقارير؛ مسار PWA الكثيف للمس استثناء مستقل | مراجع، استثناء PWA موثق |
| التقارير | `reports-overview`, `reports-financial`, `reports-vat`, `reports-hajri-tax`, `reports-documents` | حاويات التقارير وVAT والمحاكاة والجداول | مراجع ومهاجر |
| الإدارة | `administration-overview`, `administration-companies`, `administration-users`, `administration-roles`, `administration-identity-basira` | حاويات الإدارة وتبويبات بصيرة والجداول | مراجع ومهاجر |
| الإدارة | `administration-backup`, `administration-nurix-migration` | لوحات إدارة متخصصة؛ أسطح ومسافات دلالية | مراجع ومهاجر |

## عناصر مشتركة تم فحصها

| العنصر | الموضع | نتيجة الإغلاق |
| --- | --- | --- |
| سطح الصفحة | `styles.css` | توكنات `--app-canvas`, `--content-canvas`, `--surface-raised`, `--surface-subtle` ومسافات الصفحة موجودة؛ اللون المختار يطبق مركزياً. |
| البطاقة | `BaseerCard` وقواعده | سطح معتم وحدود دلالية وpadding موحد. |
| الجدول | `BaseerDataTable` و`BaseerDataGrid` | غلاف ورأس جدول من `--surface-raised` و`--table-header`؛ جداول المحررات المخصصة فحصت كاستثناءات وظيفية. |
| تبويب مساحة العمل | `BaseerWorkspaceTabs` | rail صلب وحدود وفاصل ومحتوى متصل بالتبويب النشط. |
| تبويبات محلية | الكتالوج، بطاقة الصنف، الحضور، بصيرة | رُبطت بتوكنات rail/active/border؛ لا خلفية شفافة غير مقصودة في سياق المحتوى. |
| الحوارات والنماذج | HR/العمليات/الإدارة | الأسطح والحدود ومسافات الرأس/المحتوى رُحلت ضمن الملفات المالكة. |

## بروتوكول القبول النهائي

1. الدخول بحساب لديه صلاحية كل وحدة؛ فتح كل صف في الجدول أعلاه بالعربية والإنجليزية.
2. فحص Desktop (1440px)، Laptop (1024px)، وهاتف (390px) مع RTL/LTR ووضع فاتح/داكن.
3. لا يقبل وجود صورة أو شفافية داخل حاوية بيانات أو rail تبويب أو غلاف جدول؛ اللون الهادئ الموحد بين الأقسام متوقع.
4. تسجيل لقطة مرجعية لكل لون معتمد والتأكد من وضوح النص في الوضعين الفاتح والداكن.

## نتيجة إعادة التقييم المستقل

أعيد الفحص بعد الترحيل. لم يجد المراجع حاويات بيانات أو rails تبويب شفافة غير مبررة في الطبقات التي شملها القرار. وقد عولجت مباشرةً حالات الـStepper المالي، Toolbar التقارير، وأغلفة جداول مركز القيادة وPOS والرواتب. الاستثناءات السليمة فقط: دفتر المالك، واجهة PWA للحضور الكثيفة للمس، وأدوات محرر roster/schedule المضغوطة. جولة اللقطات الحية الكاملة تظل بوابة قبول تتطلب حساباً مخولاً؛ لا تُستبدل بالمراجعة الثابتة أو اختبارات الـmock.

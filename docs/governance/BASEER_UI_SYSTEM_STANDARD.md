# معيار واجهة بصير المركزي

## القرار

واجهة بصير تستخدم نظام تصميم مركزي واحد للجوال والكمبيوتر. لا ينشأ موديول جديد بأزرار أو حقول أو جداول أو كروت أو نافذة حوار مستقلة.

## المقاييس المعتمدة

- النص المساعد: `12px`.
- الوسوم والعناوين الثانوية: `13px` على سطح المكتب.
- النص والحقول والأزرار: `14px` على سطح المكتب.
- العنوان الفرعي: `18px`، والعنوان المهم: `20–24px` حسب مستوى الصفحة.
- سطح المكتب يستخدم كثافة مهنية: ارتفاع الحقل والزر الافتراضي `36px`، وصف الجدول القياسي `36–40px`.
- الجوال أو مؤشر اللمس يستخدم ارتفاع `44px` للحقل والزر، ولا يُصغّر هدف اللمس من أجل الكثافة.
- الـShell المكتبي منفصل عن حيز الشعار: الشعار يقيم في رأس القائمة الجانبية (`64px`) ولا يفرض ارتفاع الهدر. الهدر `56px`، وصف التنقل `40px`، ونصه `13px` بوزن 500 (650 للحالة النشطة). في الجوال يبقى الهدر وصف التنقل `44px` على الأقل.
- عنوان الصفحة المكتبي `24–30px` بوزن 700؛ breadcrumb وعناصر الهدر الثانوية بوزن 500–600. لا تستخدم أوزان 800+ لمجرد إبراز عناصر التنقل.
- الأوزان: النص العادي `400–500`، الوسم `600–650`، العنوان أو الرقم المالي المهم `700`، ولا يستخدم `800+` إلا لشعار أو حالة استثنائية مبررة.
- المسافات المركزية: `4 / 8 / 12 / 16 / 24px`؛ لا تضيف الوحدة فراغاً كبيراً لمجرد الزينة.
- الخط: `Noto Sans Arabic Variable`، ويليه `IBM Plex Sans Variable` للنص اللاتيني والأرقام.

هذه القاعدة تأخذ من أودو **كثافة العمل وانضباطه** لا ألوانه أو CSS الخاص به: سطح المكتب يعرض معلومات أكثر بوضوح، بينما يبقى الجوال مريحاً للمس.

## المكونات المعتمدة

| الحاجة | المكوّن أو القاعدة |
| --- | --- |
| كرت | `BaseerCard` / `.baseer-card` |
| جدول | `DataTable` / `.baseer-data-table` |
| زر | `BaseerButton` / `.baseer-button` |
| حقل | قواعد الحقول المركزية في styles.css |
| اختيار متعدد | input[type=checkbox] مركزي بقياس 18px × 18px؛ لا يوسّع إلى عرض الحقل أو مساحة البطاقة |
| تاريخ قيد / تاريخ فاتورة | `input type="date"` الأصلي: تقويم المتصفح وسرعة إدخال موحّدة |
| فلتر فترة | `BaseerPeriodFilter`: يوم/شهر (واحد أو أكثر)/ربع/سنة/نطاق، ثم «تطبيق» |
| شريط فلاتر قائمة | `BaseerFilterBar` مع `BaseerFilterSelect` و`BaseerFilterToggle`: بحث، فلاتر سياقية، شرائح للفلاتر المطبقة، إزالة فردية ومسح الكل |
| اختيار قائمة طويلة | `BaseerSearchSelect` أو `BaseerFilterAutocomplete`: مربع بحث واقتراحات مملوك لبصير (لا قائمة متصفح أصلية) يعرض الاسم المحلي ويعيد معرف السجل الثابت للخادم |
| نافذة | طبقة الحوار المركزية (`daily-sales-dialog-backdrop` وعقد الحوار) |
| حالة | شارة الحالة المركزية (`daily-sales-badge` وعقد الحالات) |

## قواعد التنفيذ

1. يستخدم أي موديول جديد المكوّن المركزي أولاً، ولا يكرر CSS للألوان أو الزوايا أو المقاسات الأساسية.
2. النصوص تبدأ من جهة اللغة؛ الأرقام والمبالغ تستخدم `dir="ltr"` ومحاذاة رقمية.
3. الجداول قابلة للتمرير أفقيًا على الجوال ولا تُخفي بياناتها.
4. الأزرار الخطرة تبقى حمراء ولا تستخدم للإغلاق؛ الإغلاق يكون بزر × أو زر إغلاق محايد.
5. مصدر الألوان والمسافات والارتفاعات هو CSS tokens في `apps/web/src/styles.css`.
6. أي استثناء بصري يجب أن يقتصر على محتوى الموديول، لا أن يغيّر شكل المكوّن الأساسي.
7. التأكيدات تستخدم BaseerConfirmDialog؛ يمنع window.confirm في الواجهة.
8. النصوص المشتركة تأتي من قاموس مركزي؛ لا تكرر نصوص الإغلاق والإلغاء وحالات المعالجة.
9. التنقل والأزرار تسترشد بصلاحيات الشركة الحية لإخفاء ما لا يتاح؛ الخادم يعيد التحقق من كل طلب ولا تعتمد الحماية على الواجهة.
10. كل نص يراه المستخدم يأتي من مفتاح ترجمة مركزي للعربية والإنجليزية، ويشمل العناوين والحقول والأزرار والخيارات ورسائل الخطأ وحالات التحميل والطباعة والتصدير.
11. البيانات الأساسية تحمل اسم عرض عربي وإنجليزي متى كانت من بصير (شركة، بند، مورد، فئة، تصنيف). الكود والمعرّف والرقم المالي حقائق ثابتة ولا تترجم. البيانات المرحّلة التي ينقصها اسم إنجليزي توسم صراحة وتدخل قائمة استكمال، ولا تستبدل بقيمة مخمّنة.
12. لا يقبل القسم عند اختيار EN إذا بقيت محتويات الأعمال عربية بلا سبب بيانات موثق؛ يثبت ذلك باختبار عربي/إنجليزي وRTL/LTR.
13. تحفظ لغة الواجهة فقط محلياً بمفتاح `baseer.ui.locale.v1` وتستعاد بعد إعادة التحميل؛ لا تخزن معه الجلسة أو الصلاحيات أو الشركة أو أي بيانات مالية.
14. تاريخ القيد وتاريخ الفاتورة وكل تاريخ لإدخال عملية يستخدم اختياراً فورياً: النقر على اليوم يثبت التاريخ ويغلق `BaseerDatePicker` بلا زر «تطبيق». زر «تطبيق» خاص بـ`BaseerPeriodFilter` وحده، لأنه يغيّر نطاقاً زمنياً للتقارير والسجلات لا تاريخ عملية مفردة.
15. فلترة البيانات حسب الوقت تستخدم `BaseerPeriodFilter`، ولا تستعمل حقل تاريخ منفرداً مكان فترة التقرير.
16. لا تتغير قاعدة الخادم: منع التاريخ المستقبلي وتاريخ العمل والتحقق المحاسبي مسؤولية الخادم مهما اختلف شكل الحقل.
17. أي قائمة أو سجل قابل للتصفية يستعمل `BaseerFilterBar` بدلاً من عناصر `input` و`select` وcheckbox متناثرة. يضع المكوّن البحث والفلاتر السياقية في شريط واحد؛ في القوائم الكثيفة تستخدم الفلاتر وضع القائمة المنبثقة المدمج مع حقل البحث وتغلق بالنقر خارجه أو Esc. يعرض الفلاتر الفعالة في صف ثانٍ قابلة للإزالة، ويعرض «مسح الكل» فقط عند وجود فلتر فعّال.
18. فلاتر الشركة والفترة تظل خادمية ومرتبطة بـ`BaseerPeriodFilter`؛ شريط الفلاتر لا يحسب أرقاماً مالية ولا يبدل نطاق التفويض.
19. تستخدم القوائم الديناميكية الطويلة (مثل المورد أو الفئة أو العميل) `BaseerSearchSelect` في النماذج والجداول و`BaseerFilterAutocomplete` في الفلاتر؛ أما الخيارات القصيرة والثابتة (مثل الحالة والنوع) فتستخدم `BaseerFilterSelect`. الاختيار التلقائي يعرض الاسم فقط لكنه يرسل المعرّف الثابت إلى الخادم. تظهر شرائح الفلاتر المطبقة دائماً في صف ثانٍ مستقل عن أدوات الفلترة. الشاشات غير القائمة لا تضيف بحثاً شكلياً؛ تستخدم فلتر الفترة المركزي فقط متى كان لها مصدر زمني.
20. أسهم القوائم المملوكة لواجهة Baseer تستخدم المثلث المغلق ▾؛ لا تستخدم علامة V المفتوحة لتمييز القائمة المنسدلة.

## بوابة التسليم

قبل إغلاق أي قسم واجهة: تحقق من استخدام المكونات المركزية، ومن قابلية الجوال، ومن عدم وجود حجم خط أو لون أو كرت أو جدول مستقل بلا سبب موثق. أضف اختبار Playwright لمسار لوحة المفاتيح/الـEscape والاتجاهات عند تغير التنقل أو الحوار، ثم اختبارات authenticated/visual للمسارات ذات البيانات.
## Release-budget rule (2026-08-18)

The production web budget measures a real user journey from the Vite manifest: **250 KB startup JavaScript**, **85 KB largest additional workspace JavaScript**, **58 KB startup CSS**, and **16 KB largest additional workspace CSS** (raw generated assets). Cache totals are reported for observability only; they are not release gates because a user opens one workspace journey at a time, not every lazy module together.

Shared shell rules remain in `styles.css`. Feature styles that are not needed at startup live beside their owning shared component or workspace and load with that feature. Any threshold increase still requires removing duplicate rules or a new explicit UI-system decision; the preferred response is route splitting or consolidation, not raising a global limit.

### Stable navigation state

The application shell is the single owner of stable navigation state. It writes the current module and section to the URL hash as `#module=<id>&section=<index>` and may add a validated `stage` for a durable workspace tab. A refresh therefore restores the same place; if a hash is absent, the same browser session may restore the last valid route. Signing out clears that session route.

Only durable navigation is restored. Draft financial rows, dialog visibility, search text, and unsaved forms are deliberately not persisted or replayed after refresh.

## Central authentication shell — 2026-08-18

- `BaseerLogin` is the only unauthenticated web landing. It provides username/email sign-in, password visibility, loading/error feedback, Arabic/English display, and server-authorized company choice.
- A signed-in header exposes an explicit sign-out action instead of a placeholder profile action. It calls the audited server sign-out endpoint best-effort and always clears the current device session.
- The login surface uses existing central layout, button, field, brand, theme, and localization primitives; it must not introduce a second design system or persist secrets outside `sessionStorage`.

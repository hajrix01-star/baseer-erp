# معيار واجهة بصير المركزي

## القرار

واجهة بصير تستخدم نظام تصميم مركزي واحد للجوال والكمبيوتر. لا ينشأ موديول جديد بأزرار أو حقول أو جداول أو كروت أو نافذة حوار مستقلة.

## المقاييس المعتمدة

- النص المساعد: `12px`.
- الوسوم والعناوين الثانوية: `14px`.
- النص والحقول والأزرار: `16px`.
- العنوان الفرعي: `20px`.
- العنوان المهم: `24px`.
- ارتفاع التحكم الافتراضي: `44px`، مع استثناء موثق فقط للعناصر الكثيفة داخل نافذة إدخال صغيرة.
- الخط: `Noto Sans Arabic Variable`، ويليه `IBM Plex Sans Variable` للنص اللاتيني والأرقام.

## المكونات المعتمدة

| الحاجة | المكوّن أو القاعدة |
| --- | --- |
| كرت | `BaseerCard` / `.baseer-card` |
| جدول | `DataTable` / `.baseer-data-table` |
| زر | `BaseerButton` / `.baseer-button` |
| حقل | قواعد الحقول المركزية في styles.css |
| اختيار متعدد | input[type=checkbox] مركزي بقياس 18px × 18px؛ لا يوسّع إلى عرض الحقل أو مساحة البطاقة |
| تاريخ قيد / تاريخ فاتورة | `input type="date"` الأصلي: تقويم المتصفح وسرعة إدخال موحّدة |
| فلتر فترة | `BaseerPeriodFilter`: يوم/شهر/أشهر/ربع/سنة/نطاق، ثم «تطبيق» |
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
## Release-budget rule (2026-08-16)

The production web budget is **250 KB startup JavaScript**, **85 KB largest additional route journey**, **225 KB total cacheable lazy JavaScript**, and **62 KB CSS** (raw generated assets). A Vite manifest is required so the gate measures a real user journey: startup is measured alone, a workspace is measured with its additional imports only, and aggregate lazy code remains separately bounded. The CSS ceiling covers the shared bilingual RTL/LTR application stylesheet. Any future increase requires removal of duplicate rules or a new explicit UI-system decision; the compressed CSS target remains below 11 KB.

## Central authentication shell — 2026-08-18

- `BaseerLogin` is the only unauthenticated web landing. It provides username/email sign-in, password visibility, loading/error feedback, Arabic/English display, and server-authorized company choice.
- A signed-in header exposes an explicit sign-out action instead of a placeholder profile action. It calls the audited server sign-out endpoint best-effort and always clears the current device session.
- The login surface uses existing central layout, button, field, brand, theme, and localization primitives; it must not introduce a second design system or persist secrets outside `sessionStorage`.

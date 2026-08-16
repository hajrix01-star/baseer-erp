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
| حقل | قواعد الحقول المركزية في `styles.css` |
| نافذة | طبقة الحوار المركزية (`daily-sales-dialog-backdrop` وعقد الحوار) |
| حالة | شارة الحالة المركزية (`daily-sales-badge` وعقد الحالات) |

## قواعد التنفيذ

1. يستخدم أي موديول جديد المكوّن المركزي أولاً، ولا يكرر CSS للألوان أو الزوايا أو المقاسات الأساسية.
2. النصوص تبدأ من جهة اللغة؛ الأرقام والمبالغ تستخدم `dir="ltr"` ومحاذاة رقمية.
3. الجداول قابلة للتمرير أفقيًا على الجوال ولا تُخفي بياناتها.
4. الأزرار الخطرة تبقى حمراء ولا تستخدم للإغلاق؛ الإغلاق يكون بزر × أو زر إغلاق محايد.
5. مصدر الألوان والمسافات والارتفاعات هو CSS tokens في `apps/web/src/styles.css`.
6. أي استثناء بصري يجب أن يقتصر على محتوى الموديول، لا أن يغيّر شكل المكوّن الأساسي.

## بوابة التسليم

قبل إغلاق أي قسم واجهة: تحقق من استخدام المكونات المركزية، ومن قابلية الجوال، ومن عدم وجود حجم خط أو لون أو كرت أو جدول مستقل بلا سبب موثق.
## Release-budget rule (2026-08-16)

The production web budget is **300 KB JavaScript** and **52 KB CSS** (raw generated assets). The CSS ceiling covers the one shared bilingual RTL/LTR application stylesheet and leaves only 4 KB of headroom above the audited baseline. Any increase requires removal of duplicate rules or an explicit UI-system decision; the compressed CSS target remains below 10 KB.
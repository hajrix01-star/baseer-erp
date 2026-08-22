# ADR-UI-001 — React Aria Components لــBaseerCombobox

**الحالة:** معتمد لدمج المصدر وتجربة محلية واحدة فقط بموجب استثناء مالك ينتهي في **2026-09-05**؛ لا إصدار أو إنتاج بينما P1 في [سجل Phase 0](UI_PLATFORM_ENABLEMENT_PHASE_0_RECORD_2026-08-22.md) مفتوحة.

## السياق

`BaseerSearchSelect` الحالي يعيد تنفيذ البحث البعيد، القائمة، portal، التركيز، وإدارة الأحداث يدوياً. لا يحقق جميع سلوكيات Combobox القياسية للوحة المفاتيح، ولا يملك إلغاء طلب البحث القديم عبر `AbortSignal` في عقده الحالي.

المطلوب ليس تغيير شكل بصير، بل استبدال الآلية العامة خلف مكوّن مركزي واحد وغير مالي.

## القرار المرشح

عند إغلاق بوابات Phase 0، يثبت فقط:

```text
react-aria-components@1.20.0
```

لا يستخدم `latest` أو range في قرار الـpilot. يبقى الاستيراد داخل `BaseerCombobox` وفي مسار HR المؤجل، ولا يستورد من `App.tsx` أو أي شاشة مباشرة.

## تحقق الاعتماد

تم الاستعلام من npm registry في 2026-08-22:

| بند | نتيجة |
| --- | --- |
| الترخيص | Apache-2.0 |
| peer React وReact DOM | يقبل React 19؛ المشروع يستخدم React/React DOM 19.1.1 |
| التبعيات المباشرة للمكتبة | `react-aria@3.51.0`، `react-stately@3.49.0`، `@internationalized/date`، `@internationalized/string`، `@react-types/shared`، `@swc/helpers` و`client-only` |
| CSS أو theme مفروض | لا؛ يبقى CSS بصير وtokens الخاصة به |
| شبكة أو telemetry | لا يضاف SDK أو CDN أو خدمة خارجية ضمن هذا القرار |

قبل الدمج يعاد تنفيذ فحص اعتماد التشغيل الفعلي `npm audit --omit=dev --omit=optional` وDependency Review على الـlockfile الناتج. يعاد أيضاً تسجيل فحص build/migrate الكامل؛ الاستثناء الصريح لهذه الـP1 لا يجيز إصداراً أو توسيع نطاق.

## حدود الـpilot

- **المستهلك الوحيد:** مرشح الموظف في شريط فلترة «الإجازات والعودة» في `HrLeaveWorkspace`؛ لا يشمل حقل الموظف في نموذج إنشاء الإجازة.
- `value` يبقى `string` يمثل identifier، ولا يتغير عقد API أو بيانات الموظف.
- يتغير `remoteSearch` إلى `(query, signal) => Promise<options>`، ويجب تمرير signal حتى طبقة `api()`.
- يستخدم debounce وإلغاء الطلب وحماية سباق النتائج. تبديل الشركة أو تسجيل الخروج يمسح الاختيار/النتيجة ولا يسمح بنتيجة قديمة بالظهور.
- لا تعديل للـAPI أو RLS أو الصلاحيات في هذا الـpilot.

## معايير قبول وإزالة

1. يمر `check`, `build`, `verify:web-budget`, وحراس architecture/dialog/financial/localization وE2E ذات الصلة.
2. يثبت AR/EN وRTL/LTR، keyboard: Tab/Shift+Tab والأسهم وHome/End وEnter وEscape مع عودة focus، mouse/touch، loading/empty/error، وشاشة ضيقة.
3. يثبت اختبار عدم تقاطع النتائج بين الشركات وعدم بقاء نتيجة بحث ملغاة أو جلسة منتهية.
4. يقاس أثر bundle بعد التثبيت. أكبر route JavaScript الحالي هامشه 557 بايت فقط؛ إذا دخلت المكتبة في رحلة البداية أو تجاوز المسار المحدد الحد، يرفض التغيير أو يعاد تقسيمه. ولأن الـadapter مؤجل حتى فتح قائمة الفلاتر، يفرض `verify:web-budget` حداً مستقلاً `200,000 B` على chunk `baseer-combobox` التفاعلي.
5. يزال الـadapter والاعتماد إذا لم يقلل كلفة الصيانة أو إذا أخفق في RTL/keyboard/الحجم؛ ولا يزال `BaseerSearchSelect` القديم قبل ترحيل كل مستهلكيه واختبار تكافؤهم.

## البدائل المرفوضة حالياً

| البديل | سبب عدم الاختيار الآن | متى يعاد تقييمه |
| --- | --- | --- |
| إبقاء كل Combobox يدوياً | يترك دين keyboard/focus/portal الحالي | إذا أثبت pilot أن المكتبة أسوأ أو أثقل |
| Radix | جيد للـDialog/Menu/Popover، لكن ليس اختيار الـCombobox الأول في الخطة | بعد pilot إذا ظهرت حاجة بدائية لا يغطيها React Aria |
| React Spectrum | يفرض طبقة تصميم أوسع من حاجة بصير | فقط عند قرار نظام تصميم جديد صريح |
| MUI/Ant/Tailwind template | CSS ونظام هوية منافسان وزيادة هجرة | لا يعاد تقييمه إلا بقرار هوية ومنتج منفصل |

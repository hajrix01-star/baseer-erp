# دليل الإقفال المحلي قبل الـcommit — توحيد واجهة بصير

**الحالة:** Local technical closure — ليس سجل قبول نهائيًا
**التاريخ:** 2026-08-25
**النطاق:** توحيد البنية والمكوّنات والعقود والحواجز الآلية للواجهة.

## ما أُغلق محليًا

- `BaseerAppShell` و`BaseerNavigationDrawer`: طبقة portal موحدة، دلالات dialog، إدارة focus، استعادة focus، backdrop وscroll-lock، مع اختبار Desktop وPixel 5 في RTL وLTR.
- `BaseerCombobox` وواجهات التوافق: عقد لوحة المفاتيح وARIA وoverlay وحالات البيانات البعيدة موثق ومتحقق منه.
- `BaseerDatePicker`: واجهة واحدة دلالية أصلية ضمن API موحّد؛ حجم runtime بعد التحميل المتأخر **661 B** ضمن حد **200,000 B**.
- `BaseerAsyncState`: حالات loading وempty وerror وstale وretry موحدة ومستخدمة في سطح حوكمة بصيرة.
- طبقات overlay: `base`, `sticky`, `portalPopover`, `navigationDrawer`, `modal`, `toast` معرفة بمصدر واحد.
- القوائم والتبويبات والأزرار وحقول الإدخال: العقود المصرح بها محكومة بالسجل والـratchets؛ تصحيح حالة اللون في Owner Daily Brief لتتوافق مع `aria-pressed`.

## أدلة بوابات محلية

| البوابة | النتيجة المحلية |
| --- | --- |
| `npm run check:ui-governance-registers` | PASS — 42 مكوّنًا و5 استثناءات موثقة |
| `npm run check:ui-native-control-ratchet` | PASS |
| `npm run check:ui-inline-style-ratchet` | PASS |
| `npm run check --workspace @baseer-erp/web` | PASS |
| `npm run build --workspace @baseer-erp/web` | PASS |
| `npm run verify:web-budget` | PASS — startup 246,456/251,000 B؛ أكبر JS 90,035/95,000 B؛ CSS 63,278/65,000 B |
| Drawer E2E + Axe + visual | PASS محليًا: Desktop وPixel 5، RTL وLTR؛ حالات التخطي المقصودة موثقة في الاختبار |
| Async state E2E | PASS محليًا: Desktop وPixel 5 |
| DatePicker HR/Finance checks | PASS محليًا في Desktop وPixel 5 |
| Basira visual/interaction checks | PASS محليًا بعد تثبيت mock الحوكمة واختيار mobile semantics |

## قرار اللجنة المحلية

راجعت لجنة الهندسة المستقلة التنفيذ مقابل الدستور والسجل، وقرارها: **لا يوجد مانع تقني محلي يستدعي العودة للبناء**. أزيلت الملاحظات القديمة التي كانت تصف عقودًا مكتملة على أنها P0 مفتوحة؛ السجل الآن يعبر عن حالتها الفعلية.

## ما لا يصح ادعاؤه قبل الإقفال الرسمي

لا يصدر ملف `Final Acceptance Record` ولا عبارة `Final Pass` قبل تحقق الشروط الخارجية التالية:

1. إنشاء commit محدد وكتابة SHA الكامل في اسم سجل القبول.
2. نجاح workflow الكامل لذلك الـSHA في CI، ويشمل Playwright/Axe/visual كاملًا.
3. ربط فرق GitHub الحقيقية في `CODEOWNERS` وتفعيل branch protection/ruleset: required checks، code-owner review، ومنع bypass غير المصرح.

هذه عناصر منصة GitHub مرتبطة بسلطة الإصدار وليست فجوة في تنفيذ الواجهة المحلية. بعد تحققها، ينسخ الدليل إلى `UI_FINAL_ACCEPTANCE_RECORD_<SHA>.md` ويوقع مالك UI Platform وPrincipal Engineer.

# سجل قبول مطابقة واجهة الثيمين الحديثين

> **قرار منتج — 2026-09-01:** هذا السجل يحفظ تاريخ المقارنات السابقة فقط.
> التطبيق يعمل الآن بواجهة `modern-3` الإدارية وحدها؛ حُفظت ألوان العروض
> السابقة كتوكنات مستقلة في
> `docs/foundation/MODERN_ADMIN_COLOR_PALETTES_2026-09-01.md`. لا تُستخدم
> المراجع إلى `modern-1` و`modern-2` أدناه كعقد قبول نشط.

الحالة: مفتوح — لا يثبت هذا السجل أن المطابقة مكتملة.
المرجع البصري: `gpt-modern-dashboard/app/page.tsx` و`app/globals.css` و`app/theme-extensions.css`.
نطاق التغيير: واجهة بصير فقط؛ لا يغير هذا السجل الصلاحيات أو البيانات أو سلوك المحاسبة.

## تعريف القبول

لا يسمى `modern-1` أو `modern-2` «مطابقًا 100%» إلا إذا تحققت كل البنود التالية:

1. كل صفحة مصادق عليها ضمن النطاق أدناه تفتح في الثيمين، بلا `pageerror` أو تجاوز أفقي أو عنصر تحكم مخفي غير مقصود، على سطح المكتب والجوال، RTL، والوضع الداكن.
2. لكل صفحة تسمح بالتنقل، يظهر الهيدر مع تبديل الشركة واختيار الواجهة، ويظهر A/B (الشجرة / الموديولات) عندما تكون الواجهة الحديثة مفعّلة. الصفحات المستثناة تسجل سببًا واختبارًا بديلًا أدناه.
3. تنقل A/B لا يعرض إلا الموديولات والصفحات والمراحل المستقرة التي تسمح بها `pageRegistry` و`module-access`. كل مرحلة URL مستقرة لها تبويب أو تقرر صراحة أنها إجراء/حوار لا تبويب.
4. `modern-1` يحقق قياسات المرجع المشتركة: هيدر 70px، شريط جانبي 257px، مساحة محتوى قصوى 1440px، ومؤشرات 144px/13px/17px. `modern-2`: هيدر 56px، شريط 214px، محتوى بلا حد أقصى، ومؤشرات 118px متصلة. تقاس هذه القيم آليًا في سطح المكتب.
5. لا يحتوي CSS الخاص بالواجهة على لون ثابت يؤدي دورًا بصريًا قابلًا للثيم (هوية/سطح/حد/سلسلة رسم/نجاح/خطر) ما لم يكن متغيرًا دلاليًا موثقًا. الألوان الثابتة داخل بيانات صورة أو حالة دلالية لا تتغير بالتصميم توثق بوضوح.
6. توجد لقطات مرجعية قابلة للمقارنة لسطح المكتب والجوال لكل عائلة مساحة عمل، ومراجعة بشرية تؤكد اختلاف الهيكل بين الثيمين وليس اللون فقط.

## تغطية الطرق

`pageRegistry` يحتوي 53 صفحة في تسعة موديولات. كل هذه الصفحات تتلقى غلاف `ModuleWorkspace` و`data-ui-theme`، لكن ذلك ليس دليل قبول لمحتواها الخاص.

| الموديول | الصفحات | حالة الغلاف الحديث | حالة قبول المحتوى |
| --- | --- | --- | --- |
| مركز القيادة (4) | `command-money-marketing`, `command-calendar`, `command-analytics`, `command-owner-notebook` | مغطى | مفتوح: ألوان ثابتة مثبتة في أسطح مركز القيادة والتحليلات/لوحة المالك لم تفحص بلقطات قبول. |
| مركز القرار والسياق (6) | `decision-overview`, `decision-timeline`, `decision-alerts`, `decision-data-quality`, `decision-sources-policies`, `decision-interpretations` | مغطى | مفتوح: لا اختبار منظر حديث لعائلة القرار. |
| التسويق والسمعة (5) | `marketing-overview`, `marketing-calendar`, `marketing-campaigns`, `marketing-reputation`, `marketing-sources-policies` | مغطى | مفتوح: لا اختبار منظر حديث لعائلة التسويق. |
| البريد والأدلة (3) | `evidence-overview`, `evidence-labels`, `evidence-sources` | مغطى | مفتوح: لا اختبار منظر حديث لعائلة الأدلة. |
| العمليات (10) | `operations-overview`, `operations-sales`, `operations-purchases`, `operations-expenses-obligations`, `operations-suppliers`, `operations-catalog`, `operations-execution`, `operations-internal-registration`, `operations-reports`, `operations-assets-warranties` | مغطى | مفتوح: عدة مكونات تشغيلية ذات CSS خاص؛ انظر الاستثناء الآتي. |
| المالية والمحاسبة (5) | `finance-ledger`, `finance-treasury`, `finance-accounts`, `finance-categories`, `finance-settings` | مغطى جزئيًا | ربطت حالات الحسابات/السجل الآمنة بـ`record`؛ الخزائن والدفتر المكتمل ما زالا يحتاجان fixture بيانات وقياس هندسة. |
| الموارد البشرية (8) | `hr-overview`, `hr-employees`, `hr-leave`, `hr-payroll`, `hr-advances-deductions`, `hr-services`, `hr-salary-tools`, `hr-attendance` | مغطى | مفتوح: واجهات HR/الحوارات والـroster لها CSS خاص غير مقبول بعد. |
| التقارير (5) | `reports-overview`, `reports-financial`, `reports-vat`, `reports-hajri-tax`, `reports-documents` | مغطى جزئيًا | overview/documents تستخدم `record` وVAT يستخدم `form-or-receipt`/`joined-ledger`. لوحة التقرير المالي وdrawer مستثنيان بقياس مخصص مفتوح. |
| الإدارة (7) | `administration-overview`, `administration-companies`, `administration-users`, `administration-roles`, `administration-identity-basira`, `administration-backup`, `administration-nurix-migration` | مغطى | مفتوح: لا اختبار منظر حديث لعائلة الإدارة/الترحيل. |

## المسارات المستثناة وقرارها المطلوب

| المسار | الحالة الحالية | القرار المطلوب قبل الإغلاق |
| --- | --- | --- |
| `operations-internal-registration` لغير المالك | الغلاف الحديث موجود، لكن `App.tsx` يمرر `navigation: false` لحماية محطة الموظف؛ لا تظهر شجرة A/B أو drawer. | اعتماد استثناء أمني صريح، أو تصميم تنقل محدود آمن. لا يترك غير محسوم. |
| صفحة المشغّل بلا مسار (`ModuleLauncher`) | اختيار الثيم موجود؛ لا توجد شجرة A/B لعدم وجود صفحة نشطة. | اعتماد أن A/B خاص بمساحات العمل، أو إضافة معاينة/شجرة للمشغّل. |
| تسجيل الدخول (`BaseerLogin`) | لا يعرض اختيار الواجهة أو A/B قبل وجود جلسة موثوقة. | قرار منفذ: يبقى خارج تنقل ERP، لكنه يرث بصريًا الثيم المحفوظ عبر `baseer-modern-entry-themes.css`؛ اختبار دخول مستقل مطلوب قبل الإغلاق النهائي. |
| `#attendance` (`AttendanceEmployeePortal`) | تدفق PWA مستقل بلا shell حديث أو A/B. | قرار منفذ: لا يعرض A/B أو الشركة للموظف، ويرث أسطح الثيم وخطوطه عبر `attendance-pwa.css`؛ اختبار تدفق الموظف المستقل مطلوب قبل الإغلاق النهائي. |
| deep links والحورات، مثل `employee-*` و`record-service` | إجراءات/حورات وليست تبويبات URL مستقرة في الشجرة. | توثيقها كإجراءات؛ لا تحول إلى تبويبات إلا إذا أصبحت وجهات مستقرة. |

## الحالة المنفذة والدليل

- اختيار `baseer` و`modern-1` و`modern-2` وحفظه: `apps/web/src/App.tsx`.
- A/B في الهيدر وحفظه، مع شجرة/بطاقات مشتقة من الصلاحيات: `App.tsx` و`baseer-theme-navigation.tsx`.
- مراحل URL المستقرة: التقرير المالي، المشتريات، المصروفات والالتزامات في `baseer-theme-navigation.tsx`.
- القياسات والهيكل المشترك للكروت والجداول والفلاتر والتقويم والحوارات: `baseer-modern-theme-layouts.css` و`baseer-theme-variants.css`.
- جسرا النطاقات: `baseer-modern-domain-themes.css` (HR/Reports/Administration) و`baseer-modern-insights-themes.css` (القرار/التسويق/الأدلة) يعيدان ربط أسطح منتقاة بأدوار دلالية. هما معالجة مرحلية، وليسا دليلًا على إزالة literals من CSS التاريخي.
- اختبار A/B والصلاحيات والمراحل على Desktop Chrome وPixel 5: `apps/web/e2e/theme-navigation-modes.spec.ts`.
- `theme-navigation-modes.spec.ts` يثبت A/B والمراحل، وعقدًا ممثلًا للمالية/التقارير: bindings المصدرية للـvariants الآمنة، نصف قطر `record` في `modern-1`، واستثناء canvas للتقرير المالي ونصف قطرها في `modern-2`. النتيجة 8/8 على Desktop Chrome وPixel 5 (2026-08-31). لا يحل هذا محل fixture بيانات حقيقية للدفتر/الخزائن/الـdrawer.
- عقد مسارات قابل للتشغيل: `apps/web/e2e/modern-theme-route-contract.spec.ts` يثبت أن صفحات `pageRegistry` المرئية الـ53 لها موديول صالح، وتمر عبر `ModuleWorkspace` ثم `BaseerAppShell`، وأن `modern-1` و`modern-2` يضعان `data-ui-theme` مع قياسات الغلاف المرجعية. نجح العقد على Desktop Chrome وPixel 5 في 2026-08-31. هذا عقد هيكلي فقط، لا بديل عن اختبار محتوى كل صفحة أو لقطة بصرية.
- اختبار قبول تشغيلي لمركز القيادة: `apps/web/e2e/theme-parity-command-center.spec.ts` اجتاز في الثيمين، Desktop Chrome وPixel 5 (8/8، 2026-08-31). يغطي الهيدر، اختيار الواجهة، A/B، drawer الجوال، فلتر الفترة، جدول الأدلة، والحالة الداكنة على سطح المكتب، وقياسات computed-style للعينة. لا يثبت كل بطاقات بقية 52 صفحة.
- لقطات تشغيلية لقائمة مركز القيادة ولواجهة اختيار الثيم: `command-center-sidebar-preview.spec.ts` و`interface-theme-presentation.spec.ts`. هذه لقطات مخرجات، وليست pixel-diff baseline.
- مصفوفة تشغيل مرئية قابلة للصيانة: `apps/web/e2e/modern-theme-visual-matrix.spec.ts` تنشئ حالة بصلاحيات واسعة لكل صفحة مسجلة (53) ولكل من `modern-1` و`modern-2`، وتعمل تلقائيًا على Desktop Chrome وPixel 5. لكل route تتحقق من الغلاف، اختيار الواجهة، A/B، overflow، و`pageerror`؛ وتلتقط لقطة ممثلة لكل عائلة موديول. لا تختلق fixture نجاح عامة: كل GET غير محضّر يعاد كـ403 صريح ويُرفق باسمه في `unprepared-api-reads.json` ضمن نتيجة الاختبار، ليصبح سجل endpoint الناقص قابلًا للمراجعة بدل إخفائه.

## جدول المطابقة الهندسية للكروت والحاويات

القياسات أدناه من `apps/web/e2e/theme-parity-command-center.spec.ts` في 2026-08-31، على Desktop Chrome (1280×720) وPixel 5 (393×727)، RTL. الاختبار يقرأ `getComputedStyle` و`getBoundingClientRect` ويمنع overflow الأفقي. «العينة» تعني أنها ليست دليلاً على كل بطاقات الـ53 صفحة.

| العنصر | مرجع العرض | modern-1 في بصير | modern-2 في بصير | القرار |
| --- | --- | --- | --- | --- |
| سطح المكتب: الهيدر | 70px / 56px | 70px | 56px | مطابق للعقد. |
| سطح المكتب: الشريط الجانبي | 257px / 214px | 257px | 214px | مطابق للعقد. |
| سطح المكتب: حد المحتوى | 1440px / بلا حد | `1440px` | `none` | مطابق للعقد؛ عرض العينة أقل بسبب مساحة الشريط الجانبي. |
| سطح المكتب: padding صفحة المحتوى | T1: 36px، `clamp(20px,4vw,56px)`، 56px؛ T2: 24/30/46px | 36/51.2/56px عند 1280px | 24/30/46px | مطابق للعقد. |
| سطح المكتب: بطاقة مركز القيادة العينية | Trend card المرجعية: radius 18px وpadding 21/22/10px؛ T2 في الحاوية المدمجة radius 0 | radius 18px، padding 10px | radius 0، padding 10px | radius مطابق للعينة، لكن padding مختلف؛ لا يعمم على بقية الكروت. |
| سطح المكتب: صف المقاييس المدمج | T1 gap 13px؛ T2 gap 0 وradius 5px للحاوية | command metrics gap 5.6px | gap 0، radius الحاوية 5px | T2 مطابق. T1 ليست مكافئة 1:1 لأنها مقاييس timeline متخصصة؛ يلزم قرار/عينة بطاقة عامة قبل إغلاقها. |
| الجوال: الشريط الجانبي وoverflow | drawer مخفي افتراضيًا؛ لا overflow | sidebar بعرض 0 وoverflow 0 | sidebar بعرض 0 وoverflow 0 | مطابق. |
| الجوال: الهيدر | 62px في المرجع عند breakpoint الجوال | 62px | 62px | مطابق للعقد؛ فرق 70/56 خاص بسطح المكتب. |
| الجوال: padding صفحة المحتوى | T1: 26/16/42px؛ T2: 23/15/40px | 26/16/42px | 23/15/40px | مطابق للعقد. |
| primitive metric العام | T1: 144px/gap13px/radius17px؛ T2: 118px/joined/radius0 | القيم معرفة في `baseer-modern-theme-layouts.css` | القيم معرفة في `baseer-modern-theme-layouts.css` | تحقق ثابت فقط؛ لم تركب عينة `.baseer-metric` في هذه جلسة مركز القيادة، ولذلك لا يعد قبولًا بصريًا نهائيًا. |

لا توجد فجوة shell مقاسة باقية في هذه العينة بعد إعادة الاختبار. تبقى اختلافات padding البطاقات مفتوحة: تحتاج أولًا مطابقة كل نوع بطاقة في بصير مع نظيره المحدد في المرجع؛ لا يجوز فرض padding واحد على كروت مالية/بيانات مختلفة لمجرد أن لها class عامة.

### عقد variants المركزي

سجل [card-container-variant-contract.json](card-container-variant-contract.json) يعرّف ستة variants مركزية (`surface-card` و`metric-card` و`data-register` و`filter-workbench` و`dialog-surface` و`workflow-panel`) مع role واستخدام مركزي ونظير مرجعي ومالك ودليل الاختبار. كما يحصر أربع عائلات استثناء نطاقية بدل السماح بـCSS استثنائي صامت: العمليات التفاعلية، HR/بوابة الموظف، المالية/التقارير، والقرار/التسويق/الأدلة. في المالية/التقارير تحولت الحالات الآمنة إلى variants المركزية، ودليل القراءة/التفصيل للدفتر والخزائن وP&L وVAT مثبت؛ يبقى canvas/drawer ونطاقات التعديل وبقية عائلات التقارير استثناءات جزئية، لا قبولًا عامًا.

`npm run check:ui-modern-theme-variants` ينجح حاليًا لـ**6 variants مركزية** (**3 measured** و**3 partial/pending**) و**4 استثناءات نطاقية**. يتحقق من مخطط السجل ووجود selectors في طبقات CSS المركزية، ومن أن دليل variant المصنّف `measured` موجود، وأن مصفوفة القبول تتضمن `modern-1` و`modern-2` وdesktop/mobile وRTL/dark. هذا فحص حوكمة للعقد فقط؛ statuses `partial` و`pending` والاستثناءات لا تعني مطابقة أو قبولًا بصريًا.

### أنواع الحاويات والكروت غير المثبتة بعد

المصفوفة المرئية تثبت الغلاف وغياب overflow لكل صفحة، و`interface-theme-presentation.spec.ts` يثبت primitives المصطنعة (`baseer-card` وmetric/table/filter/dialog). لكنها لا تقيس geometries للمكونات الخاصة التالية في بيانات/حالة قريبة من الواقع.

| الأولوية | النوع غير المثبت | الدليل الحالي وحدّه | قياس قبول قابل للتنفيذ |
| --- | --- | --- | --- |
| P0 | مركبات العمليات القابلة للإدخال والطباعة: POS والـreceipt، catalog، execution، recipe، internal registration | المصفوفة تمر على صفحات العمليات وتمنع overflow، لكن fixture الـAPI يرد 403 غير محضّر ولا يركب مركبات إدخال/إيصال مكتملة. | fixture قراءة/بيانات صغيرة لكل مركب، ثم `getComputedStyle` لبطاقة الإدخال/الـreceipt/grid (padding/radius/gap/min-height) على desktop وPixel 5؛ screenshot لكل حالة وتحقق drawer/dialog عند وجوده. |
| P0 | HR attendance/roster وملف الموظف/onboarding والحورات المالية | bridge يغطي بعض الأسطح، والمصفوفة لا تقيس roster أو dialog أو employee PWA. | حالة موظف محددة ثم قياس grid roster، card/profile، dialog/stepper؛ أضف مسار `#attendance` منفصلًا لأن shell/A-B لا ينطبقان عليه. |
| P1 | الحسابات والدفاتر والتقارير: cards للخزائن والحسابات، reports prototype canvas/drawer، VAT | `finance-reports-modern-data.spec.ts` يركب receipts قراءة صريحة ويجتاز T1/T2 وRTL على Desktop/Mobile: register والخزائن، activity ثم journal source داخل الحوار، P&L detail dialog، وVAT overview/editor dialog. يثبت أيضًا radius register (18/5px) وpadding الدفتر (header 11px/cell 12px) وVAT (12/12px). إصلاح الجوال جعل جدول P&L يساوي عرض حاويته، بينما يبقى ميزان المراجعة العريض سجلًا أفقيًا. | مقبول ضمن مسارات القراءة/التفصيل المحددة. هذا لا يثبت عمليات الحفظ أو الترحيل أو كل تقارير النظام الأخرى. |
| P1 | القرار والتسويق والبريد: timeline، campaign card/form، evidence labels/rules | الـbridge يربط أسطح منتقاة، واللقطة الممثلة لا تمنح computed-style للكروت الخاصة. | fixture لكل عائلة، ثم قياس timeline/card/filter container ومقارنة gap/radius/padding مع نظير المرجع المحدد قبل أي حكم. |
| P2 | primitives المشتركة: `baseer-batch-panel` و`baseer-stepper__panel` وworkspace tabs وperiod/date popovers | `interface-theme-presentation.spec.ts` يركب fixture حقيقية لهذه classes ويثبت radius للحاويات والتبويبات والـpopovers في الثيمين، Desktop وPixel 5 وRTL والوضع الداكن. | مقبول هندسيًا للـprimitives المشتركة؛ لا يغني عن اختبار مركبات الإدخال أو الحوارات الخاصة بكل نطاق. |

لا يُغلق أي صف بهذه القياسات لمجرد لقطة أو selector موجود في CSS؛ يلزم fixture قابل لإعادة التشغيل، قيمة computed-style مسجلة، وصورة عند حالة البيانات نفسها.

## فجوات قابلة للتنفيذ

### P0 — تسرب أدوار لونية ثابتة

الجرد التنفيذي الحالي (2026-08-31) عبر `npm run audit:ui-modern-theme-literals` يجد **289 literal في 6 ملفات**: **265** معرّفة كـsemantic token، و**24** product swatch موثقة فرديًا، و**0** غير مصنفة. هذا قبول لبوابة الحصر الثابت فقط: كل literal ظاهر له دور أو سبب منتج قابل للمراجعة، ولا يعني وحده تطابقًا بصريًا أو وظيفيًا لكل صفحة.

- الـproduct swatches محصورة في اختيارات منتج/مستخدم قديمة معزولة وفي ورق لوحة المالك؛ وليست سماحًا باسم ملف أو مجلد.
- أدوار السطح والحد والنص والحالة في المساحات المستهدفة تربط بمتغيرات دلالية (`--brand`, `--chart-*`, `--status-*`, `--surface-*`). يبقى قبول الرسم والـhover والحالات الخاصة مرهونًا بقياس E2E للمسار الذي يعرضها.

الإجراء المستمر: أي literal جديد يحتاج تصنيفًا فرديًا في الـmanifest قبل قبوله؛ أما نقل لون إلى token فلا يغلق تلقائيًا قياس الكرت أو الحاوية أو تفاعل الصفحة.

#### بوابة الجرد والـratchet المنفذة

- `scripts/check-modern-theme-literals.mjs --inventory --json` يخرج الجرد الكامل مع path/line/column/context وتصنيف كل قيمة. يُشغّل عبر `npm run inventory:ui-modern-theme-literals`؛ أما `audit:ui-modern-theme-literals` فيعطي الملخص فقط.
- `docs/ui-parity/modern-theme-literal-manifest.json` يعرّف التصنيفين ومبرر/مالك كل product swatch؛ لا توجد قائمة سماح لمجلد أو ملف.
- `npm run check:ui-modern-theme-literals` يفحص literals المضافة في `git diff HEAD` ويرفض كل جديد غير مصنّف. نتيجة جرد الماسح الحالية صفر غير مصنف؛ ويظل فحص diff هو الـratchet الذي يمنع رجوع literal غير موثق في التعديلات اللاحقة.
- `npm run test:ui-modern-theme-literal-scanner` اجتاز ويثبت أن literal في CSS custom property يصنف semantic token، والـswatch الموثق يصنف product swatch، وأي literal مرئي مباشر يبقى غير مصنف.

#### برهان «صفر تسرب» المطلوب

لا يكفي `bridge` محمل بعد CSS التاريخي؛ فهو لا يحمي selectors أو حالات أو مخرجات رسم لم يغطها. تحقق الجزء الثابت من البرهان الآن: scanner يمر على `apps/web/src/**/*.{css,ts,tsx}` ويخرج صفر غير مصنف، والاستثناءات الفردية تربط اللون بـ`role` و`owner` وسبب منتج ثابت. لا توجد allowlist باسم ملف تاريخي أو مجلد كامل.
لكن لا يزال القبول الشامل مفتوحًا: بعد scanner الأخضر يلزم E2E `getComputedStyle` لأدوار السطح/النص/الحالة والرسم في `modern-1` و`modern-2`، light/dark وRTL، مع fixture لكل عائلة من P0–P2. لذلك لا تحول نتيجة 0 unclassified إلى حكم «100%» على الشاشات أو الرسوم.

### P0 — فحص كل صفحة بدل افتراض أن الغلاف يكفي

المصفوفة التشغيلية موجودة الآن في `modern-theme-visual-matrix.spec.ts` وتفتح 53 `pageId` تحت ثيم 1 وثيم 2 على desktop/mobile، وترصد أخطاء وقت التشغيل والتجاوزات. لكنها ليست قبولًا لمحتوى API حقيقي بعد: لا تزال fixtures التفصيلية والـscreenshots المعتمدة لكل مساحة مطلوبة.

نتيجة أول تشغيل كامل على Desktop Chrome: 106/106 أخضر. أول فحص فعلي على Pixel 5 كشف تجاوزًا أفقيًا في `operations-purchases`: 4px في `modern-1` و5px في `modern-2` عند receipt الـAPI غير المحضّر. عولج في CSS العمليات من مالكه ثم أعيد تشغيل Pixel 5 كاملًا: 106/106 أخضر. لا تضبط المصفوفة سماحية أعلى لإخفاء أي تجاوز لاحق.

الإجراء: fixture بصلاحيات واسعة، matrix test للـ53 صفحة، واختبار منفصل لملف صلاحيات محدود يثبت الإخفاء. لكل route: انتظار المحتوى، التقاط `pageerror`، فحص overflow، وتحقق عناصر الهيدر/الشجرة حيث تنطبق.

### P1 — الفلاتر والمقارنة كعقدة مشتركة

المرجع يعرض workbench واحدًا يجمع البحث والفترة (خمسة presets) والفئة والحالة والضريبة والـchips وإعادة الضبط ومقارنة الفترات. بصير يملك `BaseerPeriodFilter` و`BaseerFilterBar`، لكن التركيب والمقارنة ما زالا خاصين بالصفحات.

الإجراء: تعريف component contract مشترك للمساحات التي تقبل فترة مقارنة، بدون اختراع أرقام أو تجميعات على العميل.

### P1 — جرد المرئيات والكروت

مرجع العرض يضم معرضًا لعدة أنماط رسوم وكروت. بصير يلوّن بعض رسوم ECharts عبر `baseer-chart-theme.ts` و`monthly-application-sales-share-chart.tsx`، لكنه لا يثبت تغطية كل المرئيات ولا البطاقات الخاصة.

الإجراء: جدول مصادر لكل رسم/بطاقة (الموديول، data quality، component، tokens، desktop/mobile screenshot)، ثم إضافة theme roles أو override محصور عند الحاجة.

### P2 — أدلة بصرية قابلة للمقارنة

الاختبارات الحالية تلتقط صورًا لكن لا توجد baseline `toHaveScreenshot` أو مقارنة مرجعية عند قياسات محددة. كما أن breakpoints الحالية لا تطابق جميع نقاط المرجع حرفيًا.

الإجراء: baseline للغلاف ولعائلة مساحة عمل ممثلة من كل موديول عند 1440px وPixel 5، RTL وdark، مع اعتماد مراجعة بشرية لأن بيانات بصير الحقيقية لا تطابق بيانات الديمو.

## بروتوكول الإغلاق

1. حدّث جدول الطرق والاستثناءات مع كل تنفيذ.
2. لا تغلق صفًا إلا برابط اختبار ناجح ولقطة أو فحص computed-style مناسب.
3. لا تغلق فجوة ألوان إلا بعد التحليل الساكن ومراجعة المرئيات المتأثرة.
4. عند اكتمال كل الصفوف، أجرِ build/typecheck واختبارات المصفوفة واللقطات، ثم مراجعة عربية RTL يدوية.

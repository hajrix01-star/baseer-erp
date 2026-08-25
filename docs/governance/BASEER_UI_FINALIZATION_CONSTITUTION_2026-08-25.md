# دستور الإقفال النهائي لنظام واجهة بصير

**الحالة:** `RETURN TO BUILD` — ليس مقبولاً نهائياً بعد.
**قرار اللجنة:** لا يصح وصف جرد المكونات أو نجاح بوابات البناء وحدهما بأنه «المرحلة النهائية». الإقفال الذي يرضى به Principal Engineer هو نظام يمنع الانحراف قبل دمجه، ويملك مالكاً ودليلاً لكل استثناء، لا وعداً بأن منتجات المستقبل لن تحتاج واجهة جديدة.

## القرار التنفيذي

يبقى ملف `BASEER_UI_COMPONENT_INVENTORY_AND_WORK_ORDER_2026-08-25.md` **سجل الحملة والأدلة التاريخية**. لا يكون هو المرجع الحاكم وحده لأنه يخلط الجرد ونتائج الموجات وقرارات القبول والـbacklog في وثيقة واحدة.

مرجع الإقفال النهائي يتكون من خمسة artefacts مترابطة:

1. هذا الدستور: القواعد المعمارية غير القابلة للتفاوض وتعريف الإقفال.
2. `UI_COMPONENT_REGISTRY` قابل للقراءة آلياً: لكل عقد مركزي اسمه وطبقته ومالكه وAPI العام واختباراته وحالته.
3. `UI_EXCEPTION_REGISTER` قابل للفرض: لكل HTML/CSS متخصص سبب ومالك ودليل وtrigger لإعادة التقييم.
4. UI-ADR قصير للقرارات التي تغيّر عقداً عاماً أو طبقة overlay أو ميزانية أو استثناءاً دائماً.
5. `UI_FINAL_ACCEPTANCE_RECORD` مثبت على commit SHA: نتائج البوابات واللقطات والمخاطر المقبولة وتوقيع المالكين.

لا يعلن الإقفال قبل وجود هذه artefacts وقراءة CI لها. عندها يصبح أي عنصر جديد إما مسجلاً قبل الدمج أو مرفوضاً آلياً؛ وهذه هي الضمانة المهنية ضد «اكتشاف فجوة لاحقاً».

## النموذج المعماري النهائي

| الطبقة | تملك | أمثلة | قاعدة صارمة |
| --- | --- | --- | --- |
| Foundation | tokens، typography، RTL/LTR، portal، focus، layers، motion، أدوات الاختبار | `styles.css`، `--layer-*`، focus/portal policy | لا قيمة بصرية أو `z-index` أو portal جديد خارج token/policy معتمد إلا باستثناء مسجل. |
| Primitives | عقد تفاعل واحد لكل عنصر أساسي | `BaseerButton`، الحقول، `BaseerDialog`، `BaseerCombobox`، `BaseerDatePicker`، `BaseerCard`، `BaseerStatusBadge` | لا primitive ثانٍ لنفس العقد؛ التوسعة تتم في العقد المالك أو عبر adapter معلن. |
| Patterns | تركيب primitives من دون business/API state | `BaseerAppShell`، `BaseerNavigationDrawer`، `BaseerAsyncState`، `BaseerFormField`، tabs، menu popover، `DataGrid`/load more، toast | لا ينسخ pattern داخل feature؛ يحصل على data وcallbacks من الميزة فقط. |
| Domain-specialized | قواعد الأعمال وشكلها المتخصص | تقارير متعددة الرؤوس، POS، محرر وصفة/دفعات، charts، workflows | تستهلك الطبقات الثلاث السابقة، لكنها تبقى مالكة للحساب والبيانات والعقد التشغيلي. |

### استثناءات دائمة مقبولة

التقارير المالية متعددة الرؤوس، POS ومحررات الصفوف السريعة، الرسوم، `details` الإفصاحية، رفع الصورة مع المعاينة/الرفع الفوري، وselection/bulk actions التي لا تملك عقداً متكرراً. لا تتحول إلى generic component لمجرد خفض عدد الوسوم.

## عناصر الإقفال الإلزامية

لا يوجد `Final Pass` وأي بند P0 مفتوح:

| الحزمة | شرط الإغلاق |
| --- | --- |
| App shell وDrawer | `BaseerAppShell` يحذف تكرار الإطار؛ `BaseerNavigationDrawer` يملك portal و`dialog` semantics وfocus trap/restore وEscape/backdrop وscroll lock وRTL، مع اختبار جوال. |
| Overlay ownership | tokens طبقات `base/sticky/popover/modal/toast` وسياسة portal واحدة؛ لا z-indexات متنافسة أو popover/modal محلي غير مسجل. |
| Combobox | عقد واحد فقط، `aria-activedescendant` أو roving option، Arrow/Home/End/Page/Enter/Escape، اختيار وتمرير وتحديث AT، واختبارات AR/EN وRTL/LTR. تدمج facades المتوازية إلى API عام واحد. |
| Date وPeriod | implementation واحد للتاريخ؛ لا يبقى `BaseerAriaDatePicker` غير مستعمل بجوار عقد آخر. DatePicker وPeriodFilter يملكان keyboard grid، focus open/restore، Escape، وترجمة عربية/إنجليزية صحيحة؛ الـmodal يحبس التركيز والـpopover لا يحجزه. |
| أدوار ARIA المركبة | كل `tablist/tab/tabpanel` و`menu/menuitem/menuitemradio` إما يطبق roving focus ومفاتيح Arrow/Home/End وEscape/focus restore بحسب عقده، أو تزال الأدوار ويستخدم disclosure/button list أصلي صحيح. لا دور ARIA شكلي. |
| Form-field ownership | لا تضارب بين gateway النموذج المركزي ودالة الحقل المحلية بالاسم نفسه. يوجد اسم/API واحد للـform wrapper واسم/API واحد للـlabel/help/error عند إثبات التكافؤ. |
| Feedback | `BaseerAsyncState` يركب loading/empty/error/retry، و`BaseerNotice`/`FeedbackRegion` يحددان متى يكون المحتوى static أو `status` أو `alert`. Toast للإشعار العابر فقط، وليس خطأ حقل أو قراراً مالياً دائماً. |
| المرجع الحاكم | تسوية `BASEER_UI_SYSTEM_STANDARD.md` مع الواقع (الميزانيات `251/95/65 KB`، `BaseerDatePicker`، و`BaseerDialog`) أو إحالته صراحة إلى هذا الدستور؛ لا يبقى معياران متعارضان. |

## العمل P1 بعد إغلاق P0

- توسعة `BaseerButton variant="icon"` بدلاً من إنشاء `BaseerIconButton` موازٍ.
- `BaseerMenuPopover` كعقد عام؛ يصبح `BaseerShareMenu` composition منه، ولا يستبدل `details` الإفصاحية.
- تحصين `useDialogFocusTrap` لالتقاط كل العناصر القابلة للتركيز، لا `button/input/select/textarea` فقط، مع اختبار روابط و`tabindex` وcontenteditable.
- adoption مثبت فقط لـ`StaticSelect` و`TextArea` و`Checkbox` و`FileInput` و`SectionHeader` و`SummaryMetric` و`StatusBadge`.
- `BaseerLoadMore` presentation فقط؛ لا يملك cursor أو data.
- حوكمة `BaseerCompanyReadQuery` للقراءات البسيطة، لا للـmutation أو pagination المعقدة.

`Toast` و`FormField` وقرار `DecimalInput` لا ترفع إلى مانع P0 إلا إذا أثبت registry عقداً متكرراً؛ لا يبنى مكوّن صوري لإكمال قائمة.

## بوابات CI النهائية

| البوابة | ما تمنعه |
| --- | --- |
| AST-aware UI policy | HTML interactive أو style بصري أو import facade جديد غير مسجل. لا يكفي regex كحارس. |
| Registry + exception validation | كل استثناء يملك owner وسبباً ودليلاً وreview trigger؛ لا exception مجهول ولا P0 waiver. |
| Component contract tests | لكل primitive تفاعلي: AR/EN، RTL/LTR، keyboard، focus restore، Escape، roles/labels، disabled/busy، وجوال. |
| Authenticated Axe/E2E | Axe WCAG 2 AA ومسارات mock ثابتة للـlogin والـshell/drawer والنموذج/الحوار والـcombobox والتاريخ/الفترة والجدول/الفلاتر وحالات empty/error/retry. |
| Visual regression | لقطات desktop وPixel 5 بالعربية والإنجليزية للحالات الحاكمة، ببيانات ثابتة لا بيانات حية متذبذبة. |
| Performance | build، numeric/localization/dialog/financial guards، budget الفعلي، ومنع رفع budget أو إضافة exception في نفس التغيير بلا UI-ADR وقياس مستقل. |
| Ownership | تغير tokens أو primitive أو budget أو registry/exception يتطلب مراجعة مالك UI Platform عبر CODEOWNERS/branch protection. |

## Definition of Done — Final Pass

لا يمنح `Final Pass` إلا عندما يتحقق كله:

1. أغلقت كل حزم P0 أعلاه باختبارات العقد والبصر والجوال.
2. كل P1 انتهى بواحد فقط: primitive/pattern مطبق، توسعة لعقد قائم، أو قرار «ليس pattern عاماً» في registry؛ لا backlog فضفاض.
3. لا interactive HTML أو visual inline style أو overlay غير مصنف.
4. لكل primitive/pattern مالك وAPI عام وحالات مدعومة واختبارات ومستهلكون وحالة lifecycle.
5. CI الأخضر يشمل البوابات الحالية، registry gate، E2E/Axe، وvisual baselines.
6. acceptance record مثبت على SHA ويذكر النتائج واللقطات والمخاطر المقبولة؛ لا قبول شفهي.

## النتيجة التي تعني «نهائي»

النتيجة النهائية ليست أن المنتج لن يتغير. النتيجة المهنية هي: لا تدخل واجهة جديدة أو استثناء أو انحراف إلى بصير من دون أن يمر على registry وADR وبوابات آلية ومراجعة مالك العقد. عندها لا نعود لاحقاً لاكتشاف عناصر غير موحدة؛ النظام يكتشفها أو يمنعها قبل الدمج.

## مراجعة كبير المطورين وكبير المعماريين

| المراجع | الحكم | النتيجة |
| --- | --- | --- |
| كبير المطورين | `RETURN TO BUILD` للحالة الحالية، و`APPROVE WITH CONDITIONS` للخطة | ترتيب P0 صحيح ولا يطلب generic components عبثية؛ لكنه يرفض التوقيع قبل مخرجات فعلية على SHA واحد: العقود والوصول والاختبارات والسجلات وCI. |
| كبير المعماريين | `RETURN TO BUILD` للحالة الحالية | الطبقات الأربع وحزمة artefacts الخمسة هي الحد الأدنى الصحيح وليست بيروقراطية زائدة؛ الدستور هدف معماري جيد لكنه لا يثبت بعد وجود registry أو exception register أو acceptance record أو فرض آلي. |

### أدلة الرفض الحالية

- المعيار القديم ما زال متعارضاً مع الواقع: تاريخ أصلي وعقد حوار موروث وميزانيات `250/85/58 KB`، بينما الحارس الفعلي يطبق `251/95/65 KB` وعقوداً أحدث.
- لا توجد بعد ملفات registry وexception وacceptance القابلة للفرض، ولا `CODEOWNERS`، ولا بوابات CI إلزامية لـE2E/Axe والـvisual regression والسجلات.
- موانع P0 المثبتة في drawer وCombobox وDate/Period وطبقات overlay وARIA المركبة لم تنفذ بعد.
- لا يقبل الحارس النهائي منع HTML أو inline CSS الموجودين دفعة واحدة؛ يطبّق على الكود الجديد/المعدل مع baseline exceptions وratcheting حتى لا يحول الحارس إلى ضوضاء.

### شروط التوقيع النهائي المشتركة

1. تسوية المعيار القديم أو إحالته صراحة إلى هذا الدستور؛ مرجع حاكم واحد فقط.
2. إغلاق كل P0 واختبارها على desktop وPixel 5، AR/EN وRTL/LTR، مع keyboard وfocus وAxe.
3. تنفيذ registry وexception schemas والتحقق منهما في CI؛ لكل عقد owner وAPI وحالات واختبارات ومستهلكون، ولكل استثناء rationale/evidence/review trigger.
4. تشغيل CI الإلزامي: AST policy، registry gate، build والحراس والميزانية، E2E/Axe، visual baselines، ومراجعة UI-ADR مستقلة لتعديل budget أو استثناء جديد.
5. لا P0 waiver؛ وكل P1 ينتهي بتنفيذ أو قرار معماري صريح «ليس pattern عاماً» داخل registry.
6. إنشاء acceptance record غير قابل للتحرير لاحقاً، مثبت على commit SHA، يحوي مخرجات البوابات واللقطات والمخاطر المقبولة وتوقيع مالك UI Platform ومالك الهندسة.

**قرار اللجنة بعد المراجعتين:** يعتمد هذا الدستور كخطة الإقفال الوحيدة. ولا يستخدم وصف «نهائي» قبل تحقق شروط التوقيع الستة أعلاه.

# سجل قبول واجهة بصير — 2dc4f6784bb305dd68d366721706394a6c2932a7

**الحالة:** Draft — Local technical closure complete; external release gates pending
**Commit SHA:** `2dc4f6784bb305dd68d366721706394a6c2932a7`
**تاريخ التحقق المحلي:** 2026-08-25
**فرع الإصدار:** `codex/ui-finalization-20260825`

## حدود القبول

- عقود P0 المغلقة: AppShell، NavigationDrawer، Overlay policy، Combobox، DatePicker، Menu، Form/Button، Batch tabs، Stepper وAsyncState.
- مخرجات P1: registry وexception register وnative-control/inline-style ratchets وCODEOWNERS وvisual baselines.
- الاستثناءات: 5 استثناءات موثقة في `UI_EXCEPTION_REGISTER.json`؛ لا يوجد استثناء يلتف على عقد P0.

## أدلة البوابات المحلية

| البوابة | النتيجة |
| --- | --- |
| Registry + exception validation | PASS — 42 components، 5 approved exceptions |
| Native-control + inline-style ratchets | PASS |
| Web TypeScript | PASS |
| Production build + web budget | PASS |
| Drawer E2E/Axe/visual | PASS على Desktop وPixel 5 في RTL وLTR؛ التخطيان مقصودان حسب project gating |
| AsyncState E2E | PASS على Desktop وPixel 5 |
| HR/Finance DatePicker E2E | PASS على Desktop وPixel 5 |
| Basira interaction + visual | PASS على Desktop وPixel 5 في العربية والإنجليزية |
| `git diff --cached --check` قبل commit | PASS |

## بوابات الإصدار غير المنفذة

لا يوجد remote مهيأ لهذا المستودع عند إصدار هذا السجل؛ لذلك لا يمكن ادعاء تشغيل GitHub Actions أو تفعيل branch protection محليًا.

قبل تغيير الحالة إلى `Accepted` يجب أن يثبت رابط CI لنفس الـSHA:

1. workflow كامل أخضر، متضمنًا Playwright/Axe/visual baselines.
2. فرق GitHub الحقيقية في `CODEOWNERS` وrequired code-owner review.
3. branch protection/ruleset: required checks ومنع bypass غير المصرح.

## قرار اللجنة

**لا يوجد مانع تقني محلي للقبول.** الحالة `Draft` فقط لغياب أدلة منصة GitHub الخارجية، وليست بسبب فجوة في تنفيذ الواجهة.

## التوقيع

| الدور | القرار | الحالة |
| --- | --- | --- |
| UI Platform owner | Pending external CI | غير موقع |
| Principal Engineer | Pending external CI | غير موقع |

# أثر التغيير — مواءمة اختبارات مركز القيادة

- **المعرف:** `BASEER-IMPACT-2026-09-03-COMMAND-E2E`
- **التصنيف:** `CONTROLLED`
- **المرجع:** `BASEER-ARCH v1.0` / `marketing-decision-reports`
- **المالك:** `apps/web/e2e/command-center-sidebar-preview.spec.ts` و`apps/web/e2e/theme-parity-command-center.spec.ts`

## النطاق والقرار

تعطلت اختبارات قبول بسبب افتراضات قديمة: شبكة `command-center__financial-grid` استبدلت سابقاً بمستكشف الحركة النقدية، وfixture معاينة الشريط الجانبي لم يعد يطابق عقد التقرير المالي. التغيير يحدّث محددات قبول الواجهة والـfixtures فقط إلى السلوك والعقد الحاليين.

لا يتغير تطبيق الإنتاج أو API أو عقد مشترك أو حسابات مالية أو صلاحيات أو بيانات. تبقى القيم في fixtures خادمة للعقد ولا تحسبها الواجهة.

## معايير القبول والفحوص

1. تتجه معاينة مركز القيادة إلى route الصريح الحالي وتعرض الشريط/الدرج على سطح المكتب والجوال.
2. تقيس اختبارات الثيم مستكشف الحركة النقدية والخط الزمني الحاليين، لا عنصراً متقاعداً.
3. يمر اختبارا Playwright المتأثران على السطحين، ثم فحص TypeScript وبناء الويب.

## التراجع

التراجع بسيط ومحصور في ملفي اختبار E2E وهذه البطاقة وسجل الحوكمة؛ لا يوجد أثر بيانات أو نشر.

## نتيجة التنفيذ

- مرّت `command-center-mocked-auth.spec.ts` و`command-center-sidebar-preview.spec.ts` و`theme-parity-command-center.spec.ts`: **22/22** على desktop وmobile.
- مرّ `npm run build --workspace @baseer-erp/web`، بما فيه بوابة سياسة الأرقام و`tsc -b`.
- بقي تحذير Vite المعروف لحجم chunk الرسم (`baseer-chart`) من دون خطأ أو تغير في النطاق.

# سجل Phase 0 — تمكين منصة واجهة بصير

**Delivery ID:** `UI-PLATFORM-2026-08-22-P0`
**النطاق:** baseline للواجهة وقرار تبعية واحد، ثم Pilot واحد غير مالي لـ`BaseerCombobox`.
**السلطة:** [سلطة التسليم الحالية](CURRENT_DELIVERY_AUTHORITY.md).
**الحالة:** **Conditional pass — revision نظيف قابل لإعادة التشغيل مطلوب قبل تثبيت التبعية.**

## ما فُحص

| البوابة | الأمر | النتيجة في شجرة العمل الحالية |
| --- | --- | --- |
| Web TypeScript | `npm run check --workspace @baseer-erp/web` | Pass |
| Architecture | `npm run check:architecture` | Pass |
| Production build | `npm run build --workspace @baseer-erp/web` | Pass |
| Dialog conventions | `npm run check:web-dialog-conventions` | Pass |
| Financial browser boundaries | `npm run check:web-financial-boundaries` | Pass |
| Localization guard | `npm run check:web-localization` | Pass |
| Web release budget بعد فصل CSS الإداري المؤجل | `npm run verify:web-budget` | Pass: initial CSS `54,162 B / 58,000 B`؛ أكبر route CSS `15,112 B / 16,000 B` |
| Browser E2E baseline | `npm run test:e2e --workspace @baseer-erp/web` | Pass: `33 passed`, و`1` skipped مقصود لاختبار شاشة الجوال ضمن مشروع desktop |

فصلت أنماط شركات الإدارة التي لا تظهر قبل دخول workspace من `styles.css` إلى `workspace-legacy.css` المؤجل؛ لم يتغير شكلها أو عقدها، وانخفض CSS الابتدائي `4,526 B`. ما زالت النتائج تشخيصية فقط: شجرة العمل تحتوي تغييرات غير مرتبطة وغير مثبتة، لذلك ليست baseline معتمدة قابلة لإعادة التشغيل من revision نظيف.

## قرار lockfile

- مدير الحزم المعتمد هو `npm`، و`package-lock.json` هو المصدر الوحيد للحتمية؛ يتطابق ذلك مع CI الذي يستخدم `npm ci`.
- أزيل `pnpm-lock.yaml` المحلي المتجاهل لأنه لا يشارك في CI ولا يمثل تبعيات المشروع المعتمدة.
- لا يدخل أي اعتماد إلا بإصدار دقيق، وpeer-dependency/ترخيص/تبعيات عابرة وخطة إزالة موثقة قبل التثبيت.

## Pilot المحدد بعد إغلاق Phase 0

**المثيل الوحيد:** مرشح الموظف في شريط فلترة «الإجازات والعودة» داخل `HrLeaveWorkspace`.

**لماذا:** تدفق HR غير مالي؛ لديه بحث خادمي موجود؛ لا يكتب أموالاً ولا يغير صلاحية؛ ويختبر قائمة طويلة وتبديل العربية/الإنجليزية وRTL.

**عقد الـadapter المطلوب:**

```text
BaseerCombobox
value: string
options: readonly { id, label, description?, isFavorite? }[]
remoteSearch(query, signal): Promise<options>
onChange(id: string): void
```

البحث البعيد يجب أن يمر بسياق الجلسة والشركة القائم، ويستخدم debounce و`AbortController` ومنع سباق النتائج. لا تعرض الشاشة `react-aria-components` مباشرة.

## شرط الانتقال المفتوح

| البند | المالك | شرط الإغلاق |
| --- | --- | --- |
| baseline غير نظيف | مالك الشجرة/التسليم | revision أو commit معتمد ومحدود النطاق، وتشغيل جميع بوابات الجدول من ذلك المرجع وربط نتائجها بالـSHA |
| HR browser baseline | Phase 0 | **مغلق:** `mockHr` أصبح يزرع refresh token ووقت انتهاء للجلسة، مطابقةً لعقد `activeSession()` الحالي؛ suite الكاملة تمر |
| ضبط قاعدة البيانات المحلية | Platform/Database | **مغلق:** `verify:local-database` ضمن `package.json` و`scripts/verify-local-database.mjs` يتحققان قراءةً من `apps/api/.env.baseer-test` ويقبلان فقط `baseer_erp_test` على `127.0.0.1:5433`. شُغّل بنجاح؛ لا يغير UI أو API أو صلاحيات أو قرار React Aria. يجمعان في التغيير نفسه عند اعتماد revision. |
| قرار تبعية React Aria | BAQC-05/06/08/09/10 | [ADR-UI-001](ADR-UI-001-REACT_ARIA_COMBOBOX_PILOT.md) يوثق الإصدار والترخيص والـpeer والحدود؛ يبقى audit/Dependency Review وقياس bundle بعد التثبيت مشروطين بإغلاق baseline النظيف |

## قرار المراقبين

- **مراقب الجودة:** Conditional pass؛ البوابات التقنية تمر، وrevision نظيف هو الشرط المتبقي قبل `npm install`.
- **مراقب التسليم:** Conditional pass؛ التفويض وهدف الاختبار وقرار التبعية مكتملة، ويبقى ربط baseline بـrevision معتمد فقط.

**الخطوة الوحيدة المسموحة:** معالجة وتسجيل baseline وقرار التبعية. لا يضاف React Aria ولا يعدل مكوّن بحث قبل ذلك.

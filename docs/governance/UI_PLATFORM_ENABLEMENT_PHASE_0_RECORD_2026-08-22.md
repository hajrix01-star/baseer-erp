# سجل Phase 0 — تمكين منصة واجهة بصير

**Delivery ID:** `UI-PLATFORM-2026-08-22-P0`
**النطاق:** baseline للواجهة وقرار تبعية واحد، ثم Pilot واحد غير مالي لـ`BaseerCombobox`.
**السلطة:** [سلطة التسليم الحالية](CURRENT_DELIVERY_AUTHORITY.md).
**الحالة:** **Conditional pass — baseline مكتمل؛ استثناء مالك محدد حتى 2026-09-05 يسمح بدمج مصدر Phase 1 واحد والتحقق المحلي فقط، بينما P1 الأمنية تبقى مفتوحة.**
**Baseline revision:** `cc9c89d3300fd09c7cf9da413f85b172e32d6d62` (`establish UI platform enablement baseline`).

> **قرار لاحق حاكم:** حد `2026-09-05` أعلاه محفوظ كدليل تاريخي لقرار
> Phase 0، لكنه استُبدل للنشرة الأمنية وحدها بسياسة
> [قبول خطر Prisma للنشر الشخصي الخاص](PRISMA_PRIVATE_DEPLOYMENT_RISK_ACCEPTANCE_2026-08-22.md).
> يسمح القرار اللاحق بإكمال المشروع والنشر الخاص مع استمرار ضوابط العزل؛
> ولا يغيّر نتائج أو حدود الـPilot الوظيفية المسجلة هنا.

## ما فُحص

| البوابة | الأمر | النتيجة على revision المعتمد |
| --- | --- | --- |
| Web TypeScript | `npm run check --workspace @baseer-erp/web` | Pass |
| Architecture | `npm run check:architecture` | Pass |
| Production build | `npm run build --workspace @baseer-erp/web` | Pass |
| Dialog conventions | `npm run check:web-dialog-conventions` | Pass |
| Financial browser boundaries | `npm run check:web-financial-boundaries` | Pass |
| Localization guard | `npm run check:web-localization` | Pass |
| Web release budget بعد فصل CSS الإداري المؤجل | `npm run verify:web-budget` | Pass: initial CSS `54,162 B / 58,000 B`؛ أكبر route CSS `15,112 B / 16,000 B` |
| Browser E2E baseline | `npm run test:e2e --workspace @baseer-erp/web` | Pass: `33 passed`, و`1` skipped مقصود لاختبار شاشة الجوال ضمن مشروع desktop |
| Local database guard | `npm run verify:local-database` | Pass: `baseer_erp_test` على `127.0.0.1:5433` |

فصلت أنماط شركات الإدارة التي لا تظهر قبل دخول workspace من `styles.css` إلى `workspace-legacy.css` المؤجل؛ لم يتغير شكلها أو عقدها، وانخفض CSS الابتدائي `4,526 B`. أُعيد تشغيل كامل جدول البوابات من revision المشار إليه أعلاه. توجد تغييرات محلية أخرى خارج النطاق في الشجرة، لكنها لا تدخل في ملفات هذا baseline ولا تغير دليله المرتبط بالـSHA.

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

## دليل Pilot المحلي — 2026-08-22

- `BaseerCombobox` هو الغلاف الوحيد لـReact Aria؛ لا تستورده شاشة HR مباشرة. الاستهلاك الوحيد هو فلتر الموظف في «الإجازات والعودة»، بينما ظل حقل نموذج إنشاء الإجازة على `BaseerSearchSelect`.
- تمرر `remoteSearch(query, signal)` إلغاء الطلب إلى `listHrEmployees` ثم `api()`. عند تغير `scopeKey` يمسح الغلاف الخيارات والاختيار نفسه؛ فلا يبقى employee ID من شركة سابقة في فلتر الإجازات.
- `npm run check --workspace @baseer-erp/web` وbuild وحراس architecture/dialog/financial/localization تمر. `verify:web-budget` يمر: startup JS `243,938/250,000 B`، أكبر route `84,443/85,000 B`، CSS الابتدائي `54,162/58,000 B`، وchunk التفاعلي المؤجل `baseer-combobox` هو `188,684/200,000 B` (`56.73 KB` gzip). لا يدخل chunk مسار البداية أو مسار HR حتى يفتح المستخدم قائمة الفلاتر.
- تمر 8 اختبارات Playwright مستهدفة على desktop/mobile: العربية RTL والإنجليزية LTR، Home/End/Arrow/Enter، Escape مع إغلاق القائمة وعودة التركيز، pointer/الشاشة الضيقة، البحث الخادمي، رفض النتيجة المتأخرة، ومسح الاختيار عند تغير company scope مع إثبات أن الطلب النهائي للإجازات لا يحمل employee ID سابقاً.
- `npm audit --omit=dev` يعيد نفس `3 high` عبر Prisma/deepmerge؛ ليست React Aria في المسار. أما فحص اعتماد التشغيل الفعلي `npm audit --omit=dev --omit=optional` فيمر بصفر findings. تبقى P1 مفتوحة في build/migrate، لكنها لا تمنع دمج المصدر المحدد في استثناء المالك ولا تجيز إصداراً أو إنتاجاً.
- `npm run check:prisma-advisory-status` هو مراقب read-only لسجل npm الرسمي: يبلغ متى تصبح نسخة Prisma المستقرة تعتمد `deepmerge-ts` 8 أو أحدث. لا يغيّر lockfile أو يثبت شيئاً؛ عند الإبلاغ عن fix يبدأ نطاق أمني منفصل للترقية المتطابقة وإعادة الفحوص.
- آخر تشغيل للمراقب: `pending-official-fix`؛ `prisma@7.9.1` و`@prisma/config@7.9.1` وما زال الأخير يعتمد `deepmerge-ts@7.1.5`.

## شروط الانتقال المغلقة واللاحقة

| البند | المالك | شرط الإغلاق |
| --- | --- | --- |
| baseline غير نظيف | مالك الشجرة/التسليم | **مغلق:** revision المحدود `cc9c89d3300fd09c7cf9da413f85b172e32d6d62` يحتوي baseline، وأعيد تشغيل جميع بوابات الجدول عليه |
| HR browser baseline | Phase 0 | **مغلق:** `mockHr` أصبح يزرع refresh token ووقت انتهاء للجلسة، مطابقةً لعقد `activeSession()` الحالي؛ suite الكاملة تمر |
| ضبط قاعدة البيانات المحلية | Platform/Database | **مغلق:** `verify:local-database` ضمن `package.json` و`scripts/verify-local-database.mjs` يتحققان قراءةً من `apps/api/.env.baseer-test` ويقبلان فقط `baseer_erp_test` على `127.0.0.1:5433`. شُغّل بنجاح؛ لا يغير UI أو API أو صلاحيات أو قرار React Aria. يجمعان في التغيير نفسه عند اعتماد revision. |
| قرار تبعية React Aria | BAQC-05/06/08/09/10 | [ADR-UI-001](ADR-UI-001-REACT_ARIA_COMBOBOX_PILOT.md) يوثق الإصدار والترخيص والـpeer والحدود؛ يبقى audit/Dependency Review وقياس bundle بعد التثبيت قبل بدء الـPilot |
| `GHSA-ggr8-5vv4-36mx` — `deepmerge-ts` | Platform/Data + BAQC-08 | **P1 مفتوح ومخفف في API العامة:** فحص `npm audit --omit=dev` بعد التثبيت وجد `3 high` عبر `prisma@7.9.1 → @prisma/config@7.9.1 → deepmerge-ts@7.1.5` (المتأثر `<8.0.0`). لا تدخل `react-aria-components` في هذا المسار. لا توجد نسخة Prisma 7 رسمية أحدث حتى تاريخ المراجعة؛ `@prisma/config@7.9.1` يثبت `7.1.5` حرفياً. فحص اعتماد التشغيل الفعلي `npm audit --omit=dev --omit=optional` يمر بصفر findings، وفصل Docker صورة التشغيل عن `migrate` job يثبت غياب `prisma` و`@prisma/config` و`deepmerge-ts` من API العامة؛ اختبر runtime readiness على قاعدة الاختبار. تبقى P1 في build/migrate إلى patch رسمي. لا يستخدم `npm audit fix --force` ولا override إلى `deepmerge-ts@8`. وافق المالك استثناءً مؤقتاً حتى 2026-09-05 يجيز **دمج المصدر والتنفيذ والتحقق المحلي** لمرشح الموظف في فلتر «الإجازات والعودة» فقط، بلا إصدار/إنتاج أو نطاق آخر. |

## قرار المراقبين

- **مراقب الجودة:** Pilot يمر بعد إثبات مسح company scope وميزانية chunk مستقلة؛ لا يغلق P1. استثناء المالك يجيز دمج المصدر المحدد فقط، لا إصداراً أو إنتاجاً.
- **مراقب التسليم:** أدلة الـPilot مسجلة؛ لا يتوسع الاستهلاك أو نطاق المكتبات قبل قرار مالك جديد بعد معالجة P1.

**الخطوة الوحيدة المسموحة:** دمج الـPilot المحدد مع الحفاظ على الاستثناء حتى 2026-09-05، ومراقبة patch Prisma الرسمي. لا توسعة أو إصدار/إنتاج قبل ترقية stack متطابق وإعادة التحقق.

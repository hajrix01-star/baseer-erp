# المرحلة 3 — المعمارية وجودة الكود

## الحكم

المعمارية العامة متماسكة ومناسبة لمونوليث معياري صغير/متوسط: عقود مشتركة، سياق وصول مركزي، معاملات tenant، وخدمات أعمال واضحة. أكبر مخاطر الصيانة هي التجميع اليدوي المركزي، ملفات شديدة الضخامة، وحارس «architecture» لا يفحص فعلياً بنية الاعتماديات. لا يوجد في هذه المرحلة دليل على خطأ بيانات مباشر ناتج عن المعمارية.

## الفحوص المنفذة

| الفحص | النتيجة | الدليل |
|---|---|---|
| أساس architecture الحالي | ناجح | `node scripts/check-architecture.mjs` |
| تسجيل Nest controllers | ناجح — 46/46 | `node scripts/check-nest-registration.mjs` |
| نمط تحقق أجسام الطلبات | لا controller يستقبل `@Body` دون `.parse`/`.safeParse` | جرد static لكل `*.controller.ts` |
| الوصول المباشر لـPrisma client خارج tenant transaction | 4 مواضع مقصودة فقط: startup/readiness وlookup tenant عند sign-in | `main.ts:57-58`؛ `observability.service.ts:69`؛ `auth.service.ts:362` |
| دورات مباشرة بين ملفين | دورة source واحدة، type-only من جانب واحد | `decision-context-import.service.ts:8,26` ↔ `saudi-context-catalog.ts:3` |

## النتائج

### ARCH-01 — AppModule مركزي وتجميع يدوي واسع

- **الحالة:** أصفر؛ **الخطورة:** متوسطة؛ **الثقة:** مؤكدة من الكود.
- `apps/api/src/app.module.ts:4-136` يستورد كل controller/service تقريباً، ثم مصفوفتان يدويتان طويلتان في `:149-236`.
- وجود controller غير مسجل كان خطراً واقعياً بما يكفي لإضافة `check-nest-registration` في التغيير الحالي. الحارس الجديد جيد لكنه يغطي controllers فقط، لا providers المفقودة ولا حدود الوحدات ولا exports.
- الأثر: merge conflicts، bootstrap coupling، وصعوبة اختبار/تفعيل نطاق بمعزل عن البقية.
- المعالجة: تقسيم Nest modules حسب الهوية/المالية/HR/operations/reports/AI، مع module registration tests؛ يبقى deployment مونوليثاً.

### ARCH-02 — وحدات ضخمة تتجاوز مسؤولية قابلة للصيانة

- **الحالة:** أصفر؛ **الخطورة:** متوسطة؛ **الثقة:** مؤكدة من الكود.
- أكبر ملفات الويب: `treasury-workspace.tsx` 1900 سطر، `finance-setup-workspace.tsx` 1711، `purchase-expense-workspace.tsx` 1546.
- أكبر ملفات الخادم: `decision-intelligence.service.ts` 1293، `ai-platform.service.ts` 1261، `hr-payroll.service.ts` 1180، `ai-runtime.service.ts` 970.
- العقود المالية نفسها 1496 سطراً. توجد 84 service و46 controller لكن بعض الخدمات ما زالت تجمع orchestration وqueries وpolicy/formatting.
- الأثر: ارتفاع احتمال regression وصعوبة المراجعة والاختبار الجزئي، خصوصاً في المالية والرواتب.
- المعالجة: فصل command/query/policy/receipt mappers داخل النطاق نفسه، وتقسيم workspaces إلى containers وتبويبات مستقلة.

### ARCH-03 — اسم بوابة architecture أوسع من فحصها الفعلي

- **الحالة:** أصفر؛ **الخطورة:** منخفضة؛ **الثقة:** مؤكدة من الكود.
- `scripts/check-architecture.mjs:3-27` يتحقق فقط من وجود ثلاث وثائق وثلاث عبارات policy markers؛ لا يفحص imports أو layering أو cycles أو forbidden dependencies.
- الأثر: نجاح CI قد يُفهم خطأ كإثبات معماري. فحص controller registration الحالي يسد فجوة واحدة فقط.
- المعالجة: إضافة قواعد import boundaries ودورات الاعتماد وتسجيل providers، مع إبقاء فحص الوثائق باسمه الأدق.

### ARCH-04 — إعدادات التشغيل موزعة

- **الحالة:** أصفر؛ **الخطورة:** متوسطة؛ **الثقة:** مؤكدة من الكود.
- `process.env` مستخدم مباشرة في 19 ملفاً. `validatePrivateDeploymentConfiguration` يتحقق من deployment mode/domain/backup label/system tenant/JWT فقط (`private-deployment-config.ts:14-63`).
- تكاملات Gmail/AI/scanner/schedulers تتحقق غالباً عند الاستعمال أو حسب feature gate، ولا يوجد schema مركزي يطبع قائمة الإعدادات الفعالة/الناقصة بأمان.
- الأثر: أخطاء إعداد متأخرة وتشخيص تشغيل أصعب، مع خطر اختلاف أسماء المفاتيح (`IDENTITY_JWT_SECRET` مقابل أسماء قديمة في CI historical changes).
- المعالجة: typed config module واحد، validation حسب feature set عند startup، وredacted readiness diagnostics.

### ARCH-05 — دورة source type-only

- **الحالة:** أخضر/تحسين؛ **الخطورة:** منخفضة؛ **الثقة:** مؤكدة من الكود.
- `decision-context-import.service.ts` يستورد `buildSaudiContextCatalogDocument`، بينما `saudi-context-catalog.ts:3` يستورد `OfficialContextDocumentV1` كـ`import type` من الخدمة.
- لا توجد دورة runtime لأن import الآخر type-only، لكن العقد ينتمي إلى ملف مستقل أو contracts لتجنب coupling عكسي.

## نقاط قوة مثبتة

- كل controller يقبل body يطبّق Zod parse/safeParse؛ لا تعتمد المنظومة على DTO decorators لكنها تملك عقود runtime مشتركة، وهذا بديل صحيح.
- Company/Tenant authorization مركزي ويعيد فحص user/session/membership/grants من DB، وليس من claims فقط.
- `DatabaseService.inTenantTransaction` يربط كل عملية tenant بإعداد RLS محلي للمعاملة.
- معالجة الأخطاء مركزية في `ApiExceptionFilter`، والرصد عبر interceptor؛ الويب يمرر الأخطاء عبر `presentBaseerApiError` في غالبية التدفقات.
- تقسيم Daily Sales وReports وHR إلى خدمات فرعية يوضح اتجاهاً جيداً يمكن تعميمه على الملفات الأكبر.

## الاعتماديات والتكرار والمعاملات

- لم يظهر وصول business مباشر إلى `database.client` خارج الاستثناءات النظامية الأربعة المذكورة؛ الخدمات تستخدم معاملات tenant.
- لا توجد طبقة repositories عامة، لكن Prisma معزول عملياً داخل services. إضافة repository موحد بلا حاجة ستزيد التجريد؛ المطلوب هو فصل queries الحرجة القابلة للاختبار فقط.
- تتكرر أنماط `authorize` وparse/error داخل controllers؛ يمكن تقليلها بمساعدات دقيقة، مع تجنب guard عام يخفي capability المطلوبة لكل endpoint.
- المعاملات المالية تدقق لاحقاً في المرحلتين 4 و7؛ نجاح النمط المعماري لا يثبت atomicity لكل تدفق.

## فشل أداة وتشخيصه

فشل فاحص دورة imports ad-hoc الأول بسبب quoting في `node -e` على PowerShell (exit 1 بلا مخرجات). أُعيد مرة واحدة بتنفيذ PowerShell قراءة فقط ونجح: 180 ملف API غير مولد، ودورة مباشرة واحدة type-only. لا أثر متبقياً.

## تحقق معايير القبول

- [x] فُحص الفصل والتعقيد والتكرار والاعتماديات والدورات.
- [x] فُحصت أنماط validation/error/config/transactions.
- [x] فُصلت نقاط الصيانة عن أخطاء السلامة الفعلية.
- [x] كل نتيجة مرتبطة بكود أو فحص منفذ.

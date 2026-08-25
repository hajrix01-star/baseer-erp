# المرحلة 0 — خط الأساس وسلامة بيئة العمل

## النتيجة

**مكتملة مع ملاحظات.** لقطة التدقيق هي شجرة العمل الحالية غير النظيفة عند commit `8caa57668ccbd28287cf9da0766fcec2132c9b2d` على فرع `master`، وليست `HEAD` المجرد. لم يُعدّل أو يُحذف أي ملف قائم.

## حالة Git

- بدأ الفحص بملفات معدلة وغير متتبعة تخص أعمال التقارير والتنقل والعقود وCI؛ من أمثلتها `.github/workflows/verify.yml` و`apps/api/src/app.module.ts` و`apps/web/src/App.tsx` و`package.json`، إضافة إلى ملفات تقارير جديدة. هذه التغييرات محفوظة كما هي.
- آخر commit: `8caa576` بتاريخ 2026-08-25 01:23:24 +03:00، الرسالة `fix(charts): scale inline bars by selected share`.
- توجد مخرجات محلية متجاهلة (`dist/`، `test-results/`، سجلات `.tmp-*`، و`.env.*`). لا تُعد دليلاً إصدارياً بذاتها.
- لم يوجد ملف `AGENTS.md` داخل المستودع.

## البنية والتقنيات

| النطاق | التقنية/الدور | الدليل |
|---|---|---|
| API | NestJS 11 + Fastify 5 + TypeScript ESM | `apps/api/package.json`؛ `apps/api/src/main.ts:3-20` |
| Web | React 19 + Vite 7 + TanStack Query/Table + React Aria + RHF/Zod | `apps/web/package.json` |
| العقود | Zod + TypeScript، حزمة مشتركة | `packages/contracts/package.json` |
| المخرجات | طباعة/Excel عبر `xlsx` | `packages/output-platform/package.json` |
| البيانات | PostgreSQL 16 + Prisma 7.9.1 | `.github/workflows/verify.yml:18-36`؛ `apps/api/prisma/schema.prisma` |
| التشغيل | API وWeb وحاوية migration منفصلة، Caddy TLS edge، Nginx SPA | `Dockerfile`؛ `Dockerfile.web`؛ `docker-compose.private-online.yml` |
| النموذج | Modular Monolith متعدد الشركات | `README.md:1-3`؛ التجميع المركزي في `apps/api/src/app.module.ts:138-236` |

الإصدارات المرصودة محلياً: Node `v24.18.0`، npm `11.16.0`، Git `2.55.0.windows.2`، Docker CLI `29.7.2`، Prisma CLI/client `7.9.1`، TypeScript `5.9.3` في أداة Prisma. جرد المصدر/الوثائق والإعدادات غير المتجاهلة أعاد 983 ملفاً تقريباً، منها 704 تحت `apps/` و170 تحت `docs/`. جرد المصدر المستهدف وجد 561 ملفاً في API/Web/contracts/output-platform، منها 403 TypeScript و131 TSX.

## التطبيقات ونقاط الدخول

- `apps/api/src/main.ts`: يحمّل البيئة، يتحقق من إعداد private deployment، يسجل Helmet، يضع prefix باسم `/v1`، يضيف `Cache-Control: no-store, private` للطلبات المصادق عليها، يسجل مرشح الأخطاء والرصد، ويتحقق من اتصال قاعدة البيانات قبل الاستماع (`main.ts:15-62`).
- `apps/web/src/main.tsx`: نقطة دخول React؛ التطبيق الرئيسي في `apps/web/src/App.tsx`.
- `apps/shell/`: نماذج/ملفات static قديمة وليست workspace في `package.json` ولا تدخل صور الإنتاج الحالية؛ تُعامل خارج نطاق الإصدار المنشور ما لم يثبت نشر مستقل.
- `packages/contracts` و`packages/output-platform`: مكتبتان داخليتان ضمن npm workspaces.

## قاعدة البيانات والهجرات

- مخطط Prisma واحد في `apps/api/prisma/schema.prisma`.
- 116 مجلد migration محلياً؛ التسلسل يبدأ بـ`20260814194500_identity_company_core` وينتهي حالياً بـ`20260824230000_marketing_campaign_stop_context`.
- CI يشغل `prisma generate` ثم `prisma migrate deploy` على PostgreSQL اختبار، وبعدها ينتقل إلى مستخدم تطبيق مقيد. لم يُشغّل أي migration أو seed أثناء هذا التدقيق.
- `.env.baseer-test` موجود محلياً لكنه متجاهل، بينما `.env.example` فقط متتبع. لم تُقرأ أو تُعرض قيم أسرار محلية.

## البناء والاختبار وCI/CD

- أوامر type check: `npm run check --workspace @baseer-erp/{contracts,api,web}`؛ API/contracts يستخدمان `tsc --noEmit`، بينما web يستخدم `tsc -b` وقد يكتب ملفات incremental وفق `tsconfig`، لذا لا يُشغّل إلا مع توجيه آمن أو يُوثق كغير منفذ.
- البناء يكتب `dist/` ولذلك لا يُشغّل مباشرة ضمن قيد الكتابة الحصري للتقارير.
- CI الحالي يضم: تثبيت نظيف، generate/migrate على قاعدة اختبار، role مقيد، architecture/registration/permissions/UI guards، type checks/builds، صور Docker، اختبارات DB/HTTP حرجة، web budget، و`npm audit --omit=dev --omit=optional` (`.github/workflows/verify.yml:32-82`).
- التعديل غير الملتزم به يضيف `check:nest-registration` و`verify:finance-accounts-http` إلى CI؛ لذا نجاح CI التاريخي لا يثبت هذه الإضافات بعد.
- لا يوجد دليل محلي في هذه اللقطة على نتيجة أحدث workflow مستضاف، ولم تُستخدم الشبكة وفق حدود المهمة.

## إعداد الإنتاج المرصود

- `docker-compose.private-online.yml` يعزل شبكة قاعدة البيانات، يشغّل API/Web read-only مع `no-new-privileges`، ويعرّض Caddy فقط على 80/443.
- Caddy يوجه `/v1/*` إلى API والباقي إلى Web، ويفرض HSTS وCSP وheaders إضافية (`docker/Caddyfile.private-online:1-22`).
- صورة API runtime تستبعد Prisma CLI و`@prisma/config` و`deepmerge-ts`، بينما تبقى أداة الهجرة في image داخلي منفصل (`Dockerfile`).
- `ops/` نفسه يحوي مثال environment فقط، لكن `docs/operations/` يحوي baseline وrunbooks للإطلاق والتعافي والحوادث وتجربة private-online. توجد كذلك شهادة محلية مهملة من Git لتجربة restore اصطناعية بتاريخ 2026-08-15 على 12 جدولًا. لا توجد شهادة restore حديثة للمخطط الحالي ذي 149 model، ولا دليل مزود/تنبيه/نسخة إنتاج فعلية؛ الفجوة في **التنفيذ والإثبات الحالي** لا في غياب الوثيقة.

## ملاحظات البيئة وفشل الأدوات

1. أعاد Docker CLI تحذير `Access is denied` عند محاولة قراءة إعداد المستخدم `C:\Users\hp\.docker\config.json`، لكنه عرض الإصدار. الأثر: لم يُتحقق من daemon أو صور/حاويات عبر هذا الأمر.
2. فشل جرد الملفات الأول بسبب استعمال overload خاطئ لـPowerShell `String.Split`. شُخّص مرة وأعيد بصيغة regex آمنة، ونجح بإجمالي 983. لا أثر على النتيجة.
3. بحث TODO الأول كان واسعاً لأنه التقط كلمة `placeholder` في JSX، فتجاوز حجم الإخراج. سيُعاد في المرحلة 1 بتعبيرات أدق؛ لا يُعتمد الإخراج المبتور كجرد.

## تحقق معايير القبول

- [x] حالة Git واللقطة المرجعية موثقتان.
- [x] التطبيقات والتقنيات ونقاط الدخول وقاعدة البيانات محددة.
- [x] أوامر البناء والفحص وحدود كتابتها معروفة.
- [x] CI/CD والحاويات وإعدادات البيئة المهمة محددة.
- [x] فشل الأدوات والأثر موثق؛ لا توجد كتابة خارج `docs/audit/` من هذا التدقيق.

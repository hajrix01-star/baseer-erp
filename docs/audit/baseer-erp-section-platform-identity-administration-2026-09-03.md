# تسليم ألفا — قسم المنصة والهوية والإدارة

- **تاريخ الفحص:** 2026-09-03
- **مرشح الفحص:** `f0fecea91afd6705b400c004f8771b6b2c1034aa`
- **القرار:** **NO-GO للإنتاج — لا توقيع قبول للقسم**
- **حدود القرار:** المنصة، الهوية، العزل متعدد الشركات، الإدارة، وحلقة بناء/إطلاق المرشح. لا يحكم هذا المستند على بقية أقسام ERP.

## مرجع الخريطة

رُوجع مرجع خريطة التسليم الموجود وسجل التغييرات من `7cbddbf1` حتى المرشح. تركزت الفروق في الحضور، نقل API للويب، UI، وامتيازات قاعدة البيانات وCI؛ لا يوجد تغيير معماري يبرر إعادة اكتشاف النظام. المرجع قائم ولم يُعاد رسمه.

## تحقق ناجح قابل لإعادة التنفيذ

- `npm run verify:administration-lifecycle`: مرّ. يغطي منع غير المصرح، RLS بين الشركات، التعطيل/التفعيل، reset، سحب العضوية والجلسات، تدقيق مخفف، وحماية آخر مالك.
- `node scripts/run-auth-throttling-verification.mjs`: مرّ (خمسة محاولات للهوية ثم 429، وعشر هويات لنفس IP ثم 429).
- `npm run check:authorization-consistency`: مرّ.
- `npm run check:session-resilience`: مرّ.
- `npm run check:administration-rls`: مرّ؛ تسعة نماذج هوية/إدارة محمية بـ ENABLE+FORCE وسياسة مستأجر.
- `npm run check:web-api-transport` و`npm run check:architecture`: مرّا.

## الموانع

| المعرّف | الخطورة | الدليل | الأثر | الإغلاق المطلوب |
| --- | --- | --- | --- | --- |
| `ID-PLAT-001` | P1 | `apps/api/src/administration/administration.service.ts` يسمح بتعديل grants لدور نظامي، والواجهة `apps/web/src/administration-roles-panel.tsx` تعرض ذلك. لكن `apps/api/src/company-context/company-context.service.ts` يطبق قالب `BASEER_COMPANY_MANAGER` في الذاكرة متجاوزاً grants المخزنة. | قد يبدو سحب صلاحية من مدير الشركة ناجحاً ومسجلاً في التدقيق، مع بقاء الوصول التنفيذي قائماً. | اجعل مصدر الصلاحيات واحداً؛ والأكثر أماناً منع تعديل/حذف الأدوار النظامية في API والواجهة. أضف اختبار HTTP يثبت أن سحب صلاحية يمنع الطريق المحمي. |
| `OPS-PLAT-001` | P1 | workflow يبني ويفحص لكنه لا يثبت صورة immutable أو digest/SBOM للمرشح؛ compose ما زال يملك `build.context` ويعتمد tag. أدلة الصور المتاحة تخص commit أقدم. | لا توجد سلسلة إثبات للمرشح الحالي من commit إلى image ثم نشر ورجوع آمنين. | ابنِ في CI من commit، انشر digest/SBOM، واجعل compose الإنتاجي يستهلك image@sha256 بلا build، مع سجل digest وmigration checksum وخطة rollback. |

## نتائج غير مانعة مسجلة

| المعرّف | الخطورة | الملاحظة |
| --- | --- | --- |
| `ID-PLAT-002` | P2 | سجل `identity.owner_activated` يصف entity كجلسة بينما المعرف معرف مستخدم؛ صحح نوع الكيان أو اربط جلسة صحيحة. |
| `ID-PLAT-003` | P2 | دور التطبيق يملك DML واسعاً على `Tenant` غير المحمي بـRLS؛ خفّضه إلى SELECT وانقل تغيير المستأجر إلى دور إداري مستقل. |
| `ID-PLAT-004` | P2 | refresh token محفوظ في `sessionStorage`؛ انقله إلى HttpOnly/Secure/SameSite cookie مع CSRF مناسب. |
| `ID-PLAT-005` | P2 | لا يوجد global fail-closed auth guard؛ الحماية يدوية متسقة حالياً لكن الطريق الجديد قد يُنسى. |
| `ID-PLAT-006` | P2 | الحد الأدنى لكلمة المرور ستة رموز؛ ارفعه بسياسة مناسبة لحسابات ERP. |
| `OPS-PLAT-002` | P2 | صور الأساس تستخدم tags متحركة لا digests. |
| `QLT-PLAT-003` | P2 | حارسا UI ratchet فشلا محلياً (native controls وinline/z-index) وليسا جزءاً من CI. |

## حدود الدليل

لم يُنفذ نشر أو تعديل على Hostinger أو DNS أو قاعدة إنتاج. لا يوجد إثبات خارجي حالي لـDNS/HTTPS، النسخ والاستعادة، أو artifact CI للمرشح. هذه موانع إصدار مستقلة حتى بعد إغلاق عيوب المصدر.

## التوقيع

**فريق تسليم ألفا: لا يوقّع قبول هذا القسم الآن.** لا يبدأ فحص القسم التالي قبل معالجة مانعي P1 وإعادة تحقق المسارات المتأثرة، أو اعتماد استثناء صريح من المالك.

## ملحق العلاج وإعادة التحقق — 2026-09-03

### المانعان المغلقان

- `ID-PLAT-001`: أغلِق. ترفض خدمة الإدارة تعديل أو حذف أي دور `isSystem` بـ403، ولا تعرض لوحة الأدوار إجراء تعديل للدور النظامي. أُضيف تحقق HTTP يثبت الرفض وبقاء الدور دون تغيير.
- `OPS-PLAT-001`: أغلِق في المصدر. compose الإنتاجي لا يبني checkout ويستهلك صور `image@sha256` فقط. CI على الفرع الرئيسي يبني وينشر صور API/migrate/web، ويرفق OCI SBOM/provenance، ثم يحفظ manifest يحوي commit والصور ذات digests. بوابة preflight تتحقق من ملف البيئة والـmanifest وترفض tags وعدم التطابق قبل `compose up`.

### أدلة الإعادة

- `npm run verify:administration-lifecycle` — مرّ، بما فيه immutability للدور النظامي.
- `node scripts/check-release-provenance-contract.mjs` — مرّ، بما فيه رفض tag وعدم تطابق manifest.
- `npm run check --workspace @baseer-erp/web` و`npm run check --workspace @baseer-erp/api` — مرا.
- `docker compose --env-file ops/private-online/.env.private-online.example -f docker-compose.private-online.yml config -q` — مرّ؛ التحذير المحلي فقط أن ملف Docker config غير قابل للقراءة، ولم يمنع التحقق.

### قرار الإعادة

**CONDITIONAL GO للقسم في مرشح المصدر:** مانعا P1 مغلقان ومثبتان محلياً. لا يعني ذلك GO لإطلاق الإنتاج بعد، إذ ما زال يلزم تشغيل CI على commit منشور لإنتاج manifest/digests الفعلية، وإغلاق Gate C الخارجية (DNS/HTTPS والنسخ والاستعادة). تبقى ملاحظات P2 المسجلة في هذا التقرير، ومنها refresh token في `sessionStorage` وحراس UI غير الخضراء محلياً، خارج علاج هذه الشريحة.

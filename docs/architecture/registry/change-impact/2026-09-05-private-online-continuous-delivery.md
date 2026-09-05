# BASEER-IMPACT-2026-09-05-PRIVATE-ONLINE-CONTINUOUS-DELIVERY

- **Registry:** `BASEER-ARCH v1.0`
- **Classification:** `ARCHITECTURAL`
- **Owner module:** `platform-data-contracts`
- **ADR:** `ADR-OPS-001-PRIVATE-ONLINE-CONTINUOUS-DELIVERY.md`

## G0 — الهدف والنطاق

المالك فوّض نشر Baseer ERP الحي تلقائياً بعد نجاح `main`. معيار القبول هو أن
كل commit ناجح يملك manifest وصوراً مطابقة ويصل إلى Baseer فقط على Hostinger،
ثم يثبت health؛ فشل ما بعد migration يتوقف مع دليل recovery بدلاً من rollback
آلي غير آمن. لا تدخل بيانات Noorix، ولا تعديل DNS،
ولا shell حر أو سر تطبيق في GitHub.

## G1 — السعة والاستمرارية

يوجد نشر إنتاج واحد فقط في اللحظة نفسها (`concurrency`). حاويات Baseer الحالية
هي API/Web/Caddy/PostgreSQL؛ الهجرة والـgrant jobs تبقيان one-shot وفق Compose.
يحفظ الخادم release directories وlast-known-good Compose، وتتحقق رحلة health
من API وWeb قبل إعلان النجاح. فشل ما قبل migration لا يغير الخدمة؛ بعد migration
يصبح الرجوع قرار توافق/استعادة صريحاً. لا يدّعي هذا قياس حمل أو يغيّر سعة قاعدة البيانات.

## G2 — العقود والحدود

مدخل النشر هو commit كامل وmanifest من CI. الصور الثلاث يجب أن تكون digest-only
ومن أسماء GHCR الخاصة بـBaseer. ملف البيئة الحقيقي لا يغادر Hostinger؛ ينسخ
محلياً إلى release جديد ثم تعدّل صور API/Migrate/Web فقط. يظل PostgreSQL وCaddy
مثبتين كما هما. SSH forced command هو الحد بين GitHub وإدارة الخادم.

## G3 — المسار التقني

لا اعتماد جديد. يضاف workflow Deploy يعتمد أدوات Actions الرسمية وOpenSSH وtar
الموجودة، مع Bash server scripts مثبتة root-owned. رفضنا self-hosted runner
المشترك لأن نطاقه يتجاوز Baseer. لا يحتاج الخادم Node أو jq.

## G4 — التشغيل والمراقبة

يعرض GitHub deployment في `production` وسجل workflow؛ يسجل النص الخادمي SHA
والـdigest ونتيجة health من دون أسرار. التفعيل الآلي يقع بعد CI فقط ولا توجد
واجهة مستخدم أو أثر RTL/LTR.

## بوابات التنفيذ

- G0–G4: مكتملة للتصميم وفق ADR المذكور.
- G5: بناء workflow والنصوص واختبارات العقد المحلية.
- G6: rehearsal على الخادم بالإصدار الحالي أو مرشح digest وبلا بيانات أعمال.
- G8: مراجعة تسليم مستقلة قبل تفعيل publish on `main`.

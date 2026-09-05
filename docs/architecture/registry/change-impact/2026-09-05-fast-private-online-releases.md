# BASEER-IMPACT-2026-09-05-FAST-PRIVATE-ONLINE-RELEASES

- **Registry:** `BASEER-ARCH v1.0`
- **Classification:** `ARCHITECTURAL`
- **Owner module:** `platform-data-contracts`
- **ADR:** `ADR-OPS-002-FAST-PRIVATE-ONLINE-RELEASES.md`

## G0 — الهدف والنطاق

يعتمد المالك مساراً افتراضياً أسرع: قبول كامل على طلب الدمج، ثم preflight
محدود وصور immutable ونشر تلقائي من `main`. معيار القبول هو عدم إعادة مجموعة
الجودة أو Playwright الثقيلة على `main`، مع بقاء manifest/digest/SSH المقيد
والتحقق الصحي للخادم. لا يتغير تطبيق ERP أو بياناته أو Noorix أو DNS أو الأسرار.

## G1 — السعة والاستمرارية

تعمل الصور الثلاث بالتوازي بعد preflight واحد. لكل target نطاق cache مستقل
يمنع التزاحم؛ ويظل نشر production متسلسلاً كما في ADR-OPS-001. لا يدعي القرار
اختبار حمل، ولا يزيد سعة الإنتاج. عند فشل cache، يبني Buildx بصورة كاملة صحيحة
بدلاً من استعمال artifact غير موثق.

## G2 — العقود والحدود

يبقى commit `main` مصدر الـmanifest والصور ذات digest. لا يوجد انتقال بيانات أو
عقد API أو صلاحية جديدة. شرط القبول التشغيلي الآن مفروض داخل preflight: commit
`main` مرتبط بـPull Request مدمج وفحصه الكامل أخضر، وإلا لا يبدأ بناء الصور.
وحين تتاح حماية GitHub المناسبة يكون `quality` و`web-acceptance` required/up-to-date
قبل الدمج كذلك.

## G3 — المسار التقني

لا اعتماد جديد. يستعمل workflow Actions وBuildx cache الرسميين الموجودين.
يُبقي `release-preflight` تحقق العقد من checkout النهائي، ولا يبدأ النشر إلا
بعد اكتمال كل صور digest وmanifest.

## G4 — التشغيل والمراقبة

يسجل GitHub مراحل PR الكاملة، ثم مراحل main: preflight، الصور، manifest،
deployment. فشل محاولة تفعيل حماية الفرع موثق كقيد خطة حساب لا كتعطيل للفحص.

## بوابات التنفيذ

- G0–G4: معتمدة لهذا القرار؛ لا UI أو بيانات أو مكتبات.
- G5–G7: تعديل workflow وحارس عقد، ثم تحقق YAML/العقد وCI الخارجي.
- G8: مراجعة تسليم مستقلة للـcommit ونتيجة run على main قبل اعتباره الافتراضي.

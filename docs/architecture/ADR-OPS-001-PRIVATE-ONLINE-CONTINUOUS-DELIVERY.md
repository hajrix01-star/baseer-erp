# ADR-OPS-001 — النشر المستمر المقيد لـ BASEER ERP على البيئة الخاصة

- **الحالة:** Accepted for implementation
- **التاريخ:** 2026-09-05
- **المرجع:** `BASEER-ARCH v1.0`
- **المالك:** `platform-data-contracts`

## السياق

يبني CI في `verify.yml` صور API وMigrate وWeb غير قابلة للتغيير بالـdigest
وينتج manifest للـcommit، لكنه لا يملك مرحلة تصل إلى Hostinger. أثبت فحص
الخادم أن البيئة الحية تعمل بإصدار محفوظ سابق؛ نجاح GitHub وحده لا يبدّل
الحاويات. الخادم نفسه يستضيف تطبيقات أخرى، لذلك لا يجوز استعمال إعادة تشغيل
عامة أو Runner مشترك ذي shell حر.

## القرار

نعتمد مساراً أحادي الاتجاه:

`main CI → manifest immutable → GitHub-hosted deploy job → SSH key مقيد → deploy-release محدود على Hostinger → preflight/Compose/health/rollback`.

- لا يثبت Self-hosted Runner على خادم Baseer ولا يعاد استخدام Runner نوركس.
- Job النشر يعمل فقط بعد CI وmanifest الناجحين، مع `production` environment
  وconcurrency واحدة تمنع تقاطع الإصدارات.
- GitHub يحتفظ فقط بمفتاح SSH الخاص بالمستخدم المقيد وhost/port/known-hosts.
  أسرار قاعدة البيانات وJWT والتخزين تبقى حصراً في ملف environment محلي root-owned.
- المفتاح المقيد لا يمنح terminal أو forwarding أو نقل ملفات عام؛ يقبل
  `deploy-release <40-char-sha>` فقط، ويستقبل bundle مكوناً من Compose وCaddy
  من checkout الناجح على stdin.
- النص البرمجي root-owned على الخادم لا يقبل tags أو مراجع خارج
  `ghcr.io/hajrix01-star/baseer-erp-{api,migrate,web}@sha256:<digest>`، وينسخ
  ملف البيئة الحالي إلى مجلد الإصدار الجديد ثم يبدل متغيرات صور التطبيق فقط.
- قبل أي cutover يحفظ Compose السابق كنقطة رجوع. فشل `pull` أو preflight لا يغير
  الحاويات. بعد بدء Prisma migrate يفشل النشر ويحتفظ بدليل الإصدار السابق
  والجديد؛ لا يعيد التطبيق تلقائياً لأن migration قد لا تكون متوافقة عكسياً.
  يكون الرجوع بعد migration قرار تشغيل صريحاً مع تحقق التوافق/الاستعادة، ولا يمس
  نوركس أو n8n أو أي مشروع آخر.

## البدائل المرفوضة

1. **نشر يدوي من Hostinger:** يفسر التباين بين commit الحي وGitHub ولا يعطي سلسلة دليل.
2. **نسخ Runner نوركس:** يوسع حد الثقة إلى تطبيق آخر ويمنح workflow بيئة إنتاج دائمة.
3. **إرسال ملف البيئة أو كلمات المرور إلى GitHub:** يكسر حد الأسرار ولا يلزم للنشر.
4. **بناء checkout في الإنتاج أو استخدام tags:** لا يربط النشر بالصور الموثقة ويمنع rollback دقيقاً.

## الأثر والتراجع

لا تغيير schema أو بيانات أعمال أو DNS في bootstrap. الهجرة تبقى مهمة Compose
قصيرة العمر ومقيدة كما في العقد القائم. قبل migration، فشل التحضير لا يغير
اللايف؛ وبعد migration يكون الرجوع قراراً مدروساً لا rollback آلياً. التراجع
البرمجي بإلغاء commit يوقف المسار الجديد. أول تفعيل يتطلب bootstrap يدوي مرة
واحدة من root لإضافة المفتاح العام والمستخدم المقيد فقط.

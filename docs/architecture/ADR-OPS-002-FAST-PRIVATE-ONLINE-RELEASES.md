# ADR-OPS-002 — إصدار Baseer السريع بعد قبول طلب الدمج

- **الحالة:** Accepted for implementation
- **التاريخ:** 2026-09-05
- **المرجع:** `BASEER-ARCH v1.0`
- **المالك:** `platform-data-contracts`
- **يكمل:** `ADR-OPS-001-PRIVATE-ONLINE-CONTINUOUS-DELIVERY.md`

## السياق

كان مسار `main` يعيد تشغيل مجموعة الجودة الكاملة وقبول Playwright بعد أن تكون
نفذت بالفعل على طلب الدمج، ثم يبدأ بناء الصور. هذا يضيف زمناً متسلسلاً قبل
النشر ولا يضيف فحصاً تشغيلياً خاصاً بالـartifact النهائي.

## القرار

- تصبح `quality` و`web-acceptance` بوابتي قبول كاملتين لكل Pull Request فقط؛
  ويُلغي push أحدث للفروع التنفيذ القديم لنفس البوابة.
- عند وصول commit إلى `main`، ينفذ `release-preflight` خفيفاً من ذلك الـcommit:
  يرفض أولاً أي push مباشر ويثبت وجود Pull Request مدمج مع full verification
  ناجح لرأسه، ثم يتحقق من Bash وimmutable-release-contract. بعدها تبنى صور
  API/Migrate/Web بالتوازي وتُدفع بالـdigest وتُنشر عبر مسار ADR-OPS-001 نفسه.
- تستخدم كل صورة cache مستقلًا في GitHub Actions لتسريع البناء من دون مشاركة
  نطاق cache قابل للتسابق بين targets متوازية.
- تبقى production concurrency، صور digest-only، manifest، SSH المقيد،
  preflight الخادمي، health، وسياسة ما بعد migration دون تغيير.

## الحد المعروف

حاولنا فرض حماية `main` من GitHub API، لكن GitHub رفضها لهذا المستودع الخاص
ضمن خطة الحساب الحالية (`403`: تتطلب GitHub Pro أو مستودعاً عاماً). لذلك يرفض
`release-preflight` بنفسه أي commit مباشر إلى `main` أو PR بلا full verification
أخضر. عند توفر خطة تدعم الحماية، يفعّل المالك `strict required status checks`
لـ`quality` و`web-acceptance`، مع up-to-date، لمنع التجاوز قبل الدمج أيضاً.

## البدائل المرفوضة

1. **إعادة كل الفحوص في main:** أكثر أماناً دفاعياً نظرياً، لكنه يكرر 14 دقيقة
   تقريباً من العمل المكتمل ولا يختبر artifact مختلفاً عن PR بما يكفي لتبرير
   التأخير.
2. **نشر مباشر من أي branch:** يلغي مصدر الحقيقة `main` ولا يحافظ على تسلسل
   manifest أو التراجع.
3. **إلغاء preflight على main:** يوفر ثوانٍ لكنه يسمح بتبديل workflow أو عقد
   النشر بين قبول PR وبناء artifact دون تحقق للـcommit المنشور.

## الأثر والتراجع

التراجع هو إعادة هذا القرار وعودة `release-*` إلى الاعتماد على `quality` و
`web-acceptance`. لا يغير القرار بيانات أو schema أو أسرار أو خادم الإنتاج.

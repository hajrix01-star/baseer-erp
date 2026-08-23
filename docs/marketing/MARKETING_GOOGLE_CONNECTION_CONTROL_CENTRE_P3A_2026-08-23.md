# مركز طلب تهيئة Google — P3a

## النتيجة

يوفر قسم **المصادر والسياسات → اتصالات Google** نقطة واجهة موحدة لمسؤول الشركة
لطلب تهيئة `Google Ads` أو `Google Business`. لا يحتاج إنشاء شركة جديدة إلى
تعديل قاعدة البيانات أو كتابة ربط خاص لها؛ يظل التفعيل المستقبلي رحلة من
الواجهة بعد اكتمال إعداد المنصة مرة واحدة.

P3a ليس اتصال Google. فهو لا يحتوي على OAuth أو callback أو رمز وصول أو refresh
token أو client secret أو developer token أو حساب Ads أو موقع Business أو SDK أو
طلب HTTP أو worker أو مزامنة أو نشر. `SETUP_REQUESTED` يعني فقط أن مسؤول الشركة
طلب إتاحة الرحلة، ولا يعني موافقة أو اتصالاً أو صلاحية نشر.

## البيانات والصلاحيات

- `MarketingProviderConnection` يحمل الشركة والموصل وحالة الطلب والفاعل/الوقت
  بصورة تدقيقية؛ لا يحمل أسراراً أو حقائق موفر.
- جدول الاتصال تحت RLS وFORCE RLS؛ لا تقرأ شركة طلب شركة أخرى.
- القراءة تحتاج `marketing.insights.read`، وتسجيل الطلب يحتاج
  `marketing.google-connection.manage`، وهي صلاحية حساسة مضافة فقط لدور
  `BASEER_COMPANY_MANAGER` النظامي. الأدوار المخصصة لا تتوسع تلقائياً.
- كل طلب idempotent ومدقق، ولا يمس المالية أو مركز القرار أو سياسة الردود.

## حالات الواجهة

| الحالة | المعنى | ما لا يعنيه |
| --- | --- | --- |
| `NOT_CONNECTED` | لم تسجل الشركة طلب تهيئة بعد | ليس صفراً في Google ولا فشل حساب |
| `SETUP_REQUESTED` | سجل المسؤول طلب تهيئة للمنصة | ليس OAuth ولا موافقة ولا حساباً مربوطاً |
| `BLOCKED` | منع تشغيلي مستقبلي من طبقة المنصة | لا يعرض سبباً حساساً أو سراً |

## بوابة P3 الحية لاحقاً

لا تتحول P3a إلى Google OAuth إلا بعد اعتماد مستقل لكل موصل يثبت:

1. مالك مشروع Google، الشروط والخصوصية، redirect URI الثابت، ومالك الإبطال.
2. Google Ads: developer token ودرجة الوصول، scope `adwords`، وحظر mutation
   بصورة قابلة للاختبار. Google يتطلب OAuth وdeveloper token لكل طلب، وقد يلزم
   `login-customer-id` مع MCC. [مرجع Google الرسمي](https://developers.google.com/google-ads/api/rest/auth)
3. Google Business: موافقة المشروع، scope `business.manage`، التفويض الصريح
   وسياسة حفظ المحتوى. لا توجد Sandbox عامة؛ يستعمل `validateOnly` عند توفره.
   [إعداد GBP](https://developers.google.com/my-business/content/basic-setup)
4. OAuth authorization-code خادمي مع PKCE/state/nonce قصير العمر، vault مشفر
   منفصل، اختيار صريح للحساب/الموقع، kill switch، audit، وPilot محدود.

عندها فقط يصبح زر «ربط» رحلة: Google consent → حسابات/مواقع متاحة → اختيار
صريح → معاينة → تأكيد → mapping وإيصال. لا يختار Baseer الحساب الأول ولا
يعرض مفتاحاً أو رمزاً في المتصفح.

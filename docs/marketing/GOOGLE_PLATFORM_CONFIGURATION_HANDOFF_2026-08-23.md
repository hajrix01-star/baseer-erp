# تسليم إعداد منصة Google المركزية

هذا المستند يجهز الانتقال من مشروع بصير القديم إلى Baseer ERP من دون نسخ
مفاتيح أو رموز أو حسابات شركات إلى المستودع.

## ما ينقل مرة واحدة إلى أسرار بيئة خادم ERP

| متغير البيئة | مصدره في مشروع Google القديم | الغرض |
| --- | --- | --- |
| `BASEER_GOOGLE_OAUTH_CLIENT_ID` | OAuth client | تعريف تطبيق Baseer أمام Google |
| `BASEER_GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client | تبادل رمز التفويض على الخادم فقط |
| `BASEER_GOOGLE_OAUTH_REDIRECT_URI` | Authorized redirect URI جديد | عنوان callback الخاص بـERP |
| `BASEER_GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API Center | مطلوب لقراءة Ads فقط |
| `BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY` | مفتاح جديد 32-byte Base64 | تشفير تفويض كل شركة لاحقاً |
| `BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED` | قرار تشغيل محلي | يبقى `false` حتى قبول البوابة الحية |
| `BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_COMPANY_ID` | UUID شركة ARZ في Baseer | allowlist خادمي للتجربة؛ ليس Google account/location ID |

تضاف قيم الأسرار إلى بيئة النشر فقط، ولا تدخل Git أو واجهة الويب أو جدول
اتصال الشركة. بعد نقلها يظهر في ERP أن المنصة جاهزة، لكنه لا يبدأ اتصالاً
خارجياً بنفسه.

يبقى `BASEER_GOOGLE_OAUTH_ENABLED=false` و
`BASEER_MARKETING_GOOGLE_BUSINESS_PILOT_ENABLED=false` حتى تسليم السر إلى ملف
بيئة الخادم المحمي، واختيار الحساب، وقبول تجربة محدودة؛ هذان مفتاحا إيقاف
متلازمان يمنعان أي تفويض حي مبكر. لا يقرأ خادم Baseer الخاص Google Secret
Manager مباشرة؛ مصدر التشغيل هو `.env.private-online` خارج المستودع وبصلاحيات
الخادم فقط.

## ما لا ينقل

- رموز الوصول أو Refresh Tokens من بصير القديم.
- حسابات Ads أو مواقع Business أو customer IDs المسجلة سابقاً.
- أي موافقة عميل أو سياسة رد آلي قديمة.

تستعيد كل شركة تفويضها من الواجهة، ثم تختار حساب Ads المباشر أو الحساب الواقع
تحت MCC، أو موقع Google Business، صراحة. لا يوجد اختيار تلقائي أو تطابق أسماء.

## بوابة التنفيذ التالية

بعد ضبط أسرار البيئة وإضافة redirect URI في Google Cloud، تنفذ بوابة OAuth
المراجعة: PKCE/state/nonce قصير العمر، اكتشاف الحسابات/المواقع، اختيار صريح،
حفظ تفويض مشفر معزول، ثم اختبار مزامنة قراءة محدود. لا يفتح Ads أي كتابة، ولا
يفتح Business النشر قبل بوابته المستقلة.

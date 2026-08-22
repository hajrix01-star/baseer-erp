# سجل التحقق — إغلاق تحول مكتبات مركز القيادة

**Delivery ID:** `COMMAND-CENTER-LIBRARY-MIGRATION-2026-08-23`

**الحالة:** `Closed` — أُغلق موديول مركز القيادة محلياً بعد تحويل السطح
الحي الوحيد وإثبات العزل والصلاحيات والمتصفح والميزانية.

**مرجع التنفيذ:** `9742d09`.

**مرجع تنظيف التوافق النهائي:** `e547134`.

## النطاق المنجز

- القسم الحي الوحيد هو «النظرة التنفيذية» وفيه تقويم التشغيل والمبيعات
  للقراءة فقط. الأقسام «الأولويات» و«التنبيهات» و«موجز النشاط» placeholders
  بلا feature instance أو كود قديم يحتاج ترحيلاً.
- قراءة التقويم تستخدم `BaseerCompanyReadQuery` بمفتاح الشركة والجلسة واللغة
  والفترة، وتمرر `AbortSignal`؛ لا تعرض receipt ما لم يطابق company/from/to
  النطاق الحالي.
- لا يرسل المتصفح طلب التقويم قبل اكتمال الصلاحيات أو عند غياب
  `finance.daily_sales.read`، ويبقى الخادم وRLS سلطة القرار.
- `salesGrossAmount` يعرض كسلسلة Decimal ذات أربع منازل مع `SAR` بلا
  `Number` أو تجميع/تقريب في المتصفح.
- التقويم محدود خادمياً إلى 400 يوم وبطاقاته خفيفة مقصودة؛ لا Chart أو
  DataGrid أو Form مطلوب لهذا السطح.

## دليل الإغلاق القابل لإعادة التشغيل

| المجال | الدليل | النتيجة |
| --- | --- | --- |
| الجرد والمعمارية | `check:library-migration-inventory` و`check:architecture` | Pass — 153 ملفاً؛ 42 form، 15 selector، 26 date، 30 table، 11 query و2 chart؛ `unclassified=0` و`stale=0` ولا pending decision |
| العقود والتطبيق | checks للعقود وAPI والويب + web build | Pass |
| المتصفح والإتاحة | `command-center-mocked-auth.spec.ts` ثم المجموعة الكاملة | Pass — مركز القيادة `6/6` desktop/mobile؛ المجموعة `109 passed` و`1 intentional skip`؛ AR/EN وRTL/LTR وAxe والفترة والتحديث ومنع GET بلا صلاحية |
| HTTP والتفويض | `verify:command-center-http` و`verify:daily-sales-http` | Pass — 401/403، capability، فصل شركتين، tenant/RLS، الجلسة الملغاة، receipt خادمي |
| RLS | `check:command-center-rls` | Pass — `FinanceOperationalDay` و`FinanceDailyFinancialSummary` فيهما tenant UUID وENABLE + FORCE + USING/WITH CHECK |
| الدقة المالية | `check:web-financial-boundaries` ومراجعة data/read-model | Pass — Decimal string من projection خادمي ولا حساب متصفح |
| ميزانية الويب | `verify:web-budget` | Pass — startup `243,887/250,000 B`، أكبر route `79,814/85,000 B`، startup CSS `54,223/58,000 B`، أكبر route CSS `13,018/16,000 B` |
| الاعتمادات | `npm audit --omit=dev --omit=optional` | Pass — zero findings في الرسم القابل للنشر |
| مراجعة اللجنة | UI، data/read-model، security/quality | Pass نهائي — لا P0 أو P1 خاص بإغلاق مركز القيادة |

## الحدود المستمرة

هذا إغلاق تحول مكتبات وقبول محلي، وليس بناء Dashboard تنفيذي جديد أو اعتماد
KPI رسمي أو أمر مالي أو نشر إنتاجي. أي KPI أو Chart لاحق يحتاج read-model
خادمياً يصرح currency/as-of/source/data-quality. سياسة Prisma للنشر الشخصي
تبقى كما هي، ولا توجد السلسلة المتأثرة في صورة API runtime.

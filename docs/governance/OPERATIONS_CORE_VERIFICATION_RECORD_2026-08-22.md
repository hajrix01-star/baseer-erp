# سجل التحقق — Operations Core

**Delivery ID:** `OPERATIONS-CORE-2026-08-22`

**الحالة:** Conditional pass — التحقق التقني مكتمل؛ قبول المالك لتجربة
المستخدم ما زال مطلوباً.

**النطاق:** الكتالوج والوحدات والتحويلات والوصفات، طلبات واستلامات الشراء،
المخزون والعهدة، التسجيل الداخلي، والأصول والضمانات التشغيلية Gate A.

## الحدود

لا يشمل النطاق رسملة الأصول أو الإهلاك أو التصرف أو المطالبات، ولا أي قيد
مالي جديد للأصل، ولا مرفقات عامة أو تكاملات خارجية أو Noorix أو تقارير مالية
رسمية. كل رقم مالي يبقى خادمياً ومصدراً من المستند أو دفتر الأستاذ المعتمد.

## دليل التحقق المعاد في 2026-08-22

| المجال | الدليل | النتيجة |
| --- | --- | --- |
| العقود وAPI | `npm run check --workspace @baseer-erp/contracts` و`npm run build --workspace @baseer-erp/api` | Pass |
| الصلاحيات | `npm run check:permissions` | Pass — 112 capability |
| دورة العمليات | `npm run verify:operations-purchase-cycle` | Pass — cash, custody, bank transfer, inventory, reports, recipe and internal registration |
| الأصول والضمانات Gate A | `npm run verify:operations-assets-warranty` | Pass — queue, source follow-up, snapshot, warranty lines, idempotency, archive, audit and no finance posting |
| العزل المالي | `npm run verify:finance-gate-b-db` و`npm run check:web-financial-boundaries` | Pass |
| الواجهة | web typecheck/build،`npm run verify:web-budget`،localization وdialog guards | Pass — لا تجاوز لحدود الحزمة أو العربية/الإنجليزية |
| المعمارية | `npm run check:architecture` | Pass |

## بوابة القبول المتبقية

ينفذ المالك تجربة متصفح واحدة بحساب الشركة الصحيح: إنشاء وحدة/مادة، نشر
تحويل ووصفة، إنشاء طلب شراء واستلامه، فحص رصيد المخزون والعهدة، تسجيل إنتاج
داخلي، ثم وضع مستند للمتابعة وإنشاء سجل أصل/ضمان وأرشفته. يجب تأكيد أن
العربية/الإنجليزية والصلاحيات المطلوبة وتجربة الهاتف مقبولة. لا يفتح هذا
القبول أي نطاق مستبعد أعلاه.

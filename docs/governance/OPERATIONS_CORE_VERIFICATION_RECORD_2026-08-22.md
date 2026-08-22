# سجل التحقق — Operations Core

**Delivery ID:** `OPERATIONS-CORE-2026-08-22`

**الحالة:** Closed — التحقق التقني واختبار المتصفح وقبول المالك مكتملة في
2026-08-22.

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

## إغلاق القبول والتحول

سجّل المالك قبوله، وأعيدت بوابات الإغلاق من مرجع التنفيذ `c53ba7d`:

- Playwright الكامل: `71 passed` و`1 intentional skip` على desktop وmobile.
- جرد التحول: `unclassified=0` و`staleManifestTargets=0`.
- دورة العمليات: 12 نطاق تحقق، وتشمل filtering وcursor scope للكتالوج.
- typecheck/build وarchitecture وlocalization وdialog وfinancial boundaries
  وproduction dependency audit وweb budget: Pass.
- ميزانية DataGrid المؤجل: `31,593/50,000 B`، ولا زيادة على startup.

قرارات `DataTable` الخفيفة للوحدات والتسجيل الداخلي وشهور العهدة نهائية
ومقصودة، وليست legacy. ولا يفتح هذا القبول أي نطاق مستبعد في قسم الحدود.

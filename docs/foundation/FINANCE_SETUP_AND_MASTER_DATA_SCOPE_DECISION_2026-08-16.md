# Finance Setup & Master Data — Scope Decision

**Status:** Active build scope — owner approved on 2026-08-16.

## Purpose

Build the financial prerequisites before exposing Purchase & Expense as an operating journey. This follows the verified Noorix order and Baseer controls: chart of accounts → vaults → fiscal period → categories → suppliers → purchase or expense document.

## Product boundaries

- Companies remain in Administration; this scope is company-scoped financial setup only.
- Vaults are controlled finance records with an internally managed linked account, never free text on an invoice.
- Categories and suppliers are master data with active/archive lifecycle. They must be created and governed before a purchase document depends on them.
- Purchase & Expense UI remains gated by its required readiness data. No quick-create supplier/category inside a financial document.
- All commands require company context derived on the server, RBAC, idempotency, audit events, and RLS.

## Delivery slices

1. **Setup hub and initialization:** current fiscal period, base chart, selected initial vaults, and readiness receipt.
2. **Vault management:** cards, add and archive lifecycle; account linkage remains server-owned.
3. **Category management:** parent-aware financial categories, type, linked account and archive safeguards.
4. **Supplier management:** profile, optional default category, tax/phone fields, archive safeguards and separate copy workflow.
5. **Purchase gate:** enable purchase/expense input only after setup readiness; corrections, cancellation and attachments remain later document-scope work.

## Explicitly excluded

- Manual journal editing.
- Bank reconciliation, external banking, Gmail, Telegram, OCR, files upload and AI actions.
- Supplier/category creation embedded in invoice entry.
- Deleting master data with financial history.

## Closure evidence

Each slice closes only with contracts, API/DB authorization proof, idempotency/audit evidence, native UI, and owner acceptance. The next scope is Purchase & Expense documents, not Marketing or AI chat.
## التنفيذ الحالي

- `S1` مكتمل: شاشة إعدادات المالية، تهيئة الشركة والخزائن، وإضافة خزينة مرتبطة بحساب خادمي.
- `S2` بدأ: API محمي للفئات والموردين. إنشاء الفئة ينشئ حسابها المالي تلقائيًا، والمورد يمكن ربطه بفئة نشطة فقط. جميع الأوامر تحمل مفتاح منع تكرار وسجل تدقيق، ولا يوجد حذف نهائي للبيانات الأساسية.
- إدارة `S2` مقيدة حاليًا بالمالك العام حتى يصدر قرار تفويض صريح لأدوار الشركة؛ هذا يمنع منح صلاحيات مالية حساسة تلقائيًا.
- ما زال تعديل الفئة، أرشفة الفئات/الموردين من واجهة المستخدم، وتعديل المورد في واجهة التفاصيل ضمن شريحة الإكمال التالية قبل فتح رحلة فواتير مكتملة.

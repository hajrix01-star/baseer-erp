# إدخال دفعة مشتريات ومصروفات

## القرار

يتيح بصير حفظ دفعة من 1 إلى 25 فاتورة أو مصروفاً في طلب واحد. في الواجهة يبدأ النموذج بثلاثة صفوف فارغة، وكل صف يمثل فاتورة مستقلة كما في نوركس؛ تضاف الصفوف عند الحاجة وتُهمل الصفوف الفارغة. الدفعة وسيلة إدخال وتدقيق فقط؛ لا تصبح قيداً إجمالياً مستقلاً.

## الأثر المحاسبي

- كل صف ينشئ مستند شراء/مصروف مستقلاً ورقم مستند وقيد يومية مستقلين.
- تحفظ الدفعة كمرجع موثق (`PB-YYYYMMDD-NNNN`) يربط مستنداتها ويعرض في سجل الفواتير.
- يتم الحفظ في معاملة قاعدة بيانات واحدة: فشل أي صف يمنع حفظ الدفعة كلها.
- الطلب idempotent، ويسجل حدث تدقيق للدفعة ولكل مستند.
- المبالغ والتقارير تبقى من السجل المحاسبي، لا من بطاقة الدفعة.

## سلوك الصفوف في الواجهة

- اختيار المورد يملأ **الفئة الافتراضية** فقط إذا كانت فئة نشطة ومطابقة لنوع المستند.
- يمكن تغيير الفئة في الصف؛ الفئة المختارة هي المعتمدة للفاتورة والقيد، ولا تعدل بطاقة المورد أو فئته الافتراضية.
- لا تُقبل فئة مشتريات في صف مصروف أو العكس.
- الصفوف الفارغة لا ترسل للخادم، وأي خطأ في صف مكتمل يمنع حفظ الدفعة كاملة.
## قواعد كل فاتورة

- النوع: مشتريات أو مصروف.
- التسوية: مدفوع مع قناة دفع ومبلغ مطابق، أو آجل مع مورد إلزامي.
- البند المالي يجب أن يكون نشطاً وقابلاً للترحيل ومطابقاً للنوع.
- رقم فاتورة المورد أو سبب عدم توفره إلزامي؛ لا يقبل الاثنان معاً.
- تاريخ الدفعة وتاريخ فاتورة المورد لا يقبلان تاريخاً مستقبلياً، ولا يتجاوز تاريخ المورد تاريخ الدفعة.
- زر **بدون ضريبة** يجعل ضريبة الصف صفرًا صراحةً. تفعيل الضريبة يحسبها من إعداد ضريبة الشركة فقط.

## حدود الإصدار

لا توجد مرفقات فعلية بعد؛ لا تُعرض كميزة إلى أن يغلق مسار التخزين والرفع المحكوم. إلغاء الدفعة سيضاف مع مسار الإلغاء/العكس المحاسبي الرسمي، ولا يحذف أي قيد أو فاتورة.

## Amendment — 2026-08-17

- Every batch row chooses **Purchase** or **Expense**. Recurring expenses remain only in Expenses & Obligations.
- usinessDate is the posting/reporting date; supplierInvoiceDate is a supplier-reference date and cannot be later than the posting date.
- Settlement is **Paid** or **Credit** (Arabic: **آجل**). Credit requires a supplier and creates the supplier due; it never requires a payment vault.
- VAT is one compact row control showing the configured rate (normally 15%). Toggling it off records no VAT; the server remains the calculation authority.
- The Credit tab is a server-owned snapshot: top summaries and collapsible supplier groups are returned by the API, with no browser balance calculation.

- An open Credit invoice is settled from the Credit tab using a focused dialog: payment date, payment vault and an amount not greater than the remaining due. It posts a supplier-due payment against the existing invoice; it does **not** create a replacement purchase/expense invoice.

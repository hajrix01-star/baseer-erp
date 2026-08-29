# حزمة استلام بيانات نوركس للترحيل إلى بصير

**الغرض:** جمع دليل قراءة فقط كافٍ لفهم نوركس وبناء ترحيل قابل للتكرار والمطابقة. هذا المستند لا يفترض قاعدة بيانات نوركس أو أسماء جداولها ولا يصرح بأي كتابة فيها.

## قواعد التسليم

- مصدر نوركس يبقى read-only دائماً؛ لا API write، ولا trigger، ولا تعديل schema، ولا “تنظيف” للبيانات الأصلية.
- لكل ملف: UTF-8، تاريخ/وقت التصدير مع timezone، اسم الشركة أو `legacy_company_id`، صفٌّ واحد للرأس، وترتيب ثابت بـlegacy key، وSHA-256 في manifest.
- لا ترسل أسراراً: كلمات مرور، hashes جلسات، API/OAuth tokens، connection strings، private keys، أو ملفات إعداد الإنتاج.
- نقل الملفات عبر قناة مشفرة يحددها المالك؛ الوصول على أقل صلاحية، وسجل استلام يحتوي checksum فقط لا محتوى حساساً.
- إن تعذر استخراج بند، سلّم `UNAVAILABLE` مع السبب وحجم النقص؛ لا تخمّن قيمة أو تصنع صفوفاً بديلة.

## ملف التسليم الجذري المطلوب

`delivery-manifest.json` أو `.csv` يحوي لكل export:

| الحقل | المطلوب |
| --- | --- |
| `delivery_id` | معرف دفعة ثابت وفريد. |
| `source_product/version` | نسخة نوركس وطريقة التصدير، دون secrets. |
| `captured_at` / `timezone` | وقت snapshot والمنطقة الزمنية. |
| `company_legacy_id` / `company_name` | هوية الشركة المصدرية؛ إن كان الملف متعدد الشركات فلكل صف company id. |
| `logical_entity` / `filename` | الاسم الوظيفي للبيانات والملف الفعلي. |
| `row_count` / `byte_size` / `sha256` | دليل اكتمال وثبات. |
| `sort_key` / `encoding` / `delimiter` | قابلية إعادة القراءة نفسها. |
| `pii_classification` | عام/مالي/PII/وثيقة حساسة/سرّي. |
| `known_filters` / `missing_ranges` | ما استبعده المصدر أو النطاق الزمني الناقص. |

## ملفات الفهم قبل أي تصدير أعمال

1. **مخطط المصدر:** DDL أو export metadata للجداول/الحقول/الأنواع/PK/FK/unique/index/default/enum؛ وERD إن وجد.
2. **قاموس القيم:** meanings للحالات، أنواع المستندات، طرق الدفع، الضرائب، الإلغاء، العملة، المنطقة الزمنية، وكيف يحسب نوركس `businessDate`.
3. **قواعد العمل:** شرح دورة المستند، التصحيح، الإلغاء، إغلاق الفترة، الصلاحيات، وتوليد الأرقام التسلسلية؛ مع أمثلة واقعية منزوعة الحساسية.
4. **فهرس الملفات:** كيف ترتبط أي مرفقات بالكيانات، actual path/object identifier، المحتوى النوعي، الحجم، SHA-256، تاريخ الإنشاء، وحالة الحذف/الإلغاء. لا تكفي أسماء الملفات وحدها.
5. **سجل جودة:** صفوف مكررة، IDs غير صالحة، تواريخ ناقصة، أرصدة سالبة غير مفسرة، سجلات يتيمة، ومدى أرشفة/حذف البيانات.

## exports الأعمال المطلوبة (لا نفترض شكل نوركس)

| أولوية | export وظيفي مطلوب | الحد الأدنى من الأعمدة المطلوبة | مقابل بصير المقصود |
| --- | --- | --- | --- |
| P0 | الشركات وإعدادات السياق | legacy company ID، الاسم عربي/إنجليزي، timezone، الحالة، الموقع، العملة/ضريبة الشركة | `Company`, `CompanyFinanceProfile` — `schema.prisma:882,1345`. |
| P0 | دليل الحسابات والفترات والخزائن | legacy IDs، code/name/type/status/system key؛ الفترة start/end/status؛ vault/account/payment channel | `FinanceAccount`, `FinanceFiscalPeriod`, `FinanceVault`. |
| P0 | الفئات والموردون | IDs، code/tree parent، type/status/account/category؛ بيانات ضريبية واتصال | `FinanceCategory`, `FinanceSupplier`; راجع mapping الموجود في `apps/api/src/finance/noorix-category-mapping.ts`، ولا يعني ذلك وجود importer. |
| P0 | القيود اليومية وسطورها | entry/line legacy IDs، source type/reference، business/post dates، period/account IDs، debit/credit، status/sealed، reversal ID، serial/request/reference | `FinanceJournalEntry`, `FinanceJournalLine`; لا بد من كل القيود والعكوس لا الأرصدة المجمعة فقط. |
| P0 | مشتريات/مصروفات وتسوياتها | document/batch IDs/numbers، المورد/الفئة، التاريخ، net/VAT/gross/rate، paid/payable، الخزينة والتوزيعات، status/correction/cancellation | `FinanceOutflow*`, `FinanceSupplierDue*`. |
| P0 | أرصدة وفترات مطابقة | trial balance لكل حساب/شركة/فترة، حركة شهرية، ageing الموردين، VAT summary، قائمة الإلغاءات والأرقام المستخدمة | لا تستوردها كـtruth؛ تستخدم لمطابقة journals/documents بعد الاستيراد. |
| P1 | مبيعات وتقفيلات يومية | closing ID/number/date/scope، gross/net/VAT، العملاء، قنوات/خزائن، journal/ref/status/reversal | `FinanceDailySalesClosing/Allocation`; لا تحوّل ملخصاً إلى فواتير فردية. |
| P1 | خزينة/VAT/قروض | reconciliations، VAT settlements، loans/installments/payments، vault transfer references والعكوس | `FinanceVaultReconciliation`, `FinanceVatSettlement`, `FinanceInclusiveLoan*`. |
| P2 | الموظفون والرواتب | employee source ID، التواريخ/الحالة، عقود/تعويض، مسيرات/مدفوعات/سلف/إجازات/مخالصة مع snapshots | HR مؤجل إلى wave مستقلة؛ لا يُرحّل بلا policy PII وsource-ID mapping. |
| P2 | العمليات والمخزون | sections/units/items/conversions/recipes، purchase requests/receipts، movements، quantities/cost snapshots | `Operations*`; المخزون يعاد بناؤه من الحركات لا balance وحيد. |
| P2 | حملات/سياق/تقارير | campaigns/targets وروابطها للمستندات؛ context/evidence/report snapshots | اختيارية بعد financial base؛ لا OAuth/provider credentials أو tenant-global state. |
| P2 | المرفقات | manifest مستقل + bytes الأصلية أو نسخة قابلة للتحقق، entity legacy ID/type، MIME/size/hash/status | لا تدخل حتى تصميم copy/re-key/quarantine؛ لا paths أو storage keys داخل target. |

## أسئلة يجب أن يجيب عنها مالك نوركس قبل بدء mapping

1. هل `company_id` صريح في كل source، أم توجد جداول مشتركة أو company مخفية في header/document؟
2. ما تعريف وقت العمل عند تعارض created/posting/invoice dates؟ وهل التواريخ UTC أو محلية؟
3. ما الذي يعنيه كل status وcancel/reversal/delete، وهل حذف الصف فعلي أم soft-delete؟
4. هل كل debit/credit محفوظ line-level، وهل توجد قيود بدون source document أو قيود تسوية يدويّة؟
5. كيف يرتبط رقم المستند بالقيود والمورد والسداد، وهل يمكن أن يعاد استخدام الرقم؟
6. ما مصدر VAT ومتى يتغير rate، وكيف تمثل invoices الناقصة/غير الخاضعة؟
7. ما حدود retention/PII والموافقات اللازمة للموظفين والمرفقات؟
8. ما نافذة freeze الممكنة ومن يملك اعتماد parity والقطع؟

## ما لا نقبله كبديل

- Screenshot/PDF فقط بدلاً من export صفوف قابل للقراءة.
- Excel يضم أرقاماً إجمالية بلا stable IDs أو status أو dates.
- نسخة DB بلا schema أو snapshot timestamp أو checksums.
- ملفات مرفقات بلا manifest يربطها بكيان مصدر.
- access مباشر دائم إلى production نوركس بدلاً من snapshot محكوم.

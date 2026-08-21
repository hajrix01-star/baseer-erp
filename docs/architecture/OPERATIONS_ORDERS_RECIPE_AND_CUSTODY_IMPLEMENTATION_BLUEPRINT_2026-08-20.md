# مخطط التنفيذ — الطلبات والرسبي والعهدة

**الحالة:** مواصفة تنفيذية مبنية على قرار المنتج المتفق عليه.
**القرار المرجعي:** [قرار تصميم العمليات — الطلبات والرسبي والعهدة](OPERATIONS_ORDERS_RECIPE_AND_CUSTODY_DECISION_2026-08-20.md).
**النطاق:** Baseer ERP → العمليات فقط. لا ينشئ هذا النطاق فاتورة مورد أو قيداً محاسبياً عاماً.

## 1. نتيجة التنفيذ المطلوبة

ينشئ النظام حقائق تشغيلية دائمة وقابلة للتدقيق، لا مجرد شاشات:

```text
مادة أولية + وحدة/تحويل + آخر أسعار
        ↓
طلب شراء محلي أو طلب مندوب بعهدة
        ↓
استلام فعلي بسعر وكمية حقيقيين
        ↓
دفتر مخزون + تكلفة مرجّحة + دفتر عهدة
        ↓
رسبي منشور لمنتج المنيو
        ↓
تسجيل داخلي آمن بلا سعر للموظف
        ↓
استهلاك مواد وتقارير تشغيلية
```

كل كتابة تكون خادمية، داخل معاملة واحدة، ومحمية بمفتاح منع التكرار. الواجهة لا تحسب الكلفة أو التحويل أو رصيد العهدة أو رصيد المخزون النهائي.

## 2. ترتيب التسليم

لا تبدأ المسارات المتقدمة قبل اكتمال المصدر الذي تعتمد عليه.

| الشريحة | النطاق | شرط القبول |
| --- | --- | --- |
| O1 | المواد الأولية، منتجات المنيو، الوحدات، التحويلات والصلاحيات | يمكن تعريف صنف صحيح ووحداته من دون سعر أو حركة مخزون. |
| O2 | الرسبي وإصداراته ودفتر المخزون والتكلفة المرجّحة | يمكن نشر رسبي صالح وتسجيل استلام مادة وتحويله إلى تكلفة وحدة مخزون. |
| O3 | طلبات الشراء، الاستلام، العهدة والمرتجع | يمكن إكمال طلب محلي وطلب مندوب وحساب الرصيد بدقة. |
| O4 | التسجيل الداخلي، المستندات التشغيلية وواتساب | الموظف يسجل منتج قسمه بلا أسعار؛ الخادم يخصم المكونات ويحفظ الوثيقة. |
| O5 | الجرد والتصحيحات والتقارير | تظهر الفروقات، الحركات، الكميات والتكلفة وفق الصلاحيات. |

## 3. الشاشات ومسارات المستخدم

```text
العمليات
├─ التسجيل الداخلي
├─ طلبات المشتريات والعهدة
├─ الاستلام والمستندات التشغيلية
├─ المواد الأولية والوحدات والتحويلات
├─ منتجات المنيو والرسبي
├─ المخزون والجرد والتكلفة
└─ تقارير العمليات
```

### 3.1 موظف القسم

1. يدخل «التسجيل الداخلي».
2. يرى فقط منتجات منيو الأقسام المخوّل لها.
3. يختار الصنف والوحدة والكمية.
4. يحفظ التسجيل أو يصححه بالسبب المسموح.
5. لا يرى سعراً أو إجمالياً أو تكلفة أو رصيد مخزون أو عهدة.

### 3.2 مدير المطعم

1. يدير المواد الأولية والوحدات والتغليف والتحويلات.
2. يدير منتجات المنيو وإصدارات الرسبي.
3. ينشئ طلباً محلياً أو طلب مندوب متعدد البنود.
4. يرسل رسالة واتساب اختيارية للمندوب.
5. يستلم الطلب فعلياً، ويعدل الكمية والسعر إلى الواقع.
6. يراجع رصيد العهدة والمخزون والتقارير والجرد.

### 3.3 المندوب الوحيد

لا يحتاج حساباً في التطبيق. يستلم رسالة الطلب عند أمر إرسال صريح، وتثبت العهدة باسمه التشغيلي الثابت في إعدادات الشركة.

## 4. نموذج البيانات

الأسماء أدناه مقترحة لـ Prisma؛ جميع النماذج تحمل `tenantId` و`companyId` وتخضع لعزل المستأجر/الشركة والتدقيق المركزي.

### 4.1 التعريفات

| النموذج | الحقول الجوهرية | القواعد |
| --- | --- | --- |
| `OperationsUnit` | `code`, `nameAr`, `nameEn?`, `dimension`, `decimalScale`, `isActive` | البعد: `COUNT`, `MASS`, `VOLUME`, `PACKAGE`. الوحدة العامة لا تحمل عامل تحويل لصنف محدد. |
| `OperationsItem` | `sku?`, `nameAr`, `nameEn?`, `kind`, `categoryId?`, `inventoryUnitId`, `trackInventory`, `isActive` | `kind`: `RAW_MATERIAL` أو `MENU_PRODUCT`، ولا يتغير بعد أول حفظ. |
| `OperationsItemSection` | `itemId`, `sectionId` | يحدد منتجات المنيو التي يراها كل قسم. |
| `OperationsItemUnit` | `itemId`, `unitId`, `label?`, `isOrderEnabled`, `lastPurchasePrice?`, `lastPriceAt?`, `salePrice?`, `isActive` | السعر خاص بالصنف والوحدة. مادة أولية قد تملك سعراً مستقلاً للكيلو ونصف الكيلو. |
| `OperationsConversionVersion` | `itemId`, `version`, `status`, `publishedAt`, `supersedesId?` | نسخة منشورة لا تعدل. |
| `OperationsConversionEdge` | `versionId`, `fromUnitId`, `toUnitId`, `factor`, `reversible` | يربط وحدات الصنف ويمنع الدورات أو المسارات المتعارضة. |
| `OperationsRecipeVersion` | `outputItemId`, `version`, `outputQuantity`, `outputUnitId`, `status`, `publishedAt`, `supersedesId?` | منتج منيو فقط؛ نسخة منشورة لا تعدل. |
| `OperationsRecipeLine` | `recipeVersionId`, `rawMaterialItemId`, `quantity`, `unitId`, `sortOrder` | المكوّن مادة أولية نشطة فقط؛ لا يسمح بدورة رسبي. |

### 4.2 الطلب والاستلام والعهدة

| النموذج | الحقول الجوهرية | القواعد |
| --- | --- | --- |
| `OperationsPurchaseRequest` | `requestNumber`, `executionKind`, `status`, `requestedAt`, `requestedByUserId`, `custodyFundingAmount?`, `notes?` | `executionKind`: `LOCAL` أو `DELEGATED`; الحالة: `PENDING_RECEIPT`, `RECEIVED`, `CANCELLED`, `REVERSED`. لا توجد `APPROVED` أو `REJECTED`. |
| `OperationsPurchaseRequestLine` | `requestId`, `lineNumber`, `rawMaterialItemId`, `requestedQuantity`, `requestedUnitId`, `quotedUnitPrice`, `quotedPriceUnitId`, `quotedLineTotal` | لقطة التخطيط، لا يعاد تعديلها بعد الإنشاء. |
| `OperationsPurchaseReceipt` | `receiptNumber`, `requestId`, `receivedAt`, `receivedByUserId`, `status`, `sourceRevision`, `notes?` | سجل مستقل عن الطلب؛ الاستلام المثبت غير قابل للتعديل. |
| `OperationsPurchaseReceiptLine` | `receiptId`, `requestLineId?`, `rawMaterialItemId`, `receivedQuantity`, `receivedUnitId`, `actualUnitPrice`, `actualPriceUnitId`, `lineTotal`, `baseQuantity`, `baseUnitId`, `baseUnitCost` | يمثل الواقع، ويحتفظ بلقطة التحويل والسعر. |
| `OperationsCustodyEvent` | `eventNumber`, `eventType`, `amount`, `balanceAfter`, `requestId?`, `receiptId?`, `effectiveAt`, `reversalOfId?`, `notes?` | `FUNDING`, `PURCHASE`, `RETURN`, `REVERSAL`. لا يوجد مندوب خارجي لأن القرار يثبت مندوباً واحداً للشركة. |

### 4.3 المخزون والتسجيل الداخلي

| النموذج | الحقول الجوهرية | القواعد |
| --- | --- | --- |
| `OperationsInventoryMovement` | `movementNumber`, `rawMaterialItemId`, `locationId`, `movementType`, `baseQuantityDelta`, `valueDelta`, `quantityAfter`, `valueAfter`, `weightedUnitCostAfter`, `sourceType`, `sourceId`, `effectiveAt`, `reversalOfId?` | دفتر append-only: `RECEIPT`, `INTERNAL_ISSUE`, `STOCKTAKE_CORRECTION`, `REVERSAL`. |
| `OperationsInternalRegistration` | `registrationNumber`, `sectionId`, `businessDate`, `createdByUserId`, `status`, `recipeSnapshot`, `operationalCost`, `notes?`, `reversalOfId?` | لا يحمل أو يعيد للموظف سعر بيع أو إجمالي مبيعات. |
| `OperationsInternalRegistrationLine` | `registrationId`, `menuProductItemId`, `quantity`, `unitId`, `recipeVersionId?`, `costSnapshot` | يحفظ نسخة الوصفة والتكلفة للاطلاع المخوّل فقط. |
| `OperationsStocktake` | `stocktakeNumber`, `locationId`, `businessDate`, `status`, `createdByUserId`, `notes?` | الجرد ينشئ حركات تصحيح منفصلة؛ لا يكتب فوق الرصيد. |
| `OperationsStocktakeLine` | `stocktakeId`, `rawMaterialItemId`, `physicalBaseQuantity`, `systemBaseQuantity`, `varianceBaseQuantity`, `reason?` | يجب أن يوجد سبب لكل فرق غير صفري. |

### 4.4 الوثائق والرسائل

لا نكرر جدول «وثيقة» عام داخل العمليات. أرقام الطلب والاستلام والتسجيل والجرد وحركات العهدة هي الوثائق التشغيلية ذاتها، وتستخدم خدمة السيريال المركزية.

يضيف الربط مع المستندات العامة فقط `attachmentFileMetadataId?` أو جدول روابط عند الحاجة إلى فاتورة مورد أو صورة إيصال. الملف لا ينشئ ولا يغير حقيقة تشغيلية.

`OperationsMessageDispatch` اختياري في O4: يحفظ نوع الرسالة، رقم المستلم المهيأ، لقطة النص، المستخدم الذي ضغط الإرسال والوقت. لا يدعي نجاح تسليم واتساب ما لم يضاف مزود رسائل موثوق لاحقاً.

## 5. التحويلات والوحدات

### 5.1 قاعدة وحدة المخزون

كل مادة أولية تملك وحدة أساس واحدة:

```text
طماطم/لحم: جرام
زيت/حليب: ملليلتر
خبز/كوب: حبة
```

التحويلات تخص الصنف لا واجهة المستخدم:

```text
1 كيلو طماطم = 1,000 جرام
1 لتر زيت = 1,000 ملليلتر
1 كرتون أكواب = 50 حبة
```

لا يتحول الوزن إلى الحجم تلقائياً، ولا يحول التغليف إلا إن عرّف محتوى ذلك التغليف للصنف نفسه. لا يسمح بنشر التحويل عند وجود دورة أو أكثر من مسار يعطي نتيجتين مختلفتين.

### 5.2 السعر

السعر يحفظ لكل `(itemId, priceUnitId)` مع لقطة التحويل المستخدمة في الاستلام. لذلك يجوز:

```text
طماطم: كيلو = 6 ريال
طماطم: نصف كيلو = 4 ريال
```

لا يشتق النظام سعر نصف الكيلو من سعر الكيلو. عند الاستلام يحسب فقط `baseUnitCost = lineTotal / baseQuantity` لاستخدامه في المخزون والتكلفة.

## 6. التكلفة المرجّحة والرسبي

### 6.1 استلام مادة

تحت قفل خادمي للصنف والموقع، ينفذ النظام:

```text
newQuantity = priorQuantity + receivedBaseQuantity
newValue    = priorValue + receiptLineTotal
newWac      = newValue / newQuantity
```

مثال: استلام 3 كيلو طماطم بمجموع 18 ريال يزيد المخزون 3,000 جرام وقيمته 18 ريال، فتكون تكلفة الجرام `0.006` ريال إذا لم يوجد رصيد سابق.

### 6.2 استهلاك الرسبي

عند تسجيل منتج منيو، يحمّل الخادم نسخة رسبيه منشورة، ويحّول كل مكوّن إلى وحدة المخزون، ثم يخصم:

```text
issueValue = requiredBaseQuantity × currentWeightedUnitCost
```

ويحفظ لقطة كاملة للرسبي وللتكلفة في التسجيل وسجل المخزون. لا يعاد احتساب سجل سابق عند تغير السعر أو الرسبي لاحقاً.

### 6.3 المخزون السالب

لا يمنع تسجيل موظف القسم لمجرد أن المخزون النظري غير كافٍ؛ التسجيل حقيقة تشغيلية. يسمح الخادم بالحركة، يعلّم الرصيد السالب كاستثناء تشغيلي واضح للمدير، ويستخدم آخر تكلفة مرجّحة معروفة. الجرد أو الاستلام اللاحق لا يعيد كتابة التاريخ.

## 7. دورة طلبات الشراء

### 7.1 إنشاء الطلب

ينشئ المدير طلباً متعدد البنود من مواد أولية، ويحدد النوع والكميات والوحدات والسعر المقترح.

```text
LOCAL
→ PENDING_RECEIPT

DELEGATED + عهدة 500
→ PENDING_RECEIPT
→ OperationsCustodyEvent(FUNDING, +500)
```

لا تزيد حركة الإنشاء المخزون. ويجب أن يتطابق مبلغ العهدة مع ما سُلّم فعلاً، لا مع إجمالي السعر المتوقع بالضرورة.

### 7.2 الاستلام

يستقبل المدير الواقع: الكميات والأسعار الحقيقية قد تختلف عن الطلب. الاستلام ينشئ سجلاً جديداً ولا يبدل بنود الطلب الأصلية.

```text
طلب مندوب 12 بنداً
→ استلام 11 بنداً بكميات وأسعار فعلية
→ سجل استلام + حركات مخزون
→ OperationsCustodyEvent(PURCHASE, -actualTotal)
```

إذا أُلغي الطلب قبل الاستلام بعد إرسال العهدة، يسجل حدث `RETURN` أو `REVERSAL` موثق؛ لا يختفي مبلغ العهدة.

### 7.3 التصحيح

الاستلام المثبت لا يحرر. التصحيح ينشئ عكساً لحركات المخزون والعهدة، ثم استلاماً بديلاً مرجعياً. تبقى الوثيقة الأصلية والعكس والبديل قابلة للتتبع.

## 8. واجهات API والعقود

توضع عقود Zod في `packages/contracts`، وتوضع المصادقة والتفويض والكتابة في `apps/api/src/operations`.

| الفئة | المسار المقترح |
| --- | --- |
| قراءة مساحة العمل | `GET /operations/bootstrap` |
| المواد الأولية/المنيو | `GET/POST /operations/items`, `POST /operations/items/:id/update` |
| الوحدات والتحويلات | `GET/POST /operations/units`, `POST /operations/raw-materials/:id/conversions/publish` |
| الرسبي | `POST /operations/menu-products/:id/recipes/publish` |
| الطلبات | `GET /operations/purchase-requests`, `POST /operations/purchase-requests`, `GET /operations/purchase-requests/:id` |
| الاستلام | `POST /operations/purchase-requests/:id/receipts` |
| العهدة | `GET /operations/custody`, `POST /operations/custody/returns` |
| التسجيل الداخلي | `GET /operations/internal-registrations`, `POST /operations/internal-registrations`, `POST /operations/internal-registrations/:id/reverse` |
| المخزون والجرد | `GET /operations/inventory`, `POST /operations/stocktakes`, `POST /operations/stocktakes/:id/post` |
| التقارير | `GET /operations/reports/internal-registrations`, `GET /operations/reports/purchases`, `GET /operations/reports/inventory`, `GET /operations/reports/custody` |

كل أمر كتابة يتطلب `idempotencyKey`. لا يستقبل أي طلب من المتصفح حقول `tenantId` أو `companyId` أو حالة محكومة أو رصيد أو تكلفة نهائية أو سيريال أو بيانات تخص مستخدماً آخر.

## 9. الصلاحيات

| الصلاحية | وظيفتها |
| --- | --- |
| `operations.internal_registration.create` | تسجيل خروج منتج منيو لقسم المستخدم، بلا بيانات مالية. |
| `operations.internal_registration.read_own` | عرض تسجيلات الموظف ضمن نافذته المسموحة. |
| `operations.catalog.manage` | إدارة المواد والمنتجات والوحدات. |
| `operations.recipe.publish` | نشر إصدار رسبي. |
| `operations.purchase_request.create` | إنشاء طلب محلي أو طلب مندوب. |
| `operations.purchase_request.receive` | استلام طلب وتثبيت الواقع. |
| `operations.custody.read` / `operations.custody.return` | قراءة رصيد العهدة وتسجيل المرتجع. |
| `operations.inventory.read` / `operations.stocktake.post` | قراءة المخزون ونشر الجرد. |
| `operations.reports.read` | قراءة تقارير العمليات والتكلفة. |
| `operations.reverse` | عكس الاستلام أو التسجيل مع السبب. |

التحقق من القسم يكون في الخادم في كل قراءة وكتابة للتسجيل الداخلي. ولا يكفي إخفاء تبويب أو زر في الواجهة.

## 10. اختبارات القبول

### المواد والوحدات والرسبي

- يمنع نشر تحويل دائري أو معامل غير موجب أو مسارين متعارضين.
- استلام كيلو طماطم يحول إلى 1,000 جرام في المخزون.
- يمكن أن يحمل الكيلو ونصف الكيلو سعرين مستقلين.
- لا يمكن وضع منتج منيو ضمن مكونات الرسبي؛ المكوّن مادة أولية فقط.
- نشر رسبي جديد لا يغير تكلفة أو كميات تسجيل سابق.

### الطلبات والعهدة

- طلب محلي يبقى بانتظار الاستلام ولا يغير المخزون أو العهدة.
- طلب مندوب بعهدة 500 يسجل رصيداً +500 عند إنشائه.
- استلام مشتريات فعلية بـ300 يخفض الرصيد إلى +200 ويزيد المخزون بالكميات الفعلية فقط.
- تسجيل مرتجع 200 يعيد الرصيد إلى صفر.
- إعادة إرسال نفس الأمر بمفتاح التكرار نفسه لا تنشئ طلباً أو حركة ثانية.
- لا توجد واجهة أو API لحالة موافقة أو رفض.

### التسجيل الداخلي والمخزون

- موظف البار لا يحصل من API على سعر بيع أو تكلفة أو رصيد.
- تسجيل ثلاث شاورما يخصم مكونات الرسبي مضروبة في ثلاثة.
- تصحيح/عكس التسجيل ينشئ حركات مقابلة ولا يحذف الأصل.
- المخزون السالب يظهر استثناءً للمدير ولا يختفي بصمت.

## 11. ما لا يدخل في هذه المرحلة

- فاتورة المورد، ضريبة المدخلات، السداد المحاسبي وقيد الدفتر العام.
- ربط آلي مفترض مع أوامر/فواتير نظام الكاشير.
- حساب مستقل للمندوب أو تعدد مندوبي المشتريات.
- تسليم واتساب مضمون عبر مزود خارجي؛ المرحلة الأولى تسجل أمر الإرسال والنص فقط.

أي واحد من هذه المسارات يحتاج قرار ملكية وعقد تكامل مستقل قبل التنفيذ.

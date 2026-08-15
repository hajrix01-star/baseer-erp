نعم. انسخ هذا الملخص كاملًا واحفظه خارج Codex أيضًا، مثل ملف `BASEER_ERP_HANDOFF.md`. لا تحذف مجلد المشروع نفسه؛ حالة Git الأخيرة كانت تظهر معظم المشروع كملفات غير ملتزمة بعد، لذلك احتفظ بنسخة منه.

```md
# Baseer ERP — سجل التسليم الكامل

## 1. قرار المشروع

Baseer ERP مشروع جديد مستقل في:

`D:\Codex\Baseer-ERP`

ولا يُبنى داخل `D:\Codex\NOORIX`.

نوركس لا يُحذف ولا يُعدل أثناء البناء. يبقى:
- مرجعًا لفهم الوظائف الحالية وسير العمل والاستثناءات.
- مصدر بيانات للترحيل النهائي فقط.
- قاعدة أونلاين للقراءة فقط عند مرحلة الترحيل.
- لا يوجد ربط Runtime بين Baseer ونوركس.
- لا يوجد Dual-write بين النظامين.

القرار النهائي: لا نعتمد Odoo Community كأساس للتنفيذ. نأخذ منه فقط مبادئ الموديولات وملفات التعريف والاعتماديات، لكن Baseer يبقى تطبيقًا مستقلًا بواجهة Baseer الخاصة وعقود Backend خاصة به.

---

## 2. هوية المنتج والمعمارية المعتمدة

الاسم العام: **Baseer ERP**

المعمارية:
- Modular Monolith، وليس Microservices.
- Backend واحد + واجهة واحدة + PostgreSQL واحدة لكل بيئة.
- لا قاعدة بيانات مستقلة لكل موديول.
- هوية، جلسات، شركات، صلاحيات، ثيم، تواريخ، تدقيق، تسلسلات، ملفات ومخرجات مركزية.
- الموديولات تضيف وظائفها ضمن نفس المنصة، مثل Odoo Apps، لكنها لا تنشئ أنظمة منفصلة.

الموديولات المعتمدة:

1. **القيادة**
   - مركز القيادة.
   - ملخصات تنفيذية.
   - تنبيهات، تقويم حراري، مناسبات، مؤشرات.
   - يقرأ فقط من Read Models وخدمات المصدر الرسمية.
   - لا يحسب أرقامًا داخل الواجهة.

2. **العمليات**
   - المبيعات.
   - المشتريات.
   - الطلبات.
   - الموردون.
   - الأصناف والتصنيفات.
   - المخزون.
   - الأصول المرتبطة بالتشغيل.
   - مستندات العملية تكون ضمن سياق العملية، وليست موديولًا منفصلًا.

3. **المالية والمحاسبة**
   - لوحة المالية.
   - الفواتير.
   - الخزائن وطرق الدفع والتحويلات.
   - المصروفات.
   - الالتزامات والقروض والسداد.
   - دفتر الأستاذ.
   - التسويات.
   - لا تشمل التقارير الكاملة؛ التقارير في موديول التقارير.

4. **HR**
   - الموظفون.
   - الإجازات.
   - السلف.
   - الخصومات.
   - الرواتب.
   - الخدمات والسجلات والوثائق والإنهاءات.
   - الإدخال السريع للسلفة أو الخصم ضمن صلاحيات محددة، مثل صلاحية الكاشير.

5. **التقارير**
   - التقارير التشغيلية والمالية.
   - Hajri Tax.
   - الطباعة.
   - المعاينة قبل الطباعة.
   - التصدير إلى Excel.
   - التقارير لا تنشئ العمليات المالية؛ تقرأ المصدر الرسمي فقط.

6. **الإدارة**
   - الشركات.
   - المستخدمون.
   - الأدوار والصلاحيات.
   - الثيم والهوية.
   - الإعدادات.
   - النسخ الاحتياطي.
   - إدارة الوصول والتدقيق.

مؤجل حاليًا:
- HBC Settlements أو أي تكامل خارجي خاص.
- النمو والسمعة والمحادثة الذكية كموديولات مستقلة.
- المساعد الذكي ليس موديولًا الآن؛ الإدخال السريع يقتصر حاليًا على سلفة موظف أو خصم، بصلاحية دقيقة.

---

## 3. قواعد بناء لا يجوز تجاوزها

### منهجية العمل

- قبل بناء أي موديول، يجب دراسة نوركس بالكامل في نطاق هذا الموديول:
  - هدفه.
  - الشاشات والنماذج.
  - خطوات الإدخال.
  - الجداول والفلاتر.
  - الاستثناءات.
  - الصلاحيات.
  - الأثر المحاسبي والضريبي.
  - السلاسل.
  - التعديل والإلغاء والحذف.
  - الطباعة والتصدير.
- يكتب تقرير قبل البناء يصنف كل سلوك إلى:
  - Preserve: يبقى كما هو.
  - Harden: يبقى مع تقوية أمنية أو تقنية.
  - Correct: يصحح لوجود عيب واضح.
  - Defer: يؤجل بقرار واضح.
- يبنى موديول واحد كاملًا عموديًا قبل الانتقال لغيره.
- ممنوع الترقيع أو بناء شاشات جزئية أو روابط صامتة للنظام القديم.
- لا يعتبر الموديول مكتملًا إلا بعد الاختبارات، المطابقة، وتجربة المستخدم والموافقة.

### الواجهة

- الواجهة للعرض والإدخال فقط.
- لا حسابات ولا نسب ولا إجماليات ولا ضرائب ولا معالجة تواريخ في React.
- Backend هو مصدر الحساب والفلاتر والرسوم البيانية والتسلسلات والتقارير.
- عربي وإنجليزي 100%.
- RTL وLTR حقيقيان.
- دعم جوال كامل، وأزرار إجراءات لا تقل عن 44px.
- الأرقام تظهر بالإنجليزية في الواجهتين.
- المبالغ بلا كسور عشرية.
- النسب بخانة عشرية واحدة فقط.
- لا يظهر `SR` أو `SAR` أو «ر.س» داخل الجداول أو البطاقات أو التقارير.
- الثيم مركزي، ويؤثر بصريًا فقط. لا يغير الصلاحيات أو المسارات أو البيانات.

### التاريخ والوقت

- المنطقة الرسمية: `Asia/Riyadh`.
- `BusinessDate` هو تاريخ عمل مستقل من نوع SQL `DATE`.
- `issuedAt` ووقت التدقيق من نوع `TIMESTAMPTZ`.
- لا تستخدم الواجهة UTC لحساب بداية أو نهاية الشهر.
- الفترة الشهرية تبدأ من اليوم الأول الساعة 00:00 بتوقيت السعودية وتنتهي في آخر يوم.
- حركة الفترة تبدأ من صفر.
- الرصيد حتى تاريخ يختلف عن صافي حركة الفترة ويجب تسميتهما بوضوح.

### المالية

- السالب في الخزائن مسموح، كما هو مقصود في نوركس.
- لا يوجد إقفال فترات إلزامي.
- المالك يستطيع تعديل أو إلغاء العمليات السابقة.
- الإلغاء محفوظ في السجل ومدقق، ولا يعيد استخدام الرقم التسلسلي.
- لا حذف فعلي للعمليات المالية المنشورة.
- كل عملية لها Serial مركزي ذري، غير قابل لإعادة الاستخدام.
- تقارير المالك الافتراضية تكون **شاملة الضريبة**:
  - مثال: 115 تظهر 115 افتراضيًا.
  - زر «فصل الضريبة» يطلب من الخادم العرض: 100 صافي + 15 ضريبة = 115 إجمالي.
  - لا تقسم الواجهة 115 على 1.15.
  - قيد المحاسبة لا يتغير عند تغيير العرض.
- الربح والخسارة المحاسبي قد يعرض الصافي لأنه معناه محاسبيًا مختلف؛ يجب وضع تسمية واضحة.

### الأمن والجودة

- Tenant + Company isolation fail-closed.
- صلاحيات دقيقة على الخادم.
- RLS مفروض على الجداول متعددة المستأجرين.
- لا `any`.
- DTOs وZod allowlists.
- كل أمر كتابة: Transaction + authorization + audit + idempotency عند الحاجة.
- لا companyId للكتابة من body أو query إذا كان يمكن اشتقاقه من السياق الموثق.
- لا اعتماد على claims JWT كمصدر نهائي للصلاحية أو الشركة؛ الخادم يتحقق من قاعدة البيانات.
- لا تسرب بيانات شركة أو مستأجر آخر.
- كل export/print يخضع للصلاحية والنطاق نفسه.
- كود نظيف، ملفات صغيرة بقدر معقول، مسؤولية واحدة لكل ملف، اختبارات قبل الإغلاق.
- لا تغيير مباشر للملفات أو database عبر أوامر غير آمنة؛ استخدم patches ومراجعة قبل destructive actions.

---

## 4. التنقل وواجهة النظام المعتمدة

النمط المعتمد:

1. عند دخول Baseer ERP تظهر شاشة اختيار الموديولات.
2. اختيار موديول يفتح قسمه الافتراضي مباشرة.
3. تظهر قائمة جانبية تحتوي أقسام الموديول المختار فقط.
4. لا توجد تبويبات أفقية للتنقل الأساسي.
5. في الجوال يظهر Drawer لأقسام الموديول.
6. لكل قسم URL مباشر، ويعمل Back / Refresh.
7. زر شبكة الموديولات يعيد إلى Launcher.
8. لاحقًا يمكن إضافة بحث ومفضلة وأخيرة للوصول السريع.
9. لا تجعل Launcher عائقًا عند فتح رابط مباشر.

هذه الفكرة مستوحاة من:
- Odoo: App ثم قوائم داخل التطبيق.
- SAP Fiori: Launchpad ثم Spaces/Pages.
- Dynamics 365: Module ثم Navigation.
- ERPNext: Workspaces.

لكن التصميم والتنفيذ خاصان بـBaseer ERP.

---

## 5. العمل المنجز فعليًا في Baseer ERP

### App Shell والواجهة

المشروع يحتوي:
- `apps/web`
- `apps/shell`

تم بناء نموذج App Shell ومشغّل الموديولات.
تم اعتماد شكل Launcher → موديول → قائمة جانبية للموديول.
تمت معالجة Drawer الجوال:
- العربية: يثبت يمينًا ويتحرك يمينًا عند الإغلاق.
- الإنجليزية: يثبت يسارًا ويتحرك يسارًا عند الإغلاق.
- استخدم `inset-inline-start: 0`.
- لا تستخدم `direction: rtl` ثابتة لمساحة العمل.

تم الإبلاغ بأن البناء نجح:

```text
npm run build --workspace @baseer-erp/web
✓ built successfully
```

### منصة المخرجات المركزية

المسار:

`packages/output-platform`

الفكرة المعتمدة:
- لا تطبع DOM للواجهة.
- لا تصدر الصفوف المحملة في الواجهة.
- الموديول يعرّف report definition وفلتراته وصلاحياته فقط.
- الخادم يبني snapshot ثابتًا من المصدر الرسمي.
- المعاينة والطباعة وExcel تستخدم نفس الـsnapshot.
- تدقيق للأحداث: طلب، توليد، تنزيل، print-issued.
- لا يعد print-issued دليلًا أن الورق طبع فعلاً.

المخرجات:
- Preview مركزي.
- Print من المعاينة.
- XLSX مركزي.
- لاحقًا PDF خادمي عند الحاجة.
- دعم Arabic/English وRTL/LTR.
- أرقام إنجليزية، مبالغ بلا عملة وبلا كسور، نسب بخانة واحدة.
- حماية Excel Formula Injection: أي نص يبدأ `=`, `+`, `-`, `@` يعالج كنص آمن.
- الوظائف الكبيرة تتحول إلى Jobs غير متزامنة لاحقًا.

اختيار Excel:
- تم استبدال ExcelJS.
- الاختيار الحالي: **SheetJS CE 0.20.3** من المصدر الرسمي، مثبت بإصدار دقيق.
- السبب: مجاني، مناسب لتوليد XLSX من الخادم، والتحديث الأمني 0.20.2 وما بعده يعالج قضايا سابقة.
- لا تُستخدم مكتبة XLSX لقراءة ملفات غير موثوقة في منصة المخرجات.
- استيراد Excel له بوابة ومسار معزول وفحص مختلف لاحقًا.
- تم الإبلاغ أن اختبارات output-platform نجحت.
- تم الإبلاغ أن production audit الحالي لا يظهر ثغرات معروفة.

ملفات مهمة:
- `packages/output-platform/src/contracts.ts`
- `packages/output-platform/src/formatting.ts`
- `packages/output-platform/src/excel-renderer.ts`
- `packages/output-platform/src/print-preview.ts`
- `packages/output-platform/src/output-platform.ts`
- `packages/output-platform/src/output-platform.test.ts`
- `packages/output-platform/package.json`

### API والعقود المشتركة

المسارات:
- `apps/api`
- `packages/contracts`

تم:
- إصلاح dependency protocol من `workspace:*` إلى:
  `file:../../packages/contracts`
  داخل `apps/api/package.json`.
- بناء العقود وAPI وفحص الأنواع بنجاح.
- إصلاح تكرار `/v1` في health controller.

المسار الرسمي:

```text
GET /v1/health
```

التحقق:

```text
GET /v1/health    -> 200 {"status":"ok","service":"baseer-erp-api"}
GET /v1/v1/health -> 404
```

الخادم التجريبي تم إيقافه بعد الاختبار.

حزم API الأساسية:
- NestJS 11.2.1
- Prisma 7.9.1
- PostgreSQL driver `pg`
- `@prisma/adapter-pg`
- Zod في العقود

### مخطط قاعدة البيانات الأولي

المسار:

`apps/api/prisma/schema.prisma`

والترحيل:

`apps/api/prisma/migrations/20260814194500_identity_company_core/migration.sql`

يشمل:
- Tenant
- User
- Company
- Role
- RolePermission
- CompanyMembership
- AppSession
- AuditEvent

الحالات:
- UserStatus: ACTIVE / DISABLED
- CompanyStatus: ACTIVE / ARCHIVED
- SessionStatus: ACTIVE / REVOKED / EXPIRED

موجود:
- مفاتيح مركبة تمنع ربط مستخدم أو دور أو شركة بمستأجر مختلف.
- RLS وFORCE RLS على جداول المستأجر.
- policies تقرأ `app.tenant_id`.
- businessTimezone افتراضيًا `Asia/Riyadh`.

تم التحقق:

```text
npm exec prisma validate --workspace @baseer-erp/api
The schema is valid
```

مهم جدًا:
- لم يطبق أي migration حتى الآن.
- لا توجد قاعدة Baseer تشغيلية مستخدمة.
- لا تمس قاعدة نوركس أو قاعدة الأونلاين.

### التصحيح المطلوب قبل Prisma Generate

هناك تصحيح أمني واحد مطلوب أولًا:

في `AuditEvent` يجب أن يكون الربط بالمستخدم ضمن المستأجر نفسه، لا بالـuser ID فقط.

في Prisma:

```ts
actor User? @relation(
  fields: [actorUserId, tenantId],
  references: [id, tenantId],
  onDelete: SetNull
)
```

وفي SQL migration:

```sql
"actorUserId" UUID,
FOREIGN KEY ("actorUserId", "tenantId")
  REFERENCES "User"("id", "tenantId")
  ON DELETE SET NULL
```

بعد التصحيح:
1. `prisma validate`
2. `prisma generate`
3. build API
4. لا تطبق migration إلا على قاعدة Baseer جديدة مخصصة.

---

## 6. النواة التي تبنى الآن فقط

المرحلة الحالية: **نواة Baseer ERP**

ولا نبدأ المالية بعدها مباشرة إلا عند إغلاقها.

ترتيب التنفيذ:

1. Database foundation
   - Prisma schema.
   - RLS.
   - Composite tenant foreign keys.
   - اتصال PostgreSQL جديد لـBaseer فقط.

2. Identity
   - تسجيل الدخول.
   - password hashing.
   - access/refresh tokens.
   - sessionVersion.
   - revoke session.
   - نوع token صريح access أو refresh.
   - JWT يحمل identity receipt فقط، لا صلاحيات أو عضويات تكون مصدر قرار نهائي.

3. Company Context
   - اختيار الشركة عبر header مركزي مثل:
     `X-Baseer-Company-Id`
   - التحقق من membership live من قاعدة البيانات.
   - لا companyId ضمن body/query للكتابة.
   - Company context يمر للخدمات داخل transaction.

4. Authorization
   - roles + capabilities.
   - permissions من قاعدة البيانات.
   - deny by default.
   - cache آمن مع invalidation.
   - لا bypass ضمني للمالك أو super admin.

5. Audit + Idempotency + Serial
   - audit event مركزي.
   - idempotency receipts.
   - serial reservation ذري غير قابل للإعادة.
   - لا نبني المالية قبل هذه الثلاثة.

6. Output Platform
   - يربط بالنواة.
   - snapshot، authorization، audit وartifact lifecycle.
   - لا PDF الآن إلا عند الحاجة الفعلية.

معايير إغلاق النواة:
- اختبارات tenant isolation.
- اختبارات RLS.
- صلاحية مرفوضة.
- شركة غير مرتبطة مرفوضة.
- session revoked فورًا.
- refresh token لا يمر كـaccess.
- audit transaction rollback.
- idempotency replay.
- serial concurrency.
- API build + typecheck + unit/integration tests.
- لا مهاجرات على نوركس.

---

## 7. المالية: ما تم فهمه من نوركس

لا تبدأ المالية قبل إغلاق النواة.

ملاحظات نوركس المهمة:

### المبيعات
- إدخال ملخص نهاية دوام، وليس POS تفصيليًا.
- تاريخ عملية، وردية أو ورديتان، قنوات دفع مرتبطة بخزائن، عدد العملاء، ملاحظات.
- serial شائع:
  `DS-YYYYMMDD-001`
- الإلغاء يحتفظ بالمستند والرقم.
- تعديل العمليات السابقة مطلوب.

### الفواتير والمصروفات والمشتريات
- أنواع سلاسل مثل:
  `PUR`, `EXP`, `HR`, `ADV`, `SAL`
- مثال:
  `PUR-YYYYMMDD-001`
- الفاتورة تخزن gross / net / tax.
- يجب بناء serial مركزي ذري؛ نوركس الحالي يستخدم count + 1 وليس آمنًا في التزامن.
- التعديل/الإلغاء لا ينبغي أن يحذف أثر القيود المنشورة دون أثر revision أو reversal واضح.

### الخزائن
- خزائن نقدية/بنك/تطبيقات.
- نقل داخلي وعكس النقل.
- سياسة السالب مسموحة.
- يجب التفريق بين:
  - صافي حركة الفترة.
  - الرصيد حتى تاريخ.
- لا تصفير شهري؛ توجد حركة وحمل.

### الفترة والتاريخ
- نوركس يستخدم filter شهريًا من أول الشهر إلى آخره بتوقيت السعودية.
- بعض أجزائه تستخدم UTC أو DateTime متفرق؛ Baseer يصحح ذلك بنواة Business Date المركزية.
- لا نضيف إقفال إلزامي رغم أن بعض كود نوركس فيه fiscal period closure.

### الضريبة
- قيد البيع المثالي:
  - مدين خزينة: 115
  - دائن مبيعات: 100
  - دائن VAT payable: 15
- العرض الإداري الافتراضي Baseer: 115.
- فصل الضريبة: 100 + 15.
- VAT الرسمي يعتمد invoice tax fields والتصنيف، وليس واجهة تقرير قابل لتعديل localStorage.
- Hajri Tax يعتبر موديول تقارير/امتثال لاحق، لا مصدر الحقيقة للمبيعات والمصروفات.

### التقارير ومركز القيادة
- Ledger هو المصدر الرسمي للأموال والربح والحركة المحاسبية.
- لكن Ledger ليس مصدر كل شيء:
  - المبيعات اليومية، القنوات، الورديات وعدد العملاء مصدرها تشغيلي.
  - المخزون والكميات مصدرها عمليات.
  - aging وdue dates مصدرها فواتير وتخصيصات سداد.
  - bank reconciliation مصدر كشف الحساب والمطابقة.
- مركز القيادة يوضح مصدر كل KPI:
  - Accounting truth.
  - Operational activity.
  - Control / compliance.
- لا يخلط مصدرين تحت الرقم نفسه.

---

## 8. الترحيل من نوركس لاحقًا

ليس الآن.

الخطة:
1. اقرأ بيانات نوركس فقط.
2. Snapshot export.
3. Mapping legacy IDs إلى Baseer IDs.
4. Preflight يرفض البيانات الملتبسة ولا يخمن.
5. Import إلى staging Baseer.
6. Reconciliation لكل شركة وشهر:
   - عدد المستندات.
   - status.
   - serials.
   - gross/net/tax.
   - vault movements/balances.
   - ledger.
   - الإلغاءات.
7. Dry run واحد أو أكثر.
8. عند الجاهزية:
   - توقف كتابة قصير في نوركس.
   - snapshot نهائي.
   - import نهائي.
   - reconciliation 100%.
   - موافقة المالك.
   - Baseer يصبح الكاتب الوحيد.
   - نوركس read-only مؤرشف.
9. لا dual-write طويل.
10. لا تستخدم logical backup import الحالي في نوركس كترحيل نهائي؛ هو ينشئ شركة جديدة داخل نفس tenant ولا ينقل كل العلاقات والسجل.

---

## 9. الوثائق الموجودة أو الواجب الرجوع إليها

داخل Baseer ERP:
- `README.md`
- `docs/BASEER_ERP_MODULE_ARCHITECTURE.md`
- `docs/UNIFIED_SHELL_BUILD_PLAN.md`
- `docs/architecture/BUSINESS_DATE_KERNEL.md`
- `docs/modules/finance/BASEER_APPROVED_POLICY.md`
- `docs/foundation/IDENTITY_COMPANY_CONTEXT_DISCOVERY.md`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260814194500_identity_company_core/migration.sql`
- `packages/output-platform/*`

داخل Noorix، للقراءة فقط:
- `backend/src/auth/auth.service.ts`
- `backend/src/auth/jwt.strategy.ts`
- `backend/src/auth/guards/company-access.guard.ts`
- `backend/src/auth/guards/roles.guard.ts`
- `backend/src/common/tenant-context.ts`
- `backend/src/tenant.middleware.ts`
- `backend/src/dashboard/dashboard-ledger-projection.service.ts`
- `backend/src/reporting/reporting.facade.ts`
- `backend/src/reporting/insights/dashboard-insights.service.ts`
- `backend/src/reports/reports-tax-vat.service.ts`
- `backend/src/tax-vat-core/tax-vat-core.service.ts`
- `src/ui/usePrintPreview.tsx`
- `src/ui/PrintPreviewModal.tsx`
- `src/utils/printUtils.ts`
- `src/utils/printTableHtml.ts`
- `src/utils/excelExportImport.ts`
- `docs/modules/SALES.md`
- وثائق الخزائن والمصروفات والمشتريات الموجودة ضمن `docs/modules`.

---

## 10. مصادر خارجية موثوقة تمت مراجعتها

### تصميم التنقل والموديولات
- Odoo Apps/Menu:
  https://www.odoo.com/documentation/15.0/developer/tutorials/getting_started/06_firstui.html
- Microsoft Dynamics navigation:
  https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/page-navigation
- SAP Fiori Spaces and Pages:
  https://help.sap.com/docs/btp/sap-fiori-launchpad-for-sap-btp/spaces-and-pages
- ERPNext Workspaces:
  https://docs.frappe.io/erpnext/workspace

### Prisma/PostgreSQL
- Prisma client setup:
  https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction
- Prisma PostgreSQL:
  https://www.prisma.io/docs/orm/core-concepts/supported-databases/postgresql

### SheetJS
- SheetJS Node installation:
  https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
- SheetJS changelog:
  https://git.sheetjs.com/sheetjs/sheetjs/src/branch/master/CHANGELOG.md

### Odoo: مرجع فقط وليس أساس Baseer
- Odoo multi-company:
  https://www.odoo.com/documentation/19.0/developer/howtos/company.html
- Odoo Saudi localization:
  https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/saudi_arabia.html
- Odoo custom database upgrades:
  https://www.odoo.com/documentation/19.0/developer/howtos/upgrade_custom_db.html

---

## 11. بداية المحادثة الجديدة

افتح مشروع Codex جديدًا مصدره الوحيد:

`D:\Codex\Baseer-ERP`

لا تضف Noorix لهذا المشروع الجديد إذا كان ذلك يمنع أداة التعديل.

ثم الصق هذا النص المختصر:

“اقرأ BASEER_ERP_HANDOFF.md كاملًا. أكمل من قسم النواة فقط. أصلح الربط المركب لـAuditEvent أولًا، ثم Prisma generate، ثم Database/Tenant context/Identity/Sessions/Authorization/Audit/Idempotency/Serials. لا تبدأ المالية، ولا تلمس Noorix أو أي بيانات أونلاين.”

---

## 12. تحذيرات

- لا تطبق migrations على نوركس.
- لا تفتح أو تطبع connection string لإنتاج.
- لا تبدأ Finance UI قبل إغلاق النواة.
- لا تعيد إدخال ExcelJS.
- لا تعد إلى Odoo كأساس.
- لا تنسخ واجهات نوركس أو APIs الواسعة.
- لا تستخدم localStorage كمصدر حقيقة مالي أو ضريبي.
- لا تجعل Baseer مجرد روابط إلى نوركس.
- لا تحذف الملفات أو قاعدة البيانات بحجة إعادة البداية.
```

بعد حفظه: افتح المشروع الجديد، الصق الملخص أو أرفق الملف، ثم اكتب: **«نفذ من بداية قسم النواة»**.
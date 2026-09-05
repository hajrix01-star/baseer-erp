# تقرير مصادر البرنامج — التسويق والسمعة

**العنوان:** منهجية انتقال Google Business/Maps وGoogle Ads إلى Baseer ERP
**الجمهور:** مالك المنتج، فريق ألفا للبناء، التشغيل والتسليم
**التاريخ:** 2026-09-05
**النطاق:** منهجية وقياس وقطع للتسويق والسمعة؛ لا يتضمن أسراراً أو بيانات عملاء أو تشغيل موصل حي.

## الإجابة التنفيذية

المسار القابل للدفاع هو موصلان مستقلان: Business Profile للقراءة أولاً ثم نشر
ردود آلي ضيق وموافق عليه لكل موقع؛ وAds للقراءة والتحليل فقط. كلاهما يحتاج
OAuth خادمياً واختياراً صريحاً للموارد، وحقائق مزود منفصلة عن المحاسبة. يظل
المصدر القديم قائماً أثناء مطابقة متوازية، ثم لا يغلق إلا بعد pilot واسترداد
واختبار revoke/kill switch ومراجعة تسليم مستقلة.

## سجل الادعاء ← المصدر

| الادعاء | المصدر | ملاحظة وصول |
| --- | --- | --- |
| GBP API يحتاج OAuth ومشروعاً مهيئاً/مقبولاً؛ لا sandbox لتجربة التكامل الحي | [Google Business Profile basic setup](https://developers.google.com/my-business/content/basic-setup) | وصول 2026-09-05 |
| OAuth يثبت موافقة المالك وقد يتيح عملاً offline نيابة عنه، بما في ذلك الردود | [Implement OAuth with Business Profile APIs](https://developers.google.com/my-business/content/implement-oauth) | وصول 2026-09-05 |
| مراجعات الموقع قابلة للقراءة والرد والحذف بالمسار المقيد بالحساب/الموقع/المراجعة | [Work with review data](https://developers.google.com/my-business/content/review-data) | وصول 2026-09-05 |
| مؤشرات الملف هي ظهور/تفاعلات، ونقر الاتصال/الموقع/الاتجاهات ليست بالضرورة نتائج نهائية | [Business Profile performance](https://support.google.com/business/answer/9918094) | وصول 2026-09-05 |
| API policies تقيد الموافقة والمحتوى والاحتفاظ | [Business Profile API policies](https://developers.google.com/my-business/content/policies) | وصول 2026-09-05 |
| Ads developer token ومستوى الوصول يحددان الحصص، وتظهر `RESOURCE_EXHAUSTED` عند التجاوز | [Google Ads API limits and quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas) | وصول 2026-09-05 |
| متوسط CPC هو total cost ÷ clicks؛ المقاييس ذات شروط availability/aggregation | [Google Ads metrics reference](https://developers.google.com/google-ads/api/reference/rpc/v24/Metrics) | وصول 2026-09-05 |
| conversion definitions/lag/attribution تغير تفسير الأداء | [Google Ads conversion tracking](https://support.google.com/google-ads/answer/6270625) | وصول 2026-09-05 |

## حدود وعدم يقين

- لم يتحقق التقرير من قبول مشروع Google الحالي أو ملكية الحسابات أو مستويات developer token؛ هذه حقائق تشغيلية لا تستنتج من الإنترنت.
- لا يجوز استنتاج مدة الاحتفاظ أو SLA أو تعريف التحويل التجاري أو سياسة العملة؛ يجب أن يعتمدها المالك.
- واجهات Google المتقادمة والمتبدلة لا تستخدم دون re-validation مباشرة قبل التفعيل.

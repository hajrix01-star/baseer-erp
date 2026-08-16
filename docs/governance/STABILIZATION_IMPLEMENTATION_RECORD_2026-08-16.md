# سجل تنفيذ مرحلة التقوية — BASEER ERP

- **التاريخ:** 2026-08-16
- **السبب:** تطبيق توصيات مراجعة 360 درجة قبل فتح موديولات أعمال أو تكاملات جديدة.
- **الحالة:** تقوية مصدرية واختبارات محلية؛ ليست اعتماد نشر Hostinger بعد.

## المنفذ

1. **سياق الشركة الحي في الواجهة:** رأس التطبيق يحصل على الشركات المتاحة من الخادم ويعرض الشركة النشطة ويبدلها من جلسة المستخدم. لا يبقى اسم شركة ثابتاً في الرأس.
2. **فصل مبيعات الكاشير:** فصلت صلاحيات إدخال التقفيل، التصحيح، العكس، وتوثيق يوم بدون عمل. الكاشير الجديد يحصل على الإدخال فقط؛ الانتقال المؤقت يحترم الدور القديم حتى يعاد حفظه من الإدارة.
3. **حماية الواجهة:** أزرار التصحيح والعكس ويوم بدون عمل لا تظهر إلا عند توفر الصلاحية الحية؛ الباكند يعيد التحقق من كل أمر.
4. **وصولية نافذة التقفيل:** Escape للإغلاق، حبس التنقل بلوحة المفاتيح، وإعادة التركيز للعنصر السابق.
5. **تسجيل الدخول:** حد محاولات محلي لخادم خاص واحد: خمس إخفاقات خلال 15 دقيقة تؤدي إلى حجب 15 دقيقة؛ النجاح يمسح نافذة المحاولات. لا تسجل كلمات المرور أو مفاتيح الجلسات.
6. **نشر الواجهة:** أضيفت صورة `Dockerfile.web` وNginx داخلي، ويوجه Caddy مسار `/v1/*` إلى API وبقية المسارات إلى واجهة React. أضيفت رؤوس HSTS وCSP وframe deny وغيرها.
7. **CI:** أضيف فحص GitHub Actions للبناء والعقود والواجهة و`npm audit` واختبار حد تسجيل الدخول.
8. **Daily Sales backend components:** the former large command service is split into a 204-line coordinator, a 341-line integrity/idempotency/audit support service, a 387-line write service, a 264-line posting service, a 212-line read service, and shared types. The API contract and database schema are unchanged.
9. **Daily Sales UI components:** the workspace now delegates preview lifecycle, insights, closing history and dialog focus handling to dedicated UI units. Native behavior, server-owned calculations and the workspace request budget are unchanged.
10. **Administration user lifecycle:** owner-only user disable/activate, password reset and company-membership withdrawal now revoke sessions immediately, write redacted audit receipts, require a reason, and reject disabling the last active tenant owner. The administration UI is split into small workspace panels and an API client boundary.
11. **Noorix-compatible sign-in:** BASEER accepts either a full email or a 3–64 character short username. The server resolves the latter to `<username>@hajrix.com`, preserves existing external email identities, and uses that resolved identity for rate limiting, and the administration UI displays the short form. HTTP verification covers both forms.
12. **Hostinger:** قرار الاستضافة والنسخ اليومي موثق في `docs/operations/HOSTINGER_PRIVATE_HOSTING_AND_BACKUP_DECISION_2026-08-16.md`.
13. **Permission catalogue completeness:** every current Finance, platform output, observability, and AI command capability is now in the server-owned catalogue. System role templates use explicit allowlists; a company manager no longer gains unknown future capabilities automatically.
14. **Web command quality:** the daily-sales and administration adapters parse the standard safe API error receipt and show its correlation reference. Financial reversal uses an accessible in-app confirmation dialog with a mandatory reason; it does not use a browser prompt.

## تحقق منفذ

- TypeScript للعقود والباكند والواجهة.
- بناء إنتاجي للعقود والباكند والواجهة.
- بناء Docker لصورة الواجهة بنجاح.
- صحة Docker Compose دون تشغيل الخدمات.
- اختبار HTTP معزول للمبيعات: دخول، عزل شركة، إدخال، idempotency، ضريبة، تقفيل، كاشير بسبعة سجلات، ومنع الكاشير من التصحيح والعكس ويوم بدون عمل.
- اختبار حد محاولات تسجيل الدخول.
- اختبار HTTP معزول للإدارة: تعطيل/تفعيل، إعادة ضبط كلمة المرور، سحب العضوية، إبطال الجلسات، تدقيق بلا كلمة مرور، وحماية آخر مالك.

## مؤجل عمداً

- رفع ملفات وشعار فعلي: حتى يبنى قسم الملفات وتثبت سياسة التخزين على خادم Hostinger؛ لا يوجد حفظ bytes داخل PostgreSQL.
- Outbox/worker وGoogle/Gmail/AI: يبنى قبل أول اتصال خارجي، لا قبله، حتى لا نضيف خدمة غير مستخدمة.
- MFA وCookies HttpOnly: بوابة إلزامية قبل أول نشر عام على الإنترنت.
- اختبارات Playwright الكاملة: تأتي مع اكتمال رحلات الإدارة وليس شاشة تجريبية.
- تعديل أو تشغيل نسخة Hostinger اليومية: لا يتم إلا عند مرحلة النشر وبقرار المالك.
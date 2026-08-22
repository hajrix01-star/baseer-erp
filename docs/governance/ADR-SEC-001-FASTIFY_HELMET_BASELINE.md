# ADR-SEC-001 — Helmet لواجهة API

**الحالة:** تحقق محلي مكتمل؛ CSP يعمل الآن بوضع report-only، وسياسة HSTS
والـedge الإنتاجية تنتظر إثبات TLS.

يعتمد API `@fastify/helmet@13.1.1` مع Fastify `5.11.3` المطابق لـNest.
تطبق رؤوس الحماية الآمنة لردود JSON. يرسل API سياسة CSP ضيقة بوضع
`report-only` (`default-src 'none'` مع منع form/base/object/frame) كي نرصد أي
تعارض بلا حجب لطلب مشروع. لا تتحول إلى enforce قبل اختبار الـSPA وملفات الرفع
والـedge. لا يستضيف API الـSPA، وHSTS لا يفعّل إلا عبر
`BASEER_ENABLE_HSTS=true` بعد تأكيد TLS.

لا تغير هذه الخطوة CORS أو cookies أو CSRF؛ التطبيق يستخدم Bearer tokens، وأي
origin منفصل أو auth cookie يحتاج قرار نشر واختبارات headers مستقلة.

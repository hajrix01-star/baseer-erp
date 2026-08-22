# ADR-SEC-001 — Helmet لواجهة API

**الحالة:** تحقق محلي مكتمل؛ سياسة CSP/HSTS الإنتاجية تنتظر إثبات TLS والـedge.

يعتمد API `@fastify/helmet@13.1.1` مع Fastify `5.11.3` المطابق لـNest.
تطبق رؤوس الحماية الآمنة لردود JSON. لا نفعل CSP أو HSTS افتراضياً: API لا
تستضيف SPA، وHSTS لا يفعّل إلا عبر `BASEER_ENABLE_HSTS=true` بعد تأكيد TLS.

لا تغير هذه الخطوة CORS أو cookies أو CSRF؛ التطبيق يستخدم Bearer tokens، وأي
origin منفصل أو auth cookie يحتاج قرار نشر واختبارات headers مستقلة.

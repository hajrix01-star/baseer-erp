# فهرس قرارات المعمارية

| القرار | الحالة | النطاق | المرجع |
|---|---|---|---|
| ADR-001 | Active | Modular monolith، React/Nest/PostgreSQL، حدود Noorix | `../ADR-001-GREENFIELD-BASEER-ERP.md` |
| Module Taxonomy v2 | Active for domain boundaries | حدود تطبيقات ERP والنواة المشتركة | `../BASEER_ERP_MODULE_TAXONOMY_V2.md` |
| User Modules v3 | Active for user navigation | التطبيقات والرحلات الظاهرة للمستخدم | `../BASEER_ERP_USER_MODULES_V3.md` |
| Attendance blueprint | Active for attendance scope | الدوام، الجداول والحضور | `../ATTENDANCE_AND_TIMEKEEPING_IMPLEMENTATION_BLUEPRINT_AR_2026-08-27.md` |
| Basira foundation | Active where AI applies | حدود الذكاء والقراءة الآمنة | `../DECISION_INTELLIGENCE_AND_BASIRA_FOUNDATION_2026-08-21.md` |
| ADR-UI-006 | Active | زر مسح التقويم المركزي وسقف عناصره الأصلية | `../../governance/ADR-UI-006-CENTRAL-CALENDAR-CLEAR-CONTROL.md` |
| ADR-OPS-001 | Active | نشر Baseer ERP الخاص تلقائياً عبر SSH مقيد وimmutable manifests | `../ADR-OPS-001-PRIVATE-ONLINE-CONTINUOUS-DELIVERY.md` |
| ADR-OPS-002 | Active | بوابة قبول PR كاملة ثم نشر main سريع مع preflight وcache | `../ADR-OPS-002-FAST-PRIVATE-ONLINE-RELEASES.md` |
| ADR-OPS-003 | Active | اكتشاف إصدار واجهة منشور ومطالبة تحديث مركزية بلا Service Worker | `../ADR-OPS-003-CENTRAL-WEB-RELEASE-UPDATE-PROMPT.md` |
| ADR-OPS-004 | Active | مساحة `/baseer-static/*` لملفات Vite بعيداً عن `/assets/*` المحجوزة في edge المشترك | `../ADR-OPS-004-WEB-STATIC-ASSET-NAMESPACE.md` |
| ADR-MKT-001 | Active | حد موصلات Google: خلفية خادمية، أسرار منفصلة، اختيار صريح وfail-closed | `../ADR-MKT-001-GOOGLE-PROVIDER-BOUNDARY.md` |
| ADR-MKT-002 | Active for public legal-page slice | صفحات خصوصية/شروط عامة ثابتة قبل OAuth، بلا جلسة أو API أو أسرار | `../ADR-MKT-002-GOOGLE-OAUTH-PUBLIC-LEGAL-PAGES.md` |
| ADR-MKT-003 | Active for review read slice | مزامنة Google Business خادمية ومحدودة وقراءة التحليل/الردود فقط | `../ADR-MKT-003-GOOGLE-BUSINESS-REVIEW-SYNC.md` |
| ADR-MKT-004 | Active for full review history | احتفاظ كامل بتقييمات Google Business ولوحة سمعة خادمية قابلة للتصفح | `../ADR-MKT-004-FULL-REVIEW-HISTORY-AND-REPUTATION-DESIGN.md` |
| ADR-WAI-001 | Proposed | مراقبة فواتير WhatsApp: Baileys غير رسمي، mapping مجموعة/شركة، فصل رقابي بلا أثر مالي | `../ADR-WAI-001-WHATSAPP-INVOICE-MONITORING-BOUNDARY.md` |
| ADR-WAI-001 / WAI v2 | Proposed — supersedes scope summary above | تطوير 2026-09-05: فصل ملف/صفحات/فاتورة، حماية التعديلات، حالات وتكرار تاريخي، مؤشرات وعقد بصيرة، وجسر صريح غير مالي يفتح المشتريات | `../WHATSAPP_INVOICE_MONITORING_BUILD_PLAN_AR_2026-09-05.md` |

لا يحذف قرار قديم. عند استبدال قرار، يضاف صف جديد يذكر القرار الذي حل محله وتاريخه. أي تغيير `ARCHITECTURAL` يراجع هذا الفهرس قبل البناء.

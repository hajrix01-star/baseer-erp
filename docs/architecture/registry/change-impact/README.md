# سجل أثر التغيير

كل تغيير `CONTROLLED` أو `ARCHITECTURAL` يضيف ملفاً باسم `YYYY-MM-DD-<short-id>.md` قبل التسليم. لا يحتاج تغيير `LOCAL` ملفاً مستقلاً إذا سُجل في سجل البناء الحي.

```text
Reference: BASEER-ARCH vX.Y / lastVerifiedCommit
Classification: CONTROLLED | ARCHITECTURAL
Request and accepted scope:
Affected modules and owners:
Contracts/data/permissions changed or explicitly unaffected:
Decision or ADR required:
Implementation evidence and tests:
Registry updates and new reference version:
Delivery input: reference + impact file + known risks:
Rollback/compatibility, if applicable:
```

فريق التسليم يستخدم هذا السجل للتحقق من الأثر ولا يعيد استكشاف خريطة التطبيق ما لم يثبت أن المرجع قديم أو ناقص.

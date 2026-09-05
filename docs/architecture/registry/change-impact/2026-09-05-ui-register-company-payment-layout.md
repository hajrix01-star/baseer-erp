# BASEER-IMPACT-2026-09-05-UI-REGISTER-COMPANY-PAYMENT-LAYOUT

- **Registry:** `BASEER-ARCH v1.0`
- **Classification:** `CONTROLLED`
- **Owners:** `finance-accounting`, `operations-inventory-commercial`, `platform-identity-administration`
- **Intent:** replace the purchase/expense invoice-history card renderer with the existing bounded data grid; place the company editor submit action after its fields instead of a sticky top action; keep the three purchase-request payment channels on one physical row on mobile.

## Guardrails

- The history API continues to own filtering, cursor paging, sorting and monetary values. The browser only renders the returned page and opens the existing detail action.
- Company validation, atomic company/VAT save contract, ownership checks and logo upload remain unchanged. This is a DOM order and presentation correction only.
- Payment-channel values, defaults and validation remain unchanged. All three controls remain visible, keyboard reachable and have equal available width; no control is hidden or allowed to overflow.
- No API, schema, permission, migration, package, financial calculation or production-data change is in scope.

## Verification and rollback

- Verify web type checking, focused purchase/company/operations acceptance coverage, narrow mobile layout, and the existing release pipeline.
- Roll back with the single release commit if needed; no data restoration is required.

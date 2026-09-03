# Custom central calendar pickers — 2026-09-03

- **Classification:** `CONTROLLED`
- **Registry:** `BASEER-ARCH v1.0` (working-tree verified 2026-09-03)
- **Owner:** `apps/web/src/baseer-date-picker.tsx`, `apps/web/src/baseer-date-picker-runtime.tsx`, and `apps/web/src/baseer-form-fields.tsx`.
- **Intent:** replace the browser-native calendar surfaces behind the existing shared `BaseerDatePicker` and `BaseerMonthPicker` contracts with one Baseer-owned, accessible calendar popover. No route-local picker is added.
- **Unaffected contracts:** ISO `YYYY-MM-DD` and `YYYY-MM` values, `min`/`max` bounds, React Hook Form input/ref integration, tenant/company scoping, APIs, database, permissions, and accounting rules.
- **Direct path:** reuse the existing React stack, Baseer calendar visual tokens, and date utilities. No dependency is added; a package migration is not justified because the behavior belongs to an already central Baseer component.
- **Experience contract:** Arabic and English labels; RTL/LTR arrow direction; keyboard navigation; clear action where already supported; close on Escape and pointer-down outside; date and month constraints honored in the popover; mobile-safe viewport placement.
- **Risk and mitigation:** this shared control reaches many workspaces. Preserve its public prop contracts, add focused component/E2E coverage for date, month, bounds, keyboard close and clear, then run the web type-check and production build.
- **Rollback:** restore the three central component files and shared CSS; no persisted data or server behavior changes.

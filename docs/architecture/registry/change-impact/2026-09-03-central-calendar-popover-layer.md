# Central calendar popover layer — 2026-09-03

- **Classification:** `CONTROLLED`
- **Registry:** `BASEER-ARCH v1.0` (working-tree verified 2026-09-03)
- **Owner:** `apps/web/src/baseer-calendar-picker.tsx` and `apps/web/src/baseer-calendar.css`.
- **Intent:** render the shared date/month popover in Baseer's existing portal overlay layer, so a scrollable `DataTable` cannot clip it; normalize the input's LTR action layout so its calendar and clear controls never cover an ISO value.
- **Unaffected contracts:** ISO `YYYY-MM-DD`/`YYYY-MM`, bounds, React Hook Form ref/change compatibility, APIs, tenant/company context, data, permissions, accounting behavior and dependencies.
- **Direct path:** reuse React `createPortal` and `BASEER_OVERLAY_LAYER.portalPopover`, matching the existing central combobox strategy. No table-local z-index workaround and no new package.
- **Experience contract:** the popover is viewport-positioned below the anchor when space permits and above it otherwise; Arabic/English content retains its own direction; outside click, Escape, keyboard selection, clear and mobile placement remain supported.
- **Risk and mitigation:** this affects every central date/month control. Verify an outflow-purchase table plus mobile/desktop behavior, then run the owning E2E/type/build checks.
- **Rollback:** restore the two central files and this impact record; no persistent data or server behavior changes.
- **Verification:** the owned purchase E2E proves the calendar is portalled to `document.body`, remains dismissible outside its anchor, and keeps the action outside the ISO value on desktop and mobile; web type-check and production build pass.

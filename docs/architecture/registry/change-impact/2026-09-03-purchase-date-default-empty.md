# Purchase dates default empty — 2026-09-03

- **Classification:** `CONTROLLED`
- **Registry:** `BASEER-ARCH v1.0` (working-tree verified 2026-09-03)
- **Owner:** `apps/web/src/purchase-expense-workspace-runtime.tsx`.
- **Intent:** begin a new purchase batch and its new invoice rows with no date selected, so an operator must choose the posting date and any supplier invoice date deliberately.
- **Unaffected contracts:** the submitted ISO date contract, backend validation, API/schema, financial posting rules, company scope, permissions, calculations and audit behavior.
- **Explicit source exception:** a marketing handoff with a supplied `startsOn` still pre-fills that source date; an absent source date remains empty.
- **Risk and mitigation:** a required posting date must never become optional. Keep the existing submit validation and verify the initial empty state plus the refusal to submit until it is set.
- **Rollback:** restore the state/factory defaults; no persisted data or server behavior changes.
- **Verification:** the owned purchase E2E asserts an empty initial date on desktop and mobile before exercising the central picker.

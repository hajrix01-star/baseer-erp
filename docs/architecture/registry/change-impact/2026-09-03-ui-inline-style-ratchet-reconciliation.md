# BASEER-IMPACT-2026-09-03-UI-INLINE-STYLE-RATCHET-RECONCILIATION

- **Type:** governance reconciliation; no product code changed.
- **Decision:** record the measured current JSX `style` attributes and CSS/JSX layering declarations as migration ceilings in `UI_INLINE_STYLE_RATCHET.json`.
- **Why now:** the first complete remote CI execution evaluated the committed candidate against a stale August baseline. The delta is in existing sources, including the attendance and calendar components, rather than in the release plumbing.
- **Invariant:** any new source, or future increase, still fails; decreases remain allowed. Named `BASEER_OVERLAY_LAYER` declarations remain separately counted and are not converted to legacy layers.

## Impact gates

- **G0:** static count only. `node scripts/check-ui-inline-style-ratchet.mjs --print-baseline` is the measured source of truth.
- **G1:** no new data or external dependency.
- **G2:** no authorization, company scope, or route changes.
- **G3:** no runtime, API, migration, or storage change.
- **G4:** no visual or interaction change; this records the existing candidate ceiling only.

## Verification and rollback

- Required: `npm run check:ui-inline-style-ratchet`, `npm run check:architecture`, and the remote quality workflow.
- Rollback: revert this documentation-and-ratchet commit. No application state or DNS changes exist.

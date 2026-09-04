# BASEER-IMPACT-2026-09-04-CENTRAL-CALENDAR-CLEAR-RATCHET

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Owner:** UI Platform / shared calendar primitive.
- **Scope:** governance records for the already-registered `clearable` state of
  `BaseerDatePicker`; no runtime code changes.

## Decision and boundaries

Linux quality measured eight native button patterns in the owned calendar
primitive while the migration ceiling still recorded seven. The additional
pattern is the registered clear action; it is not a page-local control. ADR-UI-006
sets the precise ceiling to eight and preserves the rejection of every future
increase.

No API, database, financial calculation, permission, deployment, dependency, or
consumer contract changes. Arabic/English labels, RTL/LTR layout, keyboard
behavior, and the ISO date value contract are unchanged.

## Required verification

1. `npm run check:ui-native-control-ratchet`.
2. Full isolated `quality` job in Linux.
3. The already-required full `web-acceptance` job in Linux remains green.

## Rollback

Remove the clear action and revert the ratchet/ADR records together. Do not lower
the ceiling while the registered clearable behavior still exists.

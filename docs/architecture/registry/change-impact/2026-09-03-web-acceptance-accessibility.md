# BASEER-IMPACT-2026-09-03-WEB-ACCEPTANCE-ACCESSIBILITY

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Scope:** the shared Basira scope badge, mobile application navigation
  drawer, and the shared profile-menu overlay boundary only.

## Evidence and decision

Linux Chromium acceptance exposed two customer-visible accessibility defects:

1. the Basira scope badge foreground/background combination measured 4.28:1,
   below the WCAG AA 4.5:1 threshold for its text; and
2. reverse keyboard navigation (`Shift+Tab`) did not wrap from the drawer close
   control to its final interactive control.
3. an open profile menu could also consume `Escape` while the navigation drawer
   was active, overriding the drawer's focus restoration.

The repair preserves the existing application routes, permission model,
financial data, APIs, and visual composition.  It changes only the shared
semantic color token use for the badge and the drawer's existing focus-cycle
implementation, and closes the profile menu before the navigation drawer is
active. Axe and keyboard assertions remain strict; no test is
skipped, relaxed, or platform baseline copied.

## Verification and rollback

- Re-run the two focused browser tests on Linux, generate only any subsequently
  missing Linux screenshots, then run the full isolated web-acceptance gate.
- Roll back the CSS/drawer patch as one commit; no data, schema, deploy, or DNS
  state is involved.

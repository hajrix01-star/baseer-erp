# Design System and Component Standard

**Status:** Mandatory UI engineering standard  
**Applies to:** Every Baseer ERP web and mobile-responsive interface.

## 1. One design system, not one design per module

Baseer ERP has one central component system. Modules compose it; they do not invent their own buttons, cards, tables, dialogs, form controls, colors, spacing systems, empty states, or loading patterns.

Theme is a central visual token layer. A theme can change appearance only; it must not change route access, workflow, data, permission, calculation, or component semantics.

## 2. Component layers and ownership

```text
foundation tokens
  -> primitives
    -> shared patterns
      -> domain components
        -> module screens
```

| Layer | Examples | Rules |
| --- | --- | --- |
| Foundation tokens | color, typography, spacing, radius, shadow, motion, breakpoints, z-index | Central only; no raw repeated values in module CSS |
| Primitives | Button, IconButton, Input, Select, DateInput, Badge, Dialog, Tooltip, Tabs | Accessible, RTL-aware, documented, no domain logic |
| Shared patterns | PageHeader, FilterBar, DataTable, EmptyState, ErrorState, LoadingState, ConfirmDialog, ReceiptPanel | Reused whenever behavior is common |
| Domain components | MoneyAmount, BusinessDatePicker, SerialBadge, VATBreakdown, VaultMovementLabel | Own only approved domain presentation; no calculations |
| Module screens | FinanceDashboard, DailySalesScreen, VaultsScreen | Compose components and server receipts; do not recreate primitives |

## 3. Required component contract

Every reusable component has a typed public API and documents:

1. Purpose and ownership layer.
2. Required/optional props and safe defaults.
3. Supported states: default, hover, focus-visible, active, disabled, loading, error, empty, and read-only where relevant.
4. Keyboard behavior, semantic element/ARIA labeling, and screen-reader output.
5. RTL/LTR behavior and responsive behavior.
6. Visual tokens it consumes; no hidden hard-coded brand values.
7. Test coverage for interaction and accessibility where applicable.

Components must not accept an unrestricted `className` or arbitrary style object if that would let a module bypass tokens or break accessibility. Approved extension slots/variants are preferred.

## 4. Non-negotiable UX rules

- Interactive targets are at least 44px by 44px.
- Keyboard focus is visible and never obscured by fixed headers, dialogs, or overlays.
- Color is never the only way to communicate status; labels/icons/text accompany it.
- Every icon-only action has an accessible name and tooltip where appropriate.
- Destructive actions use a distinct confirmation pattern; the component never implies completion until a server receipt confirms it.
- Loading state prevents accidental duplicate command submission but retains the user’s intent for safe retry.
- Empty state explains what is absent, why, and the permitted next action.
- Error state is safe, bilingual, actionable, and exposes a correlation/reference ID rather than technical details.
- Tables have a mobile strategy defined before implementation: responsive columns, detail drawer, or explicit alternative list. Horizontal overflow is never an accidental fallback.

## 5. Forms and data entry

- Form controls are built on shared primitives and use consistent label, help, required, validation, disabled, and read-only behavior.
- Field validation has three levels: input usability in UI, strict contract validation at API boundary, and authoritative business validation in backend command.
- Forms collect input only. They do not calculate financial totals, tax, eligibility, balances, periods, or serials.
- Confirmation dialogs repeat a server-provided or contract-defined summary; they do not reconstruct financial outcomes locally.
- Long or risky commands use draft/recovery patterns only when the backend owns their state.

## 6. Tables, cards, charts, and dashboards

- `DataTable` is a server-driven pattern: server pagination, filtering, sorting intent, loading/empty/error states, accessible headers, and stable row keys.
- A card represents one clear decision or metric. It is not a container for unrelated shortcuts.
- Financial cards display the basis supplied by the backend, such as gross, net, tax, period movement, or balance-as-of.
- Charts receive complete server series and labels. The UI may render them but cannot aggregate, interpolate business values, or derive ratios.
- Dashboards use a fixed, understandable information hierarchy. They do not become an ungoverned collection of configurable widgets.

## 7. RTL, languages, and numbers

- All components work in Arabic RTL and English LTR without separate duplicated components.
- Direction is inherited from the central locale provider; components use logical CSS properties rather than left/right assumptions.
- Visible digits use English `0-9` in both languages.
- Arabic and English copy are product content, not hard-coded in random module files. Translation keys have a clear owner and fallback policy.
- Date, money, percentage, and status components use the central display-formatting layer. Formatting never changes underlying business values.

## 8. Styling and visual quality

- Tokens are CSS variables/design tokens managed centrally, including light/dark or future visual themes.
- Modules must not define competing palettes, arbitrary shadows, arbitrary radii, or arbitrary spacing scales.
- CSS is locally scoped to the component/module and uses logical properties; global CSS is reserved for reset, tokens, typography, and application shell.
- Motion is subtle, respects reduced-motion preferences, and never hides state change or delays critical action.
- Images/icons have controlled sizing, alt text, and loading behavior. SVG/script-capable uploads are not treated as decorative safe assets by default.

## 9. Component testing and release criteria

Each shared primitive or pattern requires:

1. Typed API tests.
2. Keyboard/focus and accessible-name tests where interactive.
3. RTL/LTR visual/behavioral coverage where direction matters.
4. Disabled/loading/error/empty state tests where applicable.
5. Responsive test at the supported mobile breakpoint.
6. No dependency on a module-specific API or business calculation.

Before a new component is created, the implementer must show why an existing primitive/pattern cannot be extended safely. Duplicate components with slightly different visual styling are rejected.

## 10. Component review questions

1. Is this a foundation token, primitive, shared pattern, domain component, or module-only composition?
2. Does an existing component already solve the need?
3. Does it have one responsibility and a typed API?
4. Are every interactive state, keyboard action, and screen-reader name supported?
5. Does it work in Arabic RTL, English LTR, desktop, and mobile?
6. Does it render server truth without calculating or changing it?
7. Does it use central tokens and preserve theme-only semantics?
8. Is it tested independently before being relied upon by a module?


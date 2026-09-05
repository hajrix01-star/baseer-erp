# BASEER-IMPACT-2026-09-05-AI-PROVIDER-DRAFT-VERIFY-ACTION

- **Registry:** `BASEER-ARCH v1.0`
- **Classification:** `CONTROLLED`
- **Owner modules:** `platform-identity-administration`, `marketing-decision-reports`
- **Reused decision:** `DECISION_INTELLIGENCE_AND_BASIRA_FOUNDATION_2026-08-21.md` and `BASEER-IMPACT-2026-09-05-AI-CREDENTIAL-VAULT-PRODUCTION`

## Scope and direct path

The saved Basira provider profile showed the Arabic verification instruction as
static text inside its operational card. The real check action was only in a
separate status card, so an owner could reasonably try to press text that was
not an action. Replace the draft-card instruction with the existing central
`BaseerButton`, which calls the existing owner-only provider-connection route.

The action is rendered for an owner on a draft profile card. The server keeps
the existing newest-configuration selection rule. The API, permission check,
encryption boundary, audit receipt, data model, costs and activation route are
unchanged.

## Acceptance and verification

1. An owner sees a real keyboard-accessible verification button on the current
   draft profile card.
2. Pressing it sends exactly one existing `POST /administration/ai/provider-connection` request.
3. The action is busy-safe and preserves the existing owner-only boundary.
4. The relevant mocked browser test and the web type check pass.

## Capacity, safety and rollback

This only exposes an existing deliberate external probe; it adds no polling,
retry loop, background work or client-side provider call. The server remains
the sole caller and keeps the safe receipt/audit behavior. Revert this change
to restore the prior static instruction; no data migration or secret change is
required.

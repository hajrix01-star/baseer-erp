# ADR-AI-001 — Basira Decision Alert Interpreter pilot

**Date:** 2026-08-23
**Status:** Active personal/local pilot, not production

## Decision

Use `openai@7.5.0` in the API only to create a structured, explanation-only
response for the existing `decision.command_center_analyst` skill.

The browser submits an alert ID, requested language and idempotency key. The
server authorizes the user and company, creates the existing frozen
`BasiraDecisionAlertBrief`, verifies its checksum, then sends that compact
brief to OpenAI with `store: false` and a strict JSON schema. The browser never
sends a free-text prompt, raw rows or a credential.

## Explicit exclusions

- No record write, approval, payment, posting, closure, publication or RBAC
  action.
- No web, file, database or other external tool available to the model.
- No generic chat, persistent conversation, retrieval/vector database or
  cross-module context.
- No production/public deployment, another model/provider or autonomous
  follow-up without a separate decision.

## Controls

The server requires `platform.ai.use`, the Decision read capability, active
company context, checksum-valid evidence, idempotency, per-user and per-provider
limits, and an audit/execution receipt. Provider keys are AES-GCM encrypted at
rest and are decrypted only for the outbound server call. Input text is treated
as data, never as instructions. A failed provider call is auditable and seals
the idempotency receipt with a safe 503 result.

Execution is disabled unless
`BASEER_BASIRA_DECISION_PILOT_ENABLED=true` is set in the API environment.
Configuration or a stored key alone must not enable it.

## Acceptance before use

1. API and web checks/builds, targeted Decision browser test and runtime audit
   pass from the same revision.
2. Configure one restricted, non-production OpenAI key using the existing
   encrypted provider configuration path.
3. Compare a small set of known frozen alerts manually: the response must cite
   only supplied evidence, state limitations and propose review steps without
   causal or action claims.
4. Keep pilot requests low and review each receipt. Disable the environment
   switch immediately if an explanation is misleading or policy-violating.

# BASEER ERP AI Platform and Company Identity Foundation

Date: 2026-08-15
Decision: Required platform foundation. AI is shared infrastructure for all ERP modules, not a Marketing-owned integration.

## Owner outcome

An administrator configures one tenant-scoped (system-wide) AI provider/API credential in Administration. Finance, Marketing, Operations, Documents, Reports and Command Center call one internal AI Gateway. Each company keeps its own AI identity and work context. Changing the supported provider changes the one active system configuration, not each module's code.

## Scope and isolation

- The provider configuration and API credential belong once to the tenant/system. Company identity, prompt context, usage attribution, execution receipt and output remain company-scoped. A company never receives another company's context, output or execution history.
- A central gateway and provider-adapter interface are shared; the credential and active-provider choice are tenant/system-scoped.
- A provider is a supported adapter type, not an arbitrary URL supplied by a user. This prevents server-side request forgery and makes provider changes safe and testable.
- No provider call, AI analysis or AI configuration can bypass CompanyContext, role capability, RLS, audit or idempotency.

## Identity terminology

`AiSystemIdentity` is the tenant/system-wide assistant identity: Arabic and English assistant name, default language, tone and non-negotiable safety instructions. It is versioned centrally in Administration, so changing the name does not create different assistants for different companies.

`AiCompanyIdentity` is a separate company-scoped context profile: concise approved company context and module policy reference. It has no assistant-name authority and never changes the central assistant identity.

Both identities are bounded system policy. Neither can approve accounting, alter a journal, publish an external message, reveal credentials or override authorization.
## Provider configuration

The single system provider configuration contains a supported provider kind, model name, enabled status, safe daily request and cost limits, configuration version and encrypted server-only credential envelope. Secrets never appear in API responses, browser state, audit JSON, logs or AI execution receipts.

The initial gateway permits only draft/analysis output. It has no authority to publish Google replies, spend on Google Ads, send messages, alter a finance record or run an automation. Each such side effect remains a separate module command with its own human approval.

## Required capabilities

- `platform.ai.configuration.read`
- `platform.ai.configuration.write`
- `platform.ai.identity.read`
- `platform.ai.identity.write`
- `platform.ai.use`
- `platform.ai.usage.read`

Using AI does not grant configuration, secret, publication or financial capabilities.

## Backend delivery order

1. Contracts for provider configuration, company AI identity, safe configuration receipt and execution receipt.
2. Prisma models, compound tenant/company references, RLS/FORCE RLS, encrypted credential envelope and append-only execution telemetry.
3. Administration commands: configure/disable/select provider and create/activate identity version, with CompanyContext, idempotency and AuditEvent. Configuration reads are secret-free.
4. AI Gateway adapter registry with deterministic no-provider/disabled/limit error receipts. No external provider call until a provider decision record, adapter implementation and tests pass.
5. Module adoption begins with Google review draft and Marketing analysis; Finance is draft-only and cannot post automatically.
6. Administration UI and provider-specific connection screens only after backend verification.

## Provider change rule

An administrator may activate another supported configuration for the BASEER ERP tenant/system. Existing execution receipts retain provider/model/configuration and identity versions for audit. A provider change never alters historical output or reruns an action. Unsupported providers require a new reviewed adapter; they cannot be added by entering a custom endpoint.

## Mandatory verification

- Cross-company and revoked-session authorization is denied.
- Credential ciphertext cannot be returned, logged or audited.
- Same idempotency key replays safely; a different request with the same key is rejected.
- Concurrent activation leaves one active system provider configuration and one active identity version per company.
- Disabled, quota-exhausted or unconfigured AI fails closed with a bilingual safe receipt.
- Module requests carry a correlation ID and write no Finance journal, provider request or external action in this foundation phase.
## Curated skills

Skills are not hidden model training and are not unrestricted custom prompts. BASEER keeps a versioned, reviewed skill catalog that the AI Gateway selects by module and records in future execution receipts. The first catalog includes:

- accounting advisor: explanation and reconciled exceptions only; never posts or alters journals;
- marketing performance analyst: provider facts, campaign windows and data quality; never claims causation;
- Google Ads advisor: read-only campaign interpretation; never creates, changes or spends on ads;
- Google Business and reputation advisor: drafts replies and explains profile facts; never publishes automatically;
- executive analyst: concise read-only decision summaries with freshness and uncertainty.

A future Administration UI may enable approved skills per company/module, but cannot change their non-negotiable rules or turn a skill into external execution.

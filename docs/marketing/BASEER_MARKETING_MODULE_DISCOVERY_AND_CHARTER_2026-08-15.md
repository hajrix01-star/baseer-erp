# BASEER ERP Marketing Module - Discovery and Integration Charter

Date: 2026-08-15
Status: Historical broad discovery reference. The approved active scope is the narrower Marketing Performance & Google Hub decision. Planning, content, creators, competitors, publishing and execution described below are not current build scope.

## Decision

The external `D:\Codex\Baseer` application is a reference only. BASEER ERP will not import its database, authentication, deployment model, code, credentials, or external connections. The new Marketing Module is built from zero inside BASEER ERP and is governed by its existing identity, tenant, company, RBAC, audit, idempotency, RLS, file-metadata, and server-calculated reporting rules.

## What the reference application contains

Read-only discovery confirms these bounded capabilities:

1. Campaign planning: plans, versions, approvals, events, ad groups, creative assets, measurement and conversion definitions.
2. Content operations: content calendar, drafts, assets, schedule/dispatch records, approval history and optional local-post publication.
3. Creator operations: candidates, platform profiles, collaborations, revisions, attribution links, measurements, evidence and baselines.
4. Competitive intelligence: competitor records, assessments and evidence.
5. Reputation and local visibility: Google Business Profile, reviews, keywords, maps/local rank and customer-photo selections.
6. Integration intelligence: Google Ads, Analytics, Business Profile, sync runs, immutable report snapshots, source freshness and action items.
7. Governance: approval inbox, automation jobs, AI execution/retention, audit history, role permission checks, encrypted external credentials and HTTP-cycle tests.

## BASEER ERP adaptation

| Reference concern | BASEER ERP Marketing Module decision |
| --- | --- |
| Separate organizations/companies/authentication | Reuse Baseer ERP Tenant, User, Company, CompanyMembership, roles and capabilities. No second identity system. |
| Drizzle/Next application | Do not copy. Use the existing NestJS API, Prisma/PostgreSQL, React application and existing strict contracts. |
| Campaigns and content | Build as company-scoped internal planning records with version, approval and audit history. No external publishing in the first release. |
| Creator collaboration | Build company-scoped candidates, collaboration plans, attributed evidence and measured results. Payments remain Finance documents, not Marketing records. |
| Competitor/reputation/local visibility | Build internal records and evidence first. Live provider calls are deferred behind an approved integration capability and secrets policy. |
| Google Ads/Analytics/Business Profile | Deferred. Connection metadata, sync receipts and immutable snapshots require a separate integration decision. No keys, OAuth flows, automated calls or spending are assumed. |
| AI and automation | Deferred. Any later suggestion/automation must be opt-in, capability-gated, auditable, budgeted and cannot publish, spend or message externally without explicit approval. |
| Reports | Server-calculated read models only. Browser code never derives performance, financial attribution, or permission decisions. |

## Mandatory boundaries

- Every record has tenant and company scope and is protected by RLS plus live CompanyContext authorization.
- Marketing never writes a Finance journal directly. Approved spend or creator payment will reference a Finance document later through a controlled link.
- No external post, advert, spend, message, OAuth connection, sync, crawler or AI provider is enabled in the first module build.
- All mutations require explicit capability, strict request contract, idempotency, audit event and immutable history/reversal where applicable.
- Attachments use the existing Baseer file-metadata boundary; storage paths and credentials never reach the browser.
- Analytics/read models are server-generated and filter through the central filter contract once source operations exist.

## Delivery order

1. Marketing foundation: capabilities, company-scoped schema, RLS, audit/idempotency, controlled vocabulary and command/read contracts.
2. Campaign planning: draft, revision, submit, approve/reject, archive and manual measurement. No external execution.
3. Content planning: content item, assets, calendar, revision and approval. No publication.
4. Creator and competitor records: candidates, collaboration plan/evidence and competitor observation, all manual/evidence-backed.
5. Marketing read models: server-calculated campaign/content/creator/competitor views and central filters.
6. Optional integrations: each provider has its own discovery, capability matrix, owner approval, secrets handling, sync receipt, freshness and disable/revoke behavior.
7. Optional external execution: separate explicit owner decision for each publish, spend or message channel.

## Acceptance gate before any UI

The Marketing foundation must prove migrations on the isolated BASEER Docker test database; tenant/company isolation; capability denial; idempotency replay/mismatch; audit rollback; and no Finance or external side effect. Only then may a bilingual Marketing UI be built.

## Reference evidence inspected

- `D:\Codex\Baseer\packages\database\src\schema\campaigns.ts`
- `D:\Codex\Baseer\packages\database\src\schema\content.ts`
- `D:\Codex\Baseer\packages\database\src\schema\creators.ts`
- `D:\Codex\Baseer\packages\database\src\schema\intelligence.ts`
- `D:\Codex\Baseer\packages\database\src\schema\integrations.ts`
- `D:\Codex\Baseer\apps\web\src\components\workspace-tabs.tsx`
- `D:\Codex\Baseer\docs\architecture\BOUNDARIES.md`
- `D:\Codex\Baseer\docs\reference\TARGET_ARCHITECTURE.md`
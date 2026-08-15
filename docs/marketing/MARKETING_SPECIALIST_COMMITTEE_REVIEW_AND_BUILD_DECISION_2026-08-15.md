# BASEER ERP Marketing Module - Specialist Committee Review and Build Decision

Date: 2026-08-15
Status: Approved architecture and backend-first plan. No Marketing UI is authorized until Gate A passes.

## Committee

- Product and Marketing Operations review: reference-product scope, workflows and delivery priority.
- Backend and ERP Integration review: Baseer ERP Prisma/NestJS/Finance integration and server contract design.
- Security, Governance and Data Integration review: company isolation, approvals, files, provider integrations, AI and external side effects.

## Executive decision

Build Marketing as an internal, company-scoped ERP operations module. It is not a copy of the separate Baseer application and it is not a Google, SEO, social publishing or advertising-execution console.

The first release creates governed plans, approvals, evidence and manual measurements. It has no provider credentials, OAuth, crawler, webhook, AI execution, message sending, external publishing, advertising spend, automated jobs or direct Finance journal posting.

## Reference assessment

The reference is valuable for its governance patterns: versioned campaigns, approvals, immutable events, assets with integrity metadata, measurement provenance, creator attribution, competitor freshness and provider sync receipts. It is not the correct code or data model for BASEER ERP because it owns a separate identity/organization model, uses different technologies, mixes a Google/local-SEO console with marketing operations, and contains external provider functionality that must not be enabled by implication.

## Architecture decisions

| Decision | Committee ruling |
| --- | --- |
| Identity and scope | Reuse Baseer ERP Tenant, Company, User, CompanyMembership, live CompanyContext authorization and exact capability grants. No second organization/authentication model. |
| Data isolation | Every Marketing table has `tenantId` and `companyId`, compound cross-scope foreign keys, RLS with FORCE RLS, company predicates and indexes. |
| Data mutation | All writes use strict Zod contracts, Business Date where applicable, CompanyContext, idempotency, transaction-bound AuditEvent and domain event history. No hard delete for approved/measured history. |
| Finance relationship | One-way reference only. Marketing can link a planned budget or supported spend to a posted Finance document/payment; it never creates or changes a Finance journal, due, payment, vault or revenue. |
| Performance facts | `reportedSpend` and attributed revenue are external/manual measurement facts, not accounting actuals. Confirmed spend/revenue remains Finance/Sales source data. |
| Assets | Reuse FileMetadata version/hash/company boundary. Marketing asset records contain no storage path, raw object key, secret or duplicated security metadata. |
| Reporting | Server read models only. Missing data remains missing; a zero denominator yields `null`, not zero. |
| External connections | Provider-by-provider decision records. Read-only import is the earliest possible integration; execution requires a separate approval and is not in this module build. |
| UI | Bilingual Marketing UI begins only after the backend Gate A evidence below. |

## Backend scope before UI

### Foundation models

1. `MarketingCampaign`: title, platform, objective, audience, offer, planned budget/currency, target metric/value, date range, lifecycle, current/approved revision and actors.
2. `MarketingCampaignVersion`: immutable snapshot per campaign revision.
3. `MarketingCampaignEvent`: domain history for create, revise, submit, approve, reject, complete, cancel and archive.
4. `MarketingAdGroup`: optional internal audience/geography/placement and planned daily budget structure; no provider identifier in v1.
5. `MarketingAsset`: text/image/video/carousel metadata, UTM fields, lifecycle and FileMetadata linkage.
6. `MarketingConversionDefinition`: internal measurement definition. It never asserts accounting revenue.
7. `MarketingMeasurement`: append-only manual/evidence-backed fact with source class/reference, freshness, reported spend, impressions, clicks, conversions and optional attributed value.
8. `MarketingFinancialReference`: one-way link to an existing Finance record with immutable document/amount/date snapshot and link type.

All money uses Decimal(18,4) in storage and string contracts. All counts are non-negative. Campaign end must be after start. Revision numbers and source references are unique within correct company scope.

### Commands

- `marketing.campaign.create`, `revise`, `submit`, `decide`, `complete`, `cancel`, `archive`
- `marketing.ad_group.create`, `archive`
- `marketing.asset.create`, `approve`, `archive`
- `marketing.conversion.create`, `activate`, `archive`
- `marketing.measurement.record`
- `marketing.finance.link`

A revision after submission invalidates earlier approval. A requester cannot approve their own campaign unless the owner later records a deliberate exception policy. Measurement is append-only; a correction is a new fact/revision, never a silent update.

### Read models

- Campaign list and detail projection: lifecycle, latest approved revision, planned budget and data freshness.
- Campaign performance projection: totals plus CTR/CPC/CPA only when mathematically defined.
- Budget versus reported-spend projection: planned, reported and unverified separately.
- Company-scoped Marketing audit projection.

## Capability matrix

| Capability | Scope |
| --- | --- |
| `marketing.campaign.read` | Read plans, permitted asset metadata, projections and history. |
| `marketing.campaign.create` | Create draft campaign and draft internal structure. |
| `marketing.campaign.edit` | Revise draft/current content and archive permitted records. |
| `marketing.campaign.submit` | Submit a revision for decision. |
| `marketing.campaign.approve` | Approve or reject a submitted revision. |
| `marketing.measurement.write` | Record manual or verified measurement facts. |
| `marketing.finance.link` | Create/view allowed one-way Finance references. |
| `marketing.admin` | Controlled vocabulary and policy administration only. |

Reserved for a later, separately approved integration phase: `marketing.integration.read`, `marketing.integration.sync`, `marketing.external.publish`, `marketing.external.message`, `marketing.external.spend`, `marketing.ai.execute`, and `marketing.automation.enable`.

## Delivery sequence

1. **Gate A - backend foundation:** migration, RLS, capabilities, contracts, domain services, audit/idempotency, read models and verification.
2. **Campaign governance:** lifecycle, revisions, approvals, manual measurement and Finance references.
3. **Content planning:** content calendar, internal schedule, assets, revision and approval; no publication.
4. **Creators and competitors:** manual/evidence-first profiles, collaboration plans, deliverables, observations and attribution; Finance links remain references only.
5. **Marketing reporting:** central filters and server read models after source operations exist.
6. **Read-only integrations:** one approved provider/capability at a time, immutable snapshot/import receipt and freshness; no external mutation.
7. **External execution:** only following separate owner decision, dual approval, immutable approved content hash, live connection validation, budget caps, outbox/worker idempotency and provider receipts.

## Security decisions

- No external request is possible in Gate A: no endpoint, credential store, provider client, worker or egress authorization exists.
- Later OAuth requires authorization-code plus PKCE/state/nonce, server-only callback, encrypted versioned credentials, exact account/location validation, expiry, revocation and kill switch.
- Later sync uses a committed outbox, lease/deduplication, cursor/window, checksum, validation quarantine, source freshness and immutable receipt.
- Later webhooks require signature, timestamp and replay protection before queueing.
- Later AI is draft-only with provider allowlist, redaction, structured output validation, quota/cost ceilings, retention cleanup and audit. It cannot approve, publish, message or spend.
- Files require MIME/magic/size/hash/scan controls and download reauthorization; no browser-visible storage path or URL.

## Gate A verification before UI

1. Apply migrations to isolated BASEER Docker test database with restricted application role.
2. Prove RLS and direct SQL cross-tenant/cross-company denial for each Marketing table.
3. Prove HTTP denial for anonymous, revoked, non-member, missing-capability and cross-company record requests.
4. Prove idempotency replay/mismatch, concurrent submit/decision, revision invalidates approval, and audit rollback.
5. Prove Finance journal/due/payment/vault data is unchanged by every Marketing command except an authorised reference row.
6. Prove no OAuth/publish/spend/message/AI/automation/webhook/provider route or worker is present in Gate A inventory.
7. Prove response contracts, correlation IDs and file-scope denial.

## Explicit exclusions

- Importing external Baseer data, schemas, credentials, code or identity.
- Google Ads/Analytics/Business Profile connection or sync.
- Meta, Instagram, TikTok, Snapchat or other social APIs.
- Local SEO, maps, keyword labs, crawlers, reputation reply or social publishing.
- Advertising-account creation, budget changes, spend, creator messaging and payment execution.
- AI execution and marketing automation.
- Direct Marketing-to-Finance journal posting or treating attribution as accounting revenue.

## Evidence

Committee review was based on the external reference schemas for campaigns, content, creators, intelligence, integrations and metrics; its product navigation and HTTP-cycle tests; and the active BASEER ERP schema, CompanyContext, idempotency, audit, file metadata and Finance services.
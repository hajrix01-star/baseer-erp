# BASEER ERP Marketing Performance and Google Hub - Scope Decision

Date: 2026-08-15
Decision: Replaces the broad Marketing Operations scope for the current module build.

## Owner outcome

The module answers one practical question: when a Google Ads campaign or any other marketing campaign runs, what changed during and around its period in Google Business Profile activity and, once the ERP has a verified daily-sales source, in company sales.

## Approved module name

Arabic: `الأداء التسويقي`
English: `Marketing Performance`

## Approved sections

1. Overview: read-only performance overview with company, location, period, provider and campaign filters; every number shows source freshness and completeness.
2. Campaigns: a simple campaign register, not a planning system. A manual campaign stores name, platform, company/location, start/end, status and optional external reference. It supports TikTok, Meta, Snapchat or other campaigns as time context even without a provider integration.
3. Google Ads: a first-class, read-only provider connector for the Google Ads account, campaigns and daily performance facts. The initial reader covers the available account/campaign reporting facts such as spend, impressions, clicks, conversions and conversion value. No ad creation, edits, budgets, bids, pause/resume or spend.
4. Google Business Profile: a first-class provider connector for company/location mapping, profile data, reviews and available daily performance facts such as search/maps impressions, website clicks, calls, directions, bookings or food/menu actions when Google exposes them for the selected location and account. The UI must identify the exact source metric, date coverage and freshness; unavailable Google fields stay unavailable rather than being invented.
5. Google Reviews: review reading and AI-assisted reply drafts. A user with operating permission may generate and edit a draft; an independent approver may publish it to Google only after explicit confirmation. Automatic publication is not part of the first release.
6. Connections and data quality: provider/account/location mapping, exact capability, health, last successful sync, coverage, freshness, failure-safe reason, disconnect/revoke and immutable sync receipts.
7. General analysis: server-generated comparisons of pre-window, campaign window and post-window. It is labelled `temporal association - not causation`.

## Excluded from the current module

Campaign planning/version/approval/budget proposals, content calendar/publication, creators, competitors, local SEO/maps/keyword labs beyond data received from Google Business Profile, profile writes, social publishing, social/ads execution, automatic review publication, AI-driven actions without human approval, and external messaging.

## Measurement rules

The cross-module source rule in `docs/governance/FINANCIAL_AND_FACTUAL_SOURCE_OF_TRUTH_POLICY_2026-08-15.md` is mandatory: Marketing reads confirmed monetary values only from a journal-reconciled Finance/Sales server projection; provider and campaign facts remain separate factual evidence.

- Google Ads conversions are provider-reported conversions, not ERP sales.
- GBP calls, directions, website actions, searches and views are platform interaction facts, not confirmed customers or sales.
- Finance and future Daily Sales Closing are the source of confirmed sales, refunds and actual accounting spend.
- A TikTok or other manual campaign without verified provider facts is shown as campaign time context only. It cannot claim performance or sales impact.
- The module may show before/during/after, lag windows and correlation only when source windows are complete. It must state sample size, timezone, freshness, missing days and method.
- It must never claim a campaign caused sales without an approved experimental or attribution method.
- Missing data remains `unknown` or `incomplete`; it is never silently represented as zero.

## Backend build order before UI

### Gate A1 - internal campaign and analysis foundation

- `MarketingCampaign` simple register with manual/external campaign type, platform, optional external id, company/location, dates and lifecycle.
- `MarketingDailyFact` and `BusinessProfileDailyFact` normalized immutable daily facts with provider/source/checksum/freshness/quality.
- `MarketingMeasurementLink` explicit association between campaign and facts. No name matching inference.
- metric catalog/version definitions and server read-model contracts.
- tenant/company RLS, compound FKs, exact capabilities, audit/idempotency and API/DB verification.

### Gate A2 - connection, provider and AI foundation

- connection, encrypted credential, capability state, account/location mapping, sync-run and snapshot/receipt models.
- connection health/read models and manual source import contract.
- a platform-wide `AI Gateway` contract: provider registry, encrypted server-only credentials, one active-provider selection for the BASEER ERP tenant/system, with usage attribution per company, model/configuration version, usage/cost limits, safe error receipts and immutable execution telemetry. Every ERP module calls this gateway rather than a provider SDK directly, so the provider can change without rewriting Finance, Marketing or Administration.
- the AI Gateway may produce drafts and analysis only. It cannot approve, publish, spend, alter financial records or bypass CompanyContext/RBAC.

### Gate B - each provider separately

Google Ads and Google Business Profile each need a Provider Decision Record covering the exact endpoints, OAuth scopes, terms, quota/cost, data fields, retention, kill switch and write-policy proof. The connector models, encryption boundary and adapter interfaces are built in Gate A2 so the system is ready from its first deployment; OAuth credentials, callback and data sync are enabled only after the relevant provider record passes.

The official Google Business Profile Performance API supplies daily/monthly location metrics and monthly search-keyword impressions, while Google Ads reporting supplies queryable account/campaign and related reporting facts. BASEER therefore stores each received metric with its provider field, resource, source date, import time and freshness; it never labels a partial provider response as "all visits" or as complete business activity.

### Gate C - sales correlation readiness

The correlation view remains disabled until the ERP Daily Sales Closing backend exists and has a versioned company/date/locked-status/net/gross/refund contract. It consumes aggregates by Riyadh business date only. It never reads raw customer data and never writes Finance.

## Capability decisions

Current internal-only capabilities:

- `marketing.insights.read`
- `marketing.campaign.write`
- `marketing.measurement.write`
- `marketing.analytics.read`
- `marketing.admin`

Reserved and disabled until their separate provider gate:

- `marketing.integration.manage`
- `marketing.integration.sync`
- `marketing.integration.backfill`
- `marketing.integration.credentials.manage`
- `marketing.analytics.policy.manage`
- `marketing.google-business.profile.read`
- `marketing.google-business.performance.read`
- `marketing.google-business.reviews.read`
- `marketing.google-business.reviews.reply.draft`
- `marketing.google-business.reviews.reply.publish`
- `marketing.google-ads.reporting.read`
- `platform.ai.use`
- `platform.ai.manage`

`marketing.google-business.reviews.reply.publish` is disabled by default and requires a separate approval capability from draft generation. There is no Google Ads execution capability in this scope, and there is no automatic review-reply capability in the first release.

## Security and operational decisions

- Provider credentials are encrypted, server-only and never appear in browser responses, URLs, audit JSON or logs.
- OAuth requires authorization code plus PKCE/state/nonce, server callback and exact company/account/location ownership validation. The scope set is the smallest Google-approved set needed for the enabled capability; no browser receives a token.
- Sync is manual-triggered first, runs outside the request transaction, deduplicates by source/window/checksum, has timeout/rate limit/backoff and stores immutable receipt/freshness.
- Disconnect/revoke stops future jobs immediately and disables credential use.
- Google Ads write routes and write scopes are prohibited. Google Business Profile review publication is the one controlled exception: it requires a separately enabled capability, explicit per-reply confirmation, an approver distinct from the draft workflow, a final content hash and an immutable audit receipt. Profile edits, posts, messages and automatic reply publishing remain prohibited.
- No cross-company rollup is shown by default.

## UI boundary

No UI is built until Gate A1 and Gate A2 pass the isolated BASEER Docker database checks: RLS, authorization, idempotency replay/mismatch, audit rollback, date/timezone behavior, fact deduplication, missing-versus-zero, and proof of no Finance or external side effect.

## Committee decision

Approved. Build the simplified Marketing Performance and Google Hub backend first. The former broad Marketing Operations charter is superseded only for current scope; its provider-security principles remain mandatory.
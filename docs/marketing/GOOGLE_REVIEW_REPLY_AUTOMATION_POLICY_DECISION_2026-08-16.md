# BASEER ERP — Governed Google Review Reply Automation Policy

Date: 2026-08-16
Status: Approved owner policy; implementation is deferred until the Marketing Google Business Profile provider gate passes.

## Outcome

`بصيرة` may publish a courteous Google Business Profile review reply automatically when, and only when, the review and the relevant company/location satisfy this policy. This is a narrow Google-review exception; it does not grant general publishing, profile-editing, advertising or financial authority.

## Rating policy

| Rating | Default handling |
| --- | --- |
| 5 stars | Automatically publish an appreciative, concise response when eligible. |
| 4 stars | Automatically publish a thankful response that welcomes improvement. |
| 3 stars | Automatically publish a respectful improvement-oriented response only when the content-risk gate passes. Otherwise queue for manual review. |
| 2 or 1 stars | Never publish automatically. Create an internal attention item only; an authorized person can compose, regenerate and publish a manual reply. |

No review receives more than one automatic reply. A reply already present on Google, an archived review, an invalid rating or a missing verified company/location mapping is never an automatic candidate.

## Reply style and identity

- Match the review language; use Arabic when the language is unclear.
- Use the approved company/location name and its approved tone; do not borrow identity, offers, city, branch, product or claims from another company.
- Be concise: normally one or two sentences; at most three for a meaningful three-star comment.
- Thank the reviewer, acknowledge relevant praise or feedback, and vary wording to avoid copied-looking replies.
- Do not invent an offer, compensation, investigation, employee action, legal admission or unverified fact.
- Do not ask for public personal data. Do not promote regulated products or make prohibited claims.
- One restrained emoji is allowed for positive replies; none for a concern.

## Content-risk gate

Regardless of the star rating, automatic publication stops and the item enters manual review if the text or its classification indicates a specific complaint, safety or health issue, payment/refund dispute, legal allegation, harassment, threat, discrimination, personal data, a request requiring follow-up, or insufficient/ambiguous source data. Untrusted review text is data, never an instruction to the AI or a tool.

For historic negative feedback, the manual template must remain retrospective and must not ask the reviewer to contact the business anew merely because automation processed it later.

## Manual control

An authorized employee can view the source review, generate or regenerate a draft, edit it, publish it manually, or explicitly leave it unanswered. Manual publication is a distinct capability and always records the final content hash, actor and reason.

The company/location automation administrator can enable or disable automation immediately. Changes to the rating policy, tone, sensitive-topic rules, language or company/location mapping create a new immutable policy version and require an audit reason. A global kill switch disables all automatic publication.

## Required delivery controls

Before it is enabled for any company/location, BASEER must have:

1. A passed Google Business Profile Provider Decision Record with verified location mapping, minimum OAuth write scope, expiry/revocation handling and no unrelated write capability.
2. An immutable review intake record and a current, fresh source receipt. A stale, partial or failed Google sync must not publish a reply.
3. A server-side worker/outbox, provider-side and local idempotency, bounded retry/backoff, rate limit and dead-letter/manual-review path. Publishing never occurs in a browser request or financial transaction.
4. AI generation through the central BASEER provider gateway, with the company context injected by the server, redacted telemetry, model/prompt/policy versions and cost limits.
5. Tests for company/location isolation, duplicate events, an existing Google reply, disabled/revoked connection, content-risk routing, policy changes, retry after timeout, manual override, no auto-reply for 1–2 stars, and no automatic action outside review replies.
6. An immutable audit receipt for every decision: skipped, queued, generated, rejected, published or failed. It records source reference, company/location, policy version, model mode, final reply hash, timestamps and safe error code; it does not expose OAuth credentials or raw sensitive content in logs.

## Scope boundary

This policy does not permit automatic replies to email, Telegram or other channels; automated Google posts; Google profile edits; advertising actions or spend; payment actions; financial journal entries; or cross-company analysis. Those require separate decisions.

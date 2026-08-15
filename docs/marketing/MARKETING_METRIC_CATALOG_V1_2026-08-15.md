# BASEER ERP Marketing Metric Catalog v1

Date: 2026-08-15
Status: Mandatory design contract before Marketing database models, syncs or UI.
Timezone: Company business timezone; `Asia/Riyadh` by default.

## Rule of truth

A metric is not a generic label. Every saved fact has a provider metric key, source resource, source date, import timestamp, timezone, freshness, availability and quality state. `null`, `unavailable`, `stale` and `incomplete` are never converted to zero.

## Google Business Profile facts

| Canonical metric | Google meaning | Grain | Display rule |
| --- | --- | --- | --- |
| `gbp.search_impressions` | Profile impressions in Google Search when exposed by Google | location/day/device where supplied | `ظهور في بحث Google`, not visits |
| `gbp.maps_impressions` | Profile impressions in Google Maps when exposed | location/day/device where supplied | `ظهور في الخرائط`, not visits |
| `gbp.website_clicks` | Clicks on the website action | location/day | `نقرات الموقع`, not sessions or sales |
| `gbp.call_clicks` | Clicks on the call action | location/day | `نقرات الاتصال`, not completed calls |
| `gbp.direction_requests` | Direction requests | location/day | `طلبات الاتجاهات`, not physical visits |
| `gbp.bookings` | Reserve with Google bookings when available | location/day | provider-reported action |
| `gbp.food_orders` | Google Business Profile food orders when available | location/day | provider-reported action |
| `gbp.menu_clicks` | Menu interactions when available | location/day | provider-reported action |
| `gbp.review_count` | Number of available reviews in the synced source | location/snapshot | snapshot, not a daily flow unless Google supplies one |
| `gbp.average_rating` | Average rating in the synced source | location/snapshot | source snapshot with sync time |
| `gbp.unanswered_reviews` | Reviews without a business reply in the synced source | location/snapshot | operational queue, not a rating metric |

Search keywords are a separate monthly fact: `gbp.search_keyword_impressions_monthly`. Keywords and their availability may not be treated as a daily complete search log.

## Google Ads facts

| Canonical metric | Meaning | Grain | Display rule |
| --- | --- | --- | --- |
| `ads.reported_spend` | Spend reported by Google Ads | account/campaign/day/currency | provider-reported spend; not a Finance payment |
| `ads.impressions` | Ads impressions | account/campaign/day | source fact |
| `ads.clicks` | Ads clicks | account/campaign/day | source fact |
| `ads.conversions` | Provider-reported conversions | account/campaign/day | not ERP sales or invoices |
| `ads.conversion_value` | Provider-reported conversion value | account/campaign/day/currency | not accounting revenue |
| `ads.ctr` | clicks / impressions | server-derived only | N/A if impressions are zero or incomplete |
| `ads.cpc` | reported spend / clicks | server-derived only | N/A if clicks are zero or currency is not defined |
| `ads.cpa` | reported spend / conversions | server-derived only | N/A if conversions are zero or incomplete |

## ERP facts and correlation

`finance.confirmed_sales` does not exist until the Daily Sales Closing module delivers a locked, versioned daily aggregate. Until then all campaign analysis is Google/marketing-only. When delivered, the model compares time-aligned aggregates using same-day, +1 day and +7 day lag windows. It labels the result `temporal association - not causation`.

`ROAS` is prohibited until an approved attribution policy identifies compatible spend, currency, sales definition, return/refund treatment, window, timezone and completeness rule.

## Screen allocation

- Marketing Overview: provider metrics, data quality, campaign timeline and before/during/after comparisons.
- Google Business: GBP detail, review queue and AI draft status.
- Google Ads: account/campaign detail and daily trends.
- Command Center: only short decision cards and exceptions: stale sync, data gaps, significant reported-spend change, active campaign milestones and—after Daily Sales Closing—time-aligned sales movement.
- Administration: provider configuration, AI identity/profile, usage limits, capabilities and audit receipts. It does not display provider secrets.

## Acceptance checks

1. Every API metric response includes `sourceFreshAt`, quality and coverage semantics.
2. Browser code does not calculate CTR, CPC, CPA, correlations or completeness.
3. A provider fact never becomes an ERP sale, journal entry or financial truth.
4. Currency is never aggregated across different currencies without an explicit foreign-exchange policy.
5. The same fact is not imported twice for a company/provider/resource/date/metric/version key.
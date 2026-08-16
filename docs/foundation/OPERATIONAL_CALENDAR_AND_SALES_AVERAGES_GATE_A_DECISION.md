# Operational Calendar and Sales Averages — Gate A Decision

**Decision status:** Owner approved — mandatory for the first Finance, Sales Closing, dashboard, report, print, and export delivery that exposes sales averages.  
**Approved:** 2026-08-15  
**Scope:** BASEER ERP private companies; each company is isolated.

## Decision

Baseer shall maintain a server-owned **Operational Calendar** per company. A business date may be classified as:

- `open` — the company is expected to operate;
- `closed` — the company is not expected to operate, for example Eid, a holiday, or a planned closure; or
- `partial` — the company is expected to operate for a documented limited period.

The schedule may be created from the normal company working-week pattern and known holiday dates, then adjusted only by authorized users. The calendar state, its source, actor, and change history must be retained.

## Required sales metrics

For every selected authorized company and period, Baseer shall provide both server-calculated metrics:

| Metric                    | Formula                                                                       | Meaning                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Period daily average**  | Total sales ÷ all calendar days in the selected period                        | Overall financial performance across the passage of time. A closed day contributes zero sales.                                |
| **Operating-day average** | Total sales ÷ scheduled open or partial operating days in the selected period | Sales strength when the company was expected to operate. Fully closed days, including Eid and planned holidays, are excluded. |

The interface, report, printout, and export must show the metric name and its denominator: calendar days or operating days. They must not silently substitute one for the other.

## Missing-data rule

An expected `open` or `partial` day with no saved active Sales Closing is **missing operational data**, not zero sales. It must be visibly flagged as `closing/data pending` and excluded from any final/official sales average until resolved.

A planned `closed` day requires no manual zero Sales Closing. It contributes zero to the period daily average and is excluded from the operating-day average.

This policy supersedes the earlier blanket interpretation that every missing Sales Closing automatically means a non-operating day. The calendar is the authoritative source of the day status.

## Partial-day rule

`partial` days are included in the operating-day average initially as one operating day, with a visible partial-day count. The system must not invent an hourly weighting. If the business later needs weighted operating hours, that requires a separately approved metric definition.

## Controls and acceptance criteria

1. Company isolation, permissions, audit history, and the central filter contract apply to calendar data and all metrics.
2. A user cannot use another company's calendar or change an historical day without a recorded authorized action.
3. Eid, holidays, ordinary weekly closures, manual closures, and partial operating days are distinguishable in the calendar and in report metadata.
4. Closed dates need no Sales Closing and are zero only for the period daily average.
5. Expected operating dates with a missing closing are never silently counted as zero in official averages.
6. Dashboard, report, print, and export call the same server metric definition and disclose missing-data dates.
7. Migration preserves any Noorix special-day/calendar context as source evidence, but Baseer operating status is mapped or reviewed explicitly; it is never guessed from a display label alone.

## Example

Over seven calendar days, six operating days each have sales of SAR 1,000 and one day is a scheduled Eid closure:

- Period daily average = SAR 6,000 ÷ 7 = **SAR 857.14**.
- Operating-day average = SAR 6,000 ÷ 6 = **SAR 1,000.00**.

If the seventh day was scheduled open but its closing was omitted, Baseer must flag it as incomplete rather than report either average as final.

## 2026-08-16 implementation amendment — Day Off

The approved native Daily Sales Closing window includes **No work today / Day Off** as a documented operational-calendar command, not as a zero-value sales closing. It requires a reason (weekly closure, holiday, maintenance, emergency, or other with a note), creates no journal, tax, vault movement, or sales summary, and is visible in calendar/report metadata. `closed` remains excluded from the operating-day average and included as zero only in the period daily average. An open or partial day without a saved active closing remains pending/incomplete data; it is never inferred to be a Day Off.

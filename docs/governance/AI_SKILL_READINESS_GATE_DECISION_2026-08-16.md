# BASEER ERP — AI Skill Readiness Gate

Date: 2026-08-16
Status: Approved mandatory delivery rule

## Simple rule

Every module records an **AI Skill Decision** before it closes. The decision makes the module ready for `بصيرة` later; it does **not** require a chat, provider call, RAG or a finished user-facing AI skill.

## The five possible decisions

| Level | Meaning |
| --- | --- |
| S0 | No useful AI role now. Record why. |
| S1 | Basira may explain the module and its approved policies. |
| S2 | Basira may read and explain the module's official server facts. |
| S3 | Basira may create a draft or recommendation that a person reviews. |
| S4 | A narrow automated action is allowed only through a separate approved policy, audit and kill switch. |

## Required closure note

The module owner records only:

1. The user question or decision Basira would help with.
2. The official server source, company scope and freshness available to it.
3. The allowed level S0–S4 and explicit prohibited actions.
4. The business owner and the future activation condition.

For S2–S4, the module also exposes a typed, permission-checked server read model or command boundary. The browser never supplies company authority or calculated facts.

## Activation is separate

A skill becomes available to users only after its data source, RBAC, tools, Arabic acceptance examples, audit, cost limits and kill switch are verified. A simple S1 help skill needs lightweight examples; rigorous evaluation is reserved for analysis, drafts and automated actions.

## Current examples

| Module | Current skill decision |
| --- | --- |
| Administration | S1: explain company, user and role settings; no self-service changes. |
| Daily Sales Closing | S2 candidate: explain closings, shifts and operating-day status after its official report source is available. Cash-on-hand remains explicitly operational, not an accounting balance. |
| Finance | S2: explain journal-reconciled reports; S3 later for a reviewed classification draft; no posting or payment automation. |
| Marketing performance | S2 after provider facts and official financial read models exist. |
| Google reviews | S4 only under `GOOGLE_REVIEW_REPLY_AUTOMATION_POLICY_DECISION_2026-08-16.md`. |
| Inbound evidence and OCR | S3: extract and suggest a link or classification for human review; no automatic voucher, payment or journal entry. |

## Boundary

Skills are centrally governed by the Basira platform. Modules supply their verified facts and a small decision record; they do not embed prompts, provider credentials or AI business logic in screens.
# BASEER ERP — Finance Command Capability Matrix

**Status:** Phase 1 command boundary — implemented and verified on the isolated test database.

Every write route derives tenant, user, and company from the live access token and `x-baseer-company-id`. Client-supplied tenant or user identifiers are never accepted. Financial writes require an idempotency key. The journal has no public manual-posting route.

| Capability | Route | Operation | Status |
| --- | --- | --- | --- |
| `finance.setup.write` | `POST /v1/finance/company-setup` | Create the foundation, one fiscal period, and selected ready vaults | Implemented |
| `finance.configuration.read` | `GET /v1/finance/configuration` | Read company profile, periods, vaults, accounts, categories and suppliers | Implemented |
| `finance.vaults.write` | `POST /v1/finance/vaults`, `/remove-or-archive` | Add and retire a vault | Implemented |
| `finance.periods.write` | `POST /v1/finance/periods/close`, `/lock`, `/reopen` | Controlled period lifecycle | Implemented |
| `finance.supplier_dues.write` | `POST /v1/finance/supplier-dues` | Create an unpaid supplier due | Implemented |
| `finance.supplier_dues.write` | `POST /v1/finance/supplier-dues/payments`, `/reverse` | Record or reverse a partial/full payment | Implemented |
| `finance.supplier_dues.read` | `GET /v1/finance/supplier-dues/cash-payments` | Read the paid-only cash projection | Implemented |
| `finance.loans.write` | `POST /v1/finance/inclusive-loans` and repayment routes | Opening inclusive loan, repayment, reversal | Implemented |
| `finance.daily_sales.read` | `GET /v1/finance/daily-sales/closings`, `/channel-vaults`, `/operational-calendar` | Read company-scoped sales data. Without the full-history permission, the closing register is server-limited to the latest seven records. | Implemented and Gate-B verified |
| `finance.daily_sales.history.read_all` | `GET /v1/finance/daily-sales/closings` | View the complete requested closing history (up to the server’s 400-day range); assign to owner/supervisor roles, not cashiers. | Implemented |
| `finance.daily_sales.write` | `GET /v1/finance/daily-sales/entry-date`; `POST /v1/finance/daily-sales/closings`, `/correct`, `/reverse`, `/operational-calendar/days` | Obtain the server-owned Riyadh entry-date maximum; post/correct/reverse a daily closing and maintain an operating-day state. Future sales dates are denied by the server. | Implemented and Gate-B verified |

## Seed-vault lifecycle policy

System seed vaults are never deleted. A removal request archives the vault, disables it as a collection/payment destination, and preserves its Baseer system account. A custom vault with no financial history may be deleted; a custom vault with history is archived.

## Explicit limits

- Contracts and controllers do not expose direct journal posting.
- Read-only reporting remains server-side; the browser does not calculate financial values.
- This is a private, multi-company system: no SaaS signup or public tenancy behavior.
- Daily Sales Closing remains awaiting owner acceptance of the narrow native operational journey; it does not authorize Marketing, external integrations, or AI chat UI.
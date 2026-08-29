/** Run after contracts/API builds:
 * `node apps/api/dist/operations/operations-read-performance.policy-verification.js`.
 * This is pure policy verification; it neither opens a database nor performs HTTP. */
import assert from "node:assert/strict";

import { operationsExecutionWorkspaceSummaryReceiptSchema } from "@baseer-erp/contracts";

import { resolveInternalRegistrationReportPeriod } from "./operations-internal-registration.service.js";

assert.deepEqual(
  resolveInternalRegistrationReportPeriod({}, new Date("2026-08-31T21:30:00.000Z")),
  { from: "2026-09-01", to: "2026-09-30", source: "DEFAULT_CURRENT_MONTH" },
  "An omitted report period must resolve to the current Riyadh calendar month, never all company history.",
);
assert.deepEqual(
  resolveInternalRegistrationReportPeriod({ from: "2026-02-11" }),
  { from: "2026-02-11", to: "2026-02-28", source: "EXPLICIT" },
  "A legacy start-only request must remain usable but bounded to its calendar month.",
);
assert.deepEqual(
  resolveInternalRegistrationReportPeriod({ to: "2024-02-12" }),
  { from: "2024-02-01", to: "2024-02-12", source: "EXPLICIT" },
  "A legacy end-only request must remain usable but bounded to its calendar month.",
);
assert.deepEqual(
  resolveInternalRegistrationReportPeriod({ from: "2026-01-01", to: "2026-03-31" }),
  { from: "2026-01-01", to: "2026-03-31", source: "EXPLICIT" },
  "An explicit period must retain caller intent.",
);

const summary = operationsExecutionWorkspaceSummaryReceiptSchema.parse({
  inventoryMaterialCount: 3,
  openRequestCount: 2,
  custody: { representativeName: null, balance: "0" },
  asOf: "2026-08-29T00:00:00.000Z",
});
assert.equal(summary.openRequestCount, 2, "The first-paint execution receipt carries only summary fields.");
assert.equal("requests" in summary, false, "The summary contract must not expose request/receipt relations.");

console.log(JSON.stringify({ ok: true, verified: ["internal-registration-default-period", "internal-registration-partial-period", "execution-first-paint-summary-contract"] }));

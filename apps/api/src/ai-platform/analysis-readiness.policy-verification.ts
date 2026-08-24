import assert from "node:assert/strict";

import type { BasiraDecisionAlertBrief } from "@baseer-erp/contracts";

import { decisionAlertReadiness } from "./analysis-readiness.service.js";

const readyBrief = {
  alert: { id: "11111111-1111-4111-8111-111111111111", status: "OPEN" },
  evidence: { checksumValid: true },
  salesChange: { dataQuality: "READY" },
} as unknown as BasiraDecisionAlertBrief;

assert.equal(decisionAlertReadiness(readyBrief).status, "READY");
const incomplete = decisionAlertReadiness({ ...readyBrief, salesChange: { ...readyBrief.salesChange!, dataQuality: "INCOMPLETE" } });
assert.equal(incomplete.status, "BLOCKED");
assert.equal(incomplete.reasons[0]?.code, "SALES_COMPARISON_NOT_READY");
const invalidChecksum = decisionAlertReadiness({ ...readyBrief, evidence: { ...readyBrief.evidence, checksumValid: false } });
assert.equal(invalidChecksum.status, "BLOCKED");
assert.equal(invalidChecksum.reasons[0]?.code, "EVIDENCE_CHECKSUM_INVALID");

console.log("Analysis readiness policy verification passed: incomplete or invalid evidence is blocked before any provider path.");

import assert from "node:assert/strict";

import { aiProviderConnectionReceiptSchema } from "@baseer-erp/contracts";
import OpenAI from "openai";

import { classifyProviderProbeFailure } from "./ai-platform.service.js";

function expectFailure(error: unknown, reason: string, upstreamStatus: number | null) {
  assert.deepEqual(classifyProviderProbeFailure(error), { reason, upstreamStatus });
}

function verify(): void {
  expectFailure({ status: 401 }, "CREDENTIAL_REJECTED", 401);
  expectFailure({ status: 403 }, "PROJECT_ACCESS_DENIED", 403);
  expectFailure({ status: 404 }, "MODEL_UNAVAILABLE", 404);
  expectFailure({ status: 429, code: "insufficient_quota" }, "BILLING_OR_QUOTA_REQUIRED", 429);
  expectFailure({ status: 429, code: "rate_limit_exceeded" }, "PROVIDER_RATE_LIMITED", 429);
  expectFailure({ status: 503 }, "PROVIDER_UNAVAILABLE", 503);
  expectFailure(new OpenAI.APIConnectionError({}), "PROVIDER_UNREACHABLE", null);
  expectFailure({ name: "APIConnectionTimeoutError" }, "PROVIDER_UNREACHABLE", null);
  expectFailure({ status: 418 }, "PROVIDER_RESPONSE_REJECTED", 418);

  const receipt = aiProviderConnectionReceiptSchema.parse({
    configurationId: "b3f1a4cf-b7c2-4f50-b3dd-6b077a8a47bb",
    state: "ERROR",
    reason: "BILLING_OR_QUOTA_REQUIRED",
    provider: "OPENAI_COMPATIBLE",
    model: "gpt-5-mini",
    upstreamStatus: 429,
    checkedAt: new Date("2026-08-24T16:35:00.000Z"),
  });
  assert.equal(receipt.upstreamStatus, 429);
  assert.equal(receipt.reason, "BILLING_OR_QUOTA_REQUIRED");
  console.log("Basira provider probe diagnostics verification passed: safe reason classification and receipts are aligned.");
}

verify();

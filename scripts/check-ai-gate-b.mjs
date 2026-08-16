import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(path, "utf8");
}

const runtime = source("apps/api/src/ai-platform/ai-runtime.service.ts");
const adapter = source("apps/api/src/ai-platform/ai-provider-adapter-registry.ts");
const controller = source("apps/api/src/ai-platform/ai-runtime.controller.ts");
const catalog = source("apps/api/src/ai-platform/ai-skills.ts");
const contracts = source("packages/contracts/src/ai-platform.ts");
const migration = source("apps/api/prisma/migrations/20260816200000_ai_gate_b_runtime_receipts/migration.sql");
const appModule = source("apps/api/src/app.module.ts");
const permissions = source("apps/api/src/administration/administration-permissions.ts");

for (const required of [
  "platform.ai.use",
  "companyContext.authorize",
  "beginInTransaction",
  "completeInTransaction",
  "AiExecutionOutcome.BLOCKED",
  "AI_SKILL_NOT_ACTIVATED",
]) {
  if (!runtime.includes(required)) throw new Error(`AI runtime boundary is missing: ${required}`);
}
for (const forbidden of ["fetch(", "http://", "https://", ".decrypt("]) {
  if (runtime.includes(forbidden) || adapter.includes(forbidden)) {
    throw new Error(`AI Gate B cannot make provider calls or decrypt credentials: ${forbidden}`);
  }
}
for (const required of [
  "aiRuntimePreflightRequestSchema",
  "aiRuntimePreflightReceiptSchema",
  "AiProviderAdapterRegistry",
  "AiRuntimeService",
  "skillKey",
  "policyVersion",
  "platform.ai.use",
]) {
  const all = `${contracts}\n${controller}\n${appModule}\n${migration}\n${permissions}`;
  if (!all.includes(required)) throw new Error(`AI Gate B integration is missing: ${required}`);
}
for (const required of ["S1", "S2", "S3", "S4", "PLANNED", "VALIDATED"]) {
  if (!catalog.includes(required)) throw new Error(`AI skill catalogue is missing lifecycle coverage: ${required}`);
}
console.log("AI Gate B boundary verified: scoped, receipted, and provider-offline.");
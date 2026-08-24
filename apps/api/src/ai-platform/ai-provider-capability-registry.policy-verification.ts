import assert from "node:assert/strict";

import {
  canConfigureAiProviderModel,
  findAiProviderModelCapability,
  listAiProviderModelCapabilities,
  liveAiModelProfileForSkill,
} from "./ai-provider-capability-registry.js";
import { BASIRA_S2_TOKENIZER_MODEL } from "./ai-token-counter.js";

function verify(): void {
  const capabilities = listAiProviderModelCapabilities();
  const approved = capabilities.find(
    (capability) =>
      capability.provider === "OPENAI_COMPATIBLE" &&
      capability.model === "gpt-5-mini",
  );
  assert.ok(approved, "The reviewed Basira model must be visible to the owner UI.");
  assert.equal(approved.status, "AVAILABLE");
  assert.equal(approved.activationReadiness, "READY_FOR_CONFIGURATION");
  assert.deepEqual(
    approved.supportedSkillKeys.sort(),
    ["decision.command_center_analyst", "marketing.performance_analyst"],
    "The visible capability must declare the only skills it can run.",
  );

  assert.equal(
    canConfigureAiProviderModel("OPENAI_COMPATIBLE", "gpt-5-mini"),
    true,
    "The reviewed provider/model must be configurable.",
  );
  assert.equal(
    canConfigureAiProviderModel("OPENAI_COMPATIBLE", "arbitrary-model"),
    false,
    "A free-form model name must be rejected before it can receive a credential.",
  );
  assert.equal(
    canConfigureAiProviderModel("ANTHROPIC", "any-model"),
    false,
    "A provider without a reviewed adapter must not be configurable.",
  );

  const profile = liveAiModelProfileForSkill({
    provider: "OPENAI_COMPATIBLE",
    model: "gpt-5-mini",
    skillKey: "marketing.performance_analyst",
  });
  assert.ok(profile, "A configured model must resolve a live profile for its allowed skill.");
  assert.equal(profile.tokenizerModel, BASIRA_S2_TOKENIZER_MODEL);
  assert.equal(
    liveAiModelProfileForSkill({
      provider: "OPENAI_COMPATIBLE",
      model: "gpt-5-mini",
      skillKey: "finance.accounting_advisor",
    }),
    null,
    "A model cannot silently run a skill that is not in its reviewed capability.",
  );
  assert.equal(
    findAiProviderModelCapability("GOOGLE_GENERATIVE_AI", "gpt-5-mini"),
    null,
    "Provider and model must be approved as one exact pair.",
  );

  console.log(
    "Basira provider capability registry verification passed: model selection, skill scope and tokenizer binding are fail-closed.",
  );
}

verify();

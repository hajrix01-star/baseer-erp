import assert from "node:assert/strict";

import { aiSkillCatalogItemSchema } from "@baseer-erp/contracts";

import { listAiSkillEvaluationSuites, runOfflineAiSkillEvaluation } from "./ai-skill-evaluation-suites.js";
import { AI_SKILL_CATALOG, runtimeAvailabilityForAiSkill } from "./ai-skills.js";

const suites = listAiSkillEvaluationSuites();
assert.equal(suites.length, 2, "Only the two implemented S2 skills may have a pre-pilot suite.");
for (const suite of suites) {
  assert.ok(suite.cases.length >= 4, `${suite.key} must cover more than one happy path.`);
  assert.ok(suite.cases.some((item) => item.expectedDisposition === "BLOCK"), `${suite.key} must cover a no-AI/block path.`);
  assert.ok(suite.cases.some((item) => item.requiredControls.includes("NO_CAUSATION")), `${suite.key} must test causal-claim prevention.`);
  assert.ok(suite.cases.some((item) => item.requiredControls.includes("UNTRUSTED_TEXT")), `${suite.key} must test instruction-injection resistance.`);
  const skill = AI_SKILL_CATALOG.find((item) => item.key === suite.skillKey);
  assert.ok(skill, `${suite.key} must point to a code-owned skill.`);
  const result = runOfflineAiSkillEvaluation(skill);
  assert.equal(result.passed, true, `${suite.key} must pass its current guarded skill revision.`);
  assert.match(result.suiteChecksum, /^[0-9a-f]{64}$/, "The suite fingerprint must be canonical and stable.");
}

for (const skill of AI_SKILL_CATALOG) {
  const { nonNegotiableRules: _rules, ...publicItem } = skill;
  assert.equal(aiSkillCatalogItemSchema.safeParse(publicItem).success, true, `${skill.key} must satisfy the public skill catalogue contract.`);
}

assert.equal(runtimeAvailabilityForAiSkill("owner.daily_brief_analyst").state, "NOT_IMPLEMENTED", "A disabled legacy direct-provider path must never look pilot-ready.");
console.log("Basira skill evaluation verification passed: Arabic offline safety suites, catalogue contracts, and runtime readiness are aligned.");

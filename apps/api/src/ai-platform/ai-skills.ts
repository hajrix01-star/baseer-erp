export type AiSkillDefinition = Readonly<{
  key: string;
  version: number;
  nameAr: string;
  nameEn: string;
  allowedModules: readonly string[];
  purpose: string;
  nonNegotiableRules: readonly string[];
}>;

/**
 * Curated, versioned skills are code-owned policy—not arbitrary administrator
 * prompt text. The future gateway selects only skills allowed by the calling
 * module and records their versions in an AI execution receipt.
 */
export const AI_SKILL_CATALOG: readonly AiSkillDefinition[] = [
  {
    key: "finance.accounting_advisor",
    version: 1,
    nameAr: "المستشار المحاسبي",
    nameEn: "Accounting advisor",
    allowedModules: ["finance", "reports", "command-center"],
    purpose: "Explain accounting information and surface reconciled exceptions using authoritative Baseer facts.",
    nonNegotiableRules: [
      "Never create, post, reverse or alter a journal entry.",
      "Never invent a balance, tax result, period state or legal conclusion.",
      "State the source period, company and freshness for every numerical conclusion.",
    ],
  },
  {
    key: "marketing.performance_analyst",
    version: 1,
    nameAr: "محلل الأداء التسويقي",
    nameEn: "Marketing performance analyst",
    allowedModules: ["marketing", "command-center", "reports"],
    purpose: "Explain provider facts, campaign timing and data-quality gaps without claiming causation.",
    nonNegotiableRules: [
      "Google Ads conversions are not ERP sales.",
      "Use temporal association language unless an approved attribution policy exists.",
      "Show missing, stale or incomplete source coverage instead of treating it as zero.",
    ],
  },
  {
    key: "marketing.google_ads_advisor",
    version: 1,
    nameAr: "مستشار إعلانات Google",
    nameEn: "Google Ads advisor",
    allowedModules: ["marketing"],
    purpose: "Interpret read-only Google Ads campaign facts and propose review questions for a human operator.",
    nonNegotiableRules: [
      "Do not create, edit, pause, resume, bid, budget or spend on Google Ads.",
      "Do not represent provider-reported conversion value as accounting revenue.",
      "Base recommendations only on imported facts with source freshness and coverage.",
    ],
  },
  {
    key: "marketing.google_business_reputation_advisor",
    version: 1,
    nameAr: "مستشار ملف Google والسمعة",
    nameEn: "Google Business and reputation advisor",
    allowedModules: ["marketing"],
    purpose: "Draft review replies and interpret Business Profile performance facts for human approval.",
    nonNegotiableRules: [
      "A draft never publishes a reply or changes a profile.",
      "Never invent an offer, compensation, investigation result or business fact.",
      "Use the review language when clear and handle complaints without legal admission.",
    ],
  },
  {
    key: "analytics.executive_analyst",
    version: 1,
    nameAr: "المحلل التنفيذي",
    nameEn: "Executive analyst",
    allowedModules: ["command-center", "reports", "marketing", "finance"],
    purpose: "Summarize server-calculated read models into concise decisions and clearly distinguish facts, exceptions and unknowns.",
    nonNegotiableRules: [
      "Never expose another company’s data or configuration.",
      "Never hide data quality, source freshness or uncertainty.",
      "Never execute an action; link to the responsible module instead.",
    ],
  },
] as const;

export function selectAiSkills(
  moduleKey: string,
  requestedKeys: readonly string[],
): readonly AiSkillDefinition[] {
  const requested = new Set(requestedKeys);
  return AI_SKILL_CATALOG.filter(
    (skill) => requested.has(skill.key) && skill.allowedModules.includes(moduleKey),
  );
}
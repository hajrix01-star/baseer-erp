/**
 * A short-lived, same-company handoff from a campaign to the existing Finance
 * purchase/expense form. It is UI prefill only: the Finance form still owns
 * supplier, category, VAT, payment, validation and posting.
 */
export type MarketingFinanceHandoff = Readonly<{
  version: 1;
  companyId: string;
  campaignId: string;
  campaignTitleAr: string;
  campaignSummary: string | null;
  startsOn: string | null;
  endsOn: string | null;
  plannedCost: string | null;
  createdAt: string;
}>;

const key = "baseer.marketing.finance-handoff.v1";

export function stageMarketingFinanceHandoff(value: Omit<MarketingFinanceHandoff, "version" | "createdAt">) {
  try { sessionStorage.setItem(key, JSON.stringify({ ...value, version: 1, createdAt: new Date().toISOString() } satisfies MarketingFinanceHandoff)); } catch { /* A manual Finance entry remains available if storage is blocked. */ }
}

export function takeMarketingFinanceHandoff(companyId: string): MarketingFinanceHandoff | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const draft = value as Partial<MarketingFinanceHandoff>;
    if (draft.version !== 1 || draft.companyId !== companyId || typeof draft.campaignId !== "string" || typeof draft.campaignTitleAr !== "string") return null;
    return { version: 1, companyId, campaignId: draft.campaignId, campaignTitleAr: draft.campaignTitleAr, campaignSummary: typeof draft.campaignSummary === "string" ? draft.campaignSummary : null, startsOn: typeof draft.startsOn === "string" ? draft.startsOn : null, endsOn: typeof draft.endsOn === "string" ? draft.endsOn : null, plannedCost: typeof draft.plannedCost === "string" ? draft.plannedCost : null, createdAt: typeof draft.createdAt === "string" ? draft.createdAt : new Date().toISOString() };
  } catch { return null; }
}

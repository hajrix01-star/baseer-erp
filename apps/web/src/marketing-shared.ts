export type MarketingLanguage = "ar" | "en";

export type MarketingCampaign = {
  id: string;
  titleAr: string;
  titleEn: string | null;
  platform: "MANUAL" | "GOOGLE_ADS" | "META" | "TIKTOK" | "SNAPCHAT" | "OTHER";
  externalReference: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: "DRAFT" | "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "ARCHIVED";
  stoppedOn: string | null;
  stoppedReason: string | null;
  objective: string | null;
  notes: string | null;
  plannedCost: string | null;
  plannedCurrencyCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingReplyPolicy = {
  automationStatus: "DISABLED" | "ENABLED" | "PAUSED";
  authoringMethod: "TEMPLATE" | "BASIRA_DRAFT";
  tone: "WARM" | "PROFESSIONAL" | "FORMAL";
  languageMode: "MATCH_REVIEW" | "ARABIC" | "ENGLISH";
  autoFourFiveEnabled: boolean;
  autoThreeIfSafe: boolean;
  signature: string | null;
  revision: number;
  executionReadiness: "NOT_CONNECTED";
};

export type MarketingWorkspaceRead = {
  companyId: string;
  campaigns: MarketingCampaign[];
  readiness: Array<{
    provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS";
    status: "NOT_CONNECTED";
    messageAr: string;
  }>;
  replyPolicy: MarketingReplyPolicy;
};

export type MarketingCopy = Record<string, string>;

export type MarketingSpendResult = {
  plannedCampaignCost: string | null;
  linkedActualSpend: string;
  linkedPostedSpendOnly: true;
  spendDataQuality: string;
  excludedLinkedDocumentCount: number;
  officialNetSales: string | null;
  spendToSalesPercent: string | null;
  campaignCount: number;
  salesDataQuality: string;
  googleAdsStatus: "NOT_CONNECTED";
  conclusionAr: string;
  conclusionEn: string;
};

export type MarketingCalendarRead = {
  period: { fromBusinessDate: string; toBusinessDate: string };
  sales: { dataQuality: string; payload: { netAmount: string } };
  campaigns: MarketingCampaign[];
  days: Array<{
    businessDate: string;
    officialNetSales: string | null;
    salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING";
    linkedActualSpend: string;
    linkedFinancialDocumentCount: number;
    activeCampaignIds: string[];
  }>;
  context: Array<{
    id: string;
    scope: "GLOBAL" | "AREA" | "COMPANY";
    eventKind: string;
    titleAr: string;
    startsOn: string;
    endsOn: string;
    verificationStatus: string;
  }>;
  linkedActualGrossAmount: string;
  spendResult: MarketingSpendResult;
};

export const marketingIsArabic = (language: MarketingLanguage) => language === "ar";

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
    status: "NOT_CONNECTED" | "AUTHORIZED_READ_ONLY_SELECTED";
    messageAr: string;
  }>;
  replyPolicy: MarketingReplyPolicy;
};

export type MarketingCopy = Record<string, string>;

export type MarketingSpendResult = {
  plannedCampaignCost: string | null;
  plannedCampaignCostDisplay: string | null;
  linkedActualSpend: string;
  linkedActualSpendDisplay: string;
  linkedPostedSpendOnly: true;
  spendDataQuality: string;
  excludedLinkedDocumentCount: number;
  officialGrossSales: string | null;
  officialGrossSalesDisplay: string | null;
  officialGrossSalesCalendarDisplay: string | null;
  spendToSalesPercent: string | null;
  campaignCount: number;
  salesDataQuality: string;
  googleAdsStatus: "NOT_CONNECTED";
  conclusionAr: string;
  conclusionEn: string;
};

export type MarketingCalendarRead = {
  financialRead: {
    contractVersion: "financial-read.v1";
    subject: "SALES" | "CASH_MOVEMENT" | "PURCHASE_SPEND" | "MIXED_ANALYTICS";
    defaultTaxView: "VAT_INCLUDED";
    allowedTaxViews: Array<"VAT_INCLUDED" | "VAT_SEPARATED">;
    authority: string;
    quality: string;
    currencyScope: { mode: "SINGLE_CURRENCY"; currencyCode: string } | { mode: "MIXED_OR_UNCONFIGURED" };
    presentationPolicy: "SERVER_FORMATTED";
  };
  period: { fromBusinessDate: string; toBusinessDate: string };
  sales: { dataQuality: string; payload: { netAmount: string | null; grossAmount: string | null } };
  campaigns: MarketingCampaign[];
  days: Array<{
    businessDate: string;
    officialGrossSales: string | null;
    officialGrossSalesDisplay: string | null;
    officialGrossSalesCalendarDisplay: string | null;
    officialNetSales: string | null;
    customerCount: number | null;
    salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING";
    dailySalesTarget: string | null;
    dailySalesTargetDisplay: string | null;
    targetStatus: "NO_TARGET" | "NO_SALES" | "BELOW" | "NEAR" | "MET" | "EXCEEDED";
    linkedActualSpend: string | null;
    linkedActualSpendDisplay: string | null;
    linkedFinancialDocumentCount: number;
    campaignSpend: Array<{ campaignId: string; amount: string; documentCount: number }>;
    financialOutflows: string | null;
    financialOutflowsDisplay: string | null;
    financialOutflowDocumentCount: number;
    purchaseOutflows: string | null;
    purchaseOutflowsDisplay: string | null;
    purchaseOutflowDocumentCount: number;
    activeCampaignIds: string[];
  }>;
  timeline: BaseerMarketingTimeline;
  weekdayAverages: Array<{
    weekday: number;
    averageOfficialGrossSales: string | null;
    averageOfficialGrossSalesDisplay: string | null;
    averageOfficialGrossSalesCalendarDisplay: string | null;
    eligibleDayCount: number;
  }>;
  salesTargets: Array<{ periodMonth: string; amount: string; amountDisplay: string }>;
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
  linkedActualGrossAmountDisplay: string;
  spendResult: MarketingSpendResult;
};

export const marketingIsArabic = (language: MarketingLanguage) => language === "ar";
import type { BaseerMarketingTimeline } from "./baseer-chart";

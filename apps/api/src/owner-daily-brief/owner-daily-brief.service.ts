import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { ownerDailyBriefBasiraAnswerSchema, ownerDailyBriefReceiptSchema, type OwnerDailyBriefBasiraAnswerReceipt, type OwnerDailyBriefBasiraAnswerRequest, type OwnerDailyBriefHistoryQuery, type OwnerDailyBriefQuery, type OwnerDailyBriefReceipt } from "@baseer-erp/contracts";

import type { TrustedTenantAdministratorContext } from "../administration/tenant-administration-context.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  CompanyStatus,
  FinanceDailySalesDataStatus,
  FinanceOperationalDayStatus,
  FinanceOutflowDocumentKind,
  FinanceOutflowDocumentStatus,
  MarketingCampaignStatus,
  MarketingProviderConnectionStatus,
  Prisma,
  AiProviderConfigurationStatus,
  AiCompanyIdentityStatus,
} from "../generated/prisma/client.js";
import { AiProviderAdapterRegistry } from "../ai-platform/ai-provider-adapter-registry.js";
import { AiCredentialVault } from "../ai-platform/ai-credential-vault.js";
import { selectAiSkill } from "../ai-platform/ai-skills.js";

type SalesStatus = "READY" | "INCOMPLETE" | "NO_DATA";

@Injectable()
export class OwnerDailyBriefService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adapters: AiProviderAdapterRegistry,
    private readonly vault: AiCredentialVault,
  ) {}

  async answerWithBasira(context: TrustedTenantAdministratorContext, request: OwnerDailyBriefBasiraAnswerRequest): Promise<OwnerDailyBriefBasiraAnswerReceipt> {
    const skill = selectAiSkill("command-center", "owner.daily_brief_analyst");
    if (!skill || (skill.status !== "PILOT" && skill.status !== "ACTIVE")) throw new ForbiddenException("The owner Daily Brief AI skill is not active.");
    if (process.env.BASEER_BASIRA_OWNER_BRIEF_PILOT_ENABLED !== "true") throw new ForbiddenException("The owner Daily Brief Basira pilot is not enabled.");
    const brief = await this.read(context, { reportDate: request.reportDate });
    const setup = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [provider, identity] = await Promise.all([
        tx.aiProviderConfiguration.findFirst({ where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true }, select: { id: true, provider: true, model: true, encryptedCredential: true, credentialIv: true, credentialTag: true, credentialKeyVersion: true } }),
        tx.aiSystemIdentity.findFirst({ where: { tenantId: context.tenantId, status: AiCompanyIdentityStatus.ACTIVE }, select: { toneInstructions: true, safetyInstructions: true } }),
      ]);
      if (!provider || provider.provider !== "OPENAI_COMPATIBLE") throw new ConflictException("An active OpenAI-compatible provider is required for Basira.");
      return { provider, identity };
    });
    const answer = ownerDailyBriefBasiraAnswerSchema.parse(await this.adapters.answerOwnerDailyBrief({
      apiKey: this.vault.decryptApiKey(setup.provider), model: setup.provider.model, brief, question: request.question, language: request.language,
      actorFingerprint: `${context.tenantId}:${context.actorUserId}:owner-daily-brief`,
      toneInstructions: setup.identity?.toneInstructions ?? "", safetyInstructions: setup.identity?.safetyInstructions ?? "",
    }));
    return { skillKey: "owner.daily_brief_analyst", model: setup.provider.model, answer, createdAt: new Date() };
  }

  /** Called exclusively by the code-owned scheduler. The unique database key
   * makes each completed business-day receipt immutable and idempotent. */
  async createScheduledSnapshot(tenantId: string) {
    const receipt = await this.read({ tenantId, actorUserId: SYSTEM_ACTOR_ID, isOwner: true }, {});
    const receiptJson = JSON.stringify(receipt);
    const receiptSha256 = createHash("sha256").update(receiptJson).digest("hex");
    const created = await this.database.inTenantTransaction(tenantId, (tx) => tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "OwnerDailyBriefSnapshot" ("id", "tenantId", "reportDate", "receiptJson", "receiptSha256")
      VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${receipt.reportDate}::date, ${receiptJson}::jsonb, ${receiptSha256})
      ON CONFLICT ("tenantId", "reportDate") DO NOTHING
      RETURNING "id"
    `);
    return { reportDate: receipt.reportDate, created: Boolean(created[0]) };
  }

  /** Historical reports are served only from immutable scheduler receipts. */
  async history(context: TrustedTenantAdministratorContext, query: OwnerDailyBriefHistoryQuery): Promise<OwnerDailyBriefReceipt[]> {
    const rows = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.$queryRaw<Array<{ receiptJson: unknown }>>`
      SELECT "receiptJson"
      FROM "OwnerDailyBriefSnapshot"
      WHERE "tenantId" = ${context.tenantId}::uuid
      ORDER BY "reportDate" DESC
      LIMIT ${query.limit}
    `);
    return rows.map((row) => ownerDailyBriefReceiptSchema.parse(row.receiptJson));
  }

  async read(context: TrustedTenantAdministratorContext, query: OwnerDailyBriefQuery): Promise<OwnerDailyBriefReceipt> {
    const latestAvailableDate = previousRiyadhDate(new Date());
    const reportDate = query.reportDate ?? latestAvailableDate;
    if (reportDate > latestAvailableDate) {
      throw new BadRequestException("The owner daily brief cannot be generated for a future or unfinished business date.");
    }
    const snapshot = await this.loadSnapshot(context.tenantId, reportDate);
    if (snapshot) return snapshot;
    const monthStart = `${reportDate.slice(0, 7)}-01`;
    const from = dateAtUtcStart(monthStart);
    const to = dateAtUtcStart(reportDate);
    const reportDayCount = inclusiveDayCount(from, to);

    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const companies = await tx.company.findMany({
        where: { tenantId: context.tenantId, status: CompanyStatus.ACTIVE },
        orderBy: [{ nameAr: "asc" }, { id: "asc" }],
        select: {
          id: true,
          nameAr: true,
          nameEn: true,
          financeProfile: { select: { functionalCurrencyCode: true } },
        },
      });
      const companyIds = companies.map((company) => company.id);
      const empty = companyIds.length === 0;
      const [salesSummaries, yesterdayPurchases, monthPurchases, activeCampaigns, linkedSpend, providerConnections, labelCount, enabledRuleCount] = await Promise.all([
        empty ? [] : tx.financeDailyFinancialSummary.findMany({
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, businessDate: { gte: from, lte: to } },
          select: { companyId: true, businessDate: true, salesGrossAmount: true, salesClosingCount: true, dataStatus: true, operationalDayStatus: true },
        }),
        empty ? [] : tx.financeOutflowDocument.groupBy({
          by: ["companyId"],
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, kind: FinanceOutflowDocumentKind.PURCHASE, status: FinanceOutflowDocumentStatus.POSTED, businessDate: to },
          _sum: { grossAmount: true }, _count: { id: true },
        }),
        empty ? [] : tx.financeOutflowDocument.groupBy({
          by: ["companyId"],
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, kind: FinanceOutflowDocumentKind.PURCHASE, status: FinanceOutflowDocumentStatus.POSTED, businessDate: { gte: from, lte: to } },
          _sum: { grossAmount: true }, _count: { id: true },
        }),
        empty ? [] : tx.marketingCampaign.findMany({
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, status: MarketingCampaignStatus.ACTIVE },
          select: { plannedCost: true, plannedCurrencyCode: true },
        }),
        empty ? [] : tx.marketingCampaignFinancialLink.findMany({
          where: {
            tenantId: context.tenantId,
            companyId: { in: companyIds },
            campaign: { status: MarketingCampaignStatus.ACTIVE },
            financialDocument: { status: FinanceOutflowDocumentStatus.POSTED, businessDate: { gte: from, lte: to } },
          },
          select: { financialDocument: { select: { grossAmount: true } } },
        }),
        empty ? [] : tx.marketingProviderConnection.groupBy({
          by: ["status"],
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, provider: "GOOGLE_ADS" },
          _count: { id: true },
        }),
        tx.inboundEvidenceLabel.count({ where: { tenantId: context.tenantId } }),
        tx.inboundEvidenceRule.count({ where: { tenantId: context.tenantId, enabled: true } }),
      ]);

      const summariesByCompany = new Map<string, typeof salesSummaries>();
      for (const summary of salesSummaries) {
        const current = summariesByCompany.get(summary.companyId) ?? [];
        current.push(summary);
        summariesByCompany.set(summary.companyId, current);
      }
      const yesterdayPurchasesByCompany = new Map(yesterdayPurchases.map((row) => [row.companyId, row]));
      const monthPurchasesByCompany = new Map(monthPurchases.map((row) => [row.companyId, row]));
      const currencyCodes = [...new Set(companies.map((company) => company.financeProfile?.functionalCurrencyCode ?? null))];
      const currencyCode = currencyCodes.length === 1 ? (currencyCodes[0] ?? null) : null;
      const canConsolidate = currencyCode !== null;

      const companyReceipts = companies.map((company) => {
        const summaries = summariesByCompany.get(company.id) ?? [];
        const yesterday = summaries.find((summary) => ymd(summary.businessDate) === reportDate);
        const eligible = summaries.filter(isEligibleSalesSummary);
        const eligibleGross = eligible.reduce((total, summary) => total.plus(summary.salesGrossAmount), new Prisma.Decimal(0));
        const eligibleClosingCount = eligible.reduce((total, summary) => total + summary.salesClosingCount, 0);
        const incompleteDayCount = reportDayCount - eligible.length;
        const yesterdayStatus = salesStatus(yesterday);
        const monthToDateStatus: SalesStatus = summaries.length === 0 ? "NO_DATA" : incompleteDayCount > 0 ? "INCOMPLETE" : "READY";
        const yesterdayPurchase = yesterdayPurchasesByCompany.get(company.id);
        const monthPurchase = monthPurchasesByCompany.get(company.id);
        const yesterdaySalesAmount = yesterday && isEligibleSalesSummary(yesterday) ? yesterday.salesGrossAmount : null;
        const monthToDateSalesAmount = eligible.length > 0 ? eligibleGross : null;
        const yesterdayPurchaseAmount = yesterdayPurchase?._sum.grossAmount ?? new Prisma.Decimal(0);
        const monthPurchaseAmount = monthPurchase?._sum.grossAmount ?? new Prisma.Decimal(0);
        return {
          companyId: company.id,
          nameAr: company.nameAr,
          nameEn: company.nameEn,
          currencyCode: company.financeProfile?.functionalCurrencyCode ?? null,
          sales: {
            yesterdayGrossAmount: amountOrNull(yesterdaySalesAmount),
            monthToDateGrossAmount: amountOrNull(monthToDateSalesAmount),
            yesterdayClosingCount: yesterday && isEligibleSalesSummary(yesterday) ? yesterday.salesClosingCount : 0,
            monthToDateClosingCount: eligibleClosingCount,
            yesterdayStatus,
            monthToDateStatus,
            eligibleMonthToDateDayCount: eligible.length,
            incompleteMonthToDateDayCount: incompleteDayCount,
          },
          purchases: {
            yesterdayGrossAmount: yesterdayPurchaseAmount.toFixed(4),
            monthToDateGrossAmount: monthPurchaseAmount.toFixed(4),
            yesterdayDocumentCount: yesterdayPurchase?._count.id ?? 0,
            monthToDateDocumentCount: monthPurchase?._count.id ?? 0,
          },
          purchaseToSalesPercent: percent(monthPurchaseAmount, monthToDateSalesAmount),
        };
      });

      const readyCompanyCount = companyReceipts.filter((company) => company.sales.yesterdayStatus === "READY").length;
      const incompleteCompanyCount = companyReceipts.filter((company) => company.sales.yesterdayStatus === "INCOMPLETE").length;
      const noDataCompanyCount = companyReceipts.filter((company) => company.sales.yesterdayStatus === "NO_DATA").length;
      const totals = canConsolidate ? consolidate(companyReceipts) : null;
      const providerCounts = new Map(providerConnections.map((row) => [row.status, row._count.id]));
      const plannedCostAmount = canConsolidate && activeCampaigns.every((campaign) => !campaign.plannedCost || campaign.plannedCurrencyCode === currencyCode)
        ? activeCampaigns.reduce((total, campaign) => total.plus(campaign.plannedCost ?? 0), new Prisma.Decimal(0)).toFixed(4)
        : null;
      const linkedPostedSpend = linkedSpend.reduce((total, link) => total.plus(link.financialDocument.grossAmount), new Prisma.Decimal(0));
      return {
        reportDate,
        generatedAt: new Date().toISOString(),
        timezone: "Asia/Riyadh" as const,
        period: { fromBusinessDate: monthStart, toBusinessDate: reportDate },
        currency: { code: currencyCode, status: canConsolidate ? "SINGLE_CURRENCY" as const : "MIXED_OR_UNCONFIGURED" as const },
        totals: {
          activeCompanyCount: companies.length,
          readyCompanyCount,
          incompleteCompanyCount,
          noDataCompanyCount,
          yesterdaySalesGrossAmount: totals?.yesterdaySales ?? null,
          yesterdayPurchasesGrossAmount: totals?.yesterdayPurchases ?? null,
          monthToDateSalesGrossAmount: totals?.monthSales ?? null,
          monthToDatePurchasesGrossAmount: totals?.monthPurchases ?? null,
          purchaseToSalesPercent: totals ? percent(new Prisma.Decimal(totals.monthPurchases), new Prisma.Decimal(totals.monthSales)) : null,
        },
        companies: companyReceipts,
        marketing: {
          activeCampaignCount: activeCampaigns.length,
          plannedCostAmount,
          linkedPostedSpendMonthToDate: canConsolidate ? linkedPostedSpend.toFixed(4) : null,
          googleAdsConnectionCounts: {
            notConnected: providerCounts.get(MarketingProviderConnectionStatus.NOT_CONNECTED) ?? 0,
            setupRequested: providerCounts.get(MarketingProviderConnectionStatus.SETUP_REQUESTED) ?? 0,
            authorizing: providerCounts.get(MarketingProviderConnectionStatus.AUTHORIZING) ?? 0,
            blocked: providerCounts.get(MarketingProviderConnectionStatus.BLOCKED) ?? 0,
          },
          analysisBoundary: "DESCRIPTIVE_INTERNAL_CAMPAIGN_DATA_ONLY_NOT_ROI_OR_CAUSATION" as const,
        },
        inboundEmail: {
          readiness: labelCount > 0 || enabledRuleCount > 0 ? "RULES_CONFIGURED_NO_MAILBOX_CONNECTED" as const : "NOT_CONFIGURED" as const,
          labelCount,
          enabledRuleCount,
          importedMessageCount: 0 as const,
          note: "No mailbox connector or imported email messages are available in this release." as const,
        },
      };
    });
  }

  private async loadSnapshot(tenantId: string, reportDate: string): Promise<OwnerDailyBriefReceipt | null> {
    const rows = await this.database.inTenantTransaction(tenantId, (tx) => tx.$queryRaw<Array<{ receiptJson: unknown }>>`
      SELECT "receiptJson"
      FROM "OwnerDailyBriefSnapshot"
      WHERE "tenantId" = ${tenantId}::uuid AND "reportDate" = ${reportDate}::date
      LIMIT 1
    `);
    return rows[0] ? ownerDailyBriefReceiptSchema.parse(rows[0].receiptJson) : null;
  }
}

const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

function dateAtUtcStart(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function ymd(value: Date) { return value.toISOString().slice(0, 10); }
function inclusiveDayCount(from: Date, to: Date) { return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1; }
function amountOrNull(value: Prisma.Decimal | null) { return value?.toFixed(4) ?? null; }
function percent(numerator: Prisma.Decimal, denominator: Prisma.Decimal | null) {
  return !denominator || denominator.isZero() ? null : numerator.mul(100).div(denominator).toDecimalPlaces(4).toFixed(4);
}
function isEligibleSalesSummary(summary: { dataStatus: FinanceDailySalesDataStatus; operationalDayStatus: FinanceOperationalDayStatus }) {
  return summary.dataStatus !== FinanceDailySalesDataStatus.PENDING && summary.operationalDayStatus !== FinanceOperationalDayStatus.PARTIAL;
}
function salesStatus(summary: { dataStatus: FinanceDailySalesDataStatus; operationalDayStatus: FinanceOperationalDayStatus } | undefined): SalesStatus {
  return !summary ? "NO_DATA" : isEligibleSalesSummary(summary) ? "READY" : "INCOMPLETE";
}
function consolidate(companies: Array<{ sales: { yesterdayGrossAmount: string | null; monthToDateGrossAmount: string | null }; purchases: { yesterdayGrossAmount: string; monthToDateGrossAmount: string } }>) {
  const sum = (values: Array<string | null>) => values.reduce((total, value) => total.plus(value ?? 0), new Prisma.Decimal(0)).toFixed(4);
  return {
    yesterdaySales: sum(companies.map((company) => company.sales.yesterdayGrossAmount)),
    yesterdayPurchases: sum(companies.map((company) => company.purchases.yesterdayGrossAmount)),
    monthSales: sum(companies.map((company) => company.sales.monthToDateGrossAmount)),
    monthPurchases: sum(companies.map((company) => company.purchases.monthToDateGrossAmount)),
  };
}
function previousRiyadhDate(now: Date) {
  const fields = new Map(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const current = new Date(Date.UTC(Number(fields.get("year")), Number(fields.get("month")) - 1, Number(fields.get("day"))));
  current.setUTCDate(current.getUTCDate() - 1);
  return ymd(current);
}

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
    void context;
    void request;
    // This former direct-provider path deliberately stays unavailable until it
    // is rebuilt on the shared evidence/activation/receipt gateway. Keeping a
    // familiar endpoint must never become a way around company skill gates.
    throw new ForbiddenException("Owner Daily Brief AI is temporarily unavailable while it is migrated to Basira governance.");
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
    // Legacy immutable snapshots predate the financial-basis and coverage
    // contract. Do not surface them as if they carried the newer guarantees.
    return rows
      .map((row) => ownerDailyBriefReceiptSchema.parse(row.receiptJson))
      .filter((receipt) => receipt.financialContract !== undefined);
  }

  async read(context: TrustedTenantAdministratorContext, query: OwnerDailyBriefQuery): Promise<OwnerDailyBriefReceipt> {
    const latestAvailableDate = previousRiyadhDate(new Date());
    const reportDate = query.reportDate ?? latestAvailableDate;
    if (reportDate > latestAvailableDate) {
      throw new BadRequestException("The owner daily brief cannot be generated for a future or unfinished business date.");
    }
    const snapshot = await this.loadSnapshot(context.tenantId, reportDate);
    if (snapshot?.financialContract && snapshot.companies.every((company) => company.sales.trend !== undefined)) return snapshot;
    const monthStart = `${reportDate.slice(0, 7)}-01`;
    const from = dateAtUtcStart(monthStart);
    const to = dateAtUtcStart(reportDate);
    const monthEnd = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
    const trendFrom = addUtcDays(to, -11);
    const priorPeriodFrom = previousMonthStart(from);
    const priorPeriodTo = sameDayPreviousMonth(to);

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
      const [salesSummaries, operationalDays, trendSummaries, priorPeriodSummaries, yesterdayPurchases, monthPurchases, activeCampaigns, linkedSpend, providerConnections, labelCount, enabledRuleCount] = await Promise.all([
        empty ? [] : tx.financeDailyFinancialSummary.findMany({
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, businessDate: { gte: from, lte: to } },
          select: { companyId: true, businessDate: true, salesGrossAmount: true, salesClosingCount: true, dataStatus: true, operationalDayStatus: true },
        }),
        empty ? [] : tx.financeOperationalDay.findMany({
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, businessDate: { gte: priorPeriodFrom, lte: monthEnd } },
          select: { companyId: true, businessDate: true, status: true },
        }),
        empty ? [] : tx.financeDailyFinancialSummary.findMany({
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, businessDate: { gte: trendFrom, lte: to } },
          select: { companyId: true, businessDate: true, salesGrossAmount: true, salesClosingCount: true, dataStatus: true, operationalDayStatus: true },
        }),
        empty ? [] : tx.financeDailyFinancialSummary.findMany({
          where: { tenantId: context.tenantId, companyId: { in: companyIds }, businessDate: { gte: priorPeriodFrom, lte: priorPeriodTo } },
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
      const trendByCompany = new Map<string, typeof trendSummaries>();
      for (const summary of trendSummaries) {
        const current = trendByCompany.get(summary.companyId) ?? [];
        current.push(summary);
        trendByCompany.set(summary.companyId, current);
      }
      const priorPeriodByCompany = new Map<string, typeof priorPeriodSummaries>();
      for (const summary of priorPeriodSummaries) {
        const current = priorPeriodByCompany.get(summary.companyId) ?? [];
        current.push(summary);
        priorPeriodByCompany.set(summary.companyId, current);
      }
      const operationalDaysByCompany = new Map<string, Map<string, FinanceOperationalDayStatus>>();
      for (const operationalDay of operationalDays) {
        const current = operationalDaysByCompany.get(operationalDay.companyId) ?? new Map<string, FinanceOperationalDayStatus>();
        current.set(ymd(operationalDay.businessDate), operationalDay.status);
        operationalDaysByCompany.set(operationalDay.companyId, current);
      }
      const yesterdayPurchasesByCompany = new Map(yesterdayPurchases.map((row) => [row.companyId, row]));
      const monthPurchasesByCompany = new Map(monthPurchases.map((row) => [row.companyId, row]));
      const currencyCodes = [...new Set(companies.map((company) => company.financeProfile?.functionalCurrencyCode ?? null))];
      const currencyCode = currencyCodes.length === 1 ? (currencyCodes[0] ?? null) : null;
      const canConsolidate = currencyCode !== null;

      const companyReceipts = companies.map((company) => {
        const summaries = summariesByCompany.get(company.id) ?? [];
        const trend = trendByCompany.get(company.id) ?? [];
        const priorPeriod = priorPeriodByCompany.get(company.id) ?? [];
        const operationalStatuses = operationalDaysByCompany.get(company.id) ?? new Map<string, FinanceOperationalDayStatus>();
        const yesterday = summaries.find((summary) => ymd(summary.businessDate) === reportDate);
        const coverage = salesCoverage(from, to, summaries, operationalStatuses);
        const priorCoverage = salesCoverage(priorPeriodFrom, priorPeriodTo, priorPeriod, operationalStatuses);
        const forecastOperatingMonthDayCount = operatingDayCount(from, monthEnd, operationalStatuses);
        const yesterdayStatus = salesStatus(yesterday, operationalStatuses.get(reportDate));
        const monthToDateStatus = coverage.status;
        const yesterdayPurchase = yesterdayPurchasesByCompany.get(company.id);
        const monthPurchase = monthPurchasesByCompany.get(company.id);
        const yesterdaySalesAmount = yesterdayStatus === "READY" ? yesterday?.salesGrossAmount ?? null : null;
        const monthToDateSalesAmount = monthToDateStatus === "READY" ? coverage.grossAmount : null;
        const priorDay = trend.find((summary) => ymd(summary.businessDate) === ymd(addUtcDays(to, -1)));
        const priorDaySalesAmount = salesStatus(priorDay, operationalStatuses.get(ymd(addUtcDays(to, -1)))) === "READY" ? priorDay?.salesGrossAmount ?? null : null;
        const dailyChangeGrossAmount = yesterdaySalesAmount && priorDaySalesAmount ? yesterdaySalesAmount.minus(priorDaySalesAmount) : null;
        const dailyAverageGrossAmount = monthToDateStatus === "READY" && coverage.recordedOperatingDayCount > 0
          ? coverage.grossAmount.div(coverage.recordedOperatingDayCount)
          : null;
        const monthEndForecastGrossAmount = dailyAverageGrossAmount ? dailyAverageGrossAmount.mul(forecastOperatingMonthDayCount) : null;
        const priorPeriodTrendPercent = monthToDateStatus === "READY" && priorCoverage.status === "READY"
          ? percentageChange(coverage.grossAmount, priorCoverage.grossAmount)
          : null;
        const yesterdayPurchaseAmount = yesterdayPurchase?._sum.grossAmount ?? new Prisma.Decimal(0);
        const monthPurchaseAmount = monthPurchase?._sum.grossAmount ?? new Prisma.Decimal(0);
        const companyCurrencyCode = company.financeProfile?.functionalCurrencyCode ?? null;
        const trendPoints = businessDays(trendFrom, to).map((businessDate) => {
          const summary = trend.find((candidate) => ymd(candidate.businessDate) === businessDate);
          const grossAmount = salesStatus(summary, operationalStatuses.get(businessDate)) === "READY" ? summary?.salesGrossAmount ?? null : null;
          return { businessDate, grossAmount };
        });
        const trendPeak = trendPoints.reduce((peak, point) => point.grossAmount && point.grossAmount.gt(peak) ? point.grossAmount : peak, new Prisma.Decimal(0));
        return {
          companyId: company.id,
          nameAr: company.nameAr,
          nameEn: company.nameEn,
          currencyCode: companyCurrencyCode,
          sales: {
            yesterdayGrossAmount: amountOrNull(yesterdaySalesAmount),
            monthToDateGrossAmount: amountOrNull(monthToDateSalesAmount),
            yesterdayClosingCount: yesterdayStatus === "READY" ? yesterday?.salesClosingCount ?? null : null,
            monthToDateClosingCount: monthToDateStatus === "READY" ? coverage.closingCount : null,
            yesterdayStatus,
            monthToDateStatus,
            eligibleMonthToDateDayCount: coverage.recordedOperatingDayCount,
            incompleteMonthToDateDayCount: coverage.partialOperatingDayCount + coverage.missingOperatingDayCount,
            requiredMonthToDateOperatingDayCount: coverage.requiredOperatingDayCount,
            recordedMonthToDateDayCount: coverage.recordedOperatingDayCount,
            scheduledClosedMonthToDateDayCount: coverage.scheduledClosedDayCount,
            partialMonthToDateDayCount: coverage.partialOperatingDayCount,
            missingMonthToDateDayCount: coverage.missingOperatingDayCount,
            forecastOperatingMonthDayCount,
            dailyChangeGrossAmount: signedAmountOrNull(dailyChangeGrossAmount),
            dailyAverageGrossAmount: amountOrNull(dailyAverageGrossAmount),
            monthEndForecastGrossAmount: amountOrNull(monthEndForecastGrossAmount),
            priorPeriodTrendPercent: signedAmountOrNull(priorPeriodTrendPercent),
            trend: trendPoints.map((point) => ({
              businessDate: point.businessDate,
              grossAmount: amountOrNull(point.grossAmount),
              grossAmountDisplay: displayGrossAmount(point.grossAmount, companyCurrencyCode),
              barHeightPercent: point.grossAmount && trendPeak.gt(0)
                ? Math.max(8, point.grossAmount.div(trendPeak).mul(100).toNumber())
                : null,
            })),
            display: {
              yesterdayGrossAmount: displayGrossAmount(yesterdaySalesAmount, companyCurrencyCode),
              monthToDateGrossAmount: displayGrossAmount(monthToDateSalesAmount, companyCurrencyCode),
              dailyChangeGrossAmount: displayGrossAmount(dailyChangeGrossAmount, companyCurrencyCode),
              dailyAverageGrossAmount: displayGrossAmount(dailyAverageGrossAmount, companyCurrencyCode),
              monthEndForecastGrossAmount: displayGrossAmount(monthEndForecastGrossAmount, companyCurrencyCode),
              priorPeriodTrendPercent: displayPercent(priorPeriodTrendPercent),
              purchaseToSalesPercent: displayPercent(percentDecimal(monthPurchaseAmount, monthToDateSalesAmount)),
            },
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
      const totalPurchaseToSalesPercent = totals && totals.monthPurchases !== null && totals.monthSales !== null
        ? percent(new Prisma.Decimal(totals.monthPurchases), new Prisma.Decimal(totals.monthSales))
        : null;
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
        financialContract: {
          amountBasis: "GROSS_VAT_INCLUSIVE" as const,
          dataAuthority: "BACKEND_DAILY_FINANCIAL_SUMMARY" as const,
        },
        totals: {
          activeCompanyCount: companies.length,
          readyCompanyCount,
          incompleteCompanyCount,
          noDataCompanyCount,
          yesterdaySalesGrossAmount: totals?.yesterdaySales ?? null,
          yesterdayPurchasesGrossAmount: totals?.yesterdayPurchases ?? null,
          monthToDateSalesGrossAmount: totals?.monthSales ?? null,
          monthToDatePurchasesGrossAmount: totals?.monthPurchases ?? null,
          purchaseToSalesPercent: totalPurchaseToSalesPercent,
          display: {
            yesterdaySalesGrossAmount: displayGrossAmountString(totals?.yesterdaySales ?? null, currencyCode),
            yesterdayPurchasesGrossAmount: displayGrossAmountString(totals?.yesterdayPurchases ?? null, currencyCode),
            monthToDateSalesGrossAmount: displayGrossAmountString(totals?.monthSales ?? null, currencyCode),
            monthToDatePurchasesGrossAmount: displayGrossAmountString(totals?.monthPurchases ?? null, currencyCode),
            purchaseToSalesPercent: displayPercentString(totalPurchaseToSalesPercent),
          },
        },
        companies: companyReceipts,
        marketing: {
          activeCampaignCount: activeCampaigns.length,
          plannedCostAmount,
          linkedPostedSpendMonthToDate: canConsolidate ? linkedPostedSpend.toFixed(4) : null,
          display: {
            plannedCostAmount: displayGrossAmountString(plannedCostAmount, currencyCode),
            linkedPostedSpendMonthToDate: canConsolidate ? displayGrossAmount(linkedPostedSpend, currencyCode) : null,
          },
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
function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
function previousMonthStart(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, 1)); }
function sameDayPreviousMonth(value: Date) {
  const previousMonthLastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 0)).getUTCDate();
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, Math.min(value.getUTCDate(), previousMonthLastDay)));
}
function businessDays(from: Date, to: Date) {
  const days: string[] = [];
  for (let current = new Date(from); current <= to; current = addUtcDays(current, 1)) days.push(ymd(current));
  return days;
}
function amountOrNull(value: Prisma.Decimal | null) { return value?.toFixed(4) ?? null; }
function signedAmountOrNull(value: Prisma.Decimal | null) { return value?.toFixed(4) ?? null; }
function percentageChange(current: Prisma.Decimal, prior: Prisma.Decimal) {
  return prior.isZero() ? null : current.minus(prior).mul(100).div(prior).toDecimalPlaces(4);
}
function percent(numerator: Prisma.Decimal, denominator: Prisma.Decimal | null) {
  const value = percentDecimal(numerator, denominator);
  return value?.toFixed(4) ?? null;
}
function percentDecimal(numerator: Prisma.Decimal, denominator: Prisma.Decimal | null) {
  return !denominator || denominator.isZero() ? null : numerator.mul(100).div(denominator).toDecimalPlaces(4);
}
function displayGrossAmount(value: Prisma.Decimal | null, currencyCode: string | null) {
  return value && currencyCode ? `${groupDecimal(value.toFixed(2))} ${currencyCode}` : null;
}
function displayGrossAmountString(value: string | null, currencyCode: string | null) {
  return value && currencyCode ? displayGrossAmount(new Prisma.Decimal(value), currencyCode) : null;
}
function displayPercent(value: Prisma.Decimal | null) {
  return value ? `${groupDecimal(value.toFixed(1))}%` : null;
}
function displayPercentString(value: string | null) {
  return value ? displayPercent(new Prisma.Decimal(value)) : null;
}
function groupDecimal(value: string) {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fraction] = unsigned.split(".");
  return `${negative ? "-" : ""}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
}
function isEligibleSalesSummary(
  summary: { dataStatus: FinanceDailySalesDataStatus; operationalDayStatus: FinanceOperationalDayStatus } | undefined,
  operationalStatus = summary?.operationalDayStatus,
) {
  return summary !== undefined
    && summary.dataStatus === FinanceDailySalesDataStatus.RECORDED
    && operationalStatus === FinanceOperationalDayStatus.OPEN;
}
function salesStatus(
  summary: { dataStatus: FinanceDailySalesDataStatus; operationalDayStatus: FinanceOperationalDayStatus } | undefined,
  operationalStatus = summary?.operationalDayStatus,
): SalesStatus {
  if (operationalStatus === FinanceOperationalDayStatus.CLOSED) return "NO_DATA";
  return isEligibleSalesSummary(summary, operationalStatus) ? "READY" : "INCOMPLETE";
}
function salesCoverage(
  from: Date,
  to: Date,
  summaries: ReadonlyArray<{ businessDate: Date; salesGrossAmount: Prisma.Decimal; salesClosingCount: number; dataStatus: FinanceDailySalesDataStatus; operationalDayStatus: FinanceOperationalDayStatus }>,
  operationalStatuses: ReadonlyMap<string, FinanceOperationalDayStatus>,
) {
  const summariesByBusinessDate = new Map(summaries.map((summary) => [ymd(summary.businessDate), summary]));
  let requiredOperatingDayCount = 0;
  let recordedOperatingDayCount = 0;
  let scheduledClosedDayCount = 0;
  let partialOperatingDayCount = 0;
  let missingOperatingDayCount = 0;
  let grossAmount = new Prisma.Decimal(0);
  let closingCount = 0;
  for (const businessDate of businessDays(from, to)) {
    const summary = summariesByBusinessDate.get(businessDate);
    const operationalStatus = operationalStatuses.get(businessDate) ?? summary?.operationalDayStatus ?? FinanceOperationalDayStatus.OPEN;
    if (operationalStatus === FinanceOperationalDayStatus.CLOSED) {
      scheduledClosedDayCount += 1;
      continue;
    }
    requiredOperatingDayCount += 1;
    if (operationalStatus === FinanceOperationalDayStatus.PARTIAL) {
      partialOperatingDayCount += 1;
      continue;
    }
    if (summary && isEligibleSalesSummary(summary, operationalStatus)) {
      recordedOperatingDayCount += 1;
      grossAmount = grossAmount.plus(summary.salesGrossAmount);
      closingCount += summary.salesClosingCount;
      continue;
    }
    missingOperatingDayCount += 1;
  }
  const status: SalesStatus = requiredOperatingDayCount === 0
    ? "NO_DATA"
    : partialOperatingDayCount > 0 || missingOperatingDayCount > 0
      ? "INCOMPLETE"
      : "READY";
  return {
    status,
    grossAmount,
    closingCount,
    requiredOperatingDayCount,
    recordedOperatingDayCount,
    scheduledClosedDayCount,
    partialOperatingDayCount,
    missingOperatingDayCount,
  };
}
function operatingDayCount(from: Date, to: Date, operationalStatuses: ReadonlyMap<string, FinanceOperationalDayStatus>) {
  return businessDays(from, to).filter((businessDate) => operationalStatuses.get(businessDate) !== FinanceOperationalDayStatus.CLOSED).length;
}
function consolidate(companies: Array<{ sales: { yesterdayGrossAmount: string | null; monthToDateGrossAmount: string | null }; purchases: { yesterdayGrossAmount: string; monthToDateGrossAmount: string } }>) {
  const sum = (values: Array<string | null>) => values.every((value) => value !== null)
    ? values.reduce((total, value) => total.plus(value!), new Prisma.Decimal(0)).toFixed(4)
    : null;
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

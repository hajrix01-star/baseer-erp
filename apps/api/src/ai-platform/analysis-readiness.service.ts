import {
  analysisReadinessReceiptSchema,
  type AnalysisReadinessReceipt,
  type BasiraDecisionAlertBrief,
} from "@baseer-erp/contracts";
import { Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DecisionIntelligenceService } from "../decision-intelligence/decision-intelligence.service.js";
import { MarketingService } from "../marketing/marketing.service.js";

/**
 * One read-only gate shared by the UI and the live runtime. It owns no facts
 * and performs no provider work: it only turns the authoritative read models
 * into a small, actionable readiness receipt.
 */
@Injectable()
export class AnalysisReadinessService {
  constructor(
    private readonly decisions: DecisionIntelligenceService,
    private readonly marketing: MarketingService,
  ) {}

  async decisionAlert(context: TrustedCompanyActorContext, alertId: string): Promise<AnalysisReadinessReceipt> {
    const brief = await this.decisions.readBasiraDecisionAlertBrief(context, alertId);
    return decisionAlertReadiness(brief);
  }

  async decisionWorkspace(context: TrustedCompanyActorContext): Promise<AnalysisReadinessReceipt> {
    const alerts = await this.decisions.listAlerts(context, "OPEN", 1);
    if (!alerts.length) {
      return receipt("DECISION_WORKSPACE", null, "BLOCKED", [{
        code: "NO_VERIFIED_ALERT",
        messageAr: "لا يوجد تنبيه مفتوح موثق يمكن تفسيره الآن.",
        nextActionAr: "شغّل فحص الجودة/تغيّر المبيعات أو اختر تنبيهاً موثقاً عند ظهوره؛ لا تُنشأ قراءة ذكاء من دون تنبيه ودليل محفوظ.",
      }]);
    }
    const alert = alerts[0];
    if (!alert) throw new Error("A selected decision alert is required.");
    const detail = await this.decisionAlert(context, alert.id);
    return receipt("DECISION_WORKSPACE", detail.subjectId, detail.status, detail.reasons);
  }

  async marketingCampaign(context: TrustedCompanyActorContext, campaignId: string): Promise<AnalysisReadinessReceipt> {
    const analysis = await this.marketing.campaignAnalysis(context, campaignId);
    const reasons: AnalysisReadinessReceipt["reasons"] = [];
    if (!analysis.period) reasons.push({
      code: "CAMPAIGN_DATES_MISSING",
      messageAr: "الحملة لا تملك تاريخ بداية ونهاية معتمدين.",
      nextActionAr: "أضف فترة الحملة أولاً حتى تُبنى قراءة المبيعات والسياق على أيام محددة.",
    });
    if (!analysis.salesComparison || analysis.salesComparison.dataQuality !== "READY") reasons.push({
      code: "CAMPAIGN_SALES_NOT_READY",
      messageAr: "مبيعات الحملة أو فترة المقارنة غير مكتملة أو غير متاحة.",
      nextActionAr: "أكمل أو راجع أيام المبيعات الناقصة ثم أعد فتح تحليل الحملة.",
    });
    if (analysis.spendResult.spendDataQuality !== "READY") reasons.push({
      code: "CAMPAIGN_SPEND_NOT_READY",
      messageAr: "المصروف المرتبط بالحملة غير جاهز كقراءة مالية مثبتة.",
      nextActionAr: "اربط فقط مستندات مصروف/شراء مثبتة ضمن فترة الحملة، ثم راجع حالة الجودة.",
    });
    return receipt("MARKETING_CAMPAIGN", campaignId, reasons.length ? "BLOCKED" : "READY", reasons.length ? reasons : [{
      code: "READY_FOR_INTERPRETATION",
      messageAr: "حزمة الحملة مكتملة وقابلة للتفسير.",
      nextActionAr: "يمكن طلب تفسير بصيرة؛ سيشرح الدليل ولا يثبت السببية أو يغيّر أي سجل.",
    }]);
  }

  async marketingWorkspace(context: TrustedCompanyActorContext): Promise<AnalysisReadinessReceipt> {
    const workspace = await this.marketing.workspace(context);
    const candidate = workspace.campaigns.find((campaign) => campaign.status === "ACTIVE" || campaign.status === "COMPLETED")
      ?? workspace.campaigns.find((campaign) => campaign.status !== "ARCHIVED");
    if (!candidate) {
      return receipt("MARKETING_WORKSPACE", null, "BLOCKED", [{
        code: "NO_CAMPAIGN",
        messageAr: "لا توجد حملة مسجلة قابلة للتحليل في الشركة الحالية.",
        nextActionAr: "سجل الحملة، مدتها وتكلفتها ثم اربط مصروفاتها المثبتة عند توفرها.",
      }]);
    }
    const detail = await this.marketingCampaign(context, candidate.id);
    return receipt("MARKETING_WORKSPACE", detail.subjectId, detail.status, detail.reasons);
  }
}

export function decisionAlertReadiness(brief: BasiraDecisionAlertBrief): AnalysisReadinessReceipt {
  const reasons: AnalysisReadinessReceipt["reasons"] = [];
  if (brief.alert.status !== "OPEN") reasons.push({
    code: "ALERT_NOT_OPEN",
    messageAr: "التنبيه لم يعد مفتوحاً للمراجعة.",
    nextActionAr: "استخدم التنبيه المفتوح المرتبط بالقراءة الحالية أو راجع التفسير المحفوظ للتنبيه المغلق.",
  });
  if (!brief.evidence.checksumValid) reasons.push({
    code: "EVIDENCE_CHECKSUM_INVALID",
    messageAr: "فشلت مطابقة بصمة حزمة الدليل المحفوظة.",
    nextActionAr: "لا تطلب تفسيراً؛ راجع حزمة الدليل وسجل التدقيق أولاً.",
  });
  if (!brief.salesChange || brief.salesChange.dataQuality !== "READY") reasons.push({
    code: "SALES_COMPARISON_NOT_READY",
    messageAr: "مقارنة المبيعات في دليل التنبيه غير مكتملة أو غير جاهزة.",
    nextActionAr: "أكمل فحص جودة المبيعات ثم شغّل التقييم من جديد لإنتاج تنبيه موثق جديد.",
  });
  return receipt("DECISION_ALERT", brief.alert.id, reasons.length ? "BLOCKED" : "READY", reasons.length ? reasons : [{
    code: "READY_FOR_INTERPRETATION",
    messageAr: "حزمة التنبيه موثقة وقابلة للتفسير.",
    nextActionAr: "يمكن طلب تفسير بصيرة؛ سيقتصر على حزمة الدليل المحفوظة.",
  }]);
}

function receipt(scope: AnalysisReadinessReceipt["scope"], subjectId: string | null, status: AnalysisReadinessReceipt["status"], reasons: AnalysisReadinessReceipt["reasons"]): AnalysisReadinessReceipt {
  return analysisReadinessReceiptSchema.parse({ scope, subjectId, status, reasons, checkedAt: new Date() });
}

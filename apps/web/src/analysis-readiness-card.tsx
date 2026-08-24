import { BaseerCard } from "./baseer-card";
import { BaseerStatusBadge } from "./baseer-status-badge";

export type AnalysisReadiness = {
  scope: "DECISION_ALERT" | "DECISION_WORKSPACE" | "MARKETING_CAMPAIGN" | "MARKETING_WORKSPACE";
  subjectId: string | null;
  status: "READY" | "BLOCKED" | "NEEDS_REVIEW";
  reasons: Array<{ code: string; messageAr: string; nextActionAr: string }>;
  checkedAt: string;
};

export function AnalysisReadinessCard({ language, readiness }: { language: "ar" | "en"; readiness: AnalysisReadiness | undefined }) {
  const ar = language === "ar";
  if (!readiness) return null;
  const tone = readiness.status === "READY" ? "success" : readiness.status === "NEEDS_REVIEW" ? "warning" : "neutral";
  const label = readiness.status === "READY" ? (ar ? "جاهز للتفسير" : "Ready to interpret") : readiness.status === "NEEDS_REVIEW" ? (ar ? "يحتاج مراجعة" : "Needs review") : (ar ? "غير جاهز الآن" : "Not ready now");
  return <BaseerCard className="marketing-workspace__boundary"><header><div><strong>{ar ? "جاهزية التحليل" : "Analysis readiness"}</strong><p>{ar ? "تُفحص قبل بصيرة. لا ترسل هذه البطاقة أي بيانات إلى نموذج الذكاء." : "Checked before Basira. This card never sends data to an AI model."}</p></div><BaseerStatusBadge tone={tone}>{label}</BaseerStatusBadge></header><ul>{readiness.reasons.map((reason) => <li key={reason.code}><strong>{reason.messageAr}</strong><small>{reason.nextActionAr}</small></li>)}</ul></BaseerCard>;
}

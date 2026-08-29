import { BaseerButton } from "./baseer-button";
import { BaseerCard, BaseerCardButton } from "./baseer-card";
import type { AttendanceReportRow, AttendanceReportV2 } from "./attendance-client";
import { formatAttendanceDuration } from "./attendance-time-utils";
import "./hr-attendance-team-report.css";

type Language = "ar" | "en";
export type AttendanceTeamReportView = "cards" | "table";

function commitment(row: AttendanceReportRow) {
  if (!row.plannedMinutes) return null;
  return Math.max(0, Math.min(100, Math.round(((row.plannedMinutes - row.shortageMinutes) / row.plannedMinutes) * 100)));
}

function commitmentTone(value: number | null) {
  if (value === null) return "neutral";
  if (value >= 95) return "good";
  if (value >= 85) return "watch";
  return "attention";
}

function dayState(row: AttendanceReportRow) {
  return row.days.at(-1)?.state ?? "NO_SCHEDULE";
}

function stateCopy(state: AttendanceReportRow["days"][number]["state"], language: Language) {
  const ar = language === "ar";
  if (state === "ON_TIME") return ar ? "ملتزم" : "On time";
  if (state === "REST_DAY") return ar ? "راحة" : "Rest day";
  if (state === "MISSING_CHECK_IN") return ar ? "لم يسجل حضوراً" : "Missing check-in";
  if (state === "IN_PROGRESS") return ar ? "في الدوام" : "At work";
  if (state === "ATTENTION") return ar ? "يحتاج متابعة" : "Needs review";
  return ar ? "لا يوجد دوام" : "No schedule";
}

function priorityNote(row: AttendanceReportRow, language: Language) {
  const ar = language === "ar";
  if (row.missingCheckInDays) return ar ? `${row.missingCheckInDays} يوم بلا حضور` : `${row.missingCheckInDays} missing day${row.missingCheckInDays === 1 ? "" : "s"}`;
  if (row.shortageMinutes) return ar ? `ناقص ${formatAttendanceDuration(row.shortageMinutes, language)}` : `Short ${formatAttendanceDuration(row.shortageMinutes, language)}`;
  if (row.lateMinutes) return ar ? `تأخر ${formatAttendanceDuration(row.lateMinutes, language)}` : `Late ${formatAttendanceDuration(row.lateMinutes, language)}`;
  if (row.earlyLeaveMinutes) return ar ? `خروج مبكر ${formatAttendanceDuration(row.earlyLeaveMinutes, language)}` : `Early leave ${formatAttendanceDuration(row.earlyLeaveMinutes, language)}`;
  return ar ? "لا توجد ملاحظات تشغيلية" : "No operational notes";
}

export function HrAttendanceTeamReport({ report, language, view, onViewChange, onOpenEmployee }: {
  report: AttendanceReportV2;
  language: Language;
  view: AttendanceTeamReportView;
  onViewChange: (view: AttendanceTeamReportView) => void;
  onOpenEmployee: (employeeId: string) => void;
}) {
  const ar = language === "ar";
  return <section className="hr-attendance-team-report" aria-label={ar ? "ملخص فريق الحضور" : "Attendance team summary"}>
    <BaseerCard className="hr-attendance-team-report__summary">
      <header>
        <div><span>{ar ? "ملخص فريق الحضور" : "Attendance team summary"}</span><h3>{ar ? "تابع الفريق ثم افتح تفاصيل الموظف" : "Scan the team, then open an employee detail"}</h3><p>{ar ? "المؤشر يقيس الالتزام بالدوام ضمن الفترة فقط؛ لا يمثل تقييماً للأداء ولا ينشئ خصماً أو أوفر تايم." : "The indicator measures schedule adherence for this period only. It is not a performance rating and never creates payroll actions."}</p></div>
        <div className="hr-attendance-team-report__view-switch" role="group" aria-label={ar ? "طريقة العرض" : "View mode"}><BaseerButton type="button" variant={view === "cards" ? "primary" : "quiet"} aria-pressed={view === "cards"} onClick={() => onViewChange("cards")}>{ar ? "البطاقات" : "Cards"}</BaseerButton><BaseerButton type="button" variant={view === "table" ? "primary" : "quiet"} aria-pressed={view === "table"} onClick={() => onViewChange("table")}>{ar ? "الجدول" : "Table"}</BaseerButton></div>
      </header>
      <div className="hr-attendance-team-report__totals">
        <Metric label={ar ? "الموظفون" : "Employees"} value={String(report.rows.length)} />
        <Metric label={ar ? "مخطط" : "Planned"} value={formatAttendanceDuration(report.summary.plannedMinutes, language)} />
        <Metric label={ar ? "فعلي" : "Actual"} value={formatAttendanceDuration(report.summary.workedMinutes, language)} />
        <Metric label={ar ? "يحتاج متابعة" : "Needs review"} value={String(report.rows.filter((row) => row.shortageMinutes || row.missingCheckInDays || row.lateMinutes || row.earlyLeaveMinutes).length)} tone="attention" />
      </div>
    </BaseerCard>
    {view === "cards" ? <div className="hr-attendance-team-report__cards">{report.rows.map((row) => <EmployeeCard key={row.employeeId} row={row} language={language} onOpen={() => onOpenEmployee(row.employeeId)} />)}</div> : <TeamTable rows={report.rows} language={language} onOpenEmployee={onOpenEmployee} />}
  </section>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "attention" }) {
  return <div className={tone ? `is-${tone}` : undefined}><small>{label}</small><b>{value}</b></div>;
}

function EmployeeCard({ row, language, onOpen }: { row: AttendanceReportRow; language: Language; onOpen: () => void }) {
  const ar = language === "ar";
  const score = commitment(row);
  const state = dayState(row);
  return <BaseerCardButton type="button" className={`hr-attendance-team-report__card is-${commitmentTone(score)}`} onClick={onOpen}>
    <header><div><small dir="ltr">{row.employeeNumber}</small><h4>{ar ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr}</h4></div><span className={`hr-attendance-team-report__state is-${state.toLowerCase()}`}>{stateCopy(state, language)}</span></header>
    <div className="hr-attendance-team-report__card-main"><div className="hr-attendance-team-report__score"><small>{ar ? "التزام الدوام" : "Schedule adherence"}</small><b>{score === null ? "—" : `${score}%`}</b></div><div className="hr-attendance-team-report__hours"><small>{ar ? "الفعلي من المخطط" : "Actual of planned"}</small><b>{formatAttendanceDuration(row.workedMinutes, language)}</b><span>{ar ? `من ${formatAttendanceDuration(row.plannedMinutes, language)}` : `of ${formatAttendanceDuration(row.plannedMinutes, language)}`}</span></div></div>
    <footer><span className={row.shortageMinutes || row.missingCheckInDays ? "is-attention" : undefined}>{priorityNote(row, language)}</span><b>{ar ? "عرض التفاصيل ←" : "View detail →"}</b></footer>
  </BaseerCardButton>;
}

function TeamTable({ rows, language, onOpenEmployee }: { rows: AttendanceReportRow[]; language: Language; onOpenEmployee: (employeeId: string) => void }) {
  const ar = language === "ar";
  return <BaseerCard className="hr-attendance-team-report__table-card"><div className="baseer-data-grid__scroll"><table className="baseer-data-grid hr-attendance-team-report__table"><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "الحالة" : "Status"}</th><th>{ar ? "التزام الدوام" : "Adherence"}</th><th>{ar ? "الفعلي / المخطط" : "Actual / planned"}</th><th>{ar ? "ملاحظة تشغيلية" : "Operational note"}</th><th aria-label={ar ? "فتح التقرير" : "Open report"} /></tr></thead><tbody>{rows.map((row) => { const score = commitment(row); const state = dayState(row); return <tr key={row.employeeId}><td><strong>{ar ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr}</strong><small dir="ltr">{row.employeeNumber}</small></td><td><span className={`hr-attendance-team-report__state is-${state.toLowerCase()}`}>{stateCopy(state, language)}</span></td><td><b className={`hr-attendance-team-report__table-score is-${commitmentTone(score)}`}>{score === null ? "—" : `${score}%`}</b></td><td><strong>{formatAttendanceDuration(row.workedMinutes, language)}</strong><small>{ar ? `من ${formatAttendanceDuration(row.plannedMinutes, language)}` : `of ${formatAttendanceDuration(row.plannedMinutes, language)}`}</small></td><td className={row.shortageMinutes || row.missingCheckInDays ? "is-attention" : undefined}>{priorityNote(row, language)}</td><td><BaseerButton type="button" variant="quiet" onClick={() => onOpenEmployee(row.employeeId)}>{ar ? "التفاصيل" : "Details"}</BaseerButton></td></tr>; })}</tbody></table></div></BaseerCard>;
}

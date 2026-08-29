import { BaseerCard } from "./baseer-card";
import type { BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerDataGridField } from "./baseer-data-grid-field";
import type { AttendanceEmployeeSchedule, AttendanceReportRow } from "./attendance-client";
import { formatAttendanceDuration } from "./attendance-time-utils";
import "./hr-attendance-employee-report.css";

type Language = "ar" | "en";

function commitment(row: AttendanceReportRow | null | undefined) {
  if (!row?.plannedMinutes) return null;
  return Math.max(0, Math.min(100, Math.round(((row.plannedMinutes - row.shortageMinutes) / row.plannedMinutes) * 100)));
}

function commitmentTone(value: number | null) {
  if (value === null) return "neutral";
  if (value >= 95) return "good";
  if (value >= 85) return "watch";
  return "attention";
}

function sourceLabel(source: AttendanceReportRow["days"][number]["scheduleSource"], language: Language) {
  const ar = language === "ar";
  return source === "ROSTER" ? (ar ? "جدول معتمد" : "Approved roster") : source === "EXCEPTION" ? (ar ? "استثناء" : "Exception") : source === "WEEKLY_ADJUSTMENT" ? (ar ? "راحة/نصف دوام" : "Weekly adjustment") : source === "TEMPLATE" ? (ar ? "قالب دوام" : "Template") : (ar ? "لا توجد خطة" : "No schedule");
}

function stateLabel(state: AttendanceReportRow["days"][number]["state"], language: Language) {
  const ar = language === "ar";
  return state === "ON_TIME" ? (ar ? "ملتزم" : "On time") : state === "REST_DAY" ? (ar ? "راحة" : "Rest") : state === "MISSING_CHECK_IN" ? (ar ? "لم يسجل حضور" : "Missing") : state === "IN_PROGRESS" ? (ar ? "جلسة مفتوحة" : "Open") : state === "ATTENTION" ? (ar ? "يحتاج متابعة" : "Review") : (ar ? "لا يوجد دوام" : "No schedule");
}

function varianceLabel(day: AttendanceReportRow["days"][number], language: Language) {
  const ar = language === "ar";
  if (day.extraMinutes) return { value: `+${formatAttendanceDuration(day.extraMinutes, language)}`, tone: "good" };
  if (day.shortageMinutes) return { value: `−${formatAttendanceDuration(day.shortageMinutes, language)}`, tone: "attention" };
  return { value: "—", tone: "neutral", label: ar ? "مطابق للمخطط" : "Matches plan" };
}

type DailyAttendanceRow = AttendanceReportRow["days"][number];

function DailyAttendanceTable({ days, language }: { days: DailyAttendanceRow[]; language: Language }) {
  const ar = language === "ar";
  const columns: BaseerDataGridColumn<DailyAttendanceRow>[] = [
    { id: "date", header: ar ? "التاريخ" : "Date", width: "9rem", align: "center", numeric: true, cell: (day) => <bdi dir="ltr"><strong>{day.businessDate}</strong></bdi> },
    { id: "plan", header: ar ? "الخطة" : "Plan", width: "8.5rem", cell: (day) => <small>{sourceLabel(day.scheduleSource, language)}</small> },
    { id: "planned", header: ar ? "مخطط" : "Planned", width: "6.5rem", align: "center", numeric: true, cell: (day) => formatAttendanceDuration(day.plannedMinutes, language) },
    { id: "actual", header: ar ? "فعلي" : "Actual", width: "6.5rem", align: "center", numeric: true, cell: (day) => <strong>{formatAttendanceDuration(day.workedMinutes, language)}</strong> },
    { id: "late", header: ar ? "تأخر" : "Late", width: "5.5rem", align: "center", numeric: true, cell: (day) => day.lateMinutes ? <span className="hr-employee-attendance-report__attention-value">{formatAttendanceDuration(day.lateMinutes, language)}</span> : "—" },
    { id: "early", header: ar ? "مبكر" : "Early", width: "6rem", align: "center", numeric: true, cell: (day) => day.earlyLeaveMinutes ? <span className="hr-employee-attendance-report__attention-value">{formatAttendanceDuration(day.earlyLeaveMinutes, language)}</span> : "—" },
    { id: "variance", header: ar ? "الفارق" : "Variance", width: "6.5rem", align: "center", numeric: true, cell: (day) => { const variance = varianceLabel(day, language); return <span className={`hr-employee-attendance-report__variance is-${variance.tone}`} title={variance.label}>{variance.value}</span>; } },
    { id: "state", header: ar ? "الحالة" : "Status", width: "8rem", align: "center", cell: (day) => <span className={`hr-employee-attendance-report__state is-${day.state.toLowerCase()}`}>{stateLabel(day.state, language)}</span> },
  ];
  return <BaseerDataGridField ariaLabel={ar ? "سجل الدوام اليومي" : "Daily attendance register"} caption={ar ? "تفصيل الحضور للفترة المحددة" : "Attendance detail for selected period"} className="hr-employee-attendance-report__daily-table" columns={columns} rows={days} rowKey={(day) => day.businessDate} />;
}

export function HrAttendanceEmployeeReport({ row, schedule, from, to, language, monthCommitment, yearCommitment }: {
  row: AttendanceReportRow;
  schedule: AttendanceEmployeeSchedule | null | undefined;
  from: string;
  to: string;
  language: Language;
  monthCommitment: number | null;
  yearCommitment: number | null;
}) {
  const ar = language === "ar";
  const periodCommitment = commitment(row);
  const assignment = schedule?.assignments.filter((item) => item.effectiveFrom <= to).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  const weeklyAdjustment = schedule?.weeklyAdjustments.filter((item) => item.effectiveFrom <= to).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  const exceptions = schedule?.exceptions.filter((item) => item.businessDate >= from && item.businessDate <= to) ?? [];

  return <section className="hr-employee-attendance-report" aria-label={ar ? "تحليل حضور الموظف" : "Employee attendance analysis"}>
    <BaseerCard className="hr-employee-attendance-report__hero">
      <div>
        <span>{ar ? "تحليل الموظف" : "Employee analysis"}</span>
        <h3>{row.employeeNumber} · {ar ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr}</h3>
        <p>{ar ? `الفترة ${from} إلى ${to}. المؤشر تشغيلي للمتابعة فقط ولا ينشئ خصماً أو أوفر تايم.` : `Period ${from} to ${to}. This is an operational measure only; it never creates payroll actions.`}</p>
      </div>
      <div className={`hr-employee-attendance-report__commitment is-${commitmentTone(periodCommitment)}`}>
        <small>{ar ? "التزام الفترة" : "Period commitment"}</small>
        <b>{periodCommitment === null ? "—" : `${periodCommitment}%`}</b>
        <span>{ar ? "من وقت الدوام المخطط" : "of planned work time"}</span>
      </div>
    </BaseerCard>

    <div className="hr-employee-attendance-report__metrics">
      <Metric label={ar ? "مخطط" : "Planned"} value={formatAttendanceDuration(row.plannedMinutes, language)} />
      <Metric label={ar ? "فعلي" : "Actual"} value={formatAttendanceDuration(row.workedMinutes, language)} />
      <Metric label={ar ? "تأخر + مبكر" : "Late + early"} value={formatAttendanceDuration(row.lateMinutes + row.earlyLeaveMinutes, language)} tone={row.lateMinutes + row.earlyLeaveMinutes ? "attention" : undefined} />
      <Metric label={ar ? "ناقص" : "Shortage"} value={formatAttendanceDuration(row.shortageMinutes, language)} tone={row.shortageMinutes ? "attention" : undefined} />
      <Metric label={ar ? "زائد" : "Extra"} value={formatAttendanceDuration(row.extraMinutes, language)} tone={row.extraMinutes ? "good" : undefined} />
      <Metric label={ar ? "بلا حضور" : "Missing"} value={String(row.missingCheckInDays)} tone={row.missingCheckInDays ? "attention" : undefined} />
    </div>

    <BaseerCard className="hr-employee-attendance-report__commitment-history">
      <div><span>{ar ? "مؤشرات الالتزام" : "Commitment indicators"}</span><h4>{ar ? "الشهر الحالي وآخر 12 شهراً" : "Current month and trailing 12 months"}</h4></div>
      <div className="hr-employee-attendance-report__commitment-cards">
        <Commitment label={ar ? "الشهر الحالي" : "Current month"} value={monthCommitment} />
        <Commitment label={ar ? "العام التشغيلي" : "Operational year"} value={yearCommitment} />
        <Commitment label={ar ? "الفترة المختارة" : "Selected period"} value={periodCommitment} />
      </div>
    </BaseerCard>

    <BaseerCard className="hr-employee-attendance-report__schedule">
      <div><span>{ar ? "خطة الدوام" : "Work plan"}</span><h4>{ar ? "القالب والتخصيصات المؤثرة" : "Template and active adjustments"}</h4></div>
      <dl>
        <div><dt>{ar ? "قالب الدوام" : "Work template"}</dt><dd>{assignment ? `${ar ? assignment.templateNameAr : assignment.templateNameEn ?? assignment.templateNameAr} · ${assignment.effectiveFrom}` : "—"}</dd></div>
        <div><dt>{ar ? "راحة/نصف دوام" : "Rest / half day"}</dt><dd>{weeklyAdjustment ? `${weeklyAdjustment.kind === "FULL_REST" ? (ar ? "راحة كاملة" : "Full rest") : weeklyAdjustment.periods.map((period) => `${period.startTime}–${period.endTime}`).join(" · ")} · ${weeklyAdjustment.effectiveFrom}` : "—"}</dd></div>
        <div><dt>{ar ? "جلسات مكتملة" : "Completed sessions"}</dt><dd>{row.completedSessions} / {row.sessions}</dd></div>
      </dl>
    </BaseerCard>

    <BaseerCard className="hr-employee-attendance-report__daily">
      <header><div><span>{ar ? "سجل الدوام اليومي" : "Daily attendance register"}</span><h4>{ar ? "تفصيل واضح للفترة المحددة" : "Clear detail for the selected period"}</h4><p>{ar ? "كل صف يمثل يوماً واحداً. الحسابات تعرض الحضور المسجل مقارنة بخطة الدوام المعتمدة." : "Each row represents one day. Calculations compare recorded attendance with the approved work plan."}</p></div><small>{ar ? `${row.days.length} يوم` : `${row.days.length} days`}</small></header>
      <DailyAttendanceTable days={row.days} language={language} />
    </BaseerCard>

    {exceptions.length ? <BaseerCard className="hr-employee-attendance-report__exceptions"><div><span>{ar ? "استثناءات الدوام" : "Work exceptions"}</span><h4>{ar ? "ضمن الفترة المختارة" : "Within selected period"}</h4></div><ul>{exceptions.map((exception) => <li key={exception.id}><b dir="ltr">{exception.businessDate}</b><span>{exception.kind === "FULL_REST" ? (ar ? "راحة كاملة" : "Full rest") : exception.periods.map((period) => `${period.startTime}–${period.endTime}`).join(" · ")}</span><small>{exception.reason}</small><em>{exception.status === "APPROVED" ? (ar ? "معتمد" : "Approved") : exception.status === "PENDING" ? (ar ? "بانتظار الاعتماد" : "Pending") : exception.status === "REJECTED" ? (ar ? "مرفوض" : "Rejected") : (ar ? "ملغى" : "Cancelled")}</em></li>)}</ul></BaseerCard> : null}
  </section>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "attention" }) {
  return <BaseerCard className={tone ? `hr-employee-attendance-report__metric is-${tone}` : "hr-employee-attendance-report__metric"}><small>{label}</small><b>{value}</b></BaseerCard>;
}

function Commitment({ label, value }: { label: string; value: number | null }) {
  return <div className={`is-${commitmentTone(value)} `}><small>{label}</small><b>{value === null ? "—" : `${value}%`}</b></div>;
}

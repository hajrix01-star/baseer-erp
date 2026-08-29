import { useMemo, useState } from "react";

import type { AttendanceCoverage } from "./attendance-client";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { attendanceIsoWeekdayName, formatAttendanceMinute } from "./attendance-time-utils";
import "./hr-attendance-coverage-panel.css";

type Language = "ar" | "en";
type CoverageMode = "planned" | "actual";

export function HrAttendanceCoveragePanel({ coverage, language }: { coverage: AttendanceCoverage; language: Language }) {
  const ar = language === "ar";
  const [mode, setMode] = useState<CoverageMode>("planned");
  const bucketCount = (coverage.timelineEndMinute - coverage.timelineStartMinute) / coverage.intervalMinutes;
  const counts = coverage.days.map((day) => mode === "planned" ? day.plannedCounts : day.actualCounts);
  const maximum = Math.max(1, ...counts.flat());
  const summary = useMemo(() => {
    const totals = Array.from({ length: bucketCount }, (_, index) => counts.reduce((total, day) => total + day[index]!, 0));
    const peakIndex = totals.reduce((best, value, index) => value > totals[best]! ? index : best, 0);
    return { peak: Math.ceil(totals[peakIndex]! / coverage.days.length), startMinute: coverage.timelineStartMinute + peakIndex * coverage.intervalMinutes };
  }, [bucketCount, counts, coverage.days.length, coverage.intervalMinutes, coverage.timelineStartMinute]);
  const range = coverage.timelineEndMinute - coverage.timelineStartMinute;
  const position = (minute: number) => Math.max(0, Math.min(100, ((minute - coverage.timelineStartMinute) / range) * 100));
  const width = (startMinute: number, endMinute: number) => Math.max(.75, position(endMinute) - position(startMinute));

  return <BaseerCard className="hr-coverage" aria-label={ar ? "تغطية الدوام وأوقات الذروة" : "Work coverage and peak hours"}>
    <header className="hr-coverage__header">
      <div><span>{ar ? "تحليل تشغيلي" : "Operational analytics"}</span><h3>{ar ? "تغطية الدوام وأوقات الذروة" : "Work coverage & peak hours"}</h3><p>{ar ? "المخطط من الشفتات المعتمدة، والفعلي من الحضور والانصراف فقط؛ لا يوجد تتبع للموقع." : "Planned uses approved shifts; actual uses check-in/out only. No location tracking."}</p></div>
      <div className="hr-coverage__mode" aria-label={ar ? "نمط عرض التغطية" : "Coverage display mode"}>
        <BaseerButton type="button" variant="quiet" aria-pressed={mode === "planned"} onClick={() => setMode("planned")}>{ar ? "المخطط" : "Planned"}</BaseerButton>
        <BaseerButton type="button" variant="quiet" aria-pressed={mode === "actual"} onClick={() => setMode("actual")}>{ar ? "الفعلي" : "Actual"}</BaseerButton>
      </div>
    </header>
    <div className="hr-coverage__summary">
      <div><small>{ar ? "أعلى تغطية" : "Peak coverage"}</small><b>{summary.peak}</b><span>{ar ? `موظفين · ${formatAttendanceMinute(summary.startMinute)}` : `employees · ${formatAttendanceMinute(summary.startMinute)}`}</span></div>
      <div><small>{ar ? "فجوة تغطية" : "Coverage gap"}</small><b>{coverage.summary.gapStartMinute === null ? "—" : `${formatAttendanceMinute(coverage.summary.gapStartMinute)}–${formatAttendanceMinute(coverage.summary.gapEndMinute!)}`}</b><span>{ar ? "أطول فجوة ضمن يوم العمل" : "Longest gap within work hours"}</span></div>
      <div><small>{ar ? "الحضور الفعلي" : "Actual attendance"}</small><b>{coverage.summary.actualAttendancePercent}%</b><span>{ar ? "من الموظفين المجدولين اليوم" : "of scheduled employees today"}</span></div>
    </div>
    <section className="hr-coverage__heatmap-wrap" aria-label={ar ? "خريطة التغطية الأسبوعية" : "Weekly coverage heatmap"}>
      <div className="hr-coverage__heatmap" style={{ "--coverage-columns": bucketCount } as React.CSSProperties}>
        <div className="hr-coverage__corner">{ar ? "اليوم / الوقت" : "Day / time"}</div>
        <div className="hr-coverage__time-axis">{Array.from({ length: bucketCount }, (_, index) => <span key={index}>{index % 4 === 0 ? formatAttendanceMinute(coverage.timelineStartMinute + index * coverage.intervalMinutes) : ""}</span>)}</div>
        {coverage.days.map((day, dayIndex) => <div className="hr-coverage__heatmap-row" key={day.date}><strong>{attendanceIsoWeekdayName(day.dayOfWeek, language, !ar)}</strong><div>{counts[dayIndex]!.map((count, index) => <span key={index} title={`${attendanceIsoWeekdayName(day.dayOfWeek, language, !ar)} · ${formatAttendanceMinute(coverage.timelineStartMinute + index * coverage.intervalMinutes)} · ${count}`} style={{ "--coverage-intensity": count / maximum } as React.CSSProperties}>{count || ""}</span>)}</div></div>)}
      </div>
    </section>
    <section className="hr-coverage__timeline" aria-label={ar ? "الدوام الفعلي اليوم" : "Actual attendance today"}>
      <header><div><h4>{ar ? "الدوام الفعلي اليوم" : "Actual attendance today"}</h4><p>{ar ? "الشريط الأخضر = الحضور الفعلي، والإطار الفاتح = الدوام المخطط." : "Green is actual attendance; the light outline is the planned shift."}</p></div><span>{coverage.date}</span></header>
      <div className="hr-coverage__timeline-scroll"><div className="hr-coverage__timeline-grid" style={{ "--timeline-range": range } as React.CSSProperties}>
        <div className="hr-coverage__timeline-axis"><span />{Array.from({ length: Math.floor(range / 120) + 1 }, (_, index) => <span key={index}>{formatAttendanceMinute(coverage.timelineStartMinute + index * 120)}</span>)}</div>
        {coverage.timeline.map((employee) => <div className="hr-coverage__timeline-row" key={employee.employeeId}><strong>{employee.employeeNumber} · {ar ? employee.employeeNameAr : employee.employeeNameEn ?? employee.employeeNameAr}</strong><div className="hr-coverage__track">{employee.plannedPeriods.map((period, index) => <i className="is-planned" key={`p-${index}`} style={{ insetInlineStart: `${position(period.startMinute)}%`, inlineSize: `${width(period.startMinute, period.endMinute)}%` }} />)}{employee.actualPeriods.map((period, index) => <i className="is-actual" key={`a-${index}`} style={{ insetInlineStart: `${position(period.startMinute)}%`, inlineSize: `${width(period.startMinute, period.endMinute)}%` }} />)}</div></div>)}
      </div></div>
    </section>
  </BaseerCard>;
}

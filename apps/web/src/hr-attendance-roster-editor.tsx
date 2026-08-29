import { useEffect, useMemo, useRef, useState } from "react";
import interact from "interactjs";
import type { DragEvent as InteractDragEvent, ResizeEvent as InteractResizeEvent } from "@interactjs/types";
import { animate, motion } from "motion/react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerTimeInput } from "./baseer-form-fields";
import type { AttendanceRoster } from "./attendance-client";
import {
  MINUTES_PER_DAY,
  attendanceMinuteToTimelineMinute,
  attendanceTimeToTimelineMinute,
  attendanceWeekdayName,
  formatAttendanceMinute,
} from "./attendance-time-utils";
import "./hr-attendance-roster-editor.css";

type Language = "ar" | "en";
type ApprovalMode = "WEEK" | "TEMPORARY" | "PERMANENT";
type Period = { startMinute: number; endMinute: number; endsNextDay: boolean };
type Entry = { employeeId: string; businessDate: string; kind: "FULL_REST" | "CUSTOM_PERIODS"; periods: Period[] };
type PeakPeriod = { businessDate: string; startMinute: number; endMinute: number };
type Employee = AttendanceRoster["employees"][number];
type DragState = { employeeId: string; businessDate: string; periodIndex: number; mode: "move" | "start" | "end"; originX: number; originStart: number; originEnd: number; previewStart: number; previewEnd: number };

const timelineStart = 8 * 60;
const timelineEnd = 27 * 60;
const timelineHours = Array.from({ length: 19 }, (_, index) => timelineStart + index * 60);
const gridMinutes = 30;
const minDuration = 30;
const absolutePeriod = (period: Period) => ({ start: attendanceMinuteToTimelineMinute(period.startMinute, timelineStart), end: period.endsNextDay ? period.endMinute + MINUTES_PER_DAY : attendanceMinuteToTimelineMinute(period.endMinute, timelineStart) });
const storedPeriod = (start: number, end: number): Period => ({ startMinute: start % MINUTES_PER_DAY, endMinute: end % MINUTES_PER_DAY, endsNextDay: end >= MINUTES_PER_DAY });
const snap = (value: number) => Math.round(value / gridMinutes) * gridMinutes;
const asTimelineMinute = (value: string) => attendanceTimeToTimelineMinute(value, timelineStart);
const cloneEmployees = (employees: AttendanceRoster["employees"]) => employees.map((employee) => ({ ...employee, entries: employee.entries.map((entry) => ({ ...entry, periods: entry.periods.map((period) => ({ ...period })) })) }));

function updatePeriod(employees: Employee[], employeeId: string, businessDate: string, index: number, next: Period, targetEmployeeId = employeeId) {
  const nextEmployees = cloneEmployees(employees);
  const origin = nextEmployees.find((employee) => employee.employeeId === employeeId);
  const target = nextEmployees.find((employee) => employee.employeeId === targetEmployeeId);
  const originEntry = origin?.entries.find((entry) => entry.businessDate === businessDate);
  const targetEntry = target?.entries.find((entry) => entry.businessDate === businessDate);
  if (!originEntry || !targetEntry) return employees;
  if (targetEmployeeId === employeeId) {
    originEntry.kind = "CUSTOM_PERIODS";
    originEntry.periods[index] = next;
    originEntry.periods = normalizePeriods(originEntry.periods);
    return nextEmployees;
  }
  const [moving] = originEntry.periods.splice(index, 1);
  if (!moving || targetEntry.periods.length >= 4) return employees;
  targetEntry.kind = "CUSTOM_PERIODS";
  originEntry.periods = normalizePeriods(originEntry.periods);
  originEntry.kind = originEntry.periods.length ? "CUSTOM_PERIODS" : "FULL_REST";
  targetEntry.periods = normalizePeriods([...targetEntry.periods, next]);
  return nextEmployees;
}

/** Touching or overlapping periods represent one continuous work period. */
function normalizePeriods(periods: Period[]) {
  const ordered = periods.map((period) => absolutePeriod(period)).sort((left, right) => left.start - right.start);
  const merged = ordered.reduce<Array<{ start: number; end: number }>>((result, period) => {
    const previous = result.at(-1);
    if (previous && period.start <= previous.end) previous.end = Math.max(previous.end, period.end);
    else result.push({ ...period });
    return result;
  }, []);
  return merged.map((period) => storedPeriod(period.start, period.end));
}

function splitPeriod(employees: Employee[], employeeId: string, businessDate: string, index: number, cutAt: number) {
  const nextEmployees = cloneEmployees(employees);
  const entry = nextEmployees.find((employee) => employee.employeeId === employeeId)?.entries.find((item) => item.businessDate === businessDate);
  const period = entry?.periods[index];
  if (!entry || !period || entry.periods.length >= 4) return employees;
  const absolute = absolutePeriod(period);
  if (cutAt - absolute.start < minDuration || absolute.end - cutAt < minDuration) return employees;
  entry.kind = "CUSTOM_PERIODS";
  entry.periods.splice(index, 1, storedPeriod(absolute.start, cutAt), storedPeriod(cutAt, absolute.end));
  return nextEmployees;
}

function RosterHoursCounter({ minutes, language }: { minutes: number; language: Language }) {
  const [visibleMinutes, setVisibleMinutes] = useState(minutes);
  const previousMinutes = useRef(minutes);
  const initialized = useRef(false);

  useEffect(() => {
    const from = previousMinutes.current;
    previousMinutes.current = minutes;
    if (!initialized.current || from === minutes) {
      initialized.current = true;
      setVisibleMinutes(minutes);
      return;
    }
    const controls = animate(from, minutes, {
      duration: 0.26,
      ease: "easeOut",
      onUpdate: (value) => setVisibleMinutes(Math.round(value)),
    });
    return () => controls.stop();
  }, [minutes]);

  const hours = Math.floor(visibleMinutes / 60);
  const remainder = visibleMinutes % 60;
  return <span className="hr-roster__hours-counter"><strong dir="ltr">{remainder ? `${hours}:${String(remainder).padStart(2, "0")}` : hours}</strong><small>{language === "ar" ? "ساعة" : "hours"}</small></span>;
}

export function HrAttendanceRosterEditor({ roster, language, busy, onSave, onApprove }: {
  roster: AttendanceRoster;
  language: Language;
  busy?: boolean;
  onSave: (entries: Entry[], peakPeriods: PeakPeriod[], baseRevision?: number) => Promise<void>;
  onApprove: (mode: ApprovalMode, baseRevision: number, effectiveFrom: string, temporaryDays?: 7 | 10) => Promise<void>;
}) {
  const ar = language === "ar";
  const [employees, setEmployees] = useState(() => cloneEmployees(roster.employees));
  const [peakPeriods, setPeakPeriods] = useState<PeakPeriod[]>(() =>
    (roster.peakPeriods ?? []).map((period) => ({ ...period })),
  );
  const [dayIndex, setDayIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rosterTableRef = useRef<HTMLDivElement>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingDrag = useRef<DragState | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("WEEK");
  const [temporaryDays, setTemporaryDays] = useState<7 | 10>(7);
  const [effectiveFrom, setEffectiveFrom] = useState(roster.weekStart);
  const selectedDate = roster.days[dayIndex]!;
  const entries = useMemo(() => employees.flatMap((employee) => employee.entries.map((entry) => ({ employeeId: employee.employeeId, businessDate: entry.businessDate, kind: entry.kind, periods: entry.periods }))), [employees]);

  useEffect(() => { setEmployees(cloneEmployees(roster.employees)); setPeakPeriods((roster.peakPeriods ?? []).map((period) => ({ ...period }))); setDirty(false); setEffectiveFrom(roster.weekStart); }, [roster]);
  useEffect(() => () => { if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current); }, []);

  const boundsFor = (activeDrag: DragState, clientX: number, width: number) => {
    const delta = snap(((clientX - activeDrag.originX) / width) * (timelineEnd - timelineStart));
    let start = activeDrag.originStart; let end = activeDrag.originEnd;
    if (activeDrag.mode === "move") { start = Math.max(timelineStart, Math.min(timelineEnd - (activeDrag.originEnd - activeDrag.originStart), activeDrag.originStart + delta)); end = start + (activeDrag.originEnd - activeDrag.originStart); }
    if (activeDrag.mode === "start") start = Math.max(timelineStart, Math.min(activeDrag.originEnd - minDuration, activeDrag.originStart + delta));
    if (activeDrag.mode === "end") end = Math.min(timelineEnd, Math.max(activeDrag.originStart + minDuration, activeDrag.originEnd + delta));
    return { start, end };
  };

  const begin = (employeeId: string, periodIndex: number, period: Period, mode: DragState["mode"], originX: number) => {
    if (busy) return;
    const absolute = absolutePeriod(period);
    const nextDrag = { employeeId, businessDate: selectedDate, periodIndex, mode, originX, originStart: absolute.start, originEnd: absolute.end, previewStart: absolute.start, previewEnd: absolute.end };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };
  const move = (clientX: number, width: number) => {
    const activeDrag = dragRef.current;
    if (!activeDrag) return;
    const { start, end } = boundsFor(activeDrag, clientX, width);
    pendingDrag.current = { ...activeDrag, previewStart: start, previewEnd: end };
    if (dragFrame.current !== null) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      if (pendingDrag.current) {
        dragRef.current = pendingDrag.current;
        setDrag(pendingDrag.current);
      }
    });
  };
  const end = (clientX: number, clientY: number, width: number) => {
    const activeDrag = dragRef.current;
    if (!activeDrag) return;
    const over = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-roster-employee]")?.dataset.rosterEmployee;
    const { start, end } = boundsFor(activeDrag, clientX, width);
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null; pendingDrag.current = null;
    setEmployees((current) => updatePeriod(current, activeDrag.employeeId, activeDrag.businessDate, activeDrag.periodIndex, storedPeriod(start, end), over || activeDrag.employeeId));
    setDirty(true);
    dragRef.current = null;
    setDrag(null);
  };
  const split = (event: React.MouseEvent<HTMLDivElement>, employeeId: string, periodIndex: number, period: Period) => {
    if (busy || drag) return;
    event.preventDefault(); event.stopPropagation();
    const absolute = absolutePeriod(period);
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const cutAt = snap(absolute.start + (absolute.end - absolute.start) * position);
    setEmployees((current) => splitPeriod(current, employeeId, selectedDate, periodIndex, cutAt));
    setDirty(true);
  };
  useEffect(() => {
    const table = rosterTableRef.current;
    if (!table || busy) return;

    const interactions = Array.from(table.querySelectorAll<HTMLElement>("[data-roster-bar]")).map((bar) => {
      const employeeId = bar.dataset.rosterEmployee;
      const periodIndex = Number(bar.dataset.rosterPeriodIndex);
      const startMinute = Number(bar.dataset.rosterStart);
      const endMinute = Number(bar.dataset.rosterEnd);
      const endsNextDay = bar.dataset.rosterEndsNextDay === "true";
      const track = bar.closest<HTMLElement>(".hr-roster__track");
      if (!employeeId || !Number.isInteger(periodIndex) || !track) return null;

      const period: Period = { startMinute, endMinute, endsNextDay };
      const width = () => track.getBoundingClientRect().width;
      const start = (mode: DragState["mode"], event: InteractDragEvent | InteractResizeEvent) => {
        event.preventDefault();
        begin(employeeId, periodIndex, period, mode, event.clientX);
      };
      const preview = (event: InteractDragEvent | InteractResizeEvent) => move(event.clientX, width());
      const commit = (event: InteractDragEvent | InteractResizeEvent) => end(event.clientX, event.clientY, width());

      return interact(bar)
        .draggable({
          enabled: true,
          inertia: false,
          ignoreFrom: ".hr-roster__handle",
          modifiers: [interact.modifiers.restrictRect({ restriction: "parent", endOnly: true })],
          listeners: { start: (event) => start("move", event), move: preview, end: commit },
        })
        .resizable({
          enabled: true,
          edges: { left: ".hr-roster__handle.is-start", right: ".hr-roster__handle.is-end", top: false, bottom: false },
          inertia: false,
          modifiers: [interact.modifiers.restrictEdges({ outer: "parent", endOnly: true })],
          listeners: {
            start: (event) => start(event.edges.left ? "start" : "end", event),
            move: preview,
            end: commit,
          },
        });
    }).filter((interaction): interaction is NonNullable<typeof interaction> => interaction !== null);

    return () => interactions.forEach((interaction) => interaction.unset());
  }, [busy, employees, selectedDate]);
  const selectedPeakPeriods = peakPeriods.filter((period) => period.businessDate === selectedDate);
  const hourlyCoverage = timelineHours.map((minute) => ({
    minute,
    count: employees.filter((employee) => {
      const entry = employee.entries.find((item) => item.businessDate === selectedDate);
      return entry?.periods.some((period) => {
        const absolute = absolutePeriod(period);
        return absolute.start < minute + 60 && absolute.end > minute;
      });
    }).length,
    isPeak: selectedPeakPeriods.some((period) => period.startMinute < minute + 60 && period.endMinute > minute),
  }));
  const changePeak = (index: number, field: "startMinute" | "endMinute", value: string) => { setPeakPeriods((current) => current.map((period, currentIndex) => currentIndex === index ? { ...period, [field]: asTimelineMinute(value) } : period)); setDirty(true); };
  const addPeak = () => {
    if (selectedPeakPeriods.length >= 4) return;
    const sorted = [...selectedPeakPeriods].sort((left, right) => left.startMinute - right.startMinute);
    const start = Array.from({ length: Math.floor((timelineEnd - timelineStart) / 60) }, (_, index) => timelineStart + index * 60).find((candidate) => !sorted.some((period) => candidate < period.endMinute && candidate + 60 > period.startMinute));
    if (start === undefined) return;
    setPeakPeriods((current) => [...current, { businessDate: selectedDate, startMinute: start, endMinute: start + 60 }]); setDirty(true);
  };
  const removePeak = (index: number) => { setPeakPeriods((current) => current.filter((_, currentIndex) => currentIndex !== index)); setDirty(true); };
  const save = async () => { await onSave(entries, peakPeriods, roster.plan?.revision); setDirty(false); };
  const submitApproval = async (event: React.FormEvent) => { event.preventDefault(); if (!roster.plan) return; await onApprove(approvalMode, roster.plan.revision, effectiveFrom, approvalMode === "TEMPORARY" ? temporaryDays : undefined); setApproveOpen(false); };
  const hoursFor = (entry: Entry) => entry.periods.reduce((total, period) => { const value = absolutePeriod(period); return total + value.end - value.start; }, 0);
  const visibleHoursFor = (employeeId: string, entry: Entry) => {
    if (!drag || drag.employeeId !== employeeId || drag.businessDate !== entry.businessDate) return hoursFor(entry);
    return hoursFor({ ...entry, periods: entry.periods.map((period, index) => index === drag.periodIndex ? storedPeriod(drag.previewStart, drag.previewEnd) : period) });
  };

  return <BaseerCard className="hr-roster">
    <header className="hr-roster__header"><div><span>{ar ? "تخطيط تشغيلي" : "Operational planning"}</span><h3>{ar ? "محرر جدول الدوام" : "Work roster editor"}</h3><p>{ar ? "اسحب الشريط لتغيير الوقت أو نقله لموظف آخر؛ وعند تلامس فترتين تندمجان. انقر نقراً مزدوجاً فوق الشريط لقصه. كل التغييرات مسودة حتى الاعتماد." : "Drag a bar to adjust or move it; touching periods merge automatically. Double click a bar to split it. Changes stay draft until approved."}</p></div><div className="hr-roster__actions"><BaseerButton type="button" variant="secondary" disabled={!dirty || busy} onClick={() => void save()}>{ar ? "حفظ المسودة" : "Save draft"}</BaseerButton><BaseerButton type="button" disabled={!roster.plan || dirty || busy} onClick={() => setApproveOpen(true)}>{ar ? "اعتماد الجدول" : "Approve roster"}</BaseerButton></div></header>
    <div className="hr-roster__status"><span className={dirty ? "is-draft" : undefined}>{dirty ? (ar ? "تغييرات غير محفوظة" : "Unsaved changes") : roster.plan ? (ar ? `مسودة محفوظة · إصدار ${roster.plan.revision}` : `Saved draft · revision ${roster.plan.revision}`) : (ar ? "لم تُنشأ مسودة بعد" : "No draft yet")}</span><small>{ar ? "السجل الفعلي والرواتب لا يتغيران هنا." : "Actual attendance and payroll never change here."}</small></div>
    <div className="hr-roster__days" role="tablist" aria-label={ar ? "أيام جدول الدوام" : "Roster days"}>{roster.days.map((date, index) => <BaseerButton key={date} type="button" variant={dayIndex === index ? "primary" : "quiet"} aria-selected={dayIndex === index} role="tab" onClick={() => setDayIndex(index)}>{attendanceWeekdayName(index, language, !ar)}<small dir="ltr">{date.slice(5)}</small></BaseerButton>)}</div>
    <section className="hr-roster__peak-editor"><div><span>{ar ? "تغطية مطلوبة" : "Required coverage"}</span><h4>{ar ? `أوقات الذروة · ${attendanceWeekdayName(dayIndex, language)}` : `Peak periods · ${attendanceWeekdayName(dayIndex, language, true)}`}</h4><p>{ar ? "تظهر باللون الأحمر الخفيف في الشبكة. لا تعدّل الحضور أو الرواتب." : "They appear as a soft red band in the grid and never change attendance or payroll."}</p></div><div className="hr-roster__peak-periods">{selectedPeakPeriods.map((period) => { const index = peakPeriods.indexOf(period); return <div className="hr-roster__peak-period" key={`${period.businessDate}-${period.startMinute}-${period.endMinute}-${index}`}><BaseerTimeInput aria-label={ar ? "بداية الذروة" : "Peak start"} value={formatAttendanceMinute(period.startMinute)} onChange={(event) => changePeak(index, "startMinute", event.target.value)} /><span>—</span><BaseerTimeInput aria-label={ar ? "نهاية الذروة" : "Peak end"} value={formatAttendanceMinute(period.endMinute)} onChange={(event) => changePeak(index, "endMinute", event.target.value)} /><BaseerButton type="button" variant="quiet" aria-label={ar ? "حذف فترة الذروة" : "Remove peak period"} onClick={() => removePeak(index)}>×</BaseerButton></div>; })}<BaseerButton type="button" variant="secondary" disabled={selectedPeakPeriods.length >= 4 || busy} onClick={addPeak}>{ar ? "+ إضافة فترة ذروة" : "+ Add peak period"}</BaseerButton></div></section>
    <div className="hr-roster__scroll">
      <div className="hr-roster__table" ref={rosterTableRef}>
        <div className="hr-roster__axis">
          <span>{ar ? "الموظف" : "Employee"}</span>
          <div>{timelineHours.map((minute) => <i key={minute} dir="ltr">{formatAttendanceMinute(minute)}</i>)}<i className="hr-roster__axis-end" dir="ltr">{formatAttendanceMinute(timelineEnd)}</i></div>
          <b>{ar ? "إجمالي" : "Total"}</b>
        </div>
        <div className="hr-roster__coverage">
          <span><b>{ar ? "التغطية المخططة" : "Planned coverage"}</b><small>{ar ? "موظفون في الساعة" : "Staff per hour"}</small></span>
          <div>{hourlyCoverage.map(({ minute, count, isPeak }) => <b key={minute} className={isPeak ? "is-peak" : undefined} dir="ltr" aria-label={ar ? `${count} موظف مجدول بين ${formatAttendanceMinute(minute)} و${formatAttendanceMinute(minute + 60)}` : `${count} scheduled staff from ${formatAttendanceMinute(minute)} to ${formatAttendanceMinute(minute + 60)}`}>{count}</b>)}</div>
          <small>{ar ? "موظف" : "staff"}</small>
        </div>
        {employees.map((employee) => {
          const entry = employee.entries.find((item) => item.businessDate === selectedDate)!;
          return <div className={`hr-roster__row${entry.kind === "FULL_REST" ? " is-rest" : ""}`} key={employee.employeeId} data-roster-employee={employee.employeeId}>
            <strong><span>{employee.employeeNumber}</span>{ar ? employee.employeeNameAr : employee.employeeNameEn ?? employee.employeeNameAr}</strong>
            <div className="hr-roster__track">
              {selectedPeakPeriods.map((period) => {
                const start = ((period.startMinute - timelineStart) / (timelineEnd - timelineStart)) * 100;
                const width = ((period.endMinute - period.startMinute) / (timelineEnd - timelineStart)) * 100;
                return <span key={`${period.startMinute}-${period.endMinute}`} className="hr-roster__peak-band" aria-label={ar ? `ذروة ${formatAttendanceMinute(period.startMinute)} إلى ${formatAttendanceMinute(period.endMinute)}` : `Peak ${formatAttendanceMinute(period.startMinute)} to ${formatAttendanceMinute(period.endMinute)}`} style={{ insetInlineStart: `${start}%`, inlineSize: `${width}%` }} />;
              })}
              {entry.periods.map((period, index) => {
                const absolute = absolutePeriod(period);
                const isDragging = drag?.employeeId === employee.employeeId && drag.businessDate === selectedDate && drag.periodIndex === index;
                const preview = isDragging ? { start: drag.previewStart, end: drag.previewEnd } : absolute;
                const start = ((preview.start - timelineStart) / (timelineEnd - timelineStart)) * 100;
                const width = ((preview.end - preview.start) / (timelineEnd - timelineStart)) * 100;
                return <motion.div
                  layout
                  transition={isDragging ? { duration: 0 } : { type: "spring", stiffness: 560, damping: 42, mass: 0.55 }}
                  className={`hr-roster__bar${isDragging ? " is-dragging" : ""}`}
                  key={`${index}-${period.startMinute}-${period.endMinute}`}
                  data-roster-bar
                  data-roster-employee={employee.employeeId}
                  data-roster-period-index={index}
                  data-roster-start={period.startMinute}
                  data-roster-end={period.endMinute}
                  data-roster-ends-next-day={period.endsNextDay}
                  style={{ insetInlineStart: `${start}%`, inlineSize: `${width}%` }}
                  onDoubleClick={(event) => split(event, employee.employeeId, index, period)}
                  role="button"
                  tabIndex={0}
                  aria-label={ar ? `دوام ${formatAttendanceMinute(preview.start)} إلى ${formatAttendanceMinute(preview.end)}. انقر نقراً مزدوجاً لتقسيم الفترة` : `Work period ${formatAttendanceMinute(preview.start)} to ${formatAttendanceMinute(preview.end)}. Double click to split`}
                >
                  <button type="button" className="hr-roster__handle is-start" aria-label={ar ? "تغيير بداية الدوام" : "Resize start"} />
                  <span dir="ltr">{formatAttendanceMinute(preview.start)}–{formatAttendanceMinute(preview.end)}</span>
                  <button type="button" className="hr-roster__handle is-end" aria-label={ar ? "تغيير نهاية الدوام" : "Resize end"} />
                </motion.div>;
              })}
              {entry.kind === "FULL_REST" ? <div className="hr-roster__rest"><span>{ar ? "راحة" : "Rest"}</span><small>{ar ? "لا ساعات مجدولة" : "No scheduled hours"}</small></div> : null}
            </div>
            <b><RosterHoursCounter minutes={visibleHoursFor(employee.employeeId, entry)} language={language} /></b>
          </div>;
        })}
      </div>
    </div>
    <p className="hr-roster__grid-key"><span>{ar ? "كل عمود = ساعة" : "Each column = one hour"}</span><span>{ar ? "الخط الأخف = 30 دقيقة" : "Fine line = 30 minutes"}</span><span>{ar ? "الراحة لا تحتوي ساعات مجدولة" : "Rest has no scheduled hours"}</span><span>{ar ? "الأرقام = الموظفون المجدولون، والأحمر ضمن الذروة" : "Numbers show planned staff; red marks peak coverage"}</span><span>{ar ? "التلامس يدمج الفترات · النقر المزدوج يقصها" : "Touching bars merge · double click splits"}</span></p>
    <BaseerFormDialog open={approveOpen} title={ar ? "اعتماد جدول الدوام" : "Approve work roster"} language={language} formId="attendance-roster-approval" submitLabel={ar ? "تأكيد الاعتماد" : "Confirm approval"} onClose={() => setApproveOpen(false)} busy={busy} size="compact"><form id="attendance-roster-approval" className="baseer-form" onSubmit={submitApproval}><p>{ar ? "اختر أثر هذا الجدول. لا يمكن تغيير الحضور الفعلي أو الرواتب من هذه العملية." : "Choose the effect of this roster. This action cannot change actual attendance or payroll."}</p><div className="hr-roster__approval-modes"><BaseerButton type="button" variant={approvalMode === "WEEK" ? "primary" : "secondary"} onClick={() => setApprovalMode("WEEK")}>{ar ? "لهذا الأسبوع" : "This week"}</BaseerButton><BaseerButton type="button" variant={approvalMode === "TEMPORARY" ? "primary" : "secondary"} onClick={() => setApprovalMode("TEMPORARY")}>{ar ? "اعتماد مؤقت" : "Temporary"}</BaseerButton><BaseerButton type="button" variant={approvalMode === "PERMANENT" ? "primary" : "secondary"} onClick={() => setApprovalMode("PERMANENT")}>{ar ? "اعتماد دائم" : "Permanent"}</BaseerButton></div><BaseerDatePicker language={language} label={ar ? "يبدأ من" : "Effective from"} value={effectiveFrom} onChange={setEffectiveFrom} />{approvalMode === "TEMPORARY" ? <div className="hr-roster__approval-modes"><BaseerButton type="button" variant={temporaryDays === 7 ? "primary" : "secondary"} onClick={() => setTemporaryDays(7)}>{ar ? "7 أيام" : "7 days"}</BaseerButton><BaseerButton type="button" variant={temporaryDays === 10 ? "primary" : "secondary"} onClick={() => setTemporaryDays(10)}>{ar ? "10 أيام" : "10 days"}</BaseerButton></div> : null}<p className="hr-roster__approval-note">{approvalMode === "WEEK" ? (ar ? "يعتمد الجدول للتواريخ السبعة فقط." : "Applies only to these seven dates.") : approvalMode === "TEMPORARY" ? (ar ? "يعود الموظف تلقائيًا لدوامه السابق بعد انتهاء المدة." : "Employees return automatically to their prior schedule after the duration.") : (ar ? "ينشئ قاعدة دوام مستقبلية ظاهرة في ملف الموظف." : "Creates a future schedule rule shown in the employee file.")}</p></form></BaseerFormDialog>
  </BaseerCard>;
}

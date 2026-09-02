import { useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerCheckbox, BaseerTextInput, BaseerTimeInput } from "./baseer-form-fields";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerNotice } from "./baseer-workspace";
import {
  attendanceIntervalMinutes,
  attendanceWeekdayName,
  formatAttendanceDuration,
  parseAttendanceTime,
} from "./attendance-time-utils";
import { riyadhBusinessDate } from "./number-format";
import "./hr-attendance-schedules-panel.css";

export type AttendanceScheduleInterval = {
  id: string;
  start: string;
  end: string;
};

export type AttendanceScheduleDay = {
  day: number;
  intervals: AttendanceScheduleInterval[];
};

export type AttendanceScheduleTemplate = {
  id: string;
  nameAr: string;
  nameEn?: string | null;
  status: "ACTIVE" | "ARCHIVED";
  days: AttendanceScheduleDay[];
  /** The aggregate is optional until it is supplied by the attendance API. */
  assignedEmployees?: number;
  effectiveFrom?: string | null;
  version?: number;
};

export type AttendanceScheduleEmployee = { id: string; employeeNumber: string; nameAr: string; nameEn?: string | null };

export type AttendanceScheduleDraft = {
  nameAr: string;
  nameEn: string;
  days: AttendanceScheduleDay[];
};

type Language = "ar" | "en";

type Props = {
  language: Language;
  schedules: AttendanceScheduleTemplate[];
  busy?: boolean;
  onCreate?: (draft: AttendanceScheduleDraft) => Promise<void> | void;
  onUpdate?: (scheduleId: string, draft: AttendanceScheduleDraft) => Promise<void> | void;
  onArchive?: (schedule: AttendanceScheduleTemplate) => Promise<void> | void;
  employees?: AttendanceScheduleEmployee[];
  assignedEmployeeIdsByTemplate?: Record<string, string[]>;
  onAssignEmployees?: (template: AttendanceScheduleTemplate, employeeIds: string[], effectiveFrom: string) => Promise<void> | void;
};

const interval = (id: string): AttendanceScheduleInterval => ({ id, start: "", end: "" });
const blankDays = (): AttendanceScheduleDay[] => Array.from({ length: 7 }, (_, day) => ({ day, intervals: [] }));
const blankDraft = (): AttendanceScheduleDraft => ({ nameAr: "", nameEn: "", days: blankDays() });
const defaultWorkDays = [0, 1, 2, 3, 4];

type QuickPreset = "continuous" | "split" | "overnight" | "half";

const quickPresets: Record<QuickPreset, { nameAr: string; nameEn: string; intervals: Array<Pick<AttendanceScheduleInterval, "start" | "end">> }> = {
  continuous: { nameAr: "دوام متصل", nameEn: "Continuous shift", intervals: [{ start: "09:00", end: "17:00" }] },
  split: { nameAr: "دوام مقسم", nameEn: "Split shift", intervals: [{ start: "10:00", end: "15:30" }, { start: "20:00", end: "01:00" }] },
  overnight: { nameAr: "دوام ليلي", nameEn: "Overnight shift", intervals: [{ start: "15:00", end: "03:00" }] },
  half: { nameAr: "نصف يوم", nameEn: "Half day", intervals: [{ start: "09:00", end: "13:00" }] },
};

function cloneDays(days: AttendanceScheduleDay[]) {
  return Array.from({ length: 7 }, (_, day) => {
    const current = days.find((item) => item.day === day);
    return { day, intervals: current?.intervals.map((item) => ({ ...item })) ?? [] };
  });
}

function equalIntervals(left: AttendanceScheduleInterval[], right: AttendanceScheduleInterval[]) {
  return left.length === right.length && left.every((item, index) => item.start === right[index]?.start && item.end === right[index]?.end);
}

function canUseSimpleEditor(days: AttendanceScheduleDay[]) {
  const configured = days.filter((day) => day.intervals.length > 0);
  return !configured.length || configured.every((day) => equalIntervals(day.intervals, configured[0]!.intervals));
}

function withSharedIntervals(days: AttendanceScheduleDay[], workDays: number[], source: AttendanceScheduleInterval[]) {
  return days.map((day) => ({
    day: day.day,
    intervals: workDays.includes(day.day)
      ? source.map((item, index) => ({ id: `${day.day}-${index}`, start: item.start, end: item.end }))
      : [],
  }));
}

function intervalMinutes(item: AttendanceScheduleInterval) {
  if (!item.start || !item.end || item.start === item.end) return 0;
  return attendanceIntervalMinutes(parseAttendanceTime(item.start), parseAttendanceTime(item.end));
}

function scheduleHours(days: AttendanceScheduleDay[]) {
  return days.reduce((sum, day) => sum + day.intervals.reduce((daySum, item) => daySum + intervalMinutes(item), 0), 0);
}

function schedulePreview(days: AttendanceScheduleDay[], language: Language) {
  const workDays = days.filter((day) => day.intervals.length > 0);
  if (!workDays.length) return language === "ar" ? "لم تحدد فترات عمل بعد" : "No work periods configured";
  const parts = workDays.slice(0, 2).map((day) => {
    const labels = day.intervals.filter((item) => item.start && item.end).map((item) => `${item.start}–${item.end}`).join(" · ");
    return `${attendanceWeekdayName(day.day, language)}: ${labels || "—"}`;
  });
  return `${parts.join("  /  ")}${workDays.length > 2 ? " …" : ""}`;
}

export function HrAttendanceSchedulesPanel({ language, schedules, busy = false, onCreate, onUpdate, onArchive, employees = [], assignedEmployeeIdsByTemplate = {}, onAssignEmployees }: Props) {
  const ar = language === "ar";
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceScheduleTemplate | null>(null);
  const [draft, setDraft] = useState<AttendanceScheduleDraft>(blankDraft);
  const [advancedEditor, setAdvancedEditor] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentTemplate, setAssignmentTemplate] = useState<AttendanceScheduleTemplate | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [assignmentEffectiveFrom, setAssignmentEffectiveFrom] = useState(riyadhBusinessDate);
  const [previewDay, setPreviewDay] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [simplifyConfirmationOpen, setSimplifyConfirmationOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AttendanceScheduleTemplate | null>(null);
  const activeSchedules = useMemo(() => schedules.filter((schedule) => schedule.status === "ACTIVE"), [schedules]);
  const archiveSchedules = useMemo(() => schedules.filter((schedule) => schedule.status === "ARCHIVED"), [schedules]);
  const totalAssigned = useMemo(
    () => activeSchedules.reduce((sum, schedule) => sum + (assignedEmployeeIdsByTemplate[schedule.id]?.length ?? schedule.assignedEmployees ?? 0), 0),
    [activeSchedules, assignedEmployeeIdsByTemplate],
  );

  const openCreate = () => {
    setEditing(null);
    const preset = quickPresets.continuous;
    setDraft({
      nameAr: preset.nameAr,
      nameEn: preset.nameEn,
      days: withSharedIntervals(blankDays(), defaultWorkDays, preset.intervals.map((item, index) => ({ ...item, id: `shared-${index}` }))),
    });
    setAdvancedEditor(false);
    setPreviewDay(defaultWorkDays[0]!);
    setError(null);
    setEditorOpen(true);
  };

  const openEdit = (schedule: AttendanceScheduleTemplate) => {
    setEditing(schedule);
    setDraft({ nameAr: schedule.nameAr, nameEn: schedule.nameEn ?? "", days: cloneDays(schedule.days) });
    setAdvancedEditor(!canUseSimpleEditor(schedule.days));
    setPreviewDay(schedule.days.find((day) => day.intervals.length > 0)?.day ?? 0);
    setError(null);
    setEditorOpen(true);
  };

  const changeDay = (dayIndex: number, transform: (day: AttendanceScheduleDay) => AttendanceScheduleDay) => {
    setDraft((current) => ({ ...current, days: current.days.map((day) => day.day === dayIndex ? transform(day) : day) }));
  };

  const activeWorkDays = draft.days.filter((day) => day.intervals.length > 0).map((day) => day.day);
  const sharedIntervals = draft.days.find((day) => day.intervals.length > 0)?.intervals ?? [interval("shared-0")];
  const sharedDailyMinutes = sharedIntervals.reduce((sum, item) => sum + intervalMinutes(item), 0);

  const applySimpleSchedule = (workDays: number[], periods: AttendanceScheduleInterval[]) => {
    setDraft((current) => ({ ...current, days: withSharedIntervals(current.days, workDays, periods) }));
  };

  const toggleSimpleWorkDay = (day: number, checked: boolean) => {
    const workDays = checked ? [...activeWorkDays, day].sort((left, right) => left - right) : activeWorkDays.filter((item) => item !== day);
    applySimpleSchedule(workDays, sharedIntervals);
    if (checked) setPreviewDay(day);
  };

  const applyPreset = (presetKey: QuickPreset) => {
    const preset = quickPresets[presetKey];
    const periods = preset.intervals.map((item, index) => ({ ...item, id: `shared-${index}` }));
    setDraft((current) => ({
      nameAr: current.nameAr === "" || Object.values(quickPresets).some((item) => item.nameAr === current.nameAr) ? preset.nameAr : current.nameAr,
      nameEn: current.nameEn === "" || Object.values(quickPresets).some((item) => item.nameEn === current.nameEn) ? preset.nameEn : current.nameEn,
      days: withSharedIntervals(current.days, activeWorkDays.length ? activeWorkDays : defaultWorkDays, periods),
    }));
    setPreviewDay((activeWorkDays[0] ?? defaultWorkDays[0])!);
  };

  const returnToSimpleEditor = () => {
    if (canUseSimpleEditor(draft.days)) {
      setAdvancedEditor(false);
      return;
    }

    const workDays = draft.days.filter((day) => day.intervals.length > 0).map((day) => day.day);
    const source = draft.days.find((day) => day.intervals.length > 0)?.intervals ?? [];
    // The actual change is confirmed in the shared accessible dialog below.
    // Do not rely on window.confirm: it is unreliable in installed/mobile PWA
    // contexts and bypasses the application's focus handling.
    if (workDays.length && source.length) setSimplifyConfirmationOpen(true);
  };

  const confirmReturnToSimpleEditor = () => {
    const workDays = draft.days.filter((day) => day.intervals.length > 0).map((day) => day.day);
    const source = draft.days.find((day) => day.intervals.length > 0)?.intervals ?? [];
    setDraft((current) => ({ ...current, days: withSharedIntervals(current.days, workDays, source) }));
    setPreviewDay(workDays[0] ?? 0);
    setAdvancedEditor(false);
    setSimplifyConfirmationOpen(false);
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const populated = draft.days.flatMap((day) => day.intervals.map((item) => ({ day: day.day, item }))).filter(({ item }) => item.start || item.end);
    if (!draft.nameAr.trim()) { setError(ar ? "أدخل اسم القالب بالعربية." : "Enter the Arabic template name."); return; }
    if (!populated.length || populated.some(({ item }) => !item.start || !item.end || item.start === item.end)) { setError(ar ? "أدخل بداية ونهاية صحيحتين لكل فترة عمل." : "Enter a valid start and end for every work period."); return; }
    setError(null);
    const cleanDraft: AttendanceScheduleDraft = { ...draft, nameAr: draft.nameAr.trim(), nameEn: draft.nameEn.trim(), days: cloneDays(draft.days) };
    try {
      if (editing) await onUpdate?.(editing.id, cleanDraft);
      else await onCreate?.(cleanDraft);
      setEditorOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (ar ? "تعذر حفظ قالب الدوام." : "The work template could not be saved."));
    }
  };

  const archive = async () => {
    const schedule = archiveTarget;
    if (!onArchive || busy) return;
    if (!schedule) return;
    try {
      await onArchive(schedule);
      setArchiveTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (ar ? "تعذرت أرشفة قالب الدوام." : "The work template could not be archived."));
    }
  };

  const openAssignment = (schedule: AttendanceScheduleTemplate) => {
    setAssignmentTemplate(schedule);
    setSelectedEmployeeIds([]);
    setAssignmentEffectiveFrom(riyadhBusinessDate());
    setError(null);
    setAssignmentOpen(true);
  };

  const saveAssignments = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assignmentTemplate || !selectedEmployeeIds.length) { setError(ar ? "اختر موظفاً واحداً على الأقل." : "Choose at least one employee."); return; }
    setError(null);
    try {
      await onAssignEmployees?.(assignmentTemplate, selectedEmployeeIds, assignmentEffectiveFrom);
      setAssignmentOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (ar ? "تعذر ربط الموظفين بالشفت." : "Employees could not be assigned to the shift."));
    }
  };

  const renderSchedule = (schedule: AttendanceScheduleTemplate) => {
    const duration = scheduleHours(schedule.days);
    const assignedIds = assignedEmployeeIdsByTemplate[schedule.id] ?? [];
    const hasOvernight = schedule.days.some((day) => day.intervals.some((item) => item.start && item.end && item.end < item.start));
    return <BaseerCard key={schedule.id} className="hr-schedules__template" padding="compact">
      <div className="hr-schedules__template-head">
        <div>
          <span className="hr-schedules__eyebrow">{schedule.version ? (ar ? `الإصدار ${schedule.version}` : `Version ${schedule.version}`) : (ar ? "قالب دوام" : "Work template")}</span>
          <h3>{ar ? schedule.nameAr : schedule.nameEn || schedule.nameAr}</h3>
        </div>
        <span className={schedule.status === "ACTIVE" ? "hr-schedules__status hr-schedules__status--active" : "hr-schedules__status"}>{schedule.status === "ACTIVE" ? (ar ? "نشط" : "Active") : (ar ? "مؤرشف" : "Archived")}</span>
      </div>
      <p className="hr-schedules__template-preview">{schedulePreview(schedule.days, language)}</p>
      <div className="hr-schedules__metrics">
        <span><b>{formatAttendanceDuration(duration, language)}</b><small>{ar ? "ساعات أسبوعية" : "weekly hours"}</small></span>
        <span><b>{assignedIds.length || schedule.assignedEmployees || 0}</b><small>{ar ? "موظف مرتبط" : "assigned employees"}</small></span>
        <span><b>{schedule.days.filter((day) => day.intervals.length > 0).length}</b><small>{ar ? "أيام عمل" : "work days"}</small></span>
      </div>
      {hasOvernight ? <p className="hr-schedules__overnight">{ar ? "يتضمن وردية تعبر منتصف الليل" : "Includes an overnight work period"}</p> : null}
      <div className="hr-schedules__template-actions">
        {onAssignEmployees ? <BaseerButton type="button" variant="secondary" onClick={() => openAssignment(schedule)} disabled={busy}>{ar ? "ربط موظفين" : "Assign employees"}</BaseerButton> : null}
        <BaseerButton type="button" variant="quiet" onClick={() => openEdit(schedule)} disabled={busy}>{ar ? "تعديل" : "Edit"}</BaseerButton>
        {schedule.status === "ACTIVE" ? <BaseerButton type="button" variant="quiet" onClick={() => { setError(null); setArchiveTarget(schedule); }} disabled={busy}>{ar ? "أرشفة" : "Archive"}</BaseerButton> : null}
      </div>
    </BaseerCard>;
  };

  const dailyPreview = draft.days.find((day) => day.day === previewDay) ?? draft.days[0];
  const dailyMinutes = dailyPreview.intervals.reduce((sum, item) => sum + intervalMinutes(item), 0);
  const assignedToOpenTemplate = assignmentTemplate ? new Set(assignedEmployeeIdsByTemplate[assignmentTemplate.id] ?? []) : new Set<string>();
  const unassignedEmployees = employees.filter((employee) => !assignedToOpenTemplate.has(employee.id));

  return <section className="hr-schedules" aria-labelledby="attendance-schedules-heading">
    <header className="hr-schedules__header">
      <div>
        <span className="hr-schedules__eyebrow">{ar ? "إعدادات الحضور · قوالب الدوام" : "Attendance settings · work templates"}</span>
        <h2 id="attendance-schedules-heading">{ar ? "قوالب الدوام" : "Work schedule templates"}</h2>
        <p>{ar ? "القالب يحدد فترات العمل المتكررة فقط. يوم الراحة ونصف الدوام يحددان لكل موظف من ملفه الشخصي." : "Templates define recurring work periods. Each employee’s rest day and half day are managed in their profile."}</p>
      </div>
      <BaseerButton type="button" onClick={openCreate} disabled={busy}>{ar ? "إضافة قالب دوام" : "Add work template"}</BaseerButton>
    </header>

    <div className="hr-schedules__summary" aria-label={ar ? "ملخص قوالب الدوام" : "Work schedule summary"}>
      <span><b>{activeSchedules.length}</b><small>{ar ? "قوالب نشطة" : "active templates"}</small></span>
      <span><b>{totalAssigned}</b><small>{ar ? "تعيينات نشطة" : "active assignments"}</small></span>
      <span><b>{archiveSchedules.length}</b><small>{ar ? "قوالب مؤرشفة" : "archived templates"}</small></span>
    </div>

    {activeSchedules.length ? <div className="hr-schedules__grid">{activeSchedules.map(renderSchedule)}</div> : <BaseerNotice tone="info">{ar ? "أضف أول قالب قبل تعيين دوام الموظفين." : "Add your first template before assigning employee schedules."}</BaseerNotice>}
    {archiveSchedules.length ? <details className="hr-schedules__archive"><summary>{ar ? `القوالب المؤرشفة (${archiveSchedules.length})` : `Archived templates (${archiveSchedules.length})`}</summary><div className="hr-schedules__grid">{archiveSchedules.map(renderSchedule)}</div></details> : null}

    <BaseerFormDialog open={editorOpen} title={editing ? (ar ? "تعديل قالب الدوام" : "Edit work template") : (ar ? "قالب دوام جديد" : "New work template")} language={language} formId="attendance-schedule-template" submitLabel={editing ? (ar ? "حفظ التعديل" : "Save changes") : (ar ? "إنشاء القالب" : "Create template")} onClose={() => setEditorOpen(false)} busy={busy} error={error} size="wide">
      <form id="attendance-schedule-template" className="baseer-form hr-schedules__form" onSubmit={(event) => void save(event)}>
        <div className="hr-schedules__identity">
          <label>{ar ? "اسم القالب" : "Template name"}<BaseerTextInput required value={draft.nameAr} onChange={(event) => setDraft((current) => ({ ...current, nameAr: event.target.value }))} placeholder={ar ? "مثال: دوام مقسم" : "Example: Split shift"} /></label>
          <label>{ar ? "الاسم بالإنجليزية (اختياري)" : "English name (optional)"}<BaseerTextInput dir="ltr" value={draft.nameEn} onChange={(event) => setDraft((current) => ({ ...current, nameEn: event.target.value }))} placeholder="Split shift" /></label>
        </div>
        <div className="hr-schedules__form-note"><b>{ar ? "قاعدة الدوام الليلي:" : "Overnight rule:"}</b> {ar ? "إذا كانت نهاية الفترة قبل بدايتها، يفهمها النظام تلقائيًا كنهاية في اليوم التالي." : "If an end time is before its start time, it is treated as ending on the following day."}</div>
        <div className="hr-schedules__editor-grid">
          <div className="hr-schedules__editor-main">
            {!advancedEditor ? <div className="hr-schedules__simple-editor">
              <div className="hr-schedules__simple-head">
                <div><b>{ar ? "أنشئ الجدول مرة واحدة" : "Set the schedule once"}</b><span>{ar ? "سيُطبَّق على أيام العمل المحددة أدناه." : "It will apply to the selected work days below."}</span></div>
                <BaseerButton type="button" variant="quiet" className="hr-schedules__advanced-toggle" onClick={() => setAdvancedEditor(true)}>{ar ? "تخصيص يوم مختلف" : "Customize a day"}</BaseerButton>
              </div>
              <div className="hr-schedules__preset-row" aria-label={ar ? "قوالب سريعة" : "Quick presets"}>
                {(Object.keys(quickPresets) as QuickPreset[]).map((presetKey) => <BaseerButton type="button" variant="quiet" className="hr-schedules__preset-button" key={presetKey} onClick={() => applyPreset(presetKey)}>
                  {ar ? quickPresets[presetKey].nameAr : quickPresets[presetKey].nameEn}
                </BaseerButton>)}
              </div>
              <fieldset className="hr-schedules__work-days"><legend>{ar ? "أيام العمل" : "Work days"}</legend><div>
                {draft.days.map((day) => <label key={day.day}><BaseerCheckbox checked={activeWorkDays.includes(day.day)} onChange={(event) => toggleSimpleWorkDay(day.day, event.target.checked)} /><span>{attendanceWeekdayName(day.day, language)}</span></label>)}
              </div></fieldset>
              <div className="hr-schedules__shared-periods">
                <div><b>{ar ? "فترات الدوام المشتركة" : "Shared work periods"}</b><span>{ar ? "أضف فترة ثانية فقط للدوام المقسم." : "Add a second period only for split shifts."}</span></div>
                {sharedIntervals.map((item, index) => <div className="hr-schedules__period" key={item.id}>
                  <BaseerTimeInput aria-label={`${ar ? "بداية الفترة" : "Period start"} ${index + 1}`} value={item.start} onChange={(event) => applySimpleSchedule(activeWorkDays, sharedIntervals.map((period, periodIndex) => periodIndex === index ? { ...period, start: event.target.value } : period))} />
                  <span>—</span>
                  <BaseerTimeInput aria-label={`${ar ? "نهاية الفترة" : "Period end"} ${index + 1}`} value={item.end} onChange={(event) => applySimpleSchedule(activeWorkDays, sharedIntervals.map((period, periodIndex) => periodIndex === index ? { ...period, end: event.target.value } : period))} />
                  {sharedIntervals.length > 1 ? <BaseerButton type="button" variant="icon" className="hr-schedules__remove-period" aria-label={ar ? "حذف الفترة" : "Remove period"} onClick={() => applySimpleSchedule(activeWorkDays, sharedIntervals.filter((_, periodIndex) => periodIndex !== index))}>×</BaseerButton> : null}
                </div>)}
                <BaseerButton type="button" variant="quiet" className="hr-schedules__add-period" onClick={() => applySimpleSchedule(activeWorkDays, [...sharedIntervals, interval(`shared-${sharedIntervals.length}`)])}>{ar ? "+ إضافة فترة ثانية" : "+ Add another period"}</BaseerButton>
                <output className="hr-schedules__shared-daily-total"><span>{ar ? "إجمالي اليوم الواحد" : "Daily total"}</span><b>{formatAttendanceDuration(sharedDailyMinutes, language)}</b></output>
              </div>
            </div> : <div className="hr-schedules__advanced-editor">
            <div className="hr-schedules__simple-head"><div><b>{ar ? "تخصيص متقدم للأيام" : "Advanced day customization"}</b><span>{ar ? "استخدمه فقط عندما يختلف يوم عن بقية الأسبوع." : "Use this only when a day differs from the rest of the week."}</span></div><BaseerButton type="button" variant="quiet" className="hr-schedules__advanced-toggle" onClick={returnToSimpleEditor}>{ar ? "العودة للمحرر المبسط" : "Return to simple editor"}</BaseerButton></div>
              <div className="hr-schedules__days">
                {draft.days.map((day) => <div className="hr-schedules__day-row" key={day.day}>
                  <label className="hr-schedules__day-toggle"><BaseerCheckbox checked={day.intervals.length > 0} onChange={(event) => changeDay(day.day, (current) => ({ ...current, intervals: event.target.checked ? (current.intervals.length ? current.intervals : [interval(`${day.day}-0`)]) : [] }))} /><span>{attendanceWeekdayName(day.day, language)}</span></label>
                  <div className="hr-schedules__periods">
                    {day.intervals.map((item, index) => <div className="hr-schedules__period" key={item.id}>
                      <BaseerTimeInput aria-label={`${attendanceWeekdayName(day.day, language)} ${ar ? "بداية" : "start"} ${index + 1}`} value={item.start} onChange={(event) => changeDay(day.day, (current) => ({ ...current, intervals: current.intervals.map((period) => period.id === item.id ? { ...period, start: event.target.value } : period) }))} />
                      <span>—</span>
                      <BaseerTimeInput aria-label={`${attendanceWeekdayName(day.day, language)} ${ar ? "نهاية" : "end"} ${index + 1}`} value={item.end} onChange={(event) => changeDay(day.day, (current) => ({ ...current, intervals: current.intervals.map((period) => period.id === item.id ? { ...period, end: event.target.value } : period) }))} />
                      {day.intervals.length > 1 ? <BaseerButton type="button" variant="icon" className="hr-schedules__remove-period" aria-label={ar ? "حذف الفترة" : "Remove period"} onClick={() => changeDay(day.day, (current) => ({ ...current, intervals: current.intervals.filter((period) => period.id !== item.id) }))}>×</BaseerButton> : null}
                    </div>)}
                    {day.intervals.length ? <BaseerButton type="button" variant="quiet" className="hr-schedules__add-period" onClick={() => changeDay(day.day, (current) => ({ ...current, intervals: [...current.intervals, interval(`${day.day}-${current.intervals.length}`)] }))}>{ar ? "+ فترة أخرى" : "+ another period"}</BaseerButton> : <span className="hr-schedules__rest-day">{ar ? "راحة" : "Rest day"}</span>}
                  </div>
                  <output className="hr-schedules__day-total">{day.intervals.length ? formatAttendanceDuration(day.intervals.reduce((sum, item) => sum + intervalMinutes(item), 0), language) : "—"}</output>
                </div>)}
              </div>
            </div>}
          </div>
          <aside className="hr-schedules__preview" aria-label={ar ? "معاينة القالب" : "Template preview"}>
            <span className="hr-schedules__eyebrow">{ar ? "معاينة مباشرة" : "Live preview"}</span>
            <h3>{draft.nameAr || (ar ? "قالب جديد" : "New template")}</h3>
            <div className="hr-schedules__preview-tabs">{draft.days.map((day) => <BaseerButton type="button" variant="quiet" className="hr-schedules__preview-tab" key={day.day} aria-pressed={previewDay === day.day} onClick={() => setPreviewDay(day.day)}>{attendanceWeekdayName(day.day, language, true).slice(0, 3)}</BaseerButton>)}</div>
            <strong>{dailyPreview.intervals.length ? dailyPreview.intervals.map((item) => `${item.start || "--:--"} — ${item.end || "--:--"}`).join("\n") : (ar ? "يوم راحة" : "Rest day")}</strong>
            <p>{dailyPreview.intervals.length ? `${ar ? "إجمالي اليوم:" : "Day total:"} ${formatAttendanceDuration(dailyMinutes, language)}` : (ar ? "لا توجد فترة مجدولة لهذا اليوم." : "No period is scheduled for this day.")}</p>
            <div className="hr-schedules__week-total"><span>{ar ? "إجمالي القالب الأسبوعي" : "Template weekly total"}</span><b>{formatAttendanceDuration(scheduleHours(draft.days), language)}</b></div>
          </aside>
        </div>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={assignmentOpen} title={assignmentTemplate ? (ar ? `ربط موظفين · ${assignmentTemplate.nameAr}` : `Assign employees · ${assignmentTemplate.nameAr}`) : ""} language={language} formId="attendance-template-assignment" submitLabel={ar ? "حفظ الربط" : "Save assignment"} onClose={() => setAssignmentOpen(false)} busy={busy} error={error} size="standard">
      <form id="attendance-template-assignment" className="baseer-form hr-schedules__assignment-form" onSubmit={(event) => void saveAssignments(event)}>
        <p>{ar ? "يمكنك تعيين الشفت مباشرةً من هنا. أي تغيير جديد يبدأ من تاريخ السريان المحدد ولا يعيد كتابة سجل الحضور السابق." : "Assign the shift directly here. A new assignment starts on the selected date and never rewrites past attendance."}</p>
        <BaseerDatePicker language={language} label={ar ? "تاريخ السريان" : "Effective from"} value={assignmentEffectiveFrom} onChange={setAssignmentEffectiveFrom} />
        {assignedToOpenTemplate.size ? <p className="hr-schedules__existing-assignees">{ar ? `الموظفون المرتبطون حاليًا ظاهرون أدناه بعلامة واضحة، ولا يُعاد إرسالهم عند الحفظ. لتغيير شفت موظف مرتبط، استخدم ملفه الشخصي وحدد تاريخ سريان جديد.` : "Employees already assigned are marked below and are not submitted again. Change an existing employee’s shift from their profile with a new effective date."}</p> : null}
        <fieldset><legend>{ar ? `إضافة موظفين (${selectedEmployeeIds.length})` : `Add employees (${selectedEmployeeIds.length})`}</legend><div className="hr-schedules__assignment-list">
          {employees.length ? employees.map((employee) => {
            const alreadyAssigned = assignedToOpenTemplate.has(employee.id);
            return <label key={employee.id} className={alreadyAssigned ? "hr-schedules__assignment-row hr-schedules__assignment-row--assigned" : "hr-schedules__assignment-row"}>
              <BaseerCheckbox checked={alreadyAssigned || selectedEmployeeIds.includes(employee.id)} disabled={alreadyAssigned} onChange={(event) => setSelectedEmployeeIds((current) => event.target.checked ? [...new Set([...current, employee.id])] : current.filter((id) => id !== employee.id))} />
              <span><b>{employee.employeeNumber}</b> · {ar ? employee.nameAr : employee.nameEn ?? employee.nameAr}{alreadyAssigned ? <small>{ar ? "مرتبط حاليًا" : "Currently assigned"}</small> : null}</span>
            </label>;
          }) : <p>{ar ? "لا يوجد موظفون لإدارتهم." : "There are no employees to manage."}</p>}
          {!unassignedEmployees.length && employees.length ? <p className="hr-schedules__assignment-all-assigned">{ar ? "جميع الموظفين الظاهرين مرتبطون بهذا القالب بالفعل." : "Every listed employee is already assigned to this template."}</p> : null}
        </div></fieldset>
      </form>
    </BaseerFormDialog>
    <BaseerConfirmDialog open={simplifyConfirmationOpen} language={language} title={ar ? "توحيد فترات الدوام" : "Unify work periods"} message={ar ? "ستصبح فترات كل أيام العمل متطابقة مع أول يوم عمل، وستُزال التخصيصات المختلفة." : "Every work day will use the first work day's periods and its distinct customizations will be removed."} confirmLabel={ar ? "توحيد الفترات" : "Unify periods"} destructive onCancel={() => setSimplifyConfirmationOpen(false)} onConfirm={confirmReturnToSimpleEditor} />
    <BaseerConfirmDialog open={Boolean(archiveTarget)} language={language} title={ar ? "أرشفة قالب الدوام" : "Archive work template"} message={archiveTarget ? (ar ? `لن يتغير تاريخ الحضور السابق للقالب «${archiveTarget.nameAr}».` : `Historic attendance for “${archiveTarget.nameAr}” will not change.`) : ""} confirmLabel={ar ? "أرشفة القالب" : "Archive template"} destructive busy={busy} onCancel={() => !busy && setArchiveTarget(null)} onConfirm={() => void archive()} />
  </section>;
}

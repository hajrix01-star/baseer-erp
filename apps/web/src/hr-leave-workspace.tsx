import { useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerSearchSelect } from "./baseer-search-select";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { uiCopy } from "./baseer-ui-copy";
import { DataTable, type DataTableColumn } from "./data-table";
import { activeSession, requestId, type ActiveSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { createHrEmployeeLeave, getHrEmployeeLeave, listHrEmployeeLeaves, listHrEmployees, recordHrEmployeeReturn, type HrEmployee, type HrEmployeeLeave } from "./hr-client";

type Language = "ar" | "en";
type LeaveForm = { employeeId: string; leaveType: HrEmployeeLeave["leaveType"]; startDate: string; endDate: string; notes: string };
type ReturnForm = { leaveId: string; returnDate: string; notes: string };

const today = () => new Date().toISOString().slice(0, 10);
const emptyLeave = (): LeaveForm => ({ employeeId: "", leaveType: "ANNUAL", startDate: today(), endDate: today(), notes: "" });
const label = (language: Language, row: { nameAr: string; nameEn: string | null }) => language === "ar" ? row.nameAr : row.nameEn ?? row.nameAr;

export function HrLeaveWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const ui = uiCopy(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [leaves, setLeaves] = useState<HrEmployeeLeave[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | HrEmployeeLeave["status"]>("");
  const [typeFilter, setTypeFilter] = useState<"" | HrEmployeeLeave["leaveType"]>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<HrEmployeeLeave | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState<LeaveForm>(emptyLeave());
  const [returnForm, setReturnForm] = useState<ReturnForm>({ leaveId: "", returnDate: today(), notes: "" });

  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession(); setSession(current);
    if (!current) { setLoading(false); return; }
    if (!append) setLoading(true);
    try {
      const [leaveReceipt, employeeReceipt] = await Promise.all([listHrEmployeeLeaves(current, { employeeId: employeeFilter || undefined, status: statusFilter || undefined, leaveType: typeFilter || undefined, cursor, pageSize: 50 }), append ? Promise.resolve(null) : listHrEmployees(current, { pageSize: 100 })]);
      setLeaves((rows) => append ? [...rows, ...leaveReceipt.leaves] : leaveReceipt.leaves); setNextCursor(leaveReceipt.nextCursor);
      if (employeeReceipt) setEmployees(employeeReceipt.employees);
    } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تحميل الإجازات" : "Loading leaves")); }
    finally { setLoading(false); }
  }, [ar, employeeFilter, language, statusFilter, typeFilter]);
  useEffect(() => { void load(); }, [load]);

  const showDetail = async (leave: HrEmployeeLeave) => {
    const current = activeSession(); if (!current) return;
    try { setDetail((await getHrEmployeeLeave(current, leave.id)).leave); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تفاصيل الإجازة" : "Leave details")); }
  };
  const saveLeave = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || busy) return;
    setBusy(true);
    try {
      await createHrEmployeeLeave(current, { ...leaveForm, notes: leaveForm.notes || undefined, idempotencyKey: requestId() });
      setCreateOpen(false); setLeaveForm(emptyLeave()); setMessage(ar ? "تم تسجيل الإجازة واعتمادها." : "Leave recorded and approved."); await load();
    } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تسجيل الإجازة" : "Recording leave")); }
    finally { setBusy(false); }
  };
  const saveReturn = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || busy) return;
    setBusy(true);
    try {
      await recordHrEmployeeReturn(current, { ...returnForm, notes: returnForm.notes || undefined, idempotencyKey: requestId() });
      setReturnOpen(false); setDetail(null); setMessage(ar ? "تم تسجيل العودة إلى العمل." : "Return to work recorded."); await load();
    } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تسجيل العودة" : "Recording return")); }
    finally { setBusy(false); }
  };
  const visibleLeaves = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return leaves.filter((leave) => (!employeeFilter || leave.employeeId === employeeFilter) && (!statusFilter || leave.status === statusFilter) && (!typeFilter || leave.leaveType === typeFilter) && (!needle || [leave.employeeNumber, leave.employeeNameAr, leave.employeeNameEn, leave.leaveType, leave.status, leave.startDate, leave.endDate].filter(Boolean).join(" ").toLowerCase().includes(needle)));
  }, [employeeFilter, leaves, search, statusFilter, typeFilter]);
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE"), [employees]);
  const searchEmployeeOptions = useCallback(async (query: string) => {
    const current = activeSession();
    if (!current) return [];
    const receipt = await listHrEmployees(current, { search: query.trim() || undefined, pageSize: 50 });
    return receipt.employees
      .filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE")
      .map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${label(language, employee)}` }));
  }, [language]);
  const typeLabel = (type: HrEmployeeLeave["leaveType"]) => ({ ANNUAL: ar ? "سنوية" : "Annual", SICK: ar ? "مرضية" : "Sick", UNPAID: ar ? "بدون راتب" : "Unpaid", OTHER: ar ? "أخرى" : "Other" })[type];
  const statusLabel = (status: HrEmployeeLeave["status"]) => status === "APPROVED" ? ui.leaveApproved : ui.leaveReturned;
  const onLeaveNow = leaves.filter((leave) => leave.status === "APPROVED" && leave.startDate <= today() && leave.endDate >= today()).length;
  const upcoming = leaves.filter((leave) => leave.status === "APPROVED" && leave.startDate > today()).length;
  const returned = leaves.filter((leave) => leave.status === "RETURNED").length;
  const appliedFilters = [
    employeeFilter ? { id: "employee", label: label(language, employees.find((employee) => employee.id === employeeFilter) ?? { nameAr: "", nameEn: null }), onRemove: () => setEmployeeFilter("") } : null,
    statusFilter ? { id: "status", label: statusLabel(statusFilter), onRemove: () => setStatusFilter("") } : null,
    typeFilter ? { id: "type", label: typeLabel(typeFilter), onRemove: () => setTypeFilter("") } : null,
  ].filter(Boolean) as Array<{ id: string; label: string; onRemove: () => void }>;
  const columns: readonly DataTableColumn<HrEmployeeLeave>[] = [
    { id: "employee", header: ar ? "الموظف" : "Employee", cell: (row) => <BaseerButton type="button" variant="quiet" onClick={() => void showDetail(row)}>{`${row.employeeNumber} · ${ar ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr}`}</BaseerButton>, sort: (row) => ar ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr },
    { id: "type", header: ar ? "النوع" : "Type", cell: (row) => typeLabel(row.leaveType), sort: (row) => row.leaveType, width: "9rem" },
    { id: "period", header: ar ? "الفترة" : "Period", cell: (row) => <span>{row.startDate}<br />{row.endDate}</span>, sort: (row) => row.startDate, width: "10rem" },
    { id: "return", header: ar ? "العودة الفعلية" : "Actual return", cell: (row) => row.actualReturnDate ?? "—", sort: (row) => row.actualReturnDate ?? "", width: "10rem" },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (row) => statusLabel(row.status), sort: (row) => row.status, width: "10rem" },
  ];
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="administration-panel">
    <div className="administration-section-heading"><div><h2>{ar ? "الإجازات والعودة" : "Leave & return"}</h2><p>{ar ? "سجل تشغيلي للغياب والعودة؛ لا ينشئ قيداً أو يعدّل الراتب تلقائياً." : "An operational absence and return register; it creates no journal entry and does not change payroll automatically."}</p></div><BaseerButton type="button" onClick={() => { setLeaveForm(emptyLeave()); setCreateOpen(true); }}>{ar ? "تسجيل إجازة" : "Record leave"}</BaseerButton></div>
    <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص الإجازات" : "Leave summary"}><BaseerSummaryMetric label={ar ? "في إجازة الآن" : "On leave now"} value={onLeaveNow} /><BaseerSummaryMetric label={ar ? "إجازات قادمة" : "Upcoming leaves"} value={upcoming} /><BaseerSummaryMetric label={ar ? "تمت العودة" : "Returned"} value={returned} /></BaseerSummaryMetricGrid>
    <BaseerFilterBar language={language} search={search} searchLabel={ar ? "البحث في الإجازات" : "Search leaves"} searchPlaceholder={ar ? "ابحث بالموظف أو الفترة" : "Search employee or period"} onSearchChange={setSearch} controlsPresentation="menu" controls={<><BaseerSearchSelect label={ar ? "الموظف" : "Employee"} value={employeeFilter} placeholder={ar ? "كل الموظفين" : "All employees"} options={employees.map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${label(language, employee)}` }))} remoteSearch={searchEmployeeOptions} onChange={setEmployeeFilter} /><label>{ar ? "الحالة" : "Status"}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="">{ar ? "كل الحالات" : "All statuses"}</option><option value="APPROVED">{statusLabel("APPROVED")}</option><option value="RETURNED">{statusLabel("RETURNED")}</option></select></label><label>{ar ? "النوع" : "Type"}<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="">{ar ? "كل الأنواع" : "All types"}</option>{(["ANNUAL", "SICK", "UNPAID", "OTHER"] as const).map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label></>} appliedFilters={appliedFilters} onClear={() => { setEmployeeFilter(""); setStatusFilter(""); setTypeFilter(""); }} />
    {loading ? <BaseerCard>{ar ? "جارٍ تحميل الإجازات…" : "Loading leaves…"}</BaseerCard> : visibleLeaves.length ? <DataTable<HrEmployeeLeave> ariaLabel={ar ? "سجل الإجازات والعودة" : "Leave and return register"} caption={ar ? "سجل الإجازات والعودة" : "Leave and return register"} rows={visibleLeaves} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد إجازات مطابقة لهذه الشركة." : "No matching leaves for this company."}</BaseerCard>}
    {nextCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    {message ? <p className="daily-sales-message error">{message}</p> : null}
    <BaseerDialog open={createOpen} title={ar ? "تسجيل إجازة" : "Record leave"} language={language} busy={busy} onClose={() => setCreateOpen(false)} footer={<><BaseerButton type="button" variant="secondary" onClick={() => setCreateOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-leave-create" disabled={busy}>{ar ? "حفظ" : "Save"}</BaseerButton></>}><form id="hr-leave-create" className="administration-form" onSubmit={(event) => void saveLeave(event)}><label>{ar ? "الموظف" : "Employee"}<BaseerSearchSelect required label={ar ? "الموظف" : "Employee"} value={leaveForm.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={activeEmployees.map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${label(language, employee)}` }))} remoteSearch={searchEmployeeOptions} onChange={(employeeId) => setLeaveForm((value) => ({ ...value, employeeId }))} /></label><label>{ar ? "النوع" : "Type"}<select value={leaveForm.leaveType} onChange={(event) => setLeaveForm((value) => ({ ...value, leaveType: event.target.value as HrEmployeeLeave["leaveType"] }))}>{(["ANNUAL", "SICK", "UNPAID", "OTHER"] as const).map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label><label>{ar ? "من" : "From"}<input required type="date" value={leaveForm.startDate} onChange={(event) => setLeaveForm((value) => ({ ...value, startDate: event.target.value }))} /></label><label>{ar ? "إلى" : "To"}<input required type="date" min={leaveForm.startDate} value={leaveForm.endDate} onChange={(event) => setLeaveForm((value) => ({ ...value, endDate: event.target.value }))} /></label><label>{ar ? "ملاحظات" : "Notes"}<textarea value={leaveForm.notes} onChange={(event) => setLeaveForm((value) => ({ ...value, notes: event.target.value }))} /></label></form></BaseerDialog>
    <BaseerDialog open={Boolean(detail)} title={ar ? "تفاصيل الإجازة" : "Leave details"} language={language} busy={busy} onClose={() => setDetail(null)} footer={detail?.status === "APPROVED" ? <BaseerButton type="button" onClick={() => { setReturnForm({ leaveId: detail.id, returnDate: today(), notes: "" }); setReturnOpen(true); }}>{ar ? "تسجيل العودة" : "Record return"}</BaseerButton> : undefined}>{detail ? <dl className="administration-details"><div><dt>{ar ? "الموظف" : "Employee"}</dt><dd>{`${detail.employeeNumber} · ${ar ? detail.employeeNameAr : detail.employeeNameEn ?? detail.employeeNameAr}`}</dd></div><div><dt>{ar ? "النوع" : "Type"}</dt><dd>{typeLabel(detail.leaveType)}</dd></div><div><dt>{ar ? "الفترة المخططة" : "Planned period"}</dt><dd>{`${detail.startDate} — ${detail.endDate}`}</dd></div><div><dt>{ar ? "الحالة" : "Status"}</dt><dd>{statusLabel(detail.status)}</dd></div>{detail.actualReturnDate ? <div><dt>{ar ? "العودة الفعلية" : "Actual return"}</dt><dd>{detail.actualReturnDate}</dd></div> : null}{detail.notes ? <div><dt>{ar ? "ملاحظات" : "Notes"}</dt><dd>{detail.notes}</dd></div> : null}</dl> : null}</BaseerDialog>
    <BaseerDialog open={returnOpen} title={ar ? "تسجيل العودة إلى العمل" : "Record return to work"} language={language} busy={busy} onClose={() => setReturnOpen(false)} footer={<><BaseerButton type="button" variant="secondary" onClick={() => setReturnOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-leave-return" disabled={busy}>{ar ? "حفظ العودة" : "Save return"}</BaseerButton></>}><form id="hr-leave-return" className="administration-form" onSubmit={(event) => void saveReturn(event)}><label>{ar ? "أول يوم للعودة" : "First day back"}<input required type="date" max={today()} value={returnForm.returnDate} onChange={(event) => setReturnForm((value) => ({ ...value, returnDate: event.target.value }))} /></label><label>{ar ? "ملاحظات" : "Notes"}<textarea value={returnForm.notes} onChange={(event) => setReturnForm((value) => ({ ...value, notes: event.target.value }))} /></label></form></BaseerDialog>
  </section>;
}

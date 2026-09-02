import { BaseerApiError, parseBaseerApiResponse } from "./baseer-api-error";
import { api, baseerApiBaseUrl, type ActiveSession } from "./daily-sales-client";
import type { ApproveAttendanceRosterRequest, AssignAttendanceEmployeeScheduleRequest, AssignAttendanceEmployeesScheduleRequest, AttendanceCoverageReceipt, AttendanceRosterReceipt, ConfigureAttendanceEmployeeScheduleRequest, SaveAttendanceRosterDraftRequest, SetAttendanceEmployeeWeeklyAdjustmentRequest } from "@baseer-erp/contracts";

export type AttendanceBranch = { id: string; nameAr: string; nameEn: string | null; latitude: number; longitude: number; radiusMeters: number; maxAccuracyMeters: number; qrValiditySeconds: number; isActive: boolean };
export type AttendanceCompanySettings = { locationEnabled: boolean; locationRetentionDays: number };
export type AttendanceOpenSession = { sessionId: string; employeeId: string; employeeNameAr: string; businessDate: string; checkInAt: string };
export type AttendanceOpenSessionsReceipt = { sessions: AttendanceOpenSession[]; hasMore: boolean; nextCursor: string | null };
export type AttendanceEmployeePinDisplay = { employeeId: string; state: "SET" | "NOT_SET" | "RESET_REQUIRED"; pin: string | null };
export type AttendanceRecordReceipt = { employeeId: string; employeeNameAr: string; operation: "CHECK_IN" | "CHECK_OUT"; occurredAt: string; sessionId: string; replayed: boolean };
export type AttendanceEmployeePortalProfile = { companyId: string; employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; businessDate: string; state: "READY" | "IN_PROGRESS"; /** The company owner controls this setting; false means the portal must not request geolocation. */ locationEnabled: boolean; commitment: { score: number | null; plannedMinutes: number; shortageMinutes: number; evaluatedDays: number }; schedule: Array<{ businessDate: string; source: "ROSTER" | "EXCEPTION" | "WEEKLY_ADJUSTMENT" | "TEMPLATE" | "NONE"; kind: "FULL_REST" | "CUSTOM_PERIODS" | null; periods: Array<{ startTime: string; endTime: string; endsNextDay: boolean; minutes: number }> }> };
export type AttendanceEmployeePortalSession = { accessToken: string; expiresAt: string; profile: AttendanceEmployeePortalProfile };
export type AttendanceDashboard = { date: string; summary: { activeEmployees: number; checkedIn: number; checkedOut: number; notRecorded: number; openSessions: number }; employees: Array<{ employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; state: "NOT_RECORDED" | "IN_PROGRESS" | "CHECKED_OUT"; checkInAt: string | null; checkOutAt: string | null; workedMinutes: number }> };
export type AttendanceReport = { from: string; to: string; summary: { sessions: number; completedSessions: number; openSessions: number; workedMinutes: number }; rows: Array<{ employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; sessions: number; completedSessions: number; workedMinutes: number }> };
/** Mirrors the receipt published by the attendance contract. Keep evaluation
 * state distinct from the raw check-in/check-out session state. */
export type AttendanceEvaluation = { businessDate: string; scheduleSource: "ROSTER" | "EXCEPTION" | "WEEKLY_ADJUSTMENT" | "TEMPLATE" | "NONE"; scheduleKind: "FULL_REST" | "CUSTOM_PERIODS" | null; state: "NO_SCHEDULE" | "REST_DAY" | "MISSING_CHECK_IN" | "IN_PROGRESS" | "ON_TIME" | "ATTENTION"; plannedMinutes: number; workedMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; extraMinutes: number; shortageMinutes: number; hasOpenSession: boolean };
export type AttendanceAlert = { employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; type: "LATE" | "MISSING_CHECK_IN" | "OPEN_SESSION"; severity: "INFO" | "WARNING"; businessDate: string; minutes: number; messageAr: string };
export type AttendanceAlerts = { date: string; summary: { late: number; missingCheckIn: number; openSessions: number }; alerts: AttendanceAlert[] };
export type AttendanceCoverage = AttendanceCoverageReceipt;
export type AttendanceRoster = AttendanceRosterReceipt;
export type AttendanceDashboardEmployee = { employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; state: "NOT_RECORDED" | "IN_PROGRESS" | "CHECKED_OUT"; checkInAt: string | null; checkOutAt: string | null; workedMinutes: number; evaluation: AttendanceEvaluation };
export type AttendanceDashboardV2 = Omit<AttendanceDashboard, "employees"> & { employees: AttendanceDashboardEmployee[] };
export type AttendanceReportRow = { employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; sessions: number; completedSessions: number; workedMinutes: number; plannedMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; extraMinutes: number; shortageMinutes: number; missingCheckInDays: number; days: AttendanceEvaluation[] };
export type AttendanceReportV2 = Omit<AttendanceReport, "summary" | "rows"> & { summary: AttendanceReport["summary"] & { plannedMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; extraMinutes: number; shortageMinutes: number; missingCheckInDays: number }; rows: AttendanceReportRow[] };
export type AttendanceSchedulePeriod = { dayOfWeek: number; startTime: string; endTime: string; endsNextDay: boolean; minutes: number };
export type AttendanceScheduleTemplateReceipt = { id: string; nameAr: string; nameEn: string | null; status: "ACTIVE" | "ARCHIVED"; archivedAt: string | null; versions: Array<{ id: string; versionNumber: number; effectiveFrom: string; periods: AttendanceSchedulePeriod[] }> };
export type AttendanceEmployeeSchedule = { employeeId: string; /** Server-provided agreement reference used to seed the independent attendance schedule. */ workTermsReference: { id: string; effectiveFrom: string; effectiveTo: string | null; workMinutesPerDay: number } | null; assignments: Array<{ id: string; templateId: string; templateNameAr: string; templateNameEn: string | null; effectiveFrom: string; createdAt: string }>; weeklyAdjustments: Array<{ id: string; dayOfWeek: number; effectiveFrom: string; kind: "FULL_REST" | "CUSTOM_PERIODS"; periods: Array<Omit<AttendanceSchedulePeriod, "dayOfWeek">>; createdAt: string }>; exceptions: Array<{ id: string; businessDate: string; kind: "FULL_REST" | "CUSTOM_PERIODS"; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; reason: string; decisionNote: string | null; decidedAt: string | null; periods: Array<Omit<AttendanceSchedulePeriod, "dayOfWeek">>; createdAt: string }> };
export type AttendanceEmployeeSchedulesReceipt = { schedules: AttendanceEmployeeSchedule[]; hasMore: boolean; nextCursor: string | null };
export function listAttendanceBranches(session: ActiveSession, options?: RequestInit) { return api<{ branches: AttendanceBranch[] }>(session, "/attendance/branches", options); }
export function getAttendanceCompanySettings(session: ActiveSession, options?: RequestInit) { return api<AttendanceCompanySettings>(session, "/attendance/company-settings", options); }
export function updateAttendanceCompanySettings(session: ActiveSession, payload: { locationEnabled: boolean; idempotencyKey: string }) { return api<AttendanceCompanySettings>(session, "/attendance/company-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function createAttendanceBranch(session: ActiveSession, payload: unknown) { return api<{ branch: AttendanceBranch }>(session, "/attendance/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function updateAttendanceBranch(session: ActiveSession, payload: unknown) { return api<{ branch: AttendanceBranch }>(session, "/attendance/branches/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function setAttendanceEmployeePin(session: ActiveSession, payload: unknown) { return api<{ employeeId: string }>(session, "/attendance/employees/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function getAttendanceEmployeePin(session: ActiveSession, employeeId: string) { return api<AttendanceEmployeePinDisplay>(session, `/attendance/employees/${encodeURIComponent(employeeId)}/pin`); }
export function issueAttendanceQr(session: ActiveSession, branchId: string) { return api<{ token: string; expiresAt: string }>(session, `/attendance/branches/${encodeURIComponent(branchId)}/qr`); }
export function getAttendanceEmployeePortalScope(session: ActiveSession) { return api<{ tenantId: string; companyId: string }>(session, "/attendance/employee-portal-scope"); }
export function getAttendanceDashboard(session: ActiveSession, date?: string, options?: RequestInit) { return api<AttendanceDashboardV2>(session, `/attendance/dashboard${date ? `?date=${encodeURIComponent(date)}` : ""}`, options); }
export function getAttendanceReport(session: ActiveSession, from: string, to: string, employeeId?: string) { return api<AttendanceReportV2>(session, `/attendance/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ""}`); }
export function getAttendanceCoverage(session: ActiveSession, date?: string, options?: RequestInit) { return api<AttendanceCoverage>(session, `/attendance/coverage${date ? `?date=${encodeURIComponent(date)}` : ""}`, options); }
export function getAttendanceRoster(session: ActiveSession, weekStart?: string, options?: RequestInit) { return api<AttendanceRoster>(session, `/attendance/roster${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`, options); }
export function saveAttendanceRosterDraft(session: ActiveSession, payload: SaveAttendanceRosterDraftRequest) { return api<AttendanceRoster>(session, "/attendance/roster/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function approveAttendanceRoster(session: ActiveSession, payload: ApproveAttendanceRosterRequest) { return api<AttendanceRoster>(session, "/attendance/roster/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function getAttendanceAlerts(session: ActiveSession, date?: string, options?: RequestInit) { return api<AttendanceAlerts>(session, `/attendance/alerts${date ? `?date=${encodeURIComponent(date)}` : ""}`, options); }
export function listAttendanceOpenSessionsForClose(session: ActiveSession, { cursor, pageSize = 30 }: { cursor?: string; pageSize?: number } = {}) { const query = new URLSearchParams({ pageSize: String(pageSize) }); if (cursor) query.set("cursor", cursor); return api<AttendanceOpenSessionsReceipt>(session, `/attendance/sessions/open?${query}`); }
export function listAttendanceScheduleTemplates(session: ActiveSession, options?: RequestInit) { return api<{ templates: AttendanceScheduleTemplateReceipt[] }>(session, "/attendance/schedule-templates", options); }
export function createAttendanceScheduleTemplate(session: ActiveSession, payload: unknown) { return api<{ template: AttendanceScheduleTemplateReceipt }>(session, "/attendance/schedule-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function updateAttendanceScheduleTemplate(session: ActiveSession, payload: unknown) { return api<{ template: AttendanceScheduleTemplateReceipt }>(session, "/attendance/schedule-templates/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function createAttendanceScheduleVersion(session: ActiveSession, payload: unknown) { return api(session, "/attendance/schedule-templates/version", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function archiveAttendanceScheduleTemplate(session: ActiveSession, payload: unknown) { return api(session, "/attendance/schedule-templates/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function getAttendanceEmployeeSchedule(session: ActiveSession, employeeId: string) { return api<AttendanceEmployeeSchedule>(session, `/attendance/employees/${encodeURIComponent(employeeId)}/schedule`); }
export function listAttendanceEmployeeSchedules(session: ActiveSession, { cursor, pageSize = 500, ...options }: RequestInit & { cursor?: string; pageSize?: number } = {}) {
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (cursor) query.set("cursor", cursor);
  return api<AttendanceEmployeeSchedulesReceipt>(session, `/attendance/employees/schedules?${query}`, options);
}
export function assignAttendanceEmployeeSchedule(session: ActiveSession, payload: AssignAttendanceEmployeeScheduleRequest) { return api(session, "/attendance/employees/schedule-assignment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function assignAttendanceEmployeesSchedule(session: ActiveSession, payload: AssignAttendanceEmployeesScheduleRequest) { return api<{ assignedEmployeeIds: string[]; effectiveFrom: string }>(session, "/attendance/employees/schedule-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function configureAttendanceEmployeeSchedule(session: ActiveSession, payload: ConfigureAttendanceEmployeeScheduleRequest) { return api<{ employeeId: string; effectiveFrom: string }>(session, "/attendance/employees/schedule-setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function setAttendanceEmployeeWeeklyAdjustment(session: ActiveSession, payload: SetAttendanceEmployeeWeeklyAdjustmentRequest) { return api(session, "/attendance/employees/weekly-adjustment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function createAttendanceScheduleException(session: ActiveSession, payload: unknown) { return api(session, "/attendance/schedule-exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function decideAttendanceScheduleException(session: ActiveSession, payload: unknown) { return api(session, "/attendance/schedule-exceptions/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
/** Administrative close preserves the raw check-in and records the manager-selected time and mandatory reason. */
export function closeAttendanceSession(session: ActiveSession, payload: { employeeId: string; businessDate: string; checkOutAt: string; reason: string; idempotencyKey: string }) { return api(session, "/attendance/sessions/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }

/** Public employee-PWA command. The server validates the signed QR, PIN and location. */
export async function recordAttendance(payload: unknown): Promise<AttendanceRecordReceipt> {
  let response: Response;
  try {
    response = await fetch(`${baseerApiBaseUrl}/attendance/record`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new BaseerApiError(0, "DEPENDENCY_UNAVAILABLE", null, null, null);
  }
  return parseBaseerApiResponse<AttendanceRecordReceipt>(response);
}

/** Public employee-PWA APIs intentionally do not use an ERP browser session. */
async function employeePortalApi<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`${baseerApiBaseUrl}${path}`, { cache: "no-store", ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } }); }
  catch { throw new BaseerApiError(0, "DEPENDENCY_UNAVAILABLE", null, null, null); }
  return parseBaseerApiResponse<T>(response);
}
export function createAttendanceEmployeePortalSession(tenantId: string | null, companyId: string | null, pin: string) { return employeePortalApi<AttendanceEmployeePortalSession>("/attendance/portal/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(tenantId && companyId ? { tenantId, companyId } : {}), pin }) }); }
export function getAttendanceEmployeePortalProfile(accessToken: string) { return employeePortalApi<AttendanceEmployeePortalProfile>("/attendance/portal/profile", { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }); }

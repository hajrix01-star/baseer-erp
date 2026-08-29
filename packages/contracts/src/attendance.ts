import { z } from "zod";
import { companyIdSchema } from "./identity.js";

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(1).max(255);
const dateTime = z.string().datetime({ offset: true });
const pin = z.string().regex(/^\d{4}$/, "Attendance PIN must be exactly four digits.");
const employeePortalToken = z.string().trim().min(32).max(2_000);
const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scheduleTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must use HH:MM (24-hour) format.");
const isoWeekday = z.number().int().min(1).max(7);
const schedulePeriodInputSchema = z.object({ startTime: scheduleTime, endTime: scheduleTime }).strict().superRefine((value, context) => {
  if (value.startTime === value.endTime) context.addIssue({ code: z.ZodIssueCode.custom, message: "A work period cannot have the same start and end time." });
});
const weeklySchedulePeriodInputSchema = schedulePeriodInputSchema.extend({ dayOfWeek: isoWeekday }).strict();

/** The employee never needs a Baseer platform account. This is a separate, short PIN boundary. */
export const setAttendanceEmployeePinRequestSchema = z.object({ employeeId: uuid, pin, idempotencyKey }).strict();

export const createAttendanceBranchRequestSchema = z.object({
  nameAr: z.string().trim().min(1).max(160), nameEn: z.string().trim().max(160).optional(), latitude, longitude,
  radiusMeters: z.number().int().min(25).max(1_000).default(100), maxAccuracyMeters: z.number().int().min(10).max(250).default(75),
  qrValiditySeconds: z.number().int().min(30).max(60).default(45), idempotencyKey,
}).strict();
export const updateAttendanceBranchRequestSchema = createAttendanceBranchRequestSchema.omit({ idempotencyKey: true }).extend({ branchId: uuid, isActive: z.boolean().optional(), idempotencyKey }).strict();
export const attendanceEmployeeRecordRequestSchema = z.object({ tenantId: uuid, companyId: companyIdSchema, branchId: uuid, qrToken: z.string().trim().min(32).max(2_000), pin: pin.optional(), portalToken: employeePortalToken.optional(), latitude, longitude, accuracyMeters: z.number().finite().positive().max(10_000), idempotencyKey }).strict().superRefine((value, context) => {
  if (Boolean(value.pin) === Boolean(value.portalToken)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Use either a PIN or an employee portal session.", path: ["portalToken"] });
});
export const attendanceBranchSchema = z.object({ id: uuid, nameAr: z.string(), nameEn: z.string().nullable(), latitude: z.number(), longitude: z.number(), radiusMeters: z.number().int(), maxAccuracyMeters: z.number().int(), qrValiditySeconds: z.number().int(), isActive: z.boolean() }).strict();
export const attendanceEmployeePinDisplayReceiptSchema = z.object({ employeeId: uuid, state: z.enum(["SET", "NOT_SET", "RESET_REQUIRED"]), pin: pin.nullable() }).strict();
export const attendanceEmployeeRecordReceiptSchema = z.object({ employeeId: uuid, employeeNameAr: z.string(), operation: z.enum(["CHECK_IN", "CHECK_OUT"]), occurredAt: dateTime, sessionId: uuid, replayed: z.boolean() }).strict();
export const attendanceEmployeePortalScopeReceiptSchema = z.object({ tenantId: uuid, companyId: companyIdSchema }).strict();
// The issued employee link carries the immutable tenant/company scope. The
// employee never enters either identifier; they only enter their four-digit PIN.
export const attendanceEmployeePortalSessionRequestSchema = z.object({ tenantId: uuid, companyId: companyIdSchema, pin }).strict();
const attendanceEmployeePortalScheduleSchema = z.object({ businessDate, source: z.enum(["ROSTER", "EXCEPTION", "WEEKLY_ADJUSTMENT", "TEMPLATE", "NONE"]), kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]).nullable(), periods: z.array(z.object({ startTime: scheduleTime, endTime: scheduleTime, endsNextDay: z.boolean(), minutes: z.number().int().positive() }).strict()).max(4) }).strict();
const attendanceEmployeePortalCommitmentSchema = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  plannedMinutes: z.number().int().nonnegative(),
  shortageMinutes: z.number().int().nonnegative(),
  evaluatedDays: z.number().int().nonnegative(),
}).strict();
export const attendanceEmployeePortalProfileSchema = z.object({ companyId: companyIdSchema, employeeId: uuid, employeeNumber: z.string(), employeeNameAr: z.string(), employeeNameEn: z.string().nullable(), businessDate, state: z.enum(["READY", "IN_PROGRESS"]), commitment: attendanceEmployeePortalCommitmentSchema, schedule: z.array(attendanceEmployeePortalScheduleSchema).length(7) }).strict();
export const attendanceEmployeePortalSessionReceiptSchema = z.object({ accessToken: employeePortalToken, expiresAt: dateTime, profile: attendanceEmployeePortalProfileSchema }).strict();
export const attendanceDailyEvaluationSchema = z.object({
  businessDate,
  scheduleSource: z.enum(["ROSTER", "EXCEPTION", "WEEKLY_ADJUSTMENT", "TEMPLATE", "NONE"]),
  scheduleKind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]).nullable(),
  state: z.enum(["NO_SCHEDULE", "REST_DAY", "MISSING_CHECK_IN", "IN_PROGRESS", "ON_TIME", "ATTENTION"]),
  plannedMinutes: z.number().int().nonnegative(), workedMinutes: z.number().int().nonnegative(), lateMinutes: z.number().int().nonnegative(), earlyLeaveMinutes: z.number().int().nonnegative(), extraMinutes: z.number().int().nonnegative(), shortageMinutes: z.number().int().nonnegative(), hasOpenSession: z.boolean(),
}).strict();
export const attendanceAlertQuerySchema = z.object({ date: businessDate.optional() }).strict();
export const attendanceAlertsReceiptSchema = z.object({
  date: businessDate,
  summary: z.object({ late: z.number().int().nonnegative(), missingCheckIn: z.number().int().nonnegative(), openSessions: z.number().int().nonnegative() }).strict(),
  alerts: z.array(z.object({ employeeId: uuid, employeeNumber: z.string(), employeeNameAr: z.string(), employeeNameEn: z.string().nullable(), type: z.enum(["LATE", "MISSING_CHECK_IN", "OPEN_SESSION"]), severity: z.enum(["INFO", "WARNING"]), businessDate, minutes: z.number().int().nonnegative(), messageAr: z.string() }).strict()).max(1_500),
}).strict();
export const attendanceDashboardQuerySchema = z.object({ date: businessDate.optional() }).strict();
export const attendanceDashboardReceiptSchema = z.object({
  date: businessDate,
  summary: z.object({ activeEmployees: z.number().int().nonnegative(), checkedIn: z.number().int().nonnegative(), checkedOut: z.number().int().nonnegative(), notRecorded: z.number().int().nonnegative(), openSessions: z.number().int().nonnegative() }).strict(),
  employees: z.array(z.object({ employeeId: uuid, employeeNumber: z.string(), employeeNameAr: z.string(), employeeNameEn: z.string().nullable(), state: z.enum(["NOT_RECORDED", "IN_PROGRESS", "CHECKED_OUT"]), checkInAt: dateTime.nullable(), checkOutAt: dateTime.nullable(), workedMinutes: z.number().int().nonnegative(), evaluation: attendanceDailyEvaluationSchema }).strict()).max(500),
}).strict();
export const attendanceReportQuerySchema = z.object({ from: businessDate, to: businessDate, employeeId: uuid.optional() }).strict();
export const attendanceReportReceiptSchema = z.object({ from: businessDate, to: businessDate, summary: z.object({ sessions: z.number().int().nonnegative(), completedSessions: z.number().int().nonnegative(), openSessions: z.number().int().nonnegative(), workedMinutes: z.number().int().nonnegative(), plannedMinutes: z.number().int().nonnegative(), lateMinutes: z.number().int().nonnegative(), earlyLeaveMinutes: z.number().int().nonnegative(), extraMinutes: z.number().int().nonnegative(), shortageMinutes: z.number().int().nonnegative(), missingCheckInDays: z.number().int().nonnegative() }).strict(), rows: z.array(z.object({ employeeId: uuid, employeeNumber: z.string(), employeeNameAr: z.string(), employeeNameEn: z.string().nullable(), sessions: z.number().int().nonnegative(), completedSessions: z.number().int().nonnegative(), workedMinutes: z.number().int().nonnegative(), plannedMinutes: z.number().int().nonnegative(), lateMinutes: z.number().int().nonnegative(), earlyLeaveMinutes: z.number().int().nonnegative(), extraMinutes: z.number().int().nonnegative(), shortageMinutes: z.number().int().nonnegative(), missingCheckInDays: z.number().int().nonnegative(), days: z.array(attendanceDailyEvaluationSchema).max(366) }).strict()).max(500) }).strict();
export const attendanceCoverageQuerySchema = z.object({ date: businessDate.optional() }).strict();
const attendanceCoveragePeriodSchema = z.object({ startMinute: z.number().int().min(0).max(2_880), endMinute: z.number().int().min(0).max(2_880) }).strict();
export const attendanceCoverageReceiptSchema = z.object({
  date: businessDate, weekStart: businessDate, intervalMinutes: z.literal(30), timelineStartMinute: z.number().int().min(0).max(1_440), timelineEndMinute: z.number().int().min(1).max(2_880),
  days: z.array(z.object({ date: businessDate, dayOfWeek: isoWeekday, plannedCounts: z.array(z.number().int().nonnegative()).max(96), actualCounts: z.array(z.number().int().nonnegative()).max(96) }).strict()).length(7),
  timeline: z.array(z.object({ employeeId: uuid, employeeNumber: z.string(), employeeNameAr: z.string(), employeeNameEn: z.string().nullable(), plannedPeriods: z.array(attendanceCoveragePeriodSchema).max(8), actualPeriods: z.array(attendanceCoveragePeriodSchema).max(8) }).strict()).max(500),
  summary: z.object({ peakCount: z.number().int().nonnegative(), peakStartMinute: z.number().int().min(0).max(2_880), peakEndMinute: z.number().int().min(0).max(2_880), gapStartMinute: z.number().int().min(0).max(2_880).nullable(), gapEndMinute: z.number().int().min(0).max(2_880).nullable(), actualAttendancePercent: z.number().int().min(0).max(100) }).strict(),
}).strict();

const attendanceRosterPeriodSchema = z.object({ startMinute: z.number().int().min(0).max(1_439), endMinute: z.number().int().min(0).max(1_439), endsNextDay: z.boolean() }).strict().superRefine((value, context) => {
  if ((!value.endsNextDay && value.endMinute <= value.startMinute) || (value.endsNextDay && value.endMinute >= value.startMinute)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid attendance roster period." });
});
const attendanceRosterEntryInputSchema = z.object({ employeeId: uuid, businessDate, kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]), periods: z.array(attendanceRosterPeriodSchema).max(4) }).strict().superRefine((value, context) => {
  if (value.kind === "FULL_REST" && value.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "A rest day cannot have work periods.", path: ["periods"] });
  if (value.kind === "CUSTOM_PERIODS" && !value.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "A roster workday needs at least one period.", path: ["periods"] });
});
const attendanceRosterPeakPeriodSchema = z.object({ businessDate, startMinute: z.number().int().min(0).max(2_879), endMinute: z.number().int().min(1).max(2_880) }).strict().superRefine((value, context) => {
  if (value.endMinute <= value.startMinute) context.addIssue({ code: z.ZodIssueCode.custom, message: "A peak period must end after it starts." });
  if (value.endMinute - value.startMinute > 1_440) context.addIssue({ code: z.ZodIssueCode.custom, message: "A peak period cannot exceed one day." });
});
function validatePeakPeriods(value: { peakPeriods: Array<{ businessDate: string; startMinute: number; endMinute: number }> }, context: z.RefinementCtx) {
  const byDay = new Map<string, Array<{ startMinute: number; endMinute: number }>>();
  for (const period of value.peakPeriods) byDay.set(period.businessDate, [...(byDay.get(period.businessDate) ?? []), period]);
  for (const [businessDateValue, periods] of byDay) {
    if (periods.length > 4) context.addIssue({ code: z.ZodIssueCode.custom, message: "A day can have at most four peak periods.", path: ["peakPeriods"] });
    const sorted = [...periods].sort((left, right) => left.startMinute - right.startMinute);
    if (sorted.some((period, index) => index > 0 && period.startMinute < sorted[index - 1]!.endMinute)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Peak periods cannot overlap on ${businessDateValue}.`, path: ["peakPeriods"] });
  }
}
export const attendanceRosterQuerySchema = z.object({ weekStart: businessDate.optional() }).strict();
export const saveAttendanceRosterDraftRequestSchema = z.object({
  weekStart: businessDate, baseRevision: z.number().int().positive().optional(), entries: z.array(attendanceRosterEntryInputSchema).max(3_500), peakPeriods: z.array(attendanceRosterPeakPeriodSchema).max(28).default([]), idempotencyKey,
}).strict().superRefine(validatePeakPeriods);
export const approveAttendanceRosterRequestSchema = z.object({
  planId: uuid, baseRevision: z.number().int().positive(), mode: z.enum(["WEEK", "TEMPORARY", "PERMANENT"]), effectiveFrom: businessDate.optional(), temporaryDays: z.union([z.literal(7), z.literal(10)]).optional(), idempotencyKey,
}).strict().superRefine((value, context) => {
  if (value.mode === "TEMPORARY" && !value.temporaryDays) context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose 7 or 10 days for a temporary roster.", path: ["temporaryDays"] });
  if (value.mode !== "TEMPORARY" && value.temporaryDays !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "Temporary duration is only valid for a temporary roster.", path: ["temporaryDays"] });
});
export const attendanceRosterReceiptSchema = z.object({
  weekStart: businessDate,
  days: z.array(businessDate).length(7),
  plan: z.object({ id: uuid, status: z.enum(["DRAFT", "APPROVED", "APPLIED"]), revision: z.number().int().positive(), approvalMode: z.enum(["WEEK", "TEMPORARY", "PERMANENT"]).nullable(), effectiveFrom: businessDate.nullable(), effectiveUntil: businessDate.nullable(), updatedAt: dateTime }).strict().nullable(),
  employees: z.array(z.object({ employeeId: uuid, employeeNumber: z.string(), employeeNameAr: z.string(), employeeNameEn: z.string().nullable(), entries: z.array(attendanceRosterEntryInputSchema).length(7) }).strict()).max(500),
  peakPeriods: z.array(attendanceRosterPeakPeriodSchema).max(28),
}).strict();

/** A template is a reusable schedule identity. Its work periods are immutable
 * snapshots with an effective date, never mutable rows that rewrite history. */
export const createAttendanceScheduleTemplateRequestSchema = z.object({
  nameAr: z.string().trim().min(1).max(160), nameEn: z.string().trim().max(160).optional(), effectiveFrom: businessDate,
  periods: z.array(weeklySchedulePeriodInputSchema).min(1).max(28), idempotencyKey,
}).strict();
export const updateAttendanceScheduleTemplateRequestSchema = z.object({ templateId: uuid, nameAr: z.string().trim().min(1).max(160), nameEn: z.string().trim().max(160).nullable().optional(), idempotencyKey }).strict();
export const createAttendanceScheduleVersionRequestSchema = z.object({ templateId: uuid, effectiveFrom: businessDate, periods: z.array(weeklySchedulePeriodInputSchema).min(1).max(28), idempotencyKey }).strict();
export const archiveAttendanceScheduleTemplateRequestSchema = z.object({ templateId: uuid, idempotencyKey }).strict();
export const assignAttendanceEmployeeScheduleRequestSchema = z.object({ employeeId: uuid, templateId: uuid, effectiveFrom: businessDate, idempotencyKey }).strict();
export const assignAttendanceEmployeesScheduleRequestSchema = z.object({ employeeIds: z.array(uuid).min(1).max(500).transform((values) => [...new Set(values)]), templateId: uuid, effectiveFrom: businessDate, idempotencyKey }).strict();
export const setAttendanceEmployeeWeeklyAdjustmentRequestSchema = z.object({
  employeeId: uuid, dayOfWeek: isoWeekday, effectiveFrom: businessDate, kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]), periods: z.array(schedulePeriodInputSchema).max(4), idempotencyKey,
}).strict().superRefine((value, context) => {
  if (value.kind === "FULL_REST" && value.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Full rest cannot have work periods.", path: ["periods"] });
  if (value.kind === "CUSTOM_PERIODS" && !value.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "A partial-day adjustment requires actual work periods.", path: ["periods"] });
});
export const configureAttendanceEmployeeScheduleRequestSchema = z.object({
  employeeId: uuid, templateId: uuid, effectiveFrom: businessDate,
  weeklyAdjustment: z.object({ dayOfWeek: isoWeekday, kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]), periods: z.array(schedulePeriodInputSchema).max(4) }).strict(),
  idempotencyKey,
}).strict().superRefine((value, context) => {
  const adjustment = value.weeklyAdjustment;
  if (adjustment.kind === "FULL_REST" && adjustment.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Full rest cannot have work periods.", path: ["weeklyAdjustment", "periods"] });
  if (adjustment.kind === "CUSTOM_PERIODS" && !adjustment.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "A partial-day adjustment requires actual work periods.", path: ["weeklyAdjustment", "periods"] });
});
export const createAttendanceScheduleExceptionRequestSchema = z.object({
  employeeId: uuid, businessDate, kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]), periods: z.array(schedulePeriodInputSchema).max(4), reason: z.string().trim().min(1).max(2_000), idempotencyKey,
}).strict().superRefine((value, context) => {
  if (value.kind === "FULL_REST" && value.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Full rest cannot have work periods.", path: ["periods"] });
  if (value.kind === "CUSTOM_PERIODS" && !value.periods.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "A custom exception requires actual work periods.", path: ["periods"] });
});
export const decideAttendanceScheduleExceptionRequestSchema = z.object({ exceptionId: uuid, decision: z.enum(["APPROVE", "REJECT", "CANCEL"]), decisionNote: z.string().trim().max(2_000).optional(), idempotencyKey }).strict();
export const attendanceScheduleTemplateSchema = z.object({
  id: uuid, nameAr: z.string(), nameEn: z.string().nullable(), status: z.enum(["ACTIVE", "ARCHIVED"]), archivedAt: dateTime.nullable(),
  versions: z.array(z.object({ id: uuid, versionNumber: z.number().int().positive(), effectiveFrom: businessDate, periods: z.array(z.object({ dayOfWeek: isoWeekday, startTime: scheduleTime, endTime: scheduleTime, endsNextDay: z.boolean(), minutes: z.number().int().positive() }).strict()) }).strict()),
}).strict();
export const attendanceEmployeeScheduleSchema = z.object({
  employeeId: uuid,
  assignments: z.array(z.object({ id: uuid, templateId: uuid, templateNameAr: z.string(), templateNameEn: z.string().nullable(), effectiveFrom: businessDate, createdAt: dateTime }).strict()),
  weeklyAdjustments: z.array(z.object({ id: uuid, dayOfWeek: isoWeekday, effectiveFrom: businessDate, kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]), periods: z.array(z.object({ startTime: scheduleTime, endTime: scheduleTime, endsNextDay: z.boolean(), minutes: z.number().int().positive() }).strict()), createdAt: dateTime }).strict()),
  exceptions: z.array(z.object({ id: uuid, businessDate, kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]), status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]), reason: z.string(), decisionNote: z.string().nullable(), decidedAt: dateTime.nullable(), periods: z.array(z.object({ startTime: scheduleTime, endTime: scheduleTime, endsNextDay: z.boolean(), minutes: z.number().int().positive() }).strict()), createdAt: dateTime }).strict()),
}).strict();
/** Cursor paging keeps the company-wide schedule screen within its documented
 * 500-employee response ceiling without silently omitting later employees. */
export const attendanceEmployeeScheduleListQuerySchema = z.object({
  cursor: uuid.optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(500),
}).strict();
export const attendanceEmployeeScheduleListReceiptSchema = z.object({
  schedules: z.array(attendanceEmployeeScheduleSchema).max(500),
  hasMore: z.boolean(),
  nextCursor: uuid.nullable(),
}).strict().superRefine((value, context) => {
  if (value.hasMore !== Boolean(value.nextCursor)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A continuation cursor is required exactly when another schedule page exists.", path: ["nextCursor"] });
  }
});
export const attendanceEffectiveEmployeeScheduleSchema = z.object({
  employeeId: uuid, businessDate, source: z.enum(["ROSTER", "EXCEPTION", "WEEKLY_ADJUSTMENT", "TEMPLATE", "NONE"]), kind: z.enum(["FULL_REST", "CUSTOM_PERIODS"]).nullable(), templateId: uuid.nullable(), templateVersionId: uuid.nullable(),
  periods: z.array(z.object({ startTime: scheduleTime, endTime: scheduleTime, endsNextDay: z.boolean(), minutes: z.number().int().positive() }).strict()),
}).strict();
export const attendanceEffectiveEmployeeScheduleQuerySchema = z.object({ date: businessDate }).strict();
export type SetAttendanceEmployeePinRequest = z.infer<typeof setAttendanceEmployeePinRequestSchema>;
export type CreateAttendanceBranchRequest = z.infer<typeof createAttendanceBranchRequestSchema>;
export type UpdateAttendanceBranchRequest = z.infer<typeof updateAttendanceBranchRequestSchema>;
export type AttendanceEmployeeRecordRequest = z.infer<typeof attendanceEmployeeRecordRequestSchema>;
export type AttendanceEmployeePortalSessionRequest = z.infer<typeof attendanceEmployeePortalSessionRequestSchema>;
export type AttendanceEmployeePinDisplayReceipt = z.infer<typeof attendanceEmployeePinDisplayReceiptSchema>;
export type AttendanceDashboardReceipt = z.infer<typeof attendanceDashboardReceiptSchema>;
export type AttendanceReportReceipt = z.infer<typeof attendanceReportReceiptSchema>;
export type AttendanceCoverageReceipt = z.infer<typeof attendanceCoverageReceiptSchema>;
export type AttendanceRosterReceipt = z.infer<typeof attendanceRosterReceiptSchema>;
export type SaveAttendanceRosterDraftRequest = z.infer<typeof saveAttendanceRosterDraftRequestSchema>;
export type ApproveAttendanceRosterRequest = z.infer<typeof approveAttendanceRosterRequestSchema>;
export type AttendanceDailyEvaluation = z.infer<typeof attendanceDailyEvaluationSchema>;
export type AttendanceAlertsReceipt = z.infer<typeof attendanceAlertsReceiptSchema>;
export type AttendanceEmployeeScheduleListQuery = z.infer<typeof attendanceEmployeeScheduleListQuerySchema>;
export type CreateAttendanceScheduleTemplateRequest = z.infer<typeof createAttendanceScheduleTemplateRequestSchema>;
export type UpdateAttendanceScheduleTemplateRequest = z.infer<typeof updateAttendanceScheduleTemplateRequestSchema>;
export type CreateAttendanceScheduleVersionRequest = z.infer<typeof createAttendanceScheduleVersionRequestSchema>;
export type ArchiveAttendanceScheduleTemplateRequest = z.infer<typeof archiveAttendanceScheduleTemplateRequestSchema>;
export type AssignAttendanceEmployeeScheduleRequest = z.infer<typeof assignAttendanceEmployeeScheduleRequestSchema>;
export type AssignAttendanceEmployeesScheduleRequest = z.infer<typeof assignAttendanceEmployeesScheduleRequestSchema>;
export type SetAttendanceEmployeeWeeklyAdjustmentRequest = z.infer<typeof setAttendanceEmployeeWeeklyAdjustmentRequestSchema>;
export type ConfigureAttendanceEmployeeScheduleRequest = z.infer<typeof configureAttendanceEmployeeScheduleRequestSchema>;
export type CreateAttendanceScheduleExceptionRequest = z.infer<typeof createAttendanceScheduleExceptionRequestSchema>;
export type DecideAttendanceScheduleExceptionRequest = z.infer<typeof decideAttendanceScheduleExceptionRequestSchema>;

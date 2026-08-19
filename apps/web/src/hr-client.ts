import { api, type ActiveSession } from "./daily-sales-client";

export type HrEmployeeStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED" | "ARCHIVED";
export type HrEmployee = { id: string; employeeNumber: string; nameAr: string; nameEn: string | null; jobTitle: string | null; phone: string | null; email: string | null; hireDate: string; status: HrEmployeeStatus; terminatedAt: string | null; notes: string | null };
export type HrService = { id: string; employeeId: string; serviceType: "IQAMA_ISSUANCE" | "IQAMA_RENEWAL" | "SPONSORSHIP_TRANSFER" | "EXIT_REENTRY_VISA" | "FLIGHT_TICKET" | "MEDICAL_INSURANCE" | "HEALTH_CERTIFICATE" | "OTHER"; referenceNumber: string | null; issueDate: string | null; expiryDate: string | null; supplier: { id: string; nameAr: string; nameEn: string | null } | null; category: { id: string; nameAr: string; nameEn: string } | null; outflowDocumentId: string | null; status: "DRAFT" | "ISSUED" | "CANCELLED"; notes: string | null };
export type HrMovement = { id: string; journalEntryId: string; movementType: "SERVICE_COST" | "PAYROLL_ACCRUAL" | "PAYROLL_PAYMENT" | "ADVANCE_ISSUED" | "ADVANCE_SETTLEMENT"; businessDate: string; amount: string; sourceReference: string; description: string | null };
export type HrDetail = { employee: HrEmployee; services: HrService[]; movements: HrMovement[]; hasMoreMovements: boolean; nextMovementCursor: string | null };
export type HrEmployeesReceipt = { employees: HrEmployee[] };
export type HrAdvance = { id: string; employeeId: string; employeeNameAr: string; employeeNameEn: string | null; advanceNumber: string; businessDate: string; originalAmount: string; settledAmount: string; remainingAmount: string; status: "ISSUED" | "PARTIALLY_SETTLED" | "SETTLED" | "REVERSED"; nextSettlementDate: string | null; notes: string | null; journalEntryId: string; allocations: Array<{ vaultId: string; vaultNameAr: string; vaultNameEn: string; paymentMethod: "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP"; amount: string }> };
export type HrAdvancesReceipt = { advances: HrAdvance[] };
export type HrAdvanceDetail = { advance: HrAdvance; settlements: Array<{ id: string; source: "PAYROLL" | "MANUAL_RECEIPT"; businessDate: string; amount: string; journalEntryId: string | null; sourceReference: string | null }>; deferrals: Array<{ id: string; businessDate: string; deferredUntil: string; reason: string }> };
export type HrAdministrativeDeduction = { id: string; employeeId: string; employeeNameAr: string; employeeNameEn: string | null; deductionNumber: string; businessDate: string; originalAmount: string; appliedAmount: string; remainingAmount: string; status: "OPEN" | "PARTIALLY_APPLIED" | "APPLIED" | "DEFERRED" | "CANCELLED"; plannedPayrollDate: string | null; description: string; cancellationReason: string | null };
export type HrAdministrativeDeductionsReceipt = { deductions: HrAdministrativeDeduction[] };
export type HrAdministrativeDeductionDetail = { deduction: HrAdministrativeDeduction; actions: Array<{ id: string; actionType: "CREATED" | "DEFERRED" | "CANCELLED" | "APPLIED" | "REVERSED"; businessDate: string; amount: string | null; plannedPayrollDate: string | null; reason: string | null }> };
export type HrPayrollStatus = "DRAFT" | "APPROVED" | "PARTIALLY_PAID" | "PAID" | "REVERSED";
export type HrPayrollRun = { id: string; runNumber: string; payrollMonth: string; businessDate: string; status: HrPayrollStatus; employeeCount: number; grossAmount: string; advanceSettlementAmount: string; administrativeDeductionAmount: string; netPayableAmount: string; paidAmount: string; notes: string | null; accrualJournalEntryId: string | null };
export type HrPayrollDetail = { payrollRun: HrPayrollRun; lines: Array<{ id: string; employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; grossSalary: string; advanceSettlementAmount: string; administrativeDeductionAmount: string; netPayableAmount: string; paidAmount: string; advances: Array<{ id: string; amount: string; referenceNumber: string }>; administrativeDeductions: Array<{ id: string; amount: string; referenceNumber: string }> }>; payments: Array<{ id: string; paymentNumber: string; businessDate: string; amount: string; journalEntryId: string }> };
export type HrPayrollRunsReceipt = { payrollRuns: HrPayrollRun[] };
export type HrEmployeeLeaveType = "ANNUAL" | "SICK" | "UNPAID" | "OTHER";
export type HrEmployeeLeaveStatus = "APPROVED" | "RETURNED";
export type HrEmployeeLeave = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeNameAr: string;
  employeeNameEn: string | null;
  leaveType: HrEmployeeLeaveType;
  status: HrEmployeeLeaveStatus;
  startDate: string;
  endDate: string;
  actualReturnDate: string | null;
  notes: string | null;
};
export type HrEmployeeLeavesReceipt = { leaves: HrEmployeeLeave[] };
export type HrEmployeeLeaveDetail = { leave: HrEmployeeLeave };

export function listHrEmployees(session: ActiveSession) { return api<HrEmployeesReceipt>(session, "/hr/employees"); }
export function listHrAdvances(session: ActiveSession) { return api<HrAdvancesReceipt>(session, "/hr/advances"); }
export function getHrAdvance(session: ActiveSession, advanceId: string) { return api<HrAdvanceDetail>(session, `/hr/advances/${encodeURIComponent(advanceId)}`); }
export function listHrAdministrativeDeductions(session: ActiveSession) { return api<HrAdministrativeDeductionsReceipt>(session, "/hr/deductions"); }
export function getHrAdministrativeDeduction(session: ActiveSession, deductionId: string) { return api<HrAdministrativeDeductionDetail>(session, `/hr/deductions/${encodeURIComponent(deductionId)}`); }
export function issueHrEmployeeAdvance(session: ActiveSession, payload: unknown) { return api(session, "/hr/advances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function settleHrEmployeeAdvanceDirectly(session: ActiveSession, payload: unknown) { return api(session, "/hr/advances/settle-directly", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function deferHrEmployeeAdvance(session: ActiveSession, payload: unknown) { return api(session, "/hr/advances/defer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function createHrEmployeeAdministrativeDeduction(session: ActiveSession, payload: unknown) { return api(session, "/hr/deductions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function deferHrEmployeeAdministrativeDeduction(session: ActiveSession, payload: unknown) { return api(session, "/hr/deductions/defer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function cancelHrEmployeeAdministrativeDeduction(session: ActiveSession, payload: unknown) { return api(session, "/hr/deductions/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function getHrEmployee(session: ActiveSession, employeeId: string, cursor?: string) { return api<HrDetail>(session, `/hr/employees/${encodeURIComponent(employeeId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); }
export function listHrEmployeeLeaves(session: ActiveSession) { return api<HrEmployeeLeavesReceipt>(session, "/hr/leaves"); }
export function getHrEmployeeLeave(session: ActiveSession, leaveId: string) { return api<HrEmployeeLeaveDetail>(session, `/hr/leaves/${encodeURIComponent(leaveId)}`); }
export function createHrEmployeeLeave(session: ActiveSession, payload: unknown) { return api(session, "/hr/leaves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function recordHrEmployeeReturn(session: ActiveSession, payload: unknown) { return api(session, "/hr/leaves/return", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function listHrPayrollRuns(session: ActiveSession) { return api<HrPayrollRunsReceipt>(session, "/hr/payroll-runs"); }
export function getHrPayrollRun(session: ActiveSession, payrollRunId: string) { return api<HrPayrollDetail>(session, `/hr/payroll-runs/${encodeURIComponent(payrollRunId)}`); }
export function setHrEmployeeCompensation(session: ActiveSession, payload: unknown) { return api(session, "/hr/compensation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function createHrPayrollRun(session: ActiveSession, payload: unknown) { return api(session, "/hr/payroll-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function approveHrPayrollRun(session: ActiveSession, payload: unknown) { return api(session, "/hr/payroll-runs/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function payHrPayrollRun(session: ActiveSession, payload: unknown) { return api(session, "/hr/payroll-runs/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function reverseHrPayrollRun(session: ActiveSession, payload: unknown) { return api(session, "/hr/payroll-runs/reverse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }

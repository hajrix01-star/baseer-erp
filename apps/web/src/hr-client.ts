import { api, type ActiveSession } from "./daily-sales-client";

export type HrEmployeeStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED" | "ARCHIVED";
export type HrEmployee = { id: string; employeeNumber: string; nameAr: string; nameEn: string | null; jobTitle: string | null; phone: string | null; email: string | null; hireDate: string; status: HrEmployeeStatus; terminatedAt: string | null; notes: string | null };
export type HrService = { id: string; employeeId: string; serviceType: "IQAMA_RENEWAL" | "SPONSORSHIP_TRANSFER" | "EXIT_REENTRY_VISA" | "FLIGHT_TICKET" | "MEDICAL_INSURANCE" | "HEALTH_CERTIFICATE" | "OTHER"; referenceNumber: string | null; issueDate: string | null; expiryDate: string | null; supplier: { id: string; nameAr: string; nameEn: string | null } | null; category: { id: string; nameAr: string; nameEn: string } | null; outflowDocumentId: string | null; status: "DRAFT" | "ISSUED" | "CANCELLED"; notes: string | null };
export type HrMovement = { id: string; journalEntryId: string; movementType: "SERVICE_COST" | "PAYROLL_ACCRUAL" | "PAYROLL_PAYMENT" | "ADVANCE_ISSUED" | "ADVANCE_SETTLEMENT"; businessDate: string; amount: string; sourceReference: string; description: string | null };
export type HrDetail = { employee: HrEmployee; services: HrService[]; movements: HrMovement[]; hasMoreMovements: boolean; nextMovementCursor: string | null };
export type HrEmployeesReceipt = { employees: HrEmployee[] };
export type HrAdvance = { id: string; employeeId: string; employeeNameAr: string; employeeNameEn: string | null; advanceNumber: string; businessDate: string; originalAmount: string; settledAmount: string; remainingAmount: string; status: "ISSUED" | "PARTIALLY_SETTLED" | "SETTLED" | "REVERSED"; notes: string | null; journalEntryId: string; allocations: Array<{ vaultId: string; vaultNameAr: string; vaultNameEn: string; paymentMethod: "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP"; amount: string }> };
export type HrAdvancesReceipt = { advances: HrAdvance[] };

export function listHrEmployees(session: ActiveSession) { return api<HrEmployeesReceipt>(session, "/hr/employees"); }
export function listHrAdvances(session: ActiveSession) { return api<HrAdvancesReceipt>(session, "/hr/advances"); }
export function issueHrEmployeeAdvance(session: ActiveSession, payload: unknown) { return api(session, "/hr/advances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function getHrEmployee(session: ActiveSession, employeeId: string, cursor?: string) { return api<HrDetail>(session, `/hr/employees/${encodeURIComponent(employeeId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); }
export function createHrEmployeeService(session: ActiveSession, payload: unknown) { return api(session, "/hr/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function issueHrEmployeeServiceCost(session: ActiveSession, payload: unknown) { return api(session, "/hr/services/issue-cost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }

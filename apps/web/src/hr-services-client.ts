import { api, type ActiveSession } from "./daily-sales-client";

export type HrEmployee = {
  id: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED" | "ARCHIVED";
};

export type HrService = {
  id: string;
  employeeId: string;
  serviceType: "IQAMA_ISSUANCE" | "IQAMA_RENEWAL" | "SPONSORSHIP_TRANSFER" | "EXIT_REENTRY_VISA" | "FLIGHT_TICKET" | "MEDICAL_INSURANCE" | "HEALTH_CERTIFICATE" | "OTHER";
  referenceNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  supplier: { id: string; nameAr: string; nameEn: string | null } | null;
  category: { id: string; nameAr: string; nameEn: string } | null;
  outflowDocumentId: string | null;
  costStatus: "NOT_ISSUED" | "POSTED" | "REVERSED";
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  notes: string | null;
};

export type HrEmployeeServiceComplianceStatus = "ACTIVE" | "RENEWED" | "CANCELLED";
export type HrEmployeeServiceRecord = HrService & {
  employee: Pick<HrEmployee, "id" | "employeeNumber" | "nameAr" | "nameEn">;
  complianceStatus: HrEmployeeServiceComplianceStatus;
  visaDurationMonths: number | null;
  renewalOfServiceId: string | null;
};

type HrEmployeesReceipt = { employees: HrEmployee[]; hasMore: boolean; nextCursor: string | null };
type HrEmployeeServicesReceipt = { services: HrEmployeeServiceRecord[]; hasMore: boolean; nextCursor: string | null; summary: { count: number; expired: number; due30: number; due90: number } };
type HrEmployeeServiceDetail = { service: HrEmployeeServiceRecord };

export function listHrEmployees(session: ActiveSession, query: { status?: HrEmployee["status"]; search?: string; cursor?: string; pageSize?: number } = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") parameters.set(key, String(value));
  return api<HrEmployeesReceipt>(session, `/hr/employees${parameters.size ? `?${parameters}` : ""}`);
}
export function createHrEmployeeService(session: ActiveSession, payload: unknown) { return api(session, "/hr/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function recordHrEmployeeServiceAndIssueCost(session: ActiveSession, payload: unknown) { return api(session, "/hr/services/record-and-issue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function issueHrEmployeeServiceCost(session: ActiveSession, payload: unknown) { return api(session, "/hr/services/issue-cost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function reverseHrEmployeeServiceCost(session: ActiveSession, payload: unknown) { return api(session, "/hr/services/reverse-cost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function listHrEmployeeServices(session: ActiveSession, query: { employeeId?: string; serviceType?: HrService["serviceType"]; complianceStatus?: HrEmployeeServiceComplianceStatus; search?: string; expiryBefore?: string; expiryAfter?: string; cursor?: string; pageSize?: number } = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") parameters.set(key, String(value));
  return api<HrEmployeeServicesReceipt>(session, `/hr/services${parameters.size ? `?${parameters}` : ""}`);
}
export function getHrEmployeeService(session: ActiveSession, serviceId: string) { return api<HrEmployeeServiceDetail>(session, `/hr/services/${encodeURIComponent(serviceId)}`); }
export function updateHrEmployeeService(session: ActiveSession, payload: unknown) { return api(session, "/hr/services/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function cancelHrEmployeeService(session: ActiveSession, payload: unknown) { return api(session, "/hr/services/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
export function renewHrEmployeeService(session: ActiveSession, payload: unknown) { return api(session, "/hr/services/renew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }

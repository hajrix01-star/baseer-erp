import { api, requestId, type ActiveSession } from "./daily-sales-client";
import type { AdministrationOverview } from "./administration-types";

const jsonHeaders = () => ({ "Content-Type": "application/json", "X-Request-Id": requestId() });

export const loadAdministrationOverview = (session: ActiveSession) => api<AdministrationOverview>(session, "/administration/overview");
export const createAdministrationCompany = (session: ActiveSession, body: { nameAr: string; nameEn: string }) => api(session, "/administration/companies", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ...body, businessTimezone: "Asia/Riyadh" }) });
export const createAdministrationUser = (session: ActiveSession, body: { login: string; nameAr: string; nameEn: string; password: string; preferredLanguage: "ar" | "en"; avatarKind: "INITIALS" | "MALE" | "FEMALE"; companyId: string; roleId: string }) => api(session, "/administration/users", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) });
export const createAdministrationRole = (session: ActiveSession, body: { code: string; nameAr: string; nameEn: string; permissionCodes: string[] }) => api(session, "/administration/roles", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) });
export const updateAdministrationUserStatus = (session: ActiveSession, userId: string, status: "ACTIVE" | "DISABLED", reason: string) => api(session, `/administration/users/${userId}/status`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ status, reason }) });
export const resetAdministrationUserPassword = (session: ActiveSession, userId: string, password: string, reason: string) => api(session, `/administration/users/${userId}/reset-password`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ password, reason }) });
export const withdrawAdministrationMembership = (session: ActiveSession, userId: string, companyId: string, reason: string) => api(session, `/administration/memberships/${userId}/${companyId}`, { method: "DELETE", headers: jsonHeaders(), body: JSON.stringify({ reason }) });
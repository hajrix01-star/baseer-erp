import { api, requestId, type ActiveSession } from "./daily-sales-client";
import type { AdministrationOverview } from "./administration-types";

const jsonHeaders = () => ({ "Content-Type": "application/json", "X-Request-Id": requestId() });

export const loadAdministrationOverview = (session: ActiveSession) => api<AdministrationOverview>(session, "/administration/overview");
export const createAdministrationCompany = (session: ActiveSession, body: { nameAr: string; nameEn: string }) => api(session, "/administration/companies", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ...body, businessTimezone: "Asia/Riyadh" }) });
export async function uploadAdministrationCompanyLogo(session: ActiveSession, companyId: string, file: File): Promise<{ id: string; mimeType: string; byteSize: number }> {
  const contentBase64 = await fileToBase64(file);
  return api(session, `/administration/companies/${companyId}/logo`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ fileName: file.name, contentBase64 }) });
}
export async function loadAdministrationCompanyLogo(session: ActiveSession, companyId: string): Promise<string | null> {
  const response = await fetch(`/v1/administration/companies/${companyId}/logo`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load company logo.");
  return URL.createObjectURL(await response.blob());
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected logo."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}
export const updateAdministrationCompany = (session: ActiveSession, companyId: string, body: { nameAr: string; nameEn: string; businessTimezone: string; logoFileMetadataId: string | null }) => api(session, `/administration/companies/${companyId}/settings`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(body) });
export const updateAdministrationCompanyStatus = (session: ActiveSession, companyId: string, status: "ACTIVE" | "ARCHIVED", reason?: string) => api(session, `/administration/companies/${companyId}/status`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(reason ? { status, reason } : { status }) });
export const createAdministrationUser = (session: ActiveSession, body: { login: string; nameAr: string; nameEn: string; password: string; preferredLanguage: "ar" | "en"; avatarKind: "INITIALS" | "MALE" | "FEMALE"; companyId: string; roleId: string }) => api(session, "/administration/users", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) });
export const createAdministrationRole = (session: ActiveSession, body: { code: string; nameAr: string; nameEn: string; permissionCodes: string[] }) => api(session, "/administration/roles", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) });
export const updateAdministrationRole = (session: ActiveSession, roleId: string, body: { nameAr: string; nameEn: string; permissionCodes: string[] }) => api(session, `/administration/roles/${roleId}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(body) });
export const deleteAdministrationRole = (session: ActiveSession, roleId: string) => api(session, `/administration/roles/${roleId}`, { method: "DELETE", headers: jsonHeaders(), body: JSON.stringify({}) });
export const assignAdministrationMembership = (session: ActiveSession, body: { userId: string; companyId: string; roleId: string }) => api(session, "/administration/memberships", { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(body) });
export const updateAdministrationUserStatus = (session: ActiveSession, userId: string, status: "ACTIVE" | "DISABLED", reason: string) => api(session, `/administration/users/${userId}/status`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ status, reason }) });
export const resetAdministrationUserPassword = (session: ActiveSession, userId: string, password: string, reason: string) => api(session, `/administration/users/${userId}/reset-password`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ password, reason }) });
export const withdrawAdministrationMembership = (session: ActiveSession, userId: string, companyId: string, reason: string) => api(session, `/administration/memberships/${userId}/${companyId}`, { method: "DELETE", headers: jsonHeaders(), body: JSON.stringify({ reason }) });
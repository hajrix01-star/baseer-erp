import { baseerApiBaseUrl } from "./daily-sales-client";
import { parseBaseerApiResponse } from "./baseer-api-error";

export type AuthenticatedCompany = { id: string; nameAr: string; nameEn: string };
export type SignInSession = { accessToken: string };

export async function signInForDailySales(input: {
  tenantCode: string;
  login: string;
  password: string;
}): Promise<SignInSession> {
  const response = await fetch(`${baseerApiBaseUrl}/auth/sign-in`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Baseer-Tenant-Code": input.tenantCode,
    },
    body: JSON.stringify({ login: input.login, password: input.password }),
  });
  return parseBaseerApiResponse<SignInSession>(response);
}

export async function listAuthenticatedCompanies(accessToken: string): Promise<AuthenticatedCompany[]> {
  const response = await fetch(`${baseerApiBaseUrl}/companies/available`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });
  const receipt = await parseBaseerApiResponse<{ companies: AuthenticatedCompany[] }>(response);
  return receipt.companies;
}
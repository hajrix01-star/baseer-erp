/**
 * Context supplied only after the authentication and company-authorization
 * boundary has completed. These services deliberately do not authenticate or
 * authorize a caller themselves.
 */
export interface TrustedCompanyActorContext {
  readonly tenantId: string;
  readonly companyId: string;
  readonly actorUserId: string;
}

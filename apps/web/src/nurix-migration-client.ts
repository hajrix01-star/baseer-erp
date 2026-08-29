import { api, requestId, type ActiveSession } from './daily-sales-client';

export type NurixDirectCandidate = { kind: 'CATEGORY_DIRECT' | 'ACCOUNT_CODE_TYPE'; count: number; approved: boolean };
export type NurixMigrationRun = {
  id: string; sourceSystem: 'NOORIX_POSTGRES_ARCHIVE'; sourceFingerprintPrefix: string; transformVersion: string;
  status: string; companyCount: number; directCandidates: NurixDirectCandidate[];
  counterpartyResolutions: { explicitAlias: number; manual: number };
  supplierReadiness: { candidates: number; resolved: number; unresolved: number; companyMaps: number; approvedCompanyMaps: number; categoryCandidatesApproved: boolean; accountCandidatesApproved: boolean; provisionalSuppliers: number; provisionalVaults: number; canCreateProvisionalSuppliers: boolean; canStage: boolean };
  exceptionCounts: { blockers: number; review: number; warnings: number }; createdAt: string;
};
export type NurixMigrationException = { id: string; severity: 'BLOCKER' | 'REVIEW' | 'WARNING'; code: string; message: string; sourceEntity: string | null; acknowledged: boolean; createdAt: string };
export type NurixMigrationReview = { run: NurixMigrationRun; exceptions: NurixMigrationException[]; actions: Array<{ id: string; kind: string; actionKey: string; reason: string; createdAt: string }> };
export type NurixCounterpartyIdentity = { id: string; canonicalKey: string; canonicalNameAr: string; kind: 'COMMERCIAL_SUPPLIER' | 'GOVERNMENT_AUTHORITY' | 'GOVERNMENT_PLATFORM' | 'UTILITY_PROVIDER' | 'OTHER' };
export type NurixCounterpartyCandidate = { id: string; sourceCompanyId: string; sourceSupplierId: string; nameAr: string; nameEn: string | null; kind: 'EXPLICIT_ALIAS' | 'REVIEW_REQUIRED'; resolution: { kind: 'EXPLICIT_ALIAS' | 'MANUAL'; identity: NurixCounterpartyIdentity } | null };
export type NurixCounterpartyQueue = { candidates: NurixCounterpartyCandidate[]; identities: NurixCounterpartyIdentity[]; nextCursor: string | null };
export type NurixCounterpartyReviewGroup = { key: string; nameAr: string; count: number; companyCount: number };
export type NurixCounterpartyReviewGroups = { groups: NurixCounterpartyReviewGroup[]; identities: NurixCounterpartyIdentity[] };
export type NurixCounterpartySuggestion = { groupKey: string; nameAr: string; count: number; companyCount: number; action: 'MATCH_EXISTING_IDENTITY' | 'CREATE_COMMERCIAL_GROUP' | 'REVIEW_MANUALLY'; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; reasonAr: string; identity: NurixCounterpartyIdentity | null };
export type NurixCounterpartySuggestions = { suggestions: NurixCounterpartySuggestion[]; summary: { high: number; medium: number; low: number } };

const json = () => ({ 'Content-Type': 'application/json', 'X-Request-Id': requestId() });

export const loadNurixMigrationRuns = (session: ActiveSession) => api<{ runs: NurixMigrationRun[] }>(session, '/nurix-migration/runs');
export const loadNurixMigrationReview = (session: ActiveSession, runId: string) => api<NurixMigrationReview>(session, `/nurix-migration/runs/${runId}/review`);
export const loadNurixCounterpartyQueue = (session: ActiveSession, runId: string, cursor?: string) => api<NurixCounterpartyQueue>(session, `/nurix-migration/runs/${runId}/counterparties${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const loadNurixCounterpartyReviewGroups = (session: ActiveSession, runId: string) => api<NurixCounterpartyReviewGroups>(session, `/nurix-migration/runs/${runId}/counterparty-review-groups`);
export const loadNurixCounterpartySuggestions = (session: ActiveSession, runId: string) => api<NurixCounterpartySuggestions>(session, `/nurix-migration/runs/${runId}/counterparty-suggestions`);
export const approveNurixDirectCandidates = (session: ActiveSession, runId: string, kind: NurixDirectCandidate['kind'], reason: string) => api(session, `/nurix-migration/runs/${runId}/direct-candidates/approve`, { method: 'POST', headers: json(), body: JSON.stringify({ kind, reason }) });
export const approveNurixCompanyMaps = (session: ActiveSession, runId: string, reason: string) => api(session, `/nurix-migration/runs/${runId}/company-maps/approve`, { method: 'POST', headers: json(), body: JSON.stringify({ reason }) });
export const createNurixProvisionalSuppliers = (session: ActiveSession, runId: string, reason: string) => api<{ created: number; reused: number; linkedToExistingIdentity: number; total: number }>(session, `/nurix-migration/runs/${runId}/provisional-suppliers`, { method: 'POST', headers: json(), body: JSON.stringify({ reason }) });
export const acknowledgeNurixMigrationException = (session: ActiveSession, runId: string, exceptionId: string, reason: string) => api(session, `/nurix-migration/runs/${runId}/exceptions/${exceptionId}/acknowledge`, { method: 'POST', headers: json(), body: JSON.stringify({ reason }) });
export const resolveNurixCounterparty = (session: ActiveSession, runId: string, candidateId: string, identityId: string, reason: string) => api(session, `/nurix-migration/runs/${runId}/counterparties/${candidateId}/resolve`, { method: 'POST', headers: json(), body: JSON.stringify({ identityId, reason }) });
export const createCommercialNurixCounterparty = (session: ActiveSession, runId: string, candidateId: string, reason: string) => api(session, `/nurix-migration/runs/${runId}/counterparties/${candidateId}/create-commercial-identity`, { method: 'POST', headers: json(), body: JSON.stringify({ reason }) });
export const resolveNurixCounterpartyReviewGroup = (session: ActiveSession, runId: string, groupKey: string, identityId: string, reason: string) => api(session, `/nurix-migration/runs/${runId}/counterparty-review-groups/${groupKey}/resolve`, { method: 'POST', headers: json(), body: JSON.stringify({ identityId, reason }) });
export const createCommercialNurixCounterpartyReviewGroup = (session: ActiveSession, runId: string, groupKey: string, reason: string) => api(session, `/nurix-migration/runs/${runId}/counterparty-review-groups/${groupKey}/create-commercial-identity`, { method: 'POST', headers: json(), body: JSON.stringify({ reason }) });

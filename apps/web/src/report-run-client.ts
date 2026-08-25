import { api, type ActiveSession } from './daily-sales-client';

export type OfficialReportRunPurpose = 'evidence' | 'preview' | 'xlsx' | 'save';

export type OfficialReportRunRequest = Readonly<{
  reportCode: 'ledger_trial_balance' | 'personal_cash_performance' | 'internal_vat_report';
  purpose: OfficialReportRunPurpose;
  request: Readonly<Record<string, unknown>>;
}>;

/**
 * Viewing a report is live. This creates the separate, immutable boundary
 * required only for evidence, output, or retention actions.
 */
export async function createOfficialReportRun(session: ActiveSession, input: OfficialReportRunRequest, companyId?: string): Promise<string> {
  const receipt = await api<{ reportRunId: string }>(session, '/reports/official-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(companyId ? { 'X-Baseer-Company-Id': companyId } : {}) },
    body: JSON.stringify(input),
  });
  if (!receipt.reportRunId) throw new Error('The official report run was not created.');
  return receipt.reportRunId;
}

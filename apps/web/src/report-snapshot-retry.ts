import { BaseerApiError } from "./baseer-api-error";

/**
 * Report runs are intentionally short-lived immutable snapshots. A detail
 * request can therefore outlive the page snapshot without the route itself
 * being missing. Renew the parent report once, then retry against its new run.
 */
export class ReportSnapshotRefreshError extends Error {
  constructor() {
    super("The report snapshot could not be refreshed.");
    this.name = "ReportSnapshotRefreshError";
  }
}

export function isExpiredReportSnapshot(error: unknown): boolean {
  return error instanceof BaseerApiError && error.code === "REPORT_RUN_EXPIRED";
}

export async function withFreshReportRun<T>(
  request: (reportRunId: string) => Promise<T>,
  currentRunId: () => string,
  renewRun: () => Promise<string | null>,
): Promise<T> {
  const availableRunId = currentRunId() || await renewRun();
  if (!availableRunId) throw new ReportSnapshotRefreshError();
  try {
    return await request(availableRunId);
  } catch (error) {
    if (!isExpiredReportSnapshot(error)) throw error;
    const renewedRunId = await renewRun();
    if (!renewedRunId) throw new ReportSnapshotRefreshError();
    return request(renewedRunId);
  }
}

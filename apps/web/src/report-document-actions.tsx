import { useState } from 'react';

import { presentBaseerApiError } from './baseer-api-error';
import { BaseerShareMenu } from './baseer-share-menu';
import { api, type ActiveSession } from './daily-sales-client';
import { downloadReportDocument, openReportPrintWindow, printReportDocument, renderReportRunDocument } from './report-document-client';
import { ReportSnapshotRefreshError, withFreshReportRun } from './report-snapshot-retry';
import type { OfficialReportRunPurpose } from './report-run-client';

type Language = 'ar' | 'en';

/** Contextual report actions. A report is never retained unless save is pressed. */
export function ReportDocumentActions({ session, createReportRun, language, companyId }: { session: ActiveSession; createReportRun: (purpose: OfficialReportRunPurpose) => Promise<string | null>; language: Language; companyId?: string }) {
  const [busy, setBusy] = useState<'preview' | 'xlsx' | 'save' | null>(null);
  const [message, setMessage] = useState('');
  const text = language === 'ar'
    ? { share: 'مشاركة', print: 'طباعة', excel: 'تصدير Excel', save: 'حفظ في مستندات التقارير', printing: 'جارٍ تجهيز الطباعة…', exporting: 'جارٍ التصدير…', saving: 'جارٍ الحفظ…', saved: 'تم حفظ لقطة التقرير في مستندات التقارير.', snapshotExpired: 'انتهت صلاحية لقطة التقرير وتعذر تجديدها. حدّث التقرير ثم أعد المحاولة.' }
    : { share: 'Share', print: 'Print', excel: 'Export Excel', save: 'Save to report documents', printing: 'Preparing print…', exporting: 'Exporting…', saving: 'Saving…', saved: 'The report snapshot was saved to report documents.', snapshotExpired: 'The report snapshot expired and could not be refreshed. Refresh the report and try again.' };
  const freshRun = async (purpose: OfficialReportRunPurpose) => {
    const reportRunId = await createReportRun(purpose);
    if (!reportRunId) throw new ReportSnapshotRefreshError();
    return reportRunId;
  };
  const render = async (format: 'preview' | 'xlsx') => {
    const reportRunId = await freshRun(format);
    return withFreshReportRun((nextRunId) => renderReportRunDocument(session, { reportRunId: nextRunId, locale: language, format }, companyId), () => reportRunId, () => freshRun(format));
  };
  const print = async () => {
    let target: Window;
    try { target = openReportPrintWindow(); } catch (error) { setMessage(presentBaseerApiError(error, language, text.print)); return; }
    setBusy('preview'); setMessage('');
    try { printReportDocument(await render('preview'), target); }
    catch (error) { target.close(); setMessage(error instanceof ReportSnapshotRefreshError ? text.snapshotExpired : presentBaseerApiError(error, language, text.print)); }
    finally { setBusy(null); }
  };
  const excel = async () => {
    setBusy('xlsx'); setMessage('');
    try {
      downloadReportDocument(await render('xlsx'));
    } catch (error) { setMessage(error instanceof ReportSnapshotRefreshError ? text.snapshotExpired : presentBaseerApiError(error, language, text.excel)); }
    finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save'); setMessage('');
    try { const reportRunId = await freshRun('save'); const receipt = await withFreshReportRun((nextRunId) => api<{ reused: boolean }>(session, '/reports/documents', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(companyId ? { 'X-Baseer-Company-Id': companyId } : {}) }, body: JSON.stringify({ reportRunId: nextRunId, locale: language }) }), () => reportRunId, () => freshRun('save')); setMessage(receipt.reused ? text.saved : text.saved); }
    catch (error) { setMessage(error instanceof ReportSnapshotRefreshError ? text.snapshotExpired : presentBaseerApiError(error, language, text.save)); }
    finally { setBusy(null); }
  };
  return <BaseerShareMenu label={text.share} message={message}><button type="button" role="menuitem" disabled={busy !== null} onClick={() => void print()}>{text.print}</button><button type="button" role="menuitem" disabled={busy !== null} onClick={() => void excel()}>{text.excel}</button><button type="button" role="menuitem" disabled={busy !== null} onClick={() => void save()}>{text.save}</button></BaseerShareMenu>;
}

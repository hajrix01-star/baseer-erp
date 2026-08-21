import { useState } from 'react';

import { presentBaseerApiError } from './baseer-api-error';
import { BaseerShareMenu } from './baseer-share-menu';
import { api, type ActiveSession } from './daily-sales-client';
import { downloadReportDocument, openReportPrintWindow, printReportDocument, renderReportRunDocument } from './report-document-client';

type Language = 'ar' | 'en';

/** Contextual report actions. A report is never retained unless save is pressed. */
export function ReportDocumentActions({ session, reportRunId, language }: { session: ActiveSession; reportRunId: string; language: Language }) {
  const [busy, setBusy] = useState<'preview' | 'xlsx' | 'save' | null>(null);
  const [message, setMessage] = useState('');
  const text = language === 'ar'
    ? { share: 'مشاركة', print: 'طباعة', excel: 'تصدير Excel', save: 'حفظ في مستندات التقارير', printing: 'جارٍ تجهيز الطباعة…', exporting: 'جارٍ التصدير…', saving: 'جارٍ الحفظ…', saved: 'تم حفظ لقطة التقرير في مستندات التقارير.' }
    : { share: 'Share', print: 'Print', excel: 'Export Excel', save: 'Save to report documents', printing: 'Preparing print…', exporting: 'Exporting…', saving: 'Saving…', saved: 'The report snapshot was saved to report documents.' };
  const render = async (format: 'preview' | 'xlsx') => renderReportRunDocument(session, { reportRunId, locale: language, format });
  const print = async () => {
    let target: Window;
    try { target = openReportPrintWindow(); } catch (error) { setMessage(presentBaseerApiError(error, language, text.print)); return; }
    setBusy('preview'); setMessage('');
    try { printReportDocument(await render('preview'), target); }
    catch (error) { target.close(); setMessage(presentBaseerApiError(error, language, text.print)); }
    finally { setBusy(null); }
  };
  const excel = async () => {
    setBusy('xlsx'); setMessage('');
    try {
      downloadReportDocument(await render('xlsx'));
    } catch (error) { setMessage(presentBaseerApiError(error, language, text.excel)); }
    finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save'); setMessage('');
    try { const receipt = await api<{ reused: boolean }>(session, '/reports/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportRunId, locale: language }) }); setMessage(receipt.reused ? text.saved : text.saved); }
    catch (error) { setMessage(presentBaseerApiError(error, language, text.save)); }
    finally { setBusy(null); }
  };
  return <BaseerShareMenu label={text.share} message={message}><button type="button" role="menuitem" disabled={busy !== null} onClick={() => void print()}>{text.print}</button><button type="button" role="menuitem" disabled={busy !== null} onClick={() => void excel()}>{text.excel}</button><button type="button" role="menuitem" disabled={busy !== null} onClick={() => void save()}>{text.save}</button></BaseerShareMenu>;
}

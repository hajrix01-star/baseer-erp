import { useCallback, useEffect, useState } from 'react';

import { BaseerButton } from './baseer-button';
import { BaseerCard } from './baseer-card';
import { presentBaseerApiError } from './baseer-api-error';
import { BaseerShareMenu } from './baseer-share-menu';
import { DailySalesSignIn } from './daily-sales-sign-in';
import { activeSession, api, type ActiveSession } from './daily-sales-client';
import { downloadReportDocument, openReportPrintWindow, printReportDocument, renderSavedReportDocument } from './report-document-client';

type Language = 'ar' | 'en';
type Document = Readonly<{ id: string; reportRunId: string; reportCode: 'ledger_trial_balance' | 'personal_cash_performance' | 'internal_vat_report'; title: string; locale: Language; createdAt: string }>;

const copy = { ar: { title: 'مستندات التقارير', description: 'اللقطات التي اخترت حفظها فقط. لا تُضاف التقارير المعروضة تلقائياً.', loading: 'يتم تحميل المستندات…', empty: 'لم تحفظ أي مستندات تقارير بعد.', print: 'طباعة', excel: 'تصدير Excel', retry: 'إعادة المحاولة', printing: 'جارٍ تجهيز الطباعة…', exporting: 'جارٍ التصدير…' }, en: { title: 'Report documents', description: 'Only report snapshots that you chose to retain. Viewing a report never adds it here.', loading: 'Loading documents…', empty: 'No report documents have been saved yet.', print: 'Print', excel: 'Export Excel', retry: 'Retry', printing: 'Preparing print…', exporting: 'Exporting…' } } as const;

export function ReportDocumentsWorkspace({ language }: { language: Language }) {
  const text = copy[language]; const [session, setSession] = useState<ActiveSession | null>(activeSession); const [documents, setDocuments] = useState<readonly Document[]>([]); const [loading, setLoading] = useState(() => activeSession() !== null); const [message, setMessage] = useState(''); const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => { const current = activeSession(); setSession(current); if (!current) { setLoading(false); return; } setLoading(true); setMessage(''); try { const result = await api<{ documents: readonly Document[] }>(current, `/reports/documents?locale=${language}`); setDocuments(result.documents); } catch (error) { setMessage(presentBaseerApiError(error, language, text.title)); } finally { setLoading(false); } }, [language, text.title]);
  useEffect(() => { void load(); }, [load]);
  const render = async (reportDocument: Document, format: 'preview' | 'xlsx') => { if (!session) return; let target: Window | null = null; try { if (format === 'preview') target = openReportPrintWindow(); setBusyId(`${reportDocument.id}:${format}`); setMessage(''); const artifact = await renderSavedReportDocument(session, reportDocument.id, format); if (format === 'preview') printReportDocument(artifact, target!); else downloadReportDocument(artifact); } catch (error) { target?.close(); setMessage(presentBaseerApiError(error, language, format === 'preview' ? text.print : text.excel)); } finally { setBusyId(null); } };
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="report-documents" dir={language === 'ar' ? 'rtl' : 'ltr'}><header className="report-documents__intro"><h2>{text.title}</h2><p>{text.description}</p></header>{loading ? <p className="reports-overview__notice">{text.loading}</p> : null}{message ? <div className="reports-overview__notice is-error"><p>{message}</p><BaseerButton type="button" variant="secondary" onClick={() => void load()}>{text.retry}</BaseerButton></div> : null}{!loading && !documents.length ? <p className="reports-overview__notice">{text.empty}</p> : null}<div className="report-documents__list">{documents.map((document) => <BaseerCard key={document.id} className="report-documents__card"><div><h3>{document.title}</h3><p dir="ltr">{new Date(document.createdAt).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB')}</p></div><BaseerShareMenu label={language === 'ar' ? 'مشاركة' : 'Share'}><button type="button" role="menuitem" disabled={busyId !== null} onClick={() => void render(document, 'preview')}>{busyId === `${document.id}:preview` ? text.printing : text.print}</button><button type="button" role="menuitem" disabled={busyId !== null} onClick={() => void render(document, 'xlsx')}>{busyId === `${document.id}:xlsx` ? text.exporting : text.excel}</button></BaseerShareMenu></BaseerCard>)}</div></section>;
}

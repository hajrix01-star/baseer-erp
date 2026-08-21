import { api, type ActiveSession } from './daily-sales-client';

export type ReportDocumentFormat = 'preview' | 'xlsx';
export type ReportDocumentArtifact = Readonly<{ snapshotId: string; format: ReportDocumentFormat; mimeType: string; fileName: string | null; contentEncoding: 'utf8' | 'base64'; content: string }>;

/** Central client adapter for every report's frozen print and Excel outputs. */
export async function renderReportRunDocument(session: ActiveSession, input: { reportRunId: string; locale: 'ar' | 'en'; format: ReportDocumentFormat }) {
  return api<ReportDocumentArtifact>(session, '/reports/documents/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
export async function renderSavedReportDocument(session: ActiveSession, documentId: string, format: ReportDocumentFormat) {
  return api<ReportDocumentArtifact>(session, `/reports/documents/${documentId}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
}
export function openReportPrintWindow(): Window {
  const target = window.open('', '_blank', 'popup');
  if (!target) throw new Error('Popup blocked.');
  return target;
}
export function printReportDocument(artifact: ReportDocumentArtifact, target = openReportPrintWindow()): void {
  if (artifact.format !== 'preview' || artifact.contentEncoding !== 'utf8') throw new Error('Invalid print artifact.');
  target.document.open(); target.document.write(artifact.content); target.document.close(); target.focus(); target.print();
}
export function downloadReportDocument(artifact: ReportDocumentArtifact): void {
  if (artifact.format !== 'xlsx' || artifact.contentEncoding !== 'base64' || !artifact.fileName) throw new Error('Invalid Excel artifact.');
  const bytes = Uint8Array.from(atob(artifact.content), (value) => value.charCodeAt(0));
  const href = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
  const link = document.createElement('a'); link.href = href; link.download = artifact.fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

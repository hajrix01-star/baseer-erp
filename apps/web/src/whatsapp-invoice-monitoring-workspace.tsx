import { useEffect, useMemo, useState, type FormEvent } from "react";

import { BaseerApiError, presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerDataGrid, type BaseerDataGridColumn, type BaseerServerGridPage } from "./baseer-data-grid";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterSelect } from "./baseer-filter-controls";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerStatusBadge, type BaseerStatusTone } from "./baseer-status-badge";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerTextInput } from "./baseer-text-input";
import { BaseerEmptyState, BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, api, monthRange } from "./daily-sales-client";
import { formatCount, formatDateTime, formatMoney } from "./number-format";
import "./whatsapp-invoice-monitoring-workspace.css";

type Language = "ar" | "en";
type TabId = "assets" | "invoices" | "notes" | "archive" | "settings";
type DateBasis = "RECEIVED_AT" | "INVOICE_DATE";

type InvoiceRow = Readonly<{
  id: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currencyCode: string | null;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  approvalStatus: "APPROVED_MONITORING" | "INCOMPLETE";
  duplicateStatus: "CLEAR" | "SUSPECTED" | "CONFIRMED" | "DISMISSED" | "UNCHECKED";
  extractionStatus: "NOT_REQUESTED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
}>;

type InvoiceRecord = Readonly<{
  id: string; groupBindingId: string | null; supplierId: string | null; supplierName: string | null; supplierTaxNumber: string | null; invoiceNumber: string | null; invoiceDate: string | null; receivedAt: string; currencyCode: string | null; netAmount: string | null; vatAmount: string | null; grossAmount: string | null;
  extractionState: InvoiceRow["extractionStatus"]; qualityState: "VALID" | "INCOMPLETE" | "CONFLICT"; approvalState: InvoiceRow["approvalStatus"]; duplicateState: InvoiceRow["duplicateStatus"]; archiveState: "ACTIVE" | "ARCHIVED"; purchaseState: "NOT_LINKED" | "PREPARING" | "DRAFT_LINKED" | "DOCUMENT_LINKED" | "CANCELLED"; rowVersion: number; createdAt: string; updatedAt: string;
}>;
type SupplierOption = Readonly<{ id: string; nameAr: string; nameEn: string | null; taxNumber: string | null }>;
type AssetState = "PENDING" | "READY" | "QUARANTINED" | "FAILED";
type ScanStatus = "NOT_REQUESTED" | "PENDING" | "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED";
type PilotConnectionStatus = "NOT_CONFIGURED" | "DISCONNECTED" | "CONNECTED" | "GAP_DETECTED" | "BLOCKED";
const QR_INITIAL_WAIT_MS = 20_000;
const QR_POLL_INTERVAL_MS = 500;
const CONNECTION_STATUS_POLL_MS = 2_000;
type DetailResponse = Readonly<{
  record: InvoiceRecord;
  assets: readonly Readonly<{ id: string; displayName: string; receivedAt: string; mediaKind: "IMAGE" | "PDF"; invoiceRecordCount: number; extractionStatus: InvoiceRow["extractionStatus"]; storageState: AssetState; scanStatus: ScanStatus }>[];
  revisions: readonly Readonly<{ id: string; revision: number; source: "INITIAL" | "MANUAL_CORRECTION" | "AI_REEXTRACTION"; createdAt: string }>[];
  reviews: readonly Readonly<{ id: string; reason: string; createdAt: string }>[];
}>;

type WorkspaceResponse = Readonly<{
  asOf: string | null;
  connection: Readonly<{
    status: "NOT_CONFIGURED" | "DISCONNECTED" | "CONNECTED" | "GAP_DETECTED" | "BLOCKED";
    messageAr: string;
    messageEn: string;
    lastSyncedAt: string | null;
  }>;
  summary: Readonly<{
    countedInvoiceCount: string;
    duplicateInvoiceCount: string;
    needsAttentionCount: string;
    grossTotals: readonly Readonly<{ currencyCode: string; grossAmount: string }>[];
  }>;
  assets: readonly Readonly<{
    id: string;
    displayName: string;
    receivedAt: string;
    mediaKind: "IMAGE" | "PDF";
    invoiceRecordCount: number;
    extractionStatus: InvoiceRow["extractionStatus"];
    storageState: AssetState;
    scanStatus: ScanStatus;
  }>[];
  invoices: BaseerServerGridPage<InvoiceRow>;
  notes: readonly Readonly<{
    id: string;
    severity: "INFO" | "WARNING" | "DANGER";
    titleAr: string;
    titleEn: string;
    detailAr: string;
    detailEn: string;
  }>[];
  archive: readonly Readonly<{
    id: string;
    supplierName: string | null;
    invoiceNumber: string | null;
    archivedAt: string;
  }>[];
  filterOptions: Readonly<{ suppliers: readonly SupplierOption[] }>;
}>;

const copy = {
  ar: {
    eyebrow: "العمليات · رقابة مستقلة", title: "وارد فواتير واتساب", refresh: "تحديث", connected: "متصل للقراءة فقط", disconnected: "غير متصل", gap: "فجوة مزامنة تحتاج متابعة", blocked: "الربط محجوب", unconfigured: "الربط غير مهيأ",
    counted: "الفواتير المحتسبة", duplicates: "فواتير مكررة مستلمة", attention: "تحتاج تدخلاً", gross: "الإجمالي شامل الضريبة", filters: "الفلاتر تنطبق على الصور والجدول والملاحظات والأرشيف. إعدادات الربط لا تتغير بها.",
    dateBasis: "أساس التاريخ", received: "تاريخ الاستلام", invoiceDate: "تاريخ الفاتورة", from: "من", to: "إلى", search: "ابحث بالمورد أو رقم الفاتورة", clear: "مسح", asOf: "آخر قراءة", loadMore: "تحميل المزيد", loading: "جارٍ تحميل وارد الفواتير…", retry: "إعادة المحاولة",
    assets: "الصور والملفات", invoices: "جدول الفواتير", notes: "الملاحظات", archive: "الأرشيف", connection: "إعدادات الربط",
    noAssets: "لا توجد ملفات ضمن هذا النطاق", noInvoices: "لا توجد فواتير ضمن هذا النطاق", noNotes: "لا توجد ملاحظات ضمن هذا النطاق", noArchive: "لا توجد فواتير مؤرشفة ضمن هذا النطاق", noConnection: "لم تصل حالة الربط من الخادم بعد",
    file: "الملف", receivedAt: "الاستلام", registered: "سجل الفاتورة", extraction: "الاستخراج", supplier: "المورد", invoiceNo: "رقم الفاتورة", net: "قبل الضريبة", vat: "الضريبة", total: "الإجمالي", status: "الحالة", archivedAt: "تاريخ الأرشفة",
    extractionQueued: "في انتظار الاستخراج", extractionRunning: "جارٍ الاستخراج", extractionSucceeded: "تم الاستخراج", extractionFailed: "فشل الاستخراج", extractionNotRequested: "لم يطلب الاستخراج", approved: "معتمد رقابياً", incomplete: "بيانات ناقصة",
  },
  en: {
    eyebrow: "Operations · independent monitoring", title: "WhatsApp invoice inbox", refresh: "Refresh", connected: "Connected read-only", disconnected: "Disconnected", gap: "Sync gap needs follow-up", blocked: "Connection blocked", unconfigured: "Connection not configured",
    counted: "Counted invoices", duplicates: "Duplicate invoices received", attention: "Needs attention", gross: "Gross total (VAT inclusive)", filters: "Filters apply to files, invoices, notes, and archive. Connection settings are not filtered.",
    dateBasis: "Date basis", received: "Received date", invoiceDate: "Invoice date", from: "From", to: "To", search: "Search supplier or invoice number", clear: "Clear", asOf: "As of", loadMore: "Load more", loading: "Loading invoice inbox…", retry: "Try again",
    assets: "Images & files", invoices: "Invoice register", notes: "Notes", archive: "Archive", connection: "Connection settings",
    noAssets: "No files in this scope", noInvoices: "No invoices in this scope", noNotes: "No notes in this scope", noArchive: "No archived invoices in this scope", noConnection: "The server has not returned a connection status yet",
    file: "File", receivedAt: "Received", registered: "Invoice record", extraction: "Extraction", supplier: "Supplier", invoiceNo: "Invoice no.", net: "Before VAT", vat: "VAT", total: "Total", status: "Status", archivedAt: "Archived at",
    extractionQueued: "Extraction queued", extractionRunning: "Extracting", extractionSucceeded: "Extracted", extractionFailed: "Extraction failed", extractionNotRequested: "Not requested", approved: "Monitoring approved", incomplete: "Incomplete",
  },
} as const;

const tabs: readonly TabId[] = ["assets", "invoices", "notes", "archive", "settings"];

export function WhatsappInvoiceMonitoringWorkspace({ language, permissionCodes }: { language: Language; permissionCodes: readonly string[] | null }) {
  const session = activeSession();
  const initialRange = monthRange();
  const [tab, setTab] = useState<TabId>("assets");
  const [dateBasis, setDateBasis] = useState<DateBasis>("RECEIVED_AT");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => { setCursor(null); }, [dateBasis, from, to, search]);
  if (!session) return null;
  const query = new URLSearchParams({ dateBasis, from, to, tab, pageSize: "50" });
  if (search.trim()) query.set("search", search.trim());
  if (cursor) query.set("cursor", cursor);
  const scope = [dateBasis, from, to, search, tab, cursor ?? ""];
  return <BaseerCompanyReadQuery session={session} resource="operations.whatsapp_invoice_monitoring.workspace" scope={scope} load={(current, signal) => api<WorkspaceResponse>(current, `/whatsapp-invoice-monitoring/workspace?${query.toString()}`, { signal })}>
    {({ data, loading, error, refetch }) => <MonitoringContent session={session} language={language} permissionCodes={permissionCodes} tab={tab} setTab={setTab} dateBasis={dateBasis} setDateBasis={setDateBasis} from={from} setFrom={setFrom} to={to} setTo={setTo} search={search} setSearch={setSearch} cursor={cursor} setCursor={setCursor} data={data} loading={loading} error={error} onRefresh={() => void refetch().catch(() => undefined)} />}
  </BaseerCompanyReadQuery>;
}

type ContentProps = Readonly<{
  session: NonNullable<ReturnType<typeof activeSession>>; language: Language; permissionCodes: readonly string[] | null; tab: TabId; setTab: (tab: TabId) => void; dateBasis: DateBasis; setDateBasis: (basis: DateBasis) => void; from: string; setFrom: (value: string) => void; to: string; setTo: (value: string) => void; search: string; setSearch: (value: string) => void; cursor: string | null; setCursor: (value: string | null) => void; data: WorkspaceResponse | undefined; loading: boolean; error: unknown; onRefresh: () => void;
}>;

function MonitoringContent({ session, language, permissionCodes, tab, setTab, dateBasis, setDateBasis, from, setFrom, to, setTo, search, setSearch, cursor, setCursor, data, loading, error, onRefresh }: ContentProps) {
  const text = copy[language];
  const ar = language === "ar";
  const clear = () => { const range = monthRange(); setDateBasis("RECEIVED_AT"); setFrom(range.from); setTo(range.to); setSearch(""); };
  const filterControls = <><BaseerFilterSelect label={text.dateBasis} value={dateBasis} onChange={(event) => setDateBasis(event.target.value as DateBasis)}><option value="RECEIVED_AT">{text.received}</option><option value="INVOICE_DATE">{text.invoiceDate}</option></BaseerFilterSelect><BaseerDatePicker language={language} label={text.from} value={from} onChange={setFrom} /><BaseerDatePicker language={language} label={text.to} value={to} onChange={setTo} /><BaseerButton type="button" variant="quiet" onClick={clear}>{text.clear}</BaseerButton></>;
  const actions = <BaseerButton type="button" variant="secondary" onClick={onRefresh}>{text.refresh}</BaseerButton>;
  if (error) return <BaseerWorkspace className="whatsapp-invoice-monitoring"><BaseerSectionHeader eyebrow={text.eyebrow} title={text.title} actions={actions} /><BaseerEmptyState title={presentBaseerLoadError(error, language, { ar: "وارد فواتير واتساب", en: "the WhatsApp invoice inbox" })} action={<BaseerButton type="button" onClick={onRefresh}>{text.retry}</BaseerButton>} /></BaseerWorkspace>;
  if (loading || !data) return <BaseerWorkspace className="whatsapp-invoice-monitoring"><BaseerSectionHeader eyebrow={text.eyebrow} title={text.title} actions={actions} /><BaseerCard aria-busy="true">{text.loading}</BaseerCard></BaseerWorkspace>;
  const connectionTone = connectionToneFor(data.connection.status);
  const connectionText = connectionTextFor(data.connection.status, text);
  const grossTotal = data.summary.grossTotals.length ? data.summary.grossTotals.map((entry) => formatMoney(entry.grossAmount, entry.currencyCode, language)).join(" · ") : "—";
  return <BaseerWorkspace className="whatsapp-invoice-monitoring">
    <BaseerSectionHeader eyebrow={text.eyebrow} title={text.title} actions={actions} />
    <BaseerCard className="whatsapp-invoice-monitoring__connection" padding="compact"><div><BaseerStatusBadge tone={connectionTone}>{connectionText}</BaseerStatusBadge><p>{ar ? data.connection.messageAr : data.connection.messageEn}</p></div><small>{data.connection.lastSyncedAt ? `${text.asOf}: ${formatDateTime(data.connection.lastSyncedAt, language, "Asia/Riyadh")}` : "—"}</small></BaseerCard>
    <BaseerSummaryMetricGrid ariaLabel={text.title} role="list"><BaseerSummaryMetric role="listitem" label={text.counted} value={formatCount(data.summary.countedInvoiceCount, language)} /><BaseerSummaryMetric role="listitem" label={text.duplicates} value={formatCount(data.summary.duplicateInvoiceCount, language)} accent="warning" /><BaseerSummaryMetric role="listitem" label={text.attention} value={formatCount(data.summary.needsAttentionCount, language)} accent="danger" /><BaseerSummaryMetric role="listitem" label={text.gross} value={<bdi dir="ltr">{grossTotal}</bdi>} accent="info" /></BaseerSummaryMetricGrid>
    <BaseerFilterBar language={language} search={search} searchLabel={text.search} searchPlaceholder={text.search} onSearchChange={setSearch} controls={filterControls} />
    <p className="whatsapp-invoice-monitoring__filter-note">{text.filters}</p>
    <nav className="whatsapp-invoice-monitoring__tabs" role="tablist" aria-label={text.title}>{tabs.map((item) => <BaseerButton key={item} id={`whatsapp-invoice-tab-${item}`} type="button" variant="quiet" role="tab" aria-selected={tab === item} aria-controls={`whatsapp-invoice-panel-${item}`} onClick={() => { setTab(item); setCursor(null); }}>{tabTitle(item, text)}</BaseerButton>)}</nav>
    <section id={`whatsapp-invoice-panel-${tab}`} role="tabpanel" aria-labelledby={`whatsapp-invoice-tab-${tab}`} className="whatsapp-invoice-monitoring__panel">
      {tab === "assets" ? <AssetsPanel language={language} text={text} assets={data.assets} /> : null}
      {tab === "invoices" ? <InvoicesPanel language={language} text={text} page={data.invoices} cursor={cursor} onLoadMore={() => setCursor(data.invoices.nextCursor)} session={session} suppliers={data.filterOptions.suppliers} canReview={permissionCodes?.includes("operations.whatsapp_invoice_monitoring.review") === true} onSaved={onRefresh} /> : null}
      {tab === "notes" ? <NotesPanel language={language} text={text} notes={data.notes} /> : null}
      {tab === "archive" ? <ArchivePanel language={language} text={text} rows={data.archive} /> : null}
      {tab === "settings" ? <ConnectionPanelV2 language={language} session={session} onChanged={onRefresh} /> : null}
    </section>
  </BaseerWorkspace>;
}

function AssetsPanel({ language, text, assets }: { language: Language; text: typeof copy.ar | typeof copy.en; assets: WorkspaceResponse["assets"] }) {
  if (!assets.length) return <BaseerEmptyState title={text.noAssets} />;
  return <div className="whatsapp-invoice-monitoring__asset-grid">{assets.map((asset) => <BaseerCard key={asset.id} className="whatsapp-invoice-monitoring__asset" variant="record"><strong>{asset.displayName}</strong><dl><div><dt>{text.receivedAt}</dt><dd>{formatDateTime(asset.receivedAt, language, "Asia/Riyadh")}</dd></div><div><dt>{text.registered}</dt><dd>{formatCount(asset.invoiceRecordCount, language)}</dd></div></dl><span className="whatsapp-invoice-monitoring__statuses"><BaseerStatusBadge tone={assetStorageTone(asset.storageState)}>{assetStorageLabel(asset.storageState, language)}</BaseerStatusBadge><BaseerStatusBadge tone={scanTone(asset.scanStatus)}>{scanLabel(asset.scanStatus, language)}</BaseerStatusBadge><BaseerStatusBadge tone={extractionTone(asset.extractionStatus)}>{extractionLabel(asset.extractionStatus, text)}</BaseerStatusBadge></span></BaseerCard>)}</div>;
}

function InvoicesPanel({ language, text, page, cursor, onLoadMore, session, suppliers, canReview, onSaved }: { language: Language; text: typeof copy.ar | typeof copy.en; page: WorkspaceResponse["invoices"]; cursor: string | null; onLoadMore: () => void; session: NonNullable<ReturnType<typeof activeSession>>; suppliers: readonly SupplierOption[]; canReview: boolean; onSaved: () => void }) {
  const [loadedRows, setLoadedRows] = useState<readonly InvoiceRow[]>(page.rows);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  useEffect(() => {
    if (!cursor) { setLoadedRows(page.rows); return; }
    setLoadedRows((current) => [...current, ...page.rows.filter((row) => !current.some((existing) => existing.id === row.id))]);
  }, [cursor, page.rows]);
  const columns: readonly BaseerDataGridColumn<InvoiceRow>[] = useMemo(() => [
    { id: "supplier", header: text.supplier, cell: (row) => <BaseerButton className="whatsapp-invoice-monitoring__record-trigger" variant="quiet" type="button" onClick={() => setSelectedRecordId(row.id)}>{row.supplierName ?? "—"}</BaseerButton> },
    { id: "number", header: text.invoiceNo, cell: (row) => <BaseerButton className="whatsapp-invoice-monitoring__record-trigger" variant="quiet" type="button" onClick={() => setSelectedRecordId(row.id)}><bdi dir="ltr">{row.invoiceNumber ?? "—"}</bdi></BaseerButton> },
    { id: "net", header: text.net, numeric: true, align: "end", cell: (row) => <bdi dir="ltr">{row.netAmount === null ? "—" : formatMoney(row.netAmount, row.currencyCode ?? "", language)}</bdi> },
    { id: "vat", header: text.vat, numeric: true, align: "end", cell: (row) => <bdi dir="ltr">{row.vatAmount === null ? "—" : formatMoney(row.vatAmount, row.currencyCode ?? "", language)}</bdi> },
    { id: "gross", header: text.total, numeric: true, align: "end", cell: (row) => <bdi dir="ltr">{row.grossAmount === null ? "—" : formatMoney(row.grossAmount, row.currencyCode ?? "", language)}</bdi> },
    { id: "status", header: text.status, cell: (row) => <span className="whatsapp-invoice-monitoring__statuses"><BaseerStatusBadge tone={row.approvalStatus === "APPROVED_MONITORING" ? "success" : "warning"}>{row.approvalStatus === "APPROVED_MONITORING" ? text.approved : text.incomplete}</BaseerStatusBadge>{row.duplicateStatus === "CONFIRMED" || row.duplicateStatus === "SUSPECTED" ? <BaseerStatusBadge tone="warning">{row.duplicateStatus === "CONFIRMED" ? text.duplicates : text.attention}</BaseerStatusBadge> : null}</span> },
  ], [language, text]);
  if (!loadedRows.length) return <BaseerEmptyState title={text.noInvoices} />;
  return <><BaseerDataGrid ariaLabel={text.invoices} caption={text.invoices} columns={columns} rows={loadedRows} rowKey={(row) => row.id} />{page.nextCursor ? <div className="whatsapp-invoice-monitoring__load-more"><BaseerButton type="button" variant="secondary" onClick={onLoadMore}>{text.loadMore}</BaseerButton></div> : null}<InvoiceDetailDialog recordId={selectedRecordId} language={language} session={session} suppliers={suppliers} canReview={canReview} onClose={() => setSelectedRecordId(null)} onSaved={onSaved} /></>;
}

type Draft = { supplierId: string; supplierName: string; supplierTaxNumber: string; invoiceNumber: string; invoiceDate: string; currencyCode: string; netAmount: string; vatAmount: string; grossAmount: string; archiveState: "ACTIVE" | "ARCHIVED"; reason: string };

function InvoiceDetailDialog({ recordId, language, session, suppliers, canReview, onClose, onSaved }: { recordId: string | null; language: Language; session: NonNullable<ReturnType<typeof activeSession>>; suppliers: readonly SupplierOption[]; canReview: boolean; onClose: () => void; onSaved: () => void }) {
  const ar = language === "ar";
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!recordId) { setDetail(null); setDraft(null); setEditing(false); setError(null); return; }
    const controller = new AbortController();
    setLoading(true); setDetail(null); setDraft(null); setEditing(false); setError(null);
    void api<DetailResponse>(session, `/whatsapp-invoice-monitoring/records/${encodeURIComponent(recordId)}`, { signal: controller.signal })
      .then((received) => { if (!controller.signal.aborted) setDetail(received); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(presentBaseerApiError(cause, language, ar ? "تعذر تحميل تفاصيل الفاتورة." : "Could not load invoice details.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ar, language, recordId, session]);

  const beginEdit = () => {
    if (!detail || !canReview) return;
    const record = detail.record;
    setDraft({ supplierId: record.supplierId ?? "", supplierName: record.supplierName ?? "", supplierTaxNumber: record.supplierTaxNumber ?? "", invoiceNumber: record.invoiceNumber ?? "", invoiceDate: record.invoiceDate ?? "", currencyCode: record.currencyCode ?? "", netAmount: record.netAmount ?? "", vatAmount: record.vatAmount ?? "", grossAmount: record.grossAmount ?? "", archiveState: record.archiveState, reason: "" });
    setError(null); setEditing(true);
  };
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !draft || !recordId || !canReview) return;
    if (draft.reason.trim().length < 3) { setError(ar ? "أدخل سبباً من ثلاثة أحرف على الأقل للتعديل أو الأرشفة." : "Enter a reason of at least three characters for the correction or archive action."); return; }
    const current = detail.record;
    const nullIfBlank = (value: string) => value.trim() || null;
    const next = {
      supplierId: nullIfBlank(draft.supplierId), supplierName: nullIfBlank(draft.supplierName), supplierTaxNumber: nullIfBlank(draft.supplierTaxNumber), invoiceNumber: nullIfBlank(draft.invoiceNumber), invoiceDate: nullIfBlank(draft.invoiceDate), currencyCode: nullIfBlank(draft.currencyCode)?.toUpperCase() ?? null, netAmount: nullIfBlank(draft.netAmount), vatAmount: nullIfBlank(draft.vatAmount), grossAmount: nullIfBlank(draft.grossAmount), archiveState: draft.archiveState,
    };
    const patch: Record<string, string | number | null> = { expectedRowVersion: current.rowVersion, reason: draft.reason.trim() };
    (Object.keys(next) as (keyof typeof next)[]).forEach((key) => { if (next[key] !== current[key]) patch[key] = next[key]; });
    if (Object.keys(patch).length === 2) { setError(ar ? "لا توجد تعديلات للحفظ." : "There are no changes to save."); return; }
    setBusy(true); setError(null);
    try {
      const updated = await api<InvoiceRecord>(session, `/whatsapp-invoice-monitoring/records/${encodeURIComponent(recordId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      setDetail((value) => value ? { ...value, record: updated } : value);
      setEditing(false); setDraft(null); onSaved();
    } catch (cause) { setError(presentBaseerApiError(cause, language, ar ? "تعذر حفظ تصحيح الفاتورة." : "Could not save the invoice correction.")); } finally { setBusy(false); }
  };
  const title = detail?.record.invoiceNumber ?? (ar ? "تفاصيل فاتورة واردة" : "Incoming invoice details");
  return <BaseerDialog open={recordId !== null} title={title} eyebrow={ar ? "وارد فواتير واتساب" : "WhatsApp invoice inbox"} language={language} busy={busy} error={error} size="wide" className="whatsapp-invoice-monitoring__detail-dialog" onClose={onClose} footer={<>{editing ? <><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => { setEditing(false); setDraft(null); setError(null); }}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="whatsapp-invoice-monitoring-edit" disabled={busy}>{ar ? "حفظ التعديل" : "Save correction"}</BaseerButton></> : <><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{ar ? "إغلاق" : "Close"}</BaseerButton>{canReview && detail ? <BaseerButton type="button" disabled={busy || loading} onClick={beginEdit}>{ar ? "تعديل" : "Edit"}</BaseerButton> : null}</>}</>}>
    {loading ? <BaseerCard aria-busy="true">{ar ? "جارٍ تحميل تفاصيل الفاتورة…" : "Loading invoice details…"}</BaseerCard> : null}
    {!loading && detail && !editing ? <InvoiceDetailRead language={language} detail={detail} /> : null}
    {!loading && detail && editing && draft ? <InvoiceDetailForm language={language} suppliers={suppliers} draft={draft} busy={busy} onChange={change} onSubmit={save} /> : null}
  </BaseerDialog>;
}

function InvoiceDetailRead({ language, detail }: { language: Language; detail: DetailResponse }) {
  const ar = language === "ar"; const record = detail.record;
  const labels = { supplier: ar ? "المورد" : "Supplier", tax: ar ? "الرقم الضريبي" : "Tax number", invoice: ar ? "رقم الفاتورة" : "Invoice no.", date: ar ? "تاريخ الفاتورة" : "Invoice date", received: ar ? "تاريخ الاستلام" : "Received", currency: ar ? "العملة" : "Currency", net: ar ? "قبل الضريبة" : "Before VAT", vat: ar ? "الضريبة" : "VAT", total: ar ? "الإجمالي" : "Total", archive: ar ? "الأرشفة" : "Archive", duplicate: ar ? "التكرار" : "Duplicate", sourceFiles: ar ? "الملفات المصدرية" : "Source files", fileState: ar ? "حالة الملف" : "File state", scan: ar ? "الفحص" : "Scan" };
  return <div className="whatsapp-invoice-monitoring__detail"><dl className="whatsapp-invoice-monitoring__detail-fields"><div><dt>{labels.supplier}</dt><dd>{record.supplierName ?? "—"}</dd></div><div><dt>{labels.tax}</dt><dd><bdi dir="ltr">{record.supplierTaxNumber ?? "—"}</bdi></dd></div><div><dt>{labels.invoice}</dt><dd><bdi dir="ltr">{record.invoiceNumber ?? "—"}</bdi></dd></div><div><dt>{labels.date}</dt><dd>{record.invoiceDate ?? "—"}</dd></div><div><dt>{labels.received}</dt><dd>{formatDateTime(record.receivedAt, language, "Asia/Riyadh")}</dd></div><div><dt>{labels.currency}</dt><dd><bdi dir="ltr">{record.currencyCode ?? "—"}</bdi></dd></div><div><dt>{labels.net}</dt><dd><bdi dir="ltr">{record.netAmount === null ? "—" : formatMoney(record.netAmount, record.currencyCode ?? "", language)}</bdi></dd></div><div><dt>{labels.vat}</dt><dd><bdi dir="ltr">{record.vatAmount === null ? "—" : formatMoney(record.vatAmount, record.currencyCode ?? "", language)}</bdi></dd></div><div><dt>{labels.total}</dt><dd><bdi dir="ltr">{record.grossAmount === null ? "—" : formatMoney(record.grossAmount, record.currencyCode ?? "", language)}</bdi></dd></div><div><dt>{labels.archive}</dt><dd>{record.archiveState === "ARCHIVED" ? (ar ? "مؤرشفة" : "Archived") : (ar ? "نشطة" : "Active")}</dd></div><div><dt>{labels.duplicate}</dt><dd>{record.duplicateState}</dd></div></dl><section className="whatsapp-invoice-monitoring__source-assets"><h4>{labels.sourceFiles}</h4>{detail.assets.length ? detail.assets.map((asset) => <BaseerCard key={asset.id} padding="compact"><strong>{asset.displayName}</strong><span>{asset.mediaKind} · {formatDateTime(asset.receivedAt, language, "Asia/Riyadh")}</span><span>{labels.fileState}: <BaseerStatusBadge tone={assetStorageTone(asset.storageState)}>{assetStorageLabel(asset.storageState, language)}</BaseerStatusBadge></span><span>{labels.scan}: <BaseerStatusBadge tone={scanTone(asset.scanStatus)}>{scanLabel(asset.scanStatus, language)}</BaseerStatusBadge></span></BaseerCard>) : <p>{ar ? "لا توجد ملفات مصدرية مرتبطة بهذا السجل." : "No source files are linked to this record."}</p>}</section></div>;
}

function InvoiceDetailForm({ language, suppliers, draft, busy, onChange, onSubmit }: { language: Language; suppliers: readonly SupplierOption[]; draft: Draft; busy: boolean; onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const ar = language === "ar";
  return <form id="whatsapp-invoice-monitoring-edit" className="whatsapp-invoice-monitoring__edit-form" onSubmit={onSubmit}>
    <BaseerNotice tone="info" title={ar ? "تصحيح رقابي" : "Monitoring correction"}>{ar ? "لن يُنشئ الحفظ فاتورة شراء أو قيداً مالياً. تُراجع قواعد التكرار من الخادم بعد الحفظ." : "Saving does not create a purchase invoice or financial posting. Duplicate rules are reassessed by the server after saving."}</BaseerNotice>
    <label>{ar ? "ربط بالمورد الموجود" : "Link to existing supplier"}<BaseerStaticSelect label={ar ? "ربط بالمورد الموجود" : "Link to existing supplier"} value={draft.supplierId} disabled={busy} onChange={(event) => onChange("supplierId", event.target.value)}><option value="">{ar ? "بدون ربط" : "No link"}</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{ar ? supplier.nameAr : supplier.nameEn ?? supplier.nameAr}{supplier.taxNumber ? ` · ${supplier.taxNumber}` : ""}</option>)}</BaseerStaticSelect></label>
    <label>{ar ? "اسم المورد" : "Supplier name"}<BaseerTextInput value={draft.supplierName} disabled={busy} maxLength={240} onChange={(event) => onChange("supplierName", event.target.value)} /></label>
    <label>{ar ? "الرقم الضريبي للمورد" : "Supplier tax number"}<BaseerTextInput dir="ltr" value={draft.supplierTaxNumber} disabled={busy} maxLength={80} onChange={(event) => onChange("supplierTaxNumber", event.target.value)} /></label>
    <label>{ar ? "رقم الفاتورة" : "Invoice number"}<BaseerTextInput dir="ltr" value={draft.invoiceNumber} disabled={busy} maxLength={160} onChange={(event) => onChange("invoiceNumber", event.target.value)} /></label>
    <label>{ar ? "تاريخ الفاتورة" : "Invoice date"}<BaseerTextInput dir="ltr" type="date" value={draft.invoiceDate} disabled={busy} onChange={(event) => onChange("invoiceDate", event.target.value)} /></label>
    <label>{ar ? "العملة (ISO)" : "Currency (ISO)"}<BaseerTextInput dir="ltr" value={draft.currencyCode} disabled={busy} maxLength={3} pattern="[A-Za-z]{3}" onChange={(event) => onChange("currencyCode", event.target.value.toUpperCase())} /></label>
    <label>{ar ? "قبل الضريبة" : "Before VAT"}<BaseerTextInput dir="ltr" inputMode="decimal" value={draft.netAmount} disabled={busy} onChange={(event) => onChange("netAmount", event.target.value)} /></label>
    <label>{ar ? "الضريبة" : "VAT"}<BaseerTextInput dir="ltr" inputMode="decimal" value={draft.vatAmount} disabled={busy} onChange={(event) => onChange("vatAmount", event.target.value)} /></label>
    <label>{ar ? "الإجمالي" : "Total"}<BaseerTextInput dir="ltr" inputMode="decimal" value={draft.grossAmount} disabled={busy} onChange={(event) => onChange("grossAmount", event.target.value)} /></label>
    <label>{ar ? "حالة الأرشفة" : "Archive state"}<BaseerStaticSelect label={ar ? "حالة الأرشفة" : "Archive state"} value={draft.archiveState} disabled={busy} onChange={(event) => onChange("archiveState", event.target.value as Draft["archiveState"])}><option value="ACTIVE">{ar ? "نشطة" : "Active"}</option><option value="ARCHIVED">{ar ? "مؤرشفة" : "Archived"}</option></BaseerStaticSelect></label>
    <label className="whatsapp-invoice-monitoring__edit-reason">{ar ? "سبب التعديل أو الأرشفة" : "Reason for correction or archive"}<BaseerTextInput value={draft.reason} disabled={busy} minLength={3} maxLength={500} required onChange={(event) => onChange("reason", event.target.value)} /></label>
  </form>;
}

function NotesPanel({ language, text, notes }: { language: Language; text: typeof copy.ar | typeof copy.en; notes: WorkspaceResponse["notes"] }) {
  if (!notes.length) return <BaseerEmptyState title={text.noNotes} />;
  return <div className="whatsapp-invoice-monitoring__notes">{notes.map((note) => <BaseerNotice key={note.id} tone={note.severity === "DANGER" ? "danger" : note.severity === "WARNING" ? "warning" : "info"} title={language === "ar" ? note.titleAr : note.titleEn}>{language === "ar" ? note.detailAr : note.detailEn}</BaseerNotice>)}</div>;
}

function ArchivePanel({ language, text, rows }: { language: Language; text: typeof copy.ar | typeof copy.en; rows: WorkspaceResponse["archive"] }) {
  if (!rows.length) return <BaseerEmptyState title={text.noArchive} />;
  const columns: readonly BaseerDataGridColumn<WorkspaceResponse["archive"][number]>[] = [{ id: "supplier", header: text.supplier, cell: (row) => row.supplierName ?? "—" }, { id: "number", header: text.invoiceNo, cell: (row) => <bdi dir="ltr">{row.invoiceNumber ?? "—"}</bdi> }, { id: "archivedAt", header: text.archivedAt, cell: (row) => formatDateTime(row.archivedAt, language, "Asia/Riyadh") }];
  return <BaseerDataGrid ariaLabel={text.archive} caption={text.archive} columns={columns} rows={rows} rowKey={(row) => row.id} />;
}

type LiveConnectionSettings = Readonly<{ id: string | null; status: "NOT_CONFIGURED" | "DISCONNECTED" | "CONNECTED" | "GAP_DETECTED" | "BLOCKED"; phoneNumberHint: string | null; lastSyncedAt: string | null }>;
type LiveBinding = Readonly<{ id: string; groupJid: string; displayName: string; active: boolean; bindingRevision: number }>;
type LiveSettingsResponse = Readonly<{ connection: LiveConnectionSettings; groupBindings: readonly LiveBinding[] }>;
type LiveQrReceipt = Readonly<{ qr: string | null; expiresAt: string | null }>;
type LiveBindingDraft = Readonly<{ id: string | null; groupJid: string; displayName: string; active: boolean; bindingRevision: number | null }>;

/* Retired pilot UI contract. Kept temporarily as a non-executable reference
 * while ConnectionPanelV2 below uses the server-owned settings contract. */
/*
function ConnectionPanel({ language, connection, session, onChanged }: { language: Language; connection: WorkspaceResponse["connection"]; session: NonNullable<ReturnType<typeof activeSession>>; onChanged: () => void }) {
  const ar = language === "ar";
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pilotDialog, setPilotDialog] = useState(false);
  const [bindingDialog, setBindingDialog] = useState<BindingDraft | null>(null);
  const [deactivate, setDeactivate] = useState<GroupBinding | null>(null);
  const [qr, setQr] = useState<Pick<PilotReceipt, "qrToken" | "qrExpiresAt"> | null>(null);
  const [availableGroups, setAvailableGroups] = useState<PilotGroupReceipt["groups"]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  const load = async (signal?: AbortSignal) => {
    const received = await api<SettingsResponse>(session, "/whatsapp-invoice-monitoring/settings", { signal });
    setSettings(received);
    return received;
  };
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void load(controller.signal).catch((cause: unknown) => { if (!controller.signal.aborted) setError(settingsError(cause, language, "تعذر قراءة إعدادات ربط واتساب.")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [language, session]);
  const refresh = async () => { setLoading(true); setError(null); try { await load(); } catch (cause) { setError(settingsError(cause, language, "تعذر تحديث إعدادات ربط واتساب.")); } finally { setLoading(false); } };
  const runPilot = async (operation: "start" | "stop" | "qr") => {
    setBusy(true); setError(null);
    try {
      const receipt = await api<PilotReceipt>(session, `/whatsapp-invoice-monitoring/settings/pilot/${operation}`, { method: operation === "qr" ? "GET" : "POST", ...(operation === "qr" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: requestId() }) }) });
      if (operation !== "stop" && receipt.qrToken && receipt.qrExpiresAt) setQr({ qrToken: receipt.qrToken, qrExpiresAt: receipt.qrExpiresAt });
      if (operation === "stop") setQr(null);
      setPilotDialog(false); await refresh(); onChanged();
    } catch (cause) { setError(settingsError(cause, language, operation === "start" ? "تعذر بدء جلسة الربط التجريبية." : operation === "stop" ? "تعذر إيقاف جلسة الربط التجريبية." : "تعذر جلب رمز QR المؤقت.")); } finally { setBusy(false); }
  };
  const saveBinding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!bindingDialog) return;
    const draft = bindingDialog;
    if (!draft.groupJid.trim() || !draft.groupName.trim() || !draft.companyId) { setError(ar ? "أدخل معرّف المجموعة واسمها واختر الشركة." : "Enter the group identifier and name, then select a company."); return; }
    setBusy(true); setError(null);
    try {
      await api<GroupBinding>(session, draft.id ? `/whatsapp-invoice-monitoring/settings/group-bindings/${encodeURIComponent(draft.id)}` : "/whatsapp-invoice-monitoring/settings/group-bindings", { method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupJid: draft.groupJid.trim(), groupName: draft.groupName.trim(), companyId: draft.companyId, status: draft.status, idempotencyKey: requestId() }) });
      setBindingDialog(null); await refresh(); onChanged();
    } catch (cause) { setError(settingsError(cause, language, "تعذر حفظ ربط المجموعة بالشركة.")); } finally { setBusy(false); }
  };
  const loadPilotGroups = async () => {
    setLoadingGroups(true); setError(null);
    try {
      const receipt = await api<PilotGroupReceipt>(session, "/whatsapp-invoice-monitoring/settings/pilot/groups");
      setAvailableGroups(receipt.groups);
      if (!receipt.groups.length) setError(ar ? "لا توجد مجموعات متاحة من جلسة WhatsApp الحالية. تحقق من اتصال Pilot ثم أعد التحديث." : "No groups are available from the current WhatsApp session. Check the pilot connection and refresh.");
    } catch (cause) { setError(settingsError(cause, language, "تعذر جلب مجموعات WhatsApp من جلسة Pilot.")); } finally { setLoadingGroups(false); }
  };
  const deactivateBinding = async () => {
    if (!deactivate) return; setBusy(true); setError(null);
    try {
      await api<GroupBinding>(session, `/whatsapp-invoice-monitoring/settings/group-bindings/${encodeURIComponent(deactivate.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "INACTIVE", idempotencyKey: requestId() }) });
      setDeactivate(null); await refresh(); onChanged();
    } catch (cause) { setError(settingsError(cause, language, "تعذر إلغاء تفعيل المجموعة.")); } finally { setBusy(false); }
  };
  const current = settings?.connection ?? { ...connection, pilotExpiresAt: null };
  const activePilot = current.status === "PILOT_ACTIVE" || current.status === "PILOT_STARTING";
  return <section className="whatsapp-invoice-monitoring__settings" dir={ar ? "rtl" : "ltr"}>
    {error ? <BaseerNotice tone="danger" title={ar ? "تعذر تنفيذ الإجراء" : "Action could not be completed"}>{error}</BaseerNotice> : null}
    <BaseerCard className="whatsapp-invoice-monitoring__connection-detail"><div><BaseerStatusBadge tone={connectionToneFor(current.status)}>{connectionTextForSettings(current.status, language)}</BaseerStatusBadge><p>{ar ? current.messageAr : current.messageEn}</p>{current.lastSyncedAt ? <small>{ar ? "آخر مزامنة: " : "Last sync: "}{formatDateTime(current.lastSyncedAt, language, "Asia/Riyadh")}</small> : null}</div><div className="whatsapp-invoice-monitoring__settings-actions"><BaseerButton type="button" variant="secondary" disabled={loading || busy} onClick={() => void refresh()}>{ar ? "تحديث الحالة" : "Refresh status"}</BaseerButton>{activePilot ? <BaseerButton type="button" variant="danger" disabled={busy} onClick={() => setPilotDialog(true)}>{ar ? "إيقاف جلسة Pilot" : "Stop pilot session"}</BaseerButton> : <BaseerButton type="button" disabled={busy} onClick={() => setPilotDialog(true)}>{ar ? "تهيئة ربط Pilot" : "Set up pilot connection"}</BaseerButton>}</div></BaseerCard>
    <BaseerNotice tone="info" title={ar ? "حدود الربط" : "Connection boundary"}>{ar ? "الاتصال اختياري للقراءة فقط. لا تُدخل كلمة مرور أو رمزاً أو سراً هنا؛ رمز QR، إن أصدره الخادم، مؤقت ولا يُخزن في المتصفح." : "The connection is optional and read-only. Do not enter a password, token, or secret here; a server-issued QR is temporary and is not stored by the browser."}</BaseerNotice>
    {qr?.qrToken && qr.qrExpiresAt ? <PilotQr token={qr.qrToken} expiresAt={qr.qrExpiresAt} language={language} onRefresh={() => void runPilot("qr")} busy={busy} /> : null}
    <section className="whatsapp-invoice-monitoring__binding-section" aria-labelledby="whatsapp-invoice-monitoring-groups"><header><div><h3 id="whatsapp-invoice-monitoring-groups">{ar ? "مجموعات الشركات المرتبطة" : "Mapped company groups"}</h3><p>{ar ? "المعرّف هو مرجع المجموعة الثابت؛ تغيير الاسم لا يعيد تعيين الرسائل السابقة." : "The group identifier is stable; renaming a group never reassigns historic messages."}</p></div><div className="whatsapp-invoice-monitoring__settings-actions"><BaseerButton type="button" variant="secondary" disabled={busy || loadingGroups} onClick={() => void loadPilotGroups()}>{ar ? "تحديث مجموعات واتساب" : "Refresh WhatsApp groups"}</BaseerButton><BaseerButton type="button" disabled={busy || loading} onClick={() => setBindingDialog({ id: null, groupJid: "", groupName: "", companyId: "", status: "ACTIVE" })}>{ar ? "إضافة مجموعة" : "Add group"}</BaseerButton></div></header>
      {loading ? <BaseerCard aria-busy="true">{ar ? "جارٍ تحميل إعدادات المجموعات…" : "Loading group settings…"}</BaseerCard> : settings?.groupBindings.length ? <div className="whatsapp-invoice-monitoring__binding-list">{settings.groupBindings.map((binding) => <BaseerCard key={binding.id} padding="compact" className="whatsapp-invoice-monitoring__binding"><div><strong>{binding.groupName}</strong><small dir="ltr">{binding.groupJid}</small><span>{ar ? binding.companyNameAr : binding.companyNameEn ?? binding.companyNameAr}</span></div><div><BaseerStatusBadge tone={binding.status === "ACTIVE" ? "success" : "neutral"}>{binding.status === "ACTIVE" ? (ar ? "نشطة" : "Active") : (ar ? "غير نشطة" : "Inactive")}</BaseerStatusBadge><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => setBindingDialog({ id: binding.id, groupJid: binding.groupJid, groupName: binding.groupName, companyId: binding.companyId, status: binding.status })}>{ar ? "تعديل" : "Edit"}</BaseerButton>{binding.status === "ACTIVE" ? <BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => setDeactivate(binding)}>{ar ? "إلغاء التفعيل" : "Deactivate"}</BaseerButton> : null}</div></BaseerCard>)}</div> : <BaseerEmptyState title={ar ? "لا توجد مجموعات مرتبطة بعد" : "No groups are mapped yet"} />}
    </section>
    <BaseerDialog open={pilotDialog} title={activePilot ? (ar ? "إيقاف جلسة Pilot" : "Stop pilot session") : (ar ? "تهيئة ربط WhatsApp التجريبي" : "Set up WhatsApp pilot connection")} language={language} busy={busy} error={null} onClose={() => !busy && setPilotDialog(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setPilotDialog(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="button" variant={activePilot ? "danger" : "primary"} disabled={busy} onClick={() => void runPilot(activePilot ? "stop" : "start")}>{activePilot ? (ar ? "إيقاف الجلسة" : "Stop session") : (ar ? "بدء Pilot" : "Start pilot")}</BaseerButton></>}><BaseerNotice tone={activePilot ? "warning" : "info"} title={ar ? "تأكيد صريح مطلوب" : "Explicit confirmation required"}>{activePilot ? (ar ? "سيوقف هذا الإجراء جلسة القراءة التجريبية. لا يحذف أي فاتورة أو ملف محفوظ." : "This stops the pilot read session. It does not delete any saved invoice or file.") : (ar ? "سيطلب من الخادم بدء جلسة قراءة تجريبية فقط. لا يتصل المتصفح بواتساب ولا يحفظ رمز QR أو أي سر." : "This asks the server to start a read-only pilot session. The browser does not connect to WhatsApp or store a QR code or secret.")}</BaseerNotice></BaseerDialog>
    <BaseerDialog open={bindingDialog !== null} title={bindingDialog?.id ? (ar ? "تعديل ربط مجموعة" : "Edit group mapping") : (ar ? "إضافة مجموعة لشركة" : "Add company group")} language={language} busy={busy} error={null} onClose={() => !busy && setBindingDialog(null)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setBindingDialog(null)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="whatsapp-invoice-monitoring-binding" disabled={busy}>{ar ? "حفظ الربط" : "Save mapping"}</BaseerButton></>}><form id="whatsapp-invoice-monitoring-binding" className="whatsapp-invoice-monitoring__binding-form" onSubmit={saveBinding}><BaseerNotice tone="info" title={ar ? "ربط ثابت" : "Stable mapping"}>{ar ? "اختر المجموعة المكتشفة بعد ربط Pilot؛ يحتفظ النظام بالـJID الثابت. الإدخال اليدوي متاح فقط للإدارة عند الحاجة." : "Choose a discovered group after linking the pilot; the system keeps its stable JID. Manual entry remains available only for administration when needed."}</BaseerNotice>{availableGroups.length ? <label className="whatsapp-invoice-monitoring__binding-group-picker">{ar ? "مجموعة WhatsApp المكتشفة" : "Discovered WhatsApp group"}<select value={availableGroups.some((group) => group.jid === bindingDialog?.groupJid) ? bindingDialog?.groupJid : ""} disabled={busy} onChange={(event) => { const group = availableGroups.find((item) => item.jid === event.target.value); if (group) setBindingDialog((value) => value ? { ...value, groupJid: group.jid, groupName: group.name } : value); }}><option value="">{ar ? "اختر مجموعة لتعبئة الاسم والمعرّف" : "Choose a group to fill its name and identifier"}</option>{availableGroups.map((group) => <option key={group.jid} value={group.jid}>{group.name}</option>)}</select></label> : null}<label>{ar ? "معرّف المجموعة الإداري (groupJid)" : "Administrative group identifier (groupJid)"}<BaseerTextInput dir="ltr" value={bindingDialog?.groupJid ?? ""} disabled={busy} required maxLength={240} onChange={(event) => setBindingDialog((value) => value ? { ...value, groupJid: event.target.value } : value)} /></label><label>{ar ? "اسم المجموعة للعرض" : "Display group name"}<BaseerTextInput value={bindingDialog?.groupName ?? ""} disabled={busy} required maxLength={160} onChange={(event) => setBindingDialog((value) => value ? { ...value, groupName: event.target.value } : value)} /></label><label>{ar ? "الشركة" : "Company"}<select value={bindingDialog?.companyId ?? ""} disabled={busy} required onChange={(event) => setBindingDialog((value) => value ? { ...value, companyId: event.target.value } : value)}><option value="">{ar ? "اختر الشركة" : "Select company"}</option>{settings?.companies.map((company) => <option key={company.id} value={company.id}>{ar ? company.nameAr : company.nameEn ?? company.nameAr}</option>)}</select></label><label>{ar ? "الحالة" : "Status"}<select value={bindingDialog?.status ?? "ACTIVE"} disabled={busy} onChange={(event) => setBindingDialog((value) => value ? { ...value, status: event.target.value as GroupBinding["status"] } : value)}><option value="ACTIVE">{ar ? "نشطة" : "Active"}</option><option value="INACTIVE">{ar ? "غير نشطة" : "Inactive"}</option></select></label></form></BaseerDialog>
    <BaseerDialog open={deactivate !== null} title={ar ? "إلغاء تفعيل المجموعة" : "Deactivate group"} language={language} busy={busy} error={null} onClose={() => !busy && setDeactivate(null)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setDeactivate(null)}>{ar ? "رجوع" : "Back"}</BaseerButton><BaseerButton type="button" variant="danger" disabled={busy} onClick={() => void deactivateBinding()}>{ar ? "إلغاء التفعيل" : "Deactivate"}</BaseerButton></>}><BaseerNotice tone="warning" title={deactivate?.groupName ?? ""}>{ar ? "سيبقى السجل التاريخي للمجموعة محفوظاً، لكن لن تستقبل هذه المجموعة رسائل جديدة بعد تأكيد الإجراء." : "Historic records remain intact, but no new messages will be accepted for this group after confirmation."}</BaseerNotice></BaseerDialog>
  </section>;
}

*/
/**
 * The live settings contract is intentionally separate from the workspace
 * projection: it is company-scoped, contains no secret, and returns a QR
 * only through a no-store endpoint.  Keep these routes in lockstep with the
 * server controller rather than inventing a browser-only pilot protocol.
 */
function ConnectionPanelV2({ language, session, onChanged }: { language: Language; session: NonNullable<ReturnType<typeof activeSession>>; onChanged: () => void }) {
  const ar = language === "ar";
  const [settings, setSettings] = useState<LiveSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [pilotOpen, setPilotOpen] = useState(false);
  const [key, setKey] = useState("personal-main");
  const [phoneHint, setPhoneHint] = useState("");
  const [qr, setQr] = useState<LiveQrReceipt | null>(null);
  const [groups, setGroups] = useState<readonly Readonly<{ jid: string; displayName: string }>[]>([]);
  const [binding, setBinding] = useState<LiveBindingDraft | null>(null);
  const [deactivate, setDeactivate] = useState<LiveBinding | null>(null);

  const load = async (signal?: AbortSignal) => {
    const value = await api<LiveSettingsResponse>(session, "/whatsapp-invoice-monitoring/settings", { signal });
    setSettings(value);
    return value;
  };
  const refresh = async () => { setLoading(true); setError(null); try { await load(); onChanged(); } catch (cause) { setError(settingsError(cause, language, ar ? "تعذر تحديث إعدادات ربط واتساب." : "Unable to refresh WhatsApp connection settings.")); } finally { setLoading(false); } };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((cause: unknown) => { if (!controller.signal.aborted) setError(settingsError(cause, language, ar ? "تعذر قراءة إعدادات ربط واتساب." : "Unable to read WhatsApp connection settings.")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [language, session]);
  useEffect(() => {
    const expiresAt = qr?.expiresAt;
    if (!qr?.qr || !expiresAt) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      if (cancelled || Date.now() > new Date(expiresAt).valueOf() + CONNECTION_STATUS_POLL_MS) return;
      try {
        const value = await api<LiveSettingsResponse>(session, "/whatsapp-invoice-monitoring/settings");
        if (cancelled) return;
        setSettings(value);
        if (value.connection.status === "CONNECTED") { setQr(null); return; }
      } catch { /* The explicit refresh action retains the localized error path. */ }
      if (!cancelled) timer = window.setTimeout(poll, CONNECTION_STATUS_POLL_MS);
    };
    timer = window.setTimeout(poll, CONNECTION_STATUS_POLL_MS);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [qr?.expiresAt, qr?.qr, session]);
  const configure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!key.trim()) { setError(ar ? "أدخل اسماً داخلياً آمناً للربط." : "Enter a safe internal connection name."); return; }
    setBusy(true); setError(null);
    try { await api<LiveConnectionSettings>(session, "/whatsapp-invoice-monitoring/settings/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionKey: key.trim(), ...(phoneHint.trim() ? { phoneNumberHint: phoneHint.trim() } : {}) }) }); setConfigureOpen(false); await refresh(); setPilotOpen(true); }
    catch (cause) { setError(settingsError(cause, language, ar ? "تعذر حفظ إعداد الربط." : "Unable to save connection setup.")); }
    finally { setBusy(false); }
  };
  const control = async (operation: "start" | "stop") => {
    setBusy(true); setError(null);
    try {
      await api(session, `/whatsapp-invoice-monitoring/settings/connection/${operation}`, { method: "POST" });
      setPilotOpen(false);
      if (operation === "stop") { setQr(null); await refresh(); return; }
      const deadline = Date.now() + QR_INITIAL_WAIT_MS;
      let nextQr: LiveQrReceipt | null = null;
      while (!nextQr && Date.now() < deadline) {
        const value = await api<LiveQrReceipt>(session, "/whatsapp-invoice-monitoring/settings/connection/qr");
        nextQr = value.qr && value.expiresAt ? value : null;
        if (!nextQr) await new Promise<void>((resolve) => window.setTimeout(resolve, QR_POLL_INTERVAL_MS));
      }
      setQr(nextQr);
      await refresh();
      if (!nextQr) setError(ar ? "لم يصدر QR خلال المهلة. تأكد من حالة الربط ثم أعد البدء مرة واحدة." : "QR was not issued within the time limit. Check connection status, then start once again.");
    }
    catch (cause) { setError(settingsError(cause, language, operation === "start" ? (ar ? "تعذر بدء جلسة الربط التجريبية." : "Unable to start the pilot connection.") : (ar ? "تعذر إيقاف جلسة الربط التجريبية." : "Unable to stop the pilot connection."))); }
    finally { setBusy(false); }
  };
  const refreshQr = async () => { setBusy(true); setError(null); try { const value = await api<LiveQrReceipt>(session, "/whatsapp-invoice-monitoring/settings/connection/qr"); setQr(value.qr && value.expiresAt ? value : null); if (!value.qr) setError(ar ? "لا يوجد QR جاهز الآن؛ انتظر لحظة ثم حدّثه." : "No QR is ready yet; wait briefly and refresh it."); } catch (cause) { setError(settingsError(cause, language, ar ? "تعذر جلب رمز QR المؤقت." : "Unable to get the temporary QR.")); } finally { setBusy(false); } };
  const refreshGroups = async () => { setBusy(true); setError(null); try { const value = await api<readonly Readonly<{ jid: string; displayName: string }>[]>(session, "/whatsapp-invoice-monitoring/settings/pilot/groups"); setGroups(value); if (!value.length) setError(ar ? "لا توجد مجموعات متاحة؛ تحقق من اتصال الرقم ثم حدّث القائمة." : "No groups are available; check the number connection and refresh."); } catch (cause) { setError(settingsError(cause, language, ar ? "تعذر جلب مجموعات واتساب." : "Unable to fetch WhatsApp groups.")); } finally { setBusy(false); } };
  const saveBinding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!binding) return;
    if (!/^\d+(?:-\d+)?@g\.us$/.test(binding.groupJid.trim()) || !binding.displayName.trim()) { setError(ar ? "اختر مجموعة صالحة أو أدخل JID ينتهي بـ @g.us واسم عرض." : "Choose a valid group or enter a JID ending in @g.us and a display name."); return; }
    setBusy(true); setError(null);
    try {
      if (binding.id && binding.bindingRevision !== null) await api<LiveBinding>(session, `/whatsapp-invoice-monitoring/settings/groups/${encodeURIComponent(binding.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: binding.displayName.trim(), active: binding.active, expectedBindingRevision: binding.bindingRevision }) });
      else await api<LiveBinding>(session, "/whatsapp-invoice-monitoring/settings/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupJid: binding.groupJid.trim(), displayName: binding.displayName.trim(), active: binding.active }) });
      setBinding(null); await refresh();
    } catch (cause) { setError(settingsError(cause, language, ar ? "تعذر حفظ ربط المجموعة بالشركة الحالية." : "Unable to save this group mapping for the current company.")); }
    finally { setBusy(false); }
  };
  const disableBinding = async () => {
    if (!deactivate) return; setBusy(true); setError(null);
    try { await api<LiveBinding>(session, `/whatsapp-invoice-monitoring/settings/groups/${encodeURIComponent(deactivate.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedBindingRevision: deactivate.bindingRevision }) }); setDeactivate(null); await refresh(); }
    catch (cause) { setError(settingsError(cause, language, ar ? "تعذر إلغاء تفعيل المجموعة." : "Unable to deactivate the group.")); }
    finally { setBusy(false); }
  };
  const connection = settings?.connection;
  const connected = connection?.status === "CONNECTED";
  const noConnection = !connection?.id;
  return <section className="whatsapp-invoice-monitoring__settings" dir={ar ? "rtl" : "ltr"}>
    {error ? <BaseerNotice tone="danger" title={ar ? "تعذر تنفيذ الإجراء" : "Action could not be completed"}>{error}</BaseerNotice> : null}
    <BaseerCard className="whatsapp-invoice-monitoring__connection-detail"><div><BaseerStatusBadge tone={connectionToneFor(connection?.status ?? "NOT_CONFIGURED")}>{connectionTextForSettings(connection?.status ?? "NOT_CONFIGURED", language)}</BaseerStatusBadge><p>{noConnection ? (ar ? "هيّئ رابط الرقم أولاً، ثم امسح QR من واتساب على الهاتف." : "Set up the number link first, then scan the QR in WhatsApp on the phone.") : (ar ? "قراءة فواتير فقط من المجموعات المرتبطة بالشركة الحالية." : "Read invoice media only from groups mapped to the current company.")}</p>{connection?.phoneNumberHint ? <small>{ar ? "تلميح الرقم: " : "Number hint: "}{connection.phoneNumberHint}</small> : null}{connection?.lastSyncedAt ? <small>{ar ? "آخر اتصال: " : "Last connection: "}{formatDateTime(connection.lastSyncedAt, language, "Asia/Riyadh")}</small> : null}</div><div className="whatsapp-invoice-monitoring__settings-actions"><BaseerButton type="button" variant="secondary" disabled={loading || busy} onClick={() => void refresh()}>{ar ? "تحديث الحالة" : "Refresh status"}</BaseerButton>{noConnection ? <BaseerButton type="button" disabled={busy} onClick={() => setConfigureOpen(true)}>{ar ? "تهيئة الرقم" : "Set up number"}</BaseerButton> : connected ? <BaseerButton type="button" variant="danger" disabled={busy} onClick={() => setPilotOpen(true)}>{ar ? "إيقاف الربط" : "Stop connection"}</BaseerButton> : <BaseerButton type="button" disabled={busy} onClick={() => setPilotOpen(true)}>{ar ? "ربط واتساب عبر QR" : "Connect WhatsApp with QR"}</BaseerButton>}</div></BaseerCard>
    <BaseerNotice tone="info" title={ar ? "حدود الربط" : "Connection boundary"}>{ar ? "QR مؤقت ولا يُخزن. لا ترسل كلمة مرور أو رمزاً أو سراً؛ الموصل يستقبل فقط الصورة وPDF من المجموعات التي تربطها بهذه الشركة." : "QR is temporary and never stored. Do not send a password, code, or secret; the connector accepts only image and PDF media from groups mapped to this company."}</BaseerNotice>
    {qr?.qr && qr.expiresAt ? <PilotQr token={qr.qr} expiresAt={qr.expiresAt} language={language} onRefresh={() => void refreshQr()} busy={busy} /> : null}
    {!noConnection ? <div className="whatsapp-invoice-monitoring__settings-actions"><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void refreshGroups()}>{ar ? "تحديث مجموعات واتساب" : "Refresh WhatsApp groups"}</BaseerButton><BaseerButton type="button" disabled={busy} onClick={() => setBinding({ id: null, groupJid: "", displayName: "", active: true, bindingRevision: null })}>{ar ? "إضافة مجموعة لهذه الشركة" : "Add group to this company"}</BaseerButton></div> : null}
    <section className="whatsapp-invoice-monitoring__binding-section" aria-labelledby="whatsapp-invoice-monitoring-groups"><header><div><h3 id="whatsapp-invoice-monitoring-groups">{ar ? "مجموعات الشركة المرتبطة" : "Mapped company groups"}</h3><p>{ar ? "هذه القائمة تخص الشركة المفتوحة الآن؛ تعطيلها لا يغير تاريخ الفواتير السابق." : "This list belongs to the currently open company; deactivation never changes historic invoices."}</p></div></header>{loading ? <BaseerCard aria-busy="true">{ar ? "جارٍ تحميل إعدادات المجموعات…" : "Loading group settings…"}</BaseerCard> : settings?.groupBindings.length ? <div className="whatsapp-invoice-monitoring__binding-list">{settings.groupBindings.map((item) => <BaseerCard key={item.id} padding="compact" className="whatsapp-invoice-monitoring__binding"><div><strong>{item.displayName}</strong><small dir="ltr">{item.groupJid}</small></div><div><BaseerStatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? (ar ? "نشطة" : "Active") : (ar ? "غير نشطة" : "Inactive")}</BaseerStatusBadge><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => setBinding({ id: item.id, groupJid: item.groupJid, displayName: item.displayName, active: item.active, bindingRevision: item.bindingRevision })}>{ar ? "تعديل" : "Edit"}</BaseerButton>{item.active ? <BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => setDeactivate(item)}>{ar ? "إلغاء التفعيل" : "Deactivate"}</BaseerButton> : null}</div></BaseerCard>)}</div> : <BaseerEmptyState title={ar ? "لا توجد مجموعات مرتبطة بهذه الشركة بعد" : "No groups are mapped to this company yet"} />}</section>
    <BaseerDialog open={configureOpen} title={ar ? "تهيئة ربط الرقم" : "Set up number connection"} language={language} busy={busy} error={null} onClose={() => !busy && setConfigureOpen(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setConfigureOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="wai-connection-config" disabled={busy}>{ar ? "حفظ ثم متابعة" : "Save and continue"}</BaseerButton></>}><form id="wai-connection-config" className="whatsapp-invoice-monitoring__binding-form" onSubmit={configure}><BaseerNotice tone="info" title={ar ? "ليس سراً" : "Not a secret"}>{ar ? "اسم الربط مجرد معرف داخلي ثابت؛ لا تدخل رقم تحقق أو كلمة مرور." : "The connection name is only a stable internal identifier; never enter a verification code or password."}</BaseerNotice><label>{ar ? "اسم الربط الداخلي" : "Internal connection name"}<BaseerTextInput value={key} disabled={busy} required maxLength={120} onChange={(event) => setKey(event.target.value)} /></label><label>{ar ? "تلميح اختياري للرقم" : "Optional number hint"}<BaseerTextInput dir="ltr" value={phoneHint} disabled={busy} maxLength={80} onChange={(event) => setPhoneHint(event.target.value)} /></label></form></BaseerDialog>
    <BaseerDialog open={pilotOpen} title={connected ? (ar ? "إيقاف الربط" : "Stop connection") : (ar ? "ربط واتساب عبر QR" : "Connect WhatsApp with QR")} language={language} busy={busy} error={null} onClose={() => !busy && setPilotOpen(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setPilotOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="button" variant={connected ? "danger" : "primary"} disabled={busy} onClick={() => void control(connected ? "stop" : "start")}>{connected ? (ar ? "إيقاف" : "Stop") : (ar ? "ربط QR" : "Connect with QR")}</BaseerButton></>}><BaseerNotice tone={connected ? "warning" : "info"} title={ar ? "تأكيد صريح مطلوب" : "Explicit confirmation required"}>{connected ? (ar ? "الإيقاف لا يحذف أي فاتورة أو ملف." : "Stopping does not delete any invoice or file.") : (ar ? "بعد التأكيد يظهر QR تلقائياً هنا؛ امسحه من واتساب على الهاتف." : "After confirmation, the QR appears here automatically; scan it from WhatsApp on the phone.")}</BaseerNotice></BaseerDialog>
    <BaseerDialog open={binding !== null} title={binding?.id ? (ar ? "تعديل ربط مجموعة" : "Edit group mapping") : (ar ? "إضافة مجموعة للشركة الحالية" : "Add group to current company")} language={language} busy={busy} error={null} onClose={() => !busy && setBinding(null)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setBinding(null)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="wai-binding" disabled={busy}>{ar ? "حفظ" : "Save"}</BaseerButton></>}><form id="wai-binding" className="whatsapp-invoice-monitoring__binding-form" onSubmit={saveBinding}>{!binding?.id && groups.length ? <label className="whatsapp-invoice-monitoring__binding-group-picker">{ar ? "مجموعة واتساب المكتشفة" : "Discovered WhatsApp group"}<BaseerStaticSelect label={ar ? "مجموعة واتساب المكتشفة" : "Discovered WhatsApp group"} value={groups.some((group) => group.jid === binding?.groupJid) ? binding?.groupJid : ""} disabled={busy} onChange={(event) => { const group = groups.find((item) => item.jid === event.target.value); if (group) setBinding((value) => value ? { ...value, groupJid: group.jid, displayName: group.displayName } : value); }}><option value="">{ar ? "اختر مجموعة" : "Choose group"}</option>{groups.map((group) => <option key={group.jid} value={group.jid}>{group.displayName}</option>)}</BaseerStaticSelect></label> : null}<label>{ar ? "معرّف المجموعة (JID)" : "Group JID"}<BaseerTextInput dir="ltr" value={binding?.groupJid ?? ""} disabled={busy || Boolean(binding?.id)} required maxLength={240} onChange={(event) => setBinding((value) => value ? { ...value, groupJid: event.target.value } : value)} /></label><label>{ar ? "اسم العرض" : "Display name"}<BaseerTextInput value={binding?.displayName ?? ""} disabled={busy} required maxLength={160} onChange={(event) => setBinding((value) => value ? { ...value, displayName: event.target.value } : value)} /></label><label>{ar ? "الحالة" : "Status"}<BaseerStaticSelect label={ar ? "الحالة" : "Status"} value={binding?.active ? "active" : "inactive"} disabled={busy} onChange={(event) => setBinding((value) => value ? { ...value, active: event.target.value === "active" } : value)}><option value="active">{ar ? "نشطة" : "Active"}</option><option value="inactive">{ar ? "غير نشطة" : "Inactive"}</option></BaseerStaticSelect></label></form></BaseerDialog>
    <BaseerDialog open={deactivate !== null} title={ar ? "إلغاء تفعيل المجموعة" : "Deactivate group"} language={language} busy={busy} error={null} onClose={() => !busy && setDeactivate(null)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setDeactivate(null)}>{ar ? "رجوع" : "Back"}</BaseerButton><BaseerButton type="button" variant="danger" disabled={busy} onClick={() => void disableBinding()}>{ar ? "إلغاء التفعيل" : "Deactivate"}</BaseerButton></>}><BaseerNotice tone="warning" title={deactivate?.displayName ?? ""}>{ar ? "يبقى التاريخ محفوظاً، لكن لا تقبل هذه المجموعة رسائل جديدة بعد التأكيد." : "History remains intact, but this group will not accept new media after confirmation."}</BaseerNotice></BaseerDialog>
  </section>;
}

function PilotQr({ token, expiresAt, language, onRefresh, busy }: { token: string; expiresAt: string; language: Language; onRefresh: () => void; busy: boolean }) {
  const ar = language === "ar"; const [image, setImage] = useState<string | null>(null); const [now, setNow] = useState(() => Date.now());
  useEffect(() => { let cancelled = false; setImage(null); void import("qrcode").then(({ toDataURL }) => toDataURL(token, { errorCorrectionLevel: "M", margin: 2, width: 360, color: { dark: "#102e20", light: "#ffffff" } })).then((value) => { if (!cancelled) setImage(value); }).catch(() => { if (!cancelled) setImage(null); }); return () => { cancelled = true; }; }, [token]);
  useEffect(() => { const remaining = Math.max(0, new Date(expiresAt).valueOf() - Date.now()); const timer = window.setTimeout(() => setNow(Date.now()), remaining + 50); return () => window.clearTimeout(timer); }, [expiresAt]);
  const expired = new Date(expiresAt).valueOf() <= now;
  return <BaseerCard className="whatsapp-invoice-monitoring__pilot-qr"><div><h3>{ar ? "رمز QR مؤقت" : "Temporary QR code"}</h3><p>{ar ? "يُنشأ في الذاكرة لعرض هذه الجلسة فقط، ولا يُخزن في المتصفح أو في إعدادات الشركة." : "Generated in memory only for this session; it is not stored in the browser or company settings."}</p><small>{ar ? "ينتهي: " : "Expires: "}{formatDateTime(expiresAt, language, "Asia/Riyadh")}</small>{expired ? <><BaseerStatusBadge tone="warning">{ar ? "انتهت الصلاحية" : "Expired"}</BaseerStatusBadge><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onRefresh}>{ar ? "إنشاء QR جديد" : "Generate a new QR"}</BaseerButton></> : null}</div>{image ? <img src={image} alt={ar ? "رمز QR مؤقت لربط واتساب" : "Temporary WhatsApp connection QR code"} /> : <div className="whatsapp-invoice-monitoring__pilot-qr-loading" aria-busy="true">{ar ? "جارٍ تجهيز QR…" : "Preparing QR…"}</div>}</BaseerCard>;
}

function settingsError(cause: unknown, language: Language, fallback: string) {
  if (cause instanceof BaseerApiError && language === "ar") {
    if (cause.status === 403) return "لا تملك صلاحية إدارة ربط واتساب أو مجموعات الشركات.";
    if (cause.status === 409) return "تعذر تنفيذ التغيير لأن حالة الربط أو المجموعة تغيرت. حدّث الصفحة ثم راجع الحالة.";
    if (cause.status === 503) return "خدمة الربط غير متاحة مؤقتاً. لم يبدأ أي اتصال من المتصفح؛ أعد المحاولة لاحقاً.";
  }
  return presentBaseerApiError(cause, language, fallback);
}

function tabTitle(tab: TabId, text: typeof copy.ar | typeof copy.en) { return tab === "assets" ? text.assets : tab === "invoices" ? text.invoices : tab === "notes" ? text.notes : tab === "archive" ? text.archive : text.connection; }
function extractionTone(status: InvoiceRow["extractionStatus"]): BaseerStatusTone { return status === "SUCCEEDED" ? "success" : status === "FAILED" ? "danger" : status === "RUNNING" ? "info" : "neutral"; }
function extractionLabel(status: InvoiceRow["extractionStatus"], text: typeof copy.ar | typeof copy.en) { return status === "QUEUED" ? text.extractionQueued : status === "RUNNING" ? text.extractionRunning : status === "SUCCEEDED" ? text.extractionSucceeded : status === "FAILED" ? text.extractionFailed : text.extractionNotRequested; }
function connectionToneFor(status: PilotConnectionStatus): BaseerStatusTone { return status === "CONNECTED" ? "success" : status === "GAP_DETECTED" ? "warning" : status === "BLOCKED" ? "danger" : "neutral"; }
function connectionTextFor(status: WorkspaceResponse["connection"]["status"], text: typeof copy.ar | typeof copy.en) { return status === "CONNECTED" ? text.connected : status === "GAP_DETECTED" ? text.gap : status === "BLOCKED" ? text.blocked : status === "DISCONNECTED" ? text.disconnected : text.unconfigured; }
function connectionTextForSettings(status: PilotConnectionStatus, language: Language) { const ar = language === "ar"; return status === "CONNECTED" ? (ar ? "متصل للقراءة فقط" : "Connected read-only") : status === "GAP_DETECTED" ? (ar ? "فجوة مزامنة تحتاج متابعة" : "Sync gap needs follow-up") : status === "BLOCKED" ? (ar ? "الربط محجوب" : "Connection blocked") : status === "DISCONNECTED" ? (ar ? "غير متصل" : "Disconnected") : (ar ? "الربط غير مهيأ" : "Connection not configured"); }
function assetStorageTone(state: AssetState): BaseerStatusTone { return state === "READY" ? "success" : state === "FAILED" ? "danger" : state === "QUARANTINED" ? "warning" : "neutral"; }
function scanTone(state: ScanStatus): BaseerStatusTone { return state === "CLEAN" ? "success" : state === "MALICIOUS" || state === "FAILED" ? "danger" : state === "UNAVAILABLE" ? "warning" : "neutral"; }
function assetStorageLabel(state: AssetState, language: Language) { const ar = language === "ar"; return state === "READY" ? (ar ? "جاهز" : "Ready") : state === "QUARANTINED" ? (ar ? "محجور" : "Quarantined") : state === "FAILED" ? (ar ? "فشل الحفظ" : "Storage failed") : (ar ? "قيد الحفظ" : "Pending storage"); }
function scanLabel(state: ScanStatus, language: Language) { const ar = language === "ar"; return state === "CLEAN" ? (ar ? "سليم" : "Clean") : state === "MALICIOUS" ? (ar ? "ضار" : "Malicious") : state === "FAILED" ? (ar ? "فشل الفحص" : "Scan failed") : state === "UNAVAILABLE" ? (ar ? "غير متاح" : "Unavailable") : state === "PENDING" ? (ar ? "قيد الفحص" : "Scanning") : (ar ? "لم يطلب" : "Not requested"); }

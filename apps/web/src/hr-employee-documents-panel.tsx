import { useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerTextArea } from "./baseer-form-fields";
import { useBaseerForm, z } from "./baseer-form-state";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrEmployeeDocument, downloadHrEmployeeDocumentVersion, listHrEmployeeDocuments, replaceHrEmployeeDocument, revokeHrEmployeeDocument, type HrEmployeeDocument, type HrEmployeeDocumentComplianceStatus, type HrEmployeeDocumentStatus, type HrEmployeeDocumentType } from "./hr-client";

type Language = "ar" | "en";
type FilterExpiry = "" | "VALID" | "EXPIRING" | "EXPIRED" | "NONE";
type DocumentDraft = { documentType: HrEmployeeDocumentType; title: string; referenceNumber: string; issueDate: string; expiryDate: string; notes: string; retentionUntil: string; legalHold: boolean; file: File | null };
const emptyDraft = (): DocumentDraft => ({ documentType: "OTHER", title: "", referenceNumber: "", issueDate: "", expiryDate: "", notes: "", retentionUntil: "", legalHold: false, file: null });
const acceptedFileTypes = ["application/pdf", "image/jpeg", "image/png"] as const;
const acceptedFileInput = acceptedFileTypes.join(",");

function isAcceptedFile(file: File) { return acceptedFileTypes.includes(file.type as (typeof acceptedFileTypes)[number]) && file.size > 0 && file.size <= 5 * 1024 * 1024; }

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("File could not be read.")); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file); });
}

export function HrEmployeeDocumentsPanel({ employeeId, language, canWrite = false, canRevoke = false, canDownload = false, onError, onChanged }: { employeeId: string; language: Language; canWrite?: boolean; canRevoke?: boolean; canDownload?: boolean; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const [documents, setDocuments] = useState<HrEmployeeDocument[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"" | HrEmployeeDocumentType>("");
  const [statusFilter, setStatusFilter] = useState<"" | HrEmployeeDocumentStatus>("");
  const [expiryFilter, setExpiryFilter] = useState<FilterExpiry>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<HrEmployeeDocument | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [draft, setDraft] = useState<DocumentDraft>(emptyDraft());
  const [replacement, setReplacement] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const required = ar ? "هذا الحقل مطلوب." : "This field is required.";
  const invalidFile = ar ? "المسموح PDF أو JPG أو PNG وبحد أقصى 5 ميجابايت." : "Use a PDF, JPG, or PNG file up to 5 MiB.";
  const createSchema = useMemo(() => z.object({
    documentType: z.enum(["NATIONAL_ID", "IQAMA", "PASSPORT", "EMPLOYMENT_CONTRACT", "MEDICAL_INSURANCE", "HEALTH_CERTIFICATE", "QUALIFICATION", "OTHER"]),
    title: z.string().trim().min(1, required),
    referenceNumber: z.string(), issueDate: z.string(), expiryDate: z.string(), notes: z.string(), retentionUntil: z.string(),
    legalHold: z.boolean(),
    file: z.custom<File | null>((value) => value === null || value instanceof File && isAcceptedFile(value), invalidFile),
  }), [invalidFile, required]);
  const createForm = useBaseerForm<DocumentDraft>({ defaultValues: emptyDraft(), values: draft, schema: createSchema });
  const replaceForm = useBaseerForm<{ file: File | null }>({
    defaultValues: { file: null }, values: { file: replacement },
    schema: useMemo(() => z.object({ file: z.custom<File>((value) => value instanceof File && isAcceptedFile(value), invalidFile) }), [invalidFile]),
  });
  const revokeForm = useBaseerForm<{ reason: string }>({
    defaultValues: { reason: "" }, values: { reason },
    schema: useMemo(() => z.object({ reason: z.string().trim().min(1, required) }), [required]),
  });

  const documentTypeLabel = (value: HrEmployeeDocumentType) => ({ NATIONAL_ID: ar ? "الهوية الوطنية" : "National ID", IQAMA: ar ? "الإقامة" : "Iqama", PASSPORT: ar ? "جواز السفر" : "Passport", EMPLOYMENT_CONTRACT: ar ? "عقد العمل" : "Employment contract", MEDICAL_INSURANCE: ar ? "التأمين الطبي" : "Medical insurance", HEALTH_CERTIFICATE: ar ? "الشهادة الصحية" : "Health certificate", QUALIFICATION: ar ? "المؤهل" : "Qualification", OTHER: ar ? "مستند آخر" : "Other document" })[value];
  const statusLabel = (value: HrEmployeeDocumentStatus) => value === "ACTIVE" ? (ar ? "نشط" : "Active") : (ar ? "ملغى" : "Revoked");
  const complianceLabel = (value: HrEmployeeDocumentComplianceStatus) => ({ NOT_APPLICABLE: ar ? "لا ينطبق" : "Not applicable", VALID: ar ? "ساري" : "Valid", EXPIRING: ar ? "قريب الانتهاء" : "Expiring", EXPIRED: ar ? "منتهي" : "Expired" })[value];
  const downloadAvailability = (document: HrEmployeeDocument) => document.status !== "ACTIVE" ? (ar ? "المستند الملغى غير متاح للتنزيل." : "A revoked document is unavailable for download.") : !document.currentVersion ? (ar ? "لا يوجد ملف مرفق." : "No file is attached.") : document.currentVersion.blobStatus === "READY" ? "" : (ar ? "غير متاح للتنزيل في حالته الحالية." : "Unavailable for download in its current state.");
  const load = useCallback(async (nextCursor?: string, append = false) => {
    const session = activeSession(); if (!session) { setLoading(false); return; }
    if (!append) setLoading(true);
    try {
      const receipt = await listHrEmployeeDocuments(session, employeeId, { cursor: nextCursor, pageSize: 25, documentType: typeFilter || undefined, status: statusFilter || undefined, expiry: expiryFilter || undefined });
      setDocuments((items) => append ? [...items, ...receipt.documents] : receipt.documents); setCursor(receipt.nextCursor);
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر تحميل المستندات." : "Documents could not be loaded.")); }
    finally { setLoading(false); }
  }, [ar, employeeId, expiryFilter, language, onError, statusFilter, typeFilter]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const session = activeSession(); if (!session) return;
    setBusy(true);
    try {
      await createHrEmployeeDocument(session, employeeId, { documentType: draft.documentType, title: draft.title, ...(draft.referenceNumber.trim() ? { referenceNumber: draft.referenceNumber.trim() } : {}), ...(draft.issueDate ? { issueDate: draft.issueDate } : {}), ...(draft.expiryDate ? { expiryDate: draft.expiryDate } : {}), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}), ...(draft.retentionUntil ? { retentionUntil: draft.retentionUntil } : {}), legalHold: draft.legalHold, ...(draft.file ? { upload: { fileName: draft.file.name, contentBase64: await fileAsBase64(draft.file) } } : {}), idempotencyKey: requestId() });
      setCreateOpen(false); setDraft(emptyDraft()); await load(); await onChanged();
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر حفظ المستند." : "The document could not be saved.")); }
    finally { setBusy(false); }
  };
  const replace = async () => {
    const session = activeSession(); if (!session || !selected || !replacement) return;
    setBusy(true);
    try { await replaceHrEmployeeDocument(session, selected.id, { upload: { fileName: replacement.name, contentBase64: await fileAsBase64(replacement) }, idempotencyKey: requestId() }); setReplaceOpen(false); setReplacement(null); setSelected(null); await load(); await onChanged(); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر استبدال الملف." : "The file could not be replaced.")); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    const session = activeSession(); if (!session || !selected) return;
    setBusy(true);
    try { await revokeHrEmployeeDocument(session, selected.id, { reason, idempotencyKey: requestId() }); setRevokeOpen(false); setReason(""); setSelected(null); await load(); await onChanged(); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر إلغاء المستند." : "The document could not be revoked.")); }
    finally { setBusy(false); }
  };
  const download = async () => {
    const session = activeSession(); const version = selected?.currentVersion;
    if (!session || !selected || selected.status !== "ACTIVE" || !version || version.blobStatus !== "READY") return;
    setBusy(true);
    try {
      const { blob, fileName } = await downloadHrEmployeeDocumentVersion(session, version.id);
      const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر تنزيل المستند." : "The document could not be downloaded.")); }
    finally { setBusy(false); }
  };
  const columns = [
    { id: "title", header: ar ? "المستند" : "Document", cell: (row: HrEmployeeDocument) => <BaseerButton type="button" variant="quiet" onClick={() => setSelected(row)}>{row.title}</BaseerButton> },
    { id: "type", header: ar ? "النوع" : "Type", cell: (row: HrEmployeeDocument) => documentTypeLabel(row.documentType) },
    { id: "expiry", header: ar ? "الانتهاء" : "Expiry", cell: (row: HrEmployeeDocument) => row.expiryDate ?? "—" },
    { id: "compliance", header: ar ? "الامتثال" : "Compliance", cell: (row: HrEmployeeDocument) => complianceLabel(row.complianceStatus) },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeDocument) => statusLabel(row.status) },
  ];
  return <><section className="hr-document-filters" aria-label={ar ? "تصفية المستندات" : "Document filters"}><div className="hr-document-filters__fields"><label>{ar ? "النوع" : "Type"}<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "" | HrEmployeeDocumentType)}><option value="">{ar ? "كل الأنواع" : "All types"}</option>{(["NATIONAL_ID", "IQAMA", "PASSPORT", "EMPLOYMENT_CONTRACT", "MEDICAL_INSURANCE", "HEALTH_CERTIFICATE", "QUALIFICATION", "OTHER"] as const).map((type) => <option key={type} value={type}>{documentTypeLabel(type)}</option>)}</select></label><label>{ar ? "الحالة" : "Status"}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | HrEmployeeDocumentStatus)}><option value="">{ar ? "كل الحالات" : "All statuses"}</option><option value="ACTIVE">{statusLabel("ACTIVE")}</option><option value="REVOKED">{statusLabel("REVOKED")}</option></select></label><label>{ar ? "الانتهاء" : "Expiry"}<select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value as FilterExpiry)}><option value="">{ar ? "الكل" : "All"}</option><option value="VALID">{complianceLabel("VALID")}</option><option value="EXPIRING">{complianceLabel("EXPIRING")}</option><option value="EXPIRED">{complianceLabel("EXPIRED")}</option><option value="NONE">{ar ? "دون تاريخ انتهاء" : "No expiry"}</option></select></label></div>{canWrite ? <BaseerButton type="button" onClick={() => { setDraft(emptyDraft()); setCreateOpen(true); }}>{ar ? "إضافة مستند" : "Add document"}</BaseerButton> : null}</section>{loading ? <BaseerCard>{ar ? "جارٍ تحميل المستندات…" : "Loading documents…"}</BaseerCard> : documents.length ? <BaseerDataGrid ariaLabel={ar ? "مستندات الموظف" : "Employee documents"} caption={ar ? "مستندات الموظف" : "Employee documents"} rows={documents} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد مستندات مطابقة." : "No matching documents."}</BaseerCard>}{cursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(cursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    {canWrite ? <BaseerFormDialog open={createOpen} title={ar ? "إضافة مستند" : "Add document"} language={language} busy={busy} size="standard" formId="hr-employee-document-create" submitLabel={ar ? "حفظ المستند" : "Save document"} onClose={() => setCreateOpen(false)}><form id="hr-employee-document-create" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={createForm.handleSubmit(() => void create())}><BaseerFormSection title={ar ? "بيانات المستند" : "Document details"}><BaseerFormGrid><label>{ar ? "النوع" : "Type"}<select value={draft.documentType} onChange={(event) => setDraft((value) => ({ ...value, documentType: event.target.value as HrEmployeeDocumentType }))}>{(["NATIONAL_ID", "IQAMA", "PASSPORT", "EMPLOYMENT_CONTRACT", "MEDICAL_INSURANCE", "HEALTH_CERTIFICATE", "QUALIFICATION", "OTHER"] as const).map((type) => <option key={type} value={type}>{documentTypeLabel(type)}</option>)}</select></label><label>{ar ? "العنوان" : "Title"}<input required aria-invalid={Boolean(createForm.formState.errors.title)} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} />{createForm.formState.errors.title ? <small role="alert">{createForm.formState.errors.title.message}</small> : null}</label><label className="baseer-form-field--full">{ar ? "المرجع" : "Reference"}<input value={draft.referenceNumber} onChange={(event) => setDraft((value) => ({ ...value, referenceNumber: event.target.value }))} /></label><BaseerDatePicker language={language} label={ar ? "تاريخ الإصدار" : "Issue date"} clearable value={draft.issueDate} onChange={(issueDate) => setDraft((value) => ({ ...value, issueDate }))} /><BaseerDatePicker language={language} label={ar ? "تاريخ الانتهاء" : "Expiry date"} clearable value={draft.expiryDate} onChange={(expiryDate) => setDraft((value) => ({ ...value, expiryDate }))} /><BaseerDatePicker language={language} label={ar ? "الاحتفاظ حتى" : "Retain until"} clearable value={draft.retentionUntil} onChange={(retentionUntil) => setDraft((value) => ({ ...value, retentionUntil }))} /><label className="baseer-form-field--full">{ar ? "الملف (اختياري)" : "File (optional)"}<input accept={acceptedFileInput} type="file" aria-invalid={Boolean(createForm.formState.errors.file)} onChange={(event) => setDraft((value) => ({ ...value, file: event.target.files?.[0] ?? null }))} />{createForm.formState.errors.file ? <small role="alert">{createForm.formState.errors.file.message}</small> : null}</label><label className="baseer-form-checkbox"><input type="checkbox" checked={draft.legalHold} onChange={(event) => setDraft((value) => ({ ...value, legalHold: event.target.checked }))} /> {ar ? "حجز قانوني" : "Legal hold"}</label><label className="baseer-form-field--full">{ar ? "ملاحظات" : "Notes"}<BaseerTextArea compact value={draft.notes} onValueChange={(notes) => setDraft((value) => ({ ...value, notes }))} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog> : null}
    <BaseerDialog open={Boolean(selected)} title={selected?.title ?? ""} language={language} busy={busy} onClose={() => setSelected(null)} footer={selected ? <>{canDownload && selected.status === "ACTIVE" && selected.currentVersion?.blobStatus === "READY" ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void download()}>{ar ? "تنزيل الملف" : "Download file"}</BaseerButton> : null}{canWrite ? <BaseerButton type="button" variant="secondary" disabled={busy || selected.status !== "ACTIVE"} onClick={() => { setReplacement(null); setReplaceOpen(true); }}>{ar ? "استبدال الملف" : "Replace file"}</BaseerButton> : null}{canRevoke ? <BaseerButton type="button" variant="danger" disabled={busy || selected.status !== "ACTIVE"} onClick={() => { setReason(""); setRevokeOpen(true); }}>{ar ? "إلغاء المستند" : "Revoke document"}</BaseerButton> : null}</> : undefined}>{selected ? <dl className="administration-details"><div><dt>{ar ? "النوع" : "Type"}</dt><dd>{documentTypeLabel(selected.documentType)}</dd></div><div><dt>{ar ? "المرجع" : "Reference"}</dt><dd>{selected.referenceNumber ?? "—"}</dd></div><div><dt>{ar ? "التواريخ" : "Dates"}</dt><dd>{`${selected.issueDate ?? "—"} — ${selected.expiryDate ?? "—"}`}</dd></div><div><dt>{ar ? "الامتثال" : "Compliance"}</dt><dd>{complianceLabel(selected.complianceStatus)}</dd></div><div><dt>{ar ? "الملف" : "File"}</dt><dd>{selected.currentVersion ? `v${selected.currentVersion.version} · ${selected.currentVersion.mimeType} · ${selected.currentVersion.blobStatus}` : "—"}</dd></div>{downloadAvailability(selected) ? <div><dt>{ar ? "إتاحة التنزيل" : "Download availability"}</dt><dd>{downloadAvailability(selected)}</dd></div> : null}{selected.notes ? <div><dt>{ar ? "ملاحظات" : "Notes"}</dt><dd>{selected.notes}</dd></div> : null}</dl> : null}</BaseerDialog>
    <BaseerFormDialog open={replaceOpen} title={ar ? "استبدال ملف المستند" : "Replace document file"} language={language} busy={busy} size="compact" formId="hr-employee-document-replace" submitLabel={ar ? "استبدال" : "Replace"} onClose={() => setReplaceOpen(false)}><form id="hr-employee-document-replace" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={replaceForm.handleSubmit(() => void replace())}><BaseerFormSection title={ar ? "الملف الجديد" : "New file"}><BaseerFormGrid columns="one"><label>{ar ? "الملف الجديد" : "New file"}<input required accept={acceptedFileInput} type="file" aria-invalid={Boolean(replaceForm.formState.errors.file)} onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} />{replaceForm.formState.errors.file ? <small role="alert">{replaceForm.formState.errors.file.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={revokeOpen} title={ar ? "إلغاء المستند" : "Revoke document"} language={language} busy={busy} size="compact" formId="hr-employee-document-revoke" submitLabel={ar ? "تأكيد الإلغاء" : "Confirm revocation"} onClose={() => setRevokeOpen(false)}><form id="hr-employee-document-revoke" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={revokeForm.handleSubmit(() => void revoke())}><BaseerFormSection title={ar ? "سبب الإلغاء" : "Revocation reason"}><BaseerFormGrid columns="one"><label>{ar ? "سبب الإلغاء" : "Revocation reason"}<BaseerTextArea compact required value={reason} onValueChange={setReason} />{revokeForm.formState.errors.reason ? <small role="alert">{revokeForm.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
  </>;
}

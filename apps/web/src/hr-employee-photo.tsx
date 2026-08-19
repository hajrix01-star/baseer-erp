import { useCallback, useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerDialog } from "./baseer-dialog";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrEmployeeDocument, downloadHrEmployeeDocumentVersion, listHrEmployeeDocuments, replaceHrEmployeeDocument, type HrEmployeeDocument } from "./hr-client";
import { hrText } from "./hr-copy";
import "./hr-employee-photo.css";

type Language = "ar" | "en";
export const HR_PROFILE_PHOTO_REFERENCE = "HR_PROFILE_PHOTO_V1";
const maxPhotoBytes = 5 * 1024 * 1024;

export function isHrEmployeePhoto(file: File) { return ["image/jpeg", "image/png"].includes(file.type) && file.size > 0 && file.size <= maxPhotoBytes; }
export function hrEmployeePhotoAsBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Photo could not be read.")); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file); }); }
const initials = (value: string) => value.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—";

export function HrEmployeePhoto({ employeeId, name, language, onError, onChanged }: { employeeId: string; name: string; language: Language; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const text = hrText(language);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoDocument, setPhotoDocument] = useState<HrEmployeeDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const release = useCallback(() => setPhotoUrl((current) => { if (current) URL.revokeObjectURL(current); return null; }), []);
  const load = useCallback(async () => {
    const session = activeSession(); if (!session) return;
    const receipt = await listHrEmployeeDocuments(session, employeeId, { status: "ACTIVE", pageSize: 100 });
    const document = receipt.documents.find((item) => item.referenceNumber === HR_PROFILE_PHOTO_REFERENCE && item.currentVersion?.blobStatus === "READY" && item.currentVersion.mimeType.startsWith("image/")) ?? null;
    release(); setPhotoDocument(document);
    if (!document?.currentVersion) return;
    const { blob } = await downloadHrEmployeeDocumentVersion(session, document.currentVersion.id);
    setPhotoUrl(URL.createObjectURL(blob));
  }, [employeeId, release]);
  useEffect(() => { void load().catch((error) => onError(presentBaseerApiError(error, language, text.employeePhotoLoadFailed))); return release; }, [language, load, onError, release, text.employeePhotoLoadFailed]);
  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!isHrEmployeePhoto(file)) { onError(ar ? "اختر صورة JPG أو PNG بحجم لا يتجاوز 5 ميجابايت." : "Choose a JPG or PNG image up to 5 MiB."); return; }
    const session = activeSession(); if (!session) return;
    setBusy(true);
    try {
      const upload = { fileName: file.name, contentBase64: await hrEmployeePhotoAsBase64(file) };
      if (photoDocument) await replaceHrEmployeeDocument(session, photoDocument.id, { upload, idempotencyKey: requestId() });
      else await createHrEmployeeDocument(session, employeeId, { documentType: "OTHER", title: ar ? "صورة الموظف الشخصية" : "Employee profile photo", referenceNumber: HR_PROFILE_PHOTO_REFERENCE, upload, idempotencyKey: requestId() });
      await load(); await onChanged();
    } catch (error) { onError(presentBaseerApiError(error, language, text.employeePhotoSaveFailed)); }
    finally { setBusy(false); }
  };
  return <><div className="hr-employee-photo"><button type="button" className="hr-employee-photo__avatar" disabled={busy || !photoUrl} aria-label={ar ? "عرض صورة الموظف" : "View employee photo"} onClick={() => setPreviewOpen(true)}>{photoUrl ? <img src={photoUrl} alt={ar ? `صورة ${name}` : `${name} photo`} /> : <span>{initials(name)}</span>}</button><label className="hr-employee-photo__upload"><input disabled={busy} accept="image/jpeg,image/png" type="file" onChange={(event) => void choose(event)} /><span>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : photoUrl ? (ar ? "تحديث الصورة" : "Update photo") : (ar ? "إضافة صورة" : "Add photo")}</span></label></div><BaseerDialog open={previewOpen} title={ar ? "صورة الموظف" : "Employee photo"} language={language} onClose={() => setPreviewOpen(false)}>{photoUrl ? <img className="hr-employee-photo__preview" src={photoUrl} alt={ar ? `صورة ${name}` : `${name} photo`} /> : null}</BaseerDialog></>;
}

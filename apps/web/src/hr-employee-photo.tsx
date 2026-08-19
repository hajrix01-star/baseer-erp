import { useCallback, useEffect, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerDialog } from "./baseer-dialog";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrEmployeeDocument, replaceHrEmployeeDocument } from "./hr-client";
import { hrText } from "./hr-copy";
import { getCachedHrEmployeePhotoBlob, getCachedHrEmployeePhotoDocument, invalidateHrEmployeePhotoDocuments, primeHrEmployeePhotoBlob } from "./hr-employee-photo-cache";
import { HR_PROFILE_PHOTO_REFERENCE } from "./hr-employee-photo-reference";
import "./hr-employee-photo.css";

type Language = "ar" | "en";
export { HR_PROFILE_PHOTO_REFERENCE } from "./hr-employee-photo-reference";
const maxPhotoBytes = 5 * 1024 * 1024;

export function isHrEmployeePhoto(file: File) { return ["image/jpeg", "image/png"].includes(file.type) && file.size > 0 && file.size <= maxPhotoBytes; }
export function hrEmployeePhotoAsBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Photo could not be read.")); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file); }); }
const initials = (value: string) => value.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—";

export function HrEmployeePhoto({ employeeId, photoVersionId, name, language, onError, onChanged }: { employeeId: string; photoVersionId: string | null; name: string; language: Language; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const text = hrText(language);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoDocumentId, setPhotoDocumentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const loadSequence = useRef(0);
  const release = useCallback(() => setPhotoUrl((current) => { if (current) URL.revokeObjectURL(current); return null; }), []);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    release();
    const session = activeSession(); if (!session) return;
    if (!photoVersionId) return;
    try {
      const blob = await getCachedHrEmployeePhotoBlob(session, photoVersionId);
      if (sequence === loadSequence.current) setPhotoUrl(URL.createObjectURL(blob));
    } catch (error) {
      if (sequence === loadSequence.current) throw error;
    }
  }, [photoVersionId, release]);
  useEffect(() => {
    void load().catch((error) => onError(presentBaseerApiError(error, language, text.employeePhotoLoadFailed)));
    return () => { loadSequence.current += 1; release(); };
  }, [language, load, onError, release, text.employeePhotoLoadFailed]);
  useEffect(() => { setPhotoDocumentId(null); }, [employeeId]);
  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!isHrEmployeePhoto(file)) { onError(ar ? "اختر صورة JPG أو PNG بحجم لا يتجاوز 5 ميجابايت." : "Choose a JPG or PNG image up to 5 MiB."); return; }
    const session = activeSession(); if (!session) return;
    setBusy(true);
    try {
      const upload = { fileName: file.name, contentBase64: await hrEmployeePhotoAsBase64(file) };
      const documentId = photoDocumentId ?? (photoVersionId ? (await getCachedHrEmployeePhotoDocument(session, employeeId))?.id ?? null : null);
      const result = documentId
        ? await replaceHrEmployeeDocument(session, documentId, { upload, idempotencyKey: requestId() })
        : await createHrEmployeeDocument(session, employeeId, { documentType: "OTHER", title: ar ? "صورة الموظف الشخصية" : "Employee profile photo", referenceNumber: HR_PROFILE_PHOTO_REFERENCE, upload, idempotencyKey: requestId() });
      invalidateHrEmployeePhotoDocuments(session, employeeId);
      primeHrEmployeePhotoBlob(session, result.versionId, file);
      loadSequence.current += 1;
      release(); setPhotoUrl(URL.createObjectURL(file)); setPhotoDocumentId(result.id);
      await onChanged();
    } catch (error) { onError(presentBaseerApiError(error, language, text.employeePhotoSaveFailed)); }
    finally { setBusy(false); }
  };
  return <><div className="hr-employee-photo"><button type="button" className="hr-employee-photo__avatar" disabled={busy || !photoUrl} aria-label={ar ? "عرض صورة الموظف" : "View employee photo"} onClick={() => setPreviewOpen(true)}>{photoUrl ? <img src={photoUrl} alt={ar ? `صورة ${name}` : `${name} photo`} /> : <span>{initials(name)}</span>}</button><label className="hr-employee-photo__upload"><input disabled={busy} accept="image/jpeg,image/png" type="file" onChange={(event) => void choose(event)} /><span>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : photoUrl ? (ar ? "تحديث الصورة" : "Update photo") : (ar ? "إضافة صورة" : "Add photo")}</span></label></div><BaseerDialog open={previewOpen} title={ar ? "صورة الموظف" : "Employee photo"} language={language} onClose={() => setPreviewOpen(false)}>{photoUrl ? <img className="hr-employee-photo__preview" src={photoUrl} alt={ar ? `صورة ${name}` : `${name} photo`} /> : null}</BaseerDialog></>;
}

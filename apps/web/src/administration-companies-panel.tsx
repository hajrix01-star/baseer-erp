import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import {
  createAdministrationCompany,
  loadAdministrationCompanyLogo,
  updateAdministrationCompany,
  updateAdministrationCompanyStatus,
  uploadAdministrationCompanyLogo,
} from "./administration-client";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

type Company = AdministrationOverview["companies"][number];
type DialogMode = "create" | "manage" | null;
type Props = { session: ActiveSession; companies: AdministrationOverview["companies"]; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void };

export function AdministrationCompaniesPanel({ session, companies, owner, onDone, onError }: Props) {
  const [mode, setMode] = useState<DialogMode>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null;
  const visibleCompanies = companies.filter((company) => showArchived || company.status === "ACTIVE");
  const archivedCount = companies.filter((company) => company.status === "ARCHIVED").length;
  const close = () => { setMode(null); setSelectedCompanyId(null); };
  return <section className="administration-section administration-companies-section">
    <header className="administration-section-heading administration-companies-heading"><div><h3>الشركات</h3><p>اختر بطاقة الشركة لعرض بياناتها وتعديلها. الأرشفة توقف استخدامها دون حذف تاريخها.</p></div><div className="administration-companies-toolbar">{archivedCount > 0 && <label className="administration-archive-toggle"><input checked={showArchived} type="checkbox" onChange={(event) => setShowArchived(event.target.checked)} />عرض المؤرشفة <span>{archivedCount}</span></label>}{owner && <button className="daily-sales-primary" type="button" onClick={() => setMode("create")}>+ إضافة شركة</button>}</div></header>
    <div className="administration-company-cards">{visibleCompanies.map((company, index) => <button className="baseer-card baseer-card--default baseer-card--compact baseer-card--interactive administration-company-card" key={company.id} type="button" onClick={() => { setSelectedCompanyId(company.id); setMode("manage"); }}><span className="administration-company-card__mark" aria-hidden="true">{company.nameAr.trim().slice(0, 1)}</span><span className="administration-company-card__body"><strong>{company.nameAr}</strong><small>{company.nameEn}</small><span>{company.businessTimezone}</span></span><span className={company.status === "ACTIVE" ? "administration-company-card__status is-active" : "administration-company-card__status is-disabled"}>{company.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}</span><span className="administration-company-card__footer">شركة #{index + 1}<b>عرض وتعديل ←</b></span></button>)}</div>
    {visibleCompanies.length === 0 && <div className="administration-company-empty">لا توجد شركات ضمن هذا العرض.</div>}
    {mode === "create" && <CompanyDialog session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
    {mode === "manage" && selectedCompany && <CompanyDialog company={selectedCompany} session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
  </section>;
}

function CompanyDialog({ session, company, owner, onDone, onError, onClose }: { session: ActiveSession; company?: Company; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) {
  const isCreate = !company;
  const [nameAr, setNameAr] = useState(company?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(company?.nameEn ?? "");
  const [businessTimezone, setBusinessTimezone] = useState(company?.businessTimezone ?? "Asia/Riyadh");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFileMetadataId, setLogoFileMetadataId] = useState<string | null>(company?.logoFileMetadataId ?? null);
  useEffect(() => {
    if (!company?.logoFileMetadataId) return;
    let active = true; let receivedUrl: string | null = null;
    void loadAdministrationCompanyLogo(session, company.id).then((url) => { receivedUrl = url; if (active) setLogoUrl(url); else if (url) URL.revokeObjectURL(url); }).catch(() => undefined);
    return () => { active = false; if (receivedUrl) URL.revokeObjectURL(receivedUrl); };
  }, [company?.id, company?.logoFileMetadataId, session]);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const save = async (event: FormEvent) => { event.preventDefault(); if (!owner) return; setBusy(true); try { if (isCreate) await createAdministrationCompany(session, { nameAr, nameEn }); else await updateAdministrationCompany(session, company.id, { nameAr, nameEn, businessTimezone, logoFileMetadataId }); await onDone(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); } };
  const changeStatus = async () => { if (!company || !owner) return; setBusy(true); try { await updateAdministrationCompanyStatus(session, company.id, company.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE", reason.trim() || undefined); await onDone(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); } };
  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file || !company || !owner) return; setBusy(true); try { const receipt = await uploadAdministrationCompanyLogo(session, company.id, file); setLogoFileMetadataId(receipt.id); await onDone(); const nextUrl = URL.createObjectURL(file); setLogoUrl((prior) => { if (prior) URL.revokeObjectURL(prior); return nextUrl; }); } catch (error) { onError(error); } finally { setBusy(false); event.target.value = ""; } };
  const title = isCreate ? "إضافة شركة" : `تعديل الشركة — ${company.nameAr}`;
  return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}><section ref={dialogRef} className="daily-sales-dialog administration-company-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header className="daily-sales-dialog__header"><div><p className="eyebrow">إدارة الشركات</p><h3>{title}</h3><p>{isCreate ? "أدخل اسم الشركة بالعربية والإنجليزية لإنشائها." : "تُسجّل كل التعديلات في سجل المراجعة."}</p></div><button className="dialog-icon-button" type="button" aria-label="إغلاق" disabled={busy} onClick={onClose}>×</button></header><form className="administration-dialog-form" onSubmit={(event) => void save(event)}><div className="administration-company-editor-profile">{logoUrl ? <img alt={`شعار ${nameAr || "الشركة"}`} src={logoUrl} /> : <span>{nameAr.trim().slice(0, 1) || "ش"}</span>}<div><strong>{nameAr || "اسم الشركة"}</strong><small>{isCreate ? "شركة جديدة" : company.status === "ACTIVE" ? "شركة نشطة" : "شركة مؤرشفة"}</small></div></div><label>اسم الشركة بالعربية<input required value={nameAr} onChange={(event) => setNameAr(event.target.value)} autoFocus /></label><label>Company name in English<input required value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label>{!isCreate && owner && <label className="administration-company-logo-upload">رفع الشعار<input accept="image/png,image/jpeg,image/webp" disabled={busy} type="file" onChange={(event) => void selectLogo(event)} /><span>PNG أو JPG أو WebP · حتى 512 كيلوبايت</span></label>}{!isCreate && owner && <fieldset className="administration-company-status-action"><legend>{company.status === "ACTIVE" ? "أرشفة الشركة" : "إعادة تفعيل الشركة"}</legend><label>سبب التغيير (اختياري)<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سبباً مختصراً" /></label><button className={company.status === "ACTIVE" ? "daily-sales-danger" : "daily-sales-secondary"} disabled={busy} type="button" onClick={() => void changeStatus()}>{company.status === "ACTIVE" ? "أرشفة الشركة" : "إعادة التفعيل"}</button></fieldset>}<footer>{owner && <button className="daily-sales-primary" disabled={busy}>{busy ? "جارٍ الحفظ…" : isCreate ? "إنشاء الشركة" : "حفظ التعديلات"}</button>}</footer></form></section></div>;
}
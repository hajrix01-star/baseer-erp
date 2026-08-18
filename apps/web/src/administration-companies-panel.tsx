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
import { api, requestId } from "./daily-sales-client";
import { displayName } from "./baseer-localization";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import { administrationText } from "./administration-copy";

type Company = AdministrationOverview["companies"][number];
type DialogMode = "create" | "manage" | null;
type Props = { language: "ar" | "en"; session: ActiveSession; companies: AdministrationOverview["companies"]; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void };

export function AdministrationCompaniesPanel({ language, session, companies, owner, onDone, onError }: Props) {
  const text = administrationText(language);
  const [mode, setMode] = useState<DialogMode>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null;
  const visibleCompanies = companies.filter((company) => { const term = search.trim().toLocaleLowerCase(); return (showArchived || company.status === "ACTIVE") && (!term || `${company.nameAr} ${company.nameEn} ${company.businessTimezone}`.toLocaleLowerCase().includes(term)); });
  const archivedCount = companies.filter((company) => company.status === "ARCHIVED").length;
  const close = () => { setMode(null); setSelectedCompanyId(null); };
  const clearFilters = () => { setSearch(""); setShowArchived(false); };
  const appliedFilters = [
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
    ...(showArchived ? [{ id: "archived", label: text.showArchived, onRemove: () => setShowArchived(false) }] : []),
  ];
  return <section className="administration-section administration-companies-section">
    <header className="administration-section-heading administration-companies-heading"><div><h3>{text.companies}</h3></div><div className="administration-companies-toolbar">{owner && <button className="daily-sales-primary" type="button" onClick={() => setMode("create")}>+ {text.addCompany}</button>}</div></header><BaseerFilterBar controlsPresentation="menu" language={language} search={search} searchLabel={text.companies} searchPlaceholder={language === "ar" ? "ابحث باسم الشركة" : "Search company"} onSearchChange={setSearch} appliedFilters={appliedFilters} onClear={clearFilters} controls={archivedCount > 0 ? <BaseerFilterToggle label={text.showArchived} checked={showArchived} onChange={setShowArchived} /> : undefined} />
    <div className="administration-company-cards">{visibleCompanies.map((company, index) => <button className="baseer-card baseer-card--default baseer-card--compact baseer-card--interactive administration-company-card" key={company.id} type="button" onClick={() => { setSelectedCompanyId(company.id); setMode("manage"); }}><span className="administration-company-card__mark" aria-hidden="true">{company.nameAr.trim().slice(0, 1)}</span><span className="administration-company-card__body"><strong>{displayName(language, company)}</strong><small>{language === "ar" ? company.nameEn : company.nameAr}</small><span>{company.businessTimezone}</span></span><span className={company.status === "ACTIVE" ? "administration-company-card__status is-active" : "administration-company-card__status is-disabled"}>{company.status === "ACTIVE" ? text.active : text.archived}</span><span className="administration-company-card__footer">{text.companyNumber(index + 1)}<b>{text.viewEdit} ←</b></span></button>)}</div>
    {visibleCompanies.length === 0 && <div className="administration-company-empty">{text.noCompanies}</div>}
    {mode === "create" && <CompanyDialog language={language} session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
    {mode === "manage" && selectedCompany && <CompanyDialog company={selectedCompany} language={language} session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
  </section>;
}

function CompanyDialog({ language, session, company, owner, onDone, onError, onClose }: { language: "ar" | "en"; session: ActiveSession; company?: Company; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) {
  const text = administrationText(language);
  const isCreate = !company;
  const [nameAr, setNameAr] = useState(company?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(company?.nameEn ?? "");
  const [businessTimezone, setBusinessTimezone] = useState(company?.businessTimezone ?? "Asia/Riyadh");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFileMetadataId, setLogoFileMetadataId] = useState<string | null>(company?.logoFileMetadataId ?? null);
  const [vatRate, setVatRate] = useState("15");
  const [vatBusy, setVatBusy] = useState(false);
  useEffect(() => {
    if (!company?.logoFileMetadataId) return;
    let active = true; let receivedUrl: string | null = null;
    void loadAdministrationCompanyLogo(session, company.id).then((url) => { receivedUrl = url; if (active) setLogoUrl(url); else if (url) URL.revokeObjectURL(url); }).catch(() => undefined);
    return () => { active = false; if (receivedUrl) URL.revokeObjectURL(receivedUrl); };
  }, [company?.id, company?.logoFileMetadataId, session]);
  useEffect(() => {
    if (!company) return;
    let active = true;
    void api<{ profile: { vatRateBasisPoints: number } | null }>({ ...session, companyId: company.id }, "/finance/configuration")
      .then((receipt) => {
        if (active) setVatRate(String((receipt.profile?.vatRateBasisPoints ?? 1500) / 100));
      })
      .catch(onError);
    return () => { active = false; };
  }, [company, onError, session]);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const save = async (event: FormEvent) => { event.preventDefault(); if (!owner) return; setBusy(true); try { if (isCreate) await createAdministrationCompany(session, { nameAr, nameEn }); else await updateAdministrationCompany(session, company.id, { nameAr, nameEn, businessTimezone, logoFileMetadataId }); await onDone(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); } };
  const changeStatus = async () => { if (!company || !owner) return; setBusy(true); try { await updateAdministrationCompanyStatus(session, company.id, company.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE", reason.trim() || undefined); await onDone(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); } };
  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file || !company || !owner) return; setBusy(true); try { const receipt = await uploadAdministrationCompanyLogo(session, company.id, file); setLogoFileMetadataId(receipt.id); await onDone(); const nextUrl = URL.createObjectURL(file); setLogoUrl((prior) => { if (prior) URL.revokeObjectURL(prior); return nextUrl; }); } catch (error) { onError(error); } finally { setBusy(false); event.target.value = ""; } };
  const saveVatRate = async () => {
    if (!company || !owner) return;
    const vatRateBasisPoints = Math.round(Number(vatRate) * 100);
    if (!Number.isFinite(vatRateBasisPoints) || vatRateBasisPoints < 0 || vatRateBasisPoints > 10_000) return;
    setVatBusy(true);
    try {
      await api({ ...session, companyId: company.id }, "/finance/configuration/vat-rate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vatRateBasisPoints, idempotencyKey: requestId() }) });
    } catch (error) {
      onError(error);
    } finally {
      setVatBusy(false);
    }
  };
  const title = isCreate ? text.addCompany : `${text.edit}: ${displayName(language, company)}`;
  return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !busy && !vatBusy && onClose()}><section ref={dialogRef} className="daily-sales-dialog administration-company-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header className="daily-sales-dialog__header"><div><p className="eyebrow">{text.companyManagement}</p><h3>{title}</h3></div><button className="dialog-icon-button" type="button" aria-label={text.close} disabled={busy || vatBusy} onClick={onClose}>×</button></header><form className="administration-dialog-form" onSubmit={(event) => void save(event)}><div className="administration-company-editor-profile">{logoUrl ? <img alt={`${text.companyLogo}: ${nameAr || text.companies}`} src={logoUrl} /> : <span>{nameAr.trim().slice(0, 1) || "ش"}</span>}<div><strong>{nameAr || text.companies}</strong><small>{isCreate ? text.newCompany : company.status === "ACTIVE" ? text.activeCompany : text.archivedCompany}</small></div></div><label>{text.companyArabicName}<input required value={nameAr} onChange={(event) => setNameAr(event.target.value)} autoFocus /></label><label>{text.companyEnglishName}<input required value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label>{!isCreate && owner && <label className="administration-company-logo-upload">{text.companyLogo}<input accept="image/png,image/jpeg,image/webp" disabled={busy || vatBusy} type="file" onChange={(event) => void selectLogo(event)} /><span>{text.companyLogoHint}</span></label>}{!isCreate && company && <fieldset className="administration-access-list"><legend>{language === "ar" ? "الإعدادات الضريبية" : "Tax settings"}</legend><label>{language === "ar" ? "نسبة ضريبة القيمة المضافة" : "VAT rate"}<input aria-describedby="company-vat-rate-note" disabled={!owner || vatBusy} inputMode="decimal" min="0" max="100" step="0.01" type="number" value={vatRate} onChange={(event) => setVatRate(event.target.value)} /></label><small id="company-vat-rate-note">{language === "ar" ? "تطبّق على الفواتير الجديدة فقط؛ الفواتير السابقة لا تتغير." : "Applies to future invoices only; posted invoices never change."}</small>{owner && <footer><button className="daily-sales-secondary" disabled={vatBusy} type="button" onClick={() => void saveVatRate()}>{vatBusy ? text.saving : language === "ar" ? "حفظ النسبة" : "Save rate"}</button></footer>}</fieldset>}{!isCreate && owner && <fieldset className="administration-company-status-action"><legend>{company.status === "ACTIVE" ? text.archiveCompany : text.reactivateCompany}</legend><label>{text.changeReason} ({text.optional})<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={text.shortReason} /></label><button className={company.status === "ACTIVE" ? "daily-sales-danger" : "daily-sales-secondary"} disabled={busy || vatBusy} type="button" onClick={() => void changeStatus()}>{company.status === "ACTIVE" ? "أرشفة الشركة" : "إعادة التفعيل"}</button></fieldset>}<footer>{owner && <button className="daily-sales-primary" disabled={busy || vatBusy}>{busy ? text.saving : isCreate ? text.createCompany : text.updateCompany}</button>}</footer></form></section></div>;
}

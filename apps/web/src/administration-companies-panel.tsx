import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useState, type ChangeEvent } from "react";
import { COMPANY_CONTEXT_LOCATIONS } from "@baseer-erp/contracts/administration";

import {
  createAdministrationCompany,
  loadAdministrationCompanyLogo,
  updateAdministrationCompany,
  updateAdministrationCompanyStatus,
  uploadAdministrationCompanyLogo,
} from "./administration-client";
import { administrationText } from "./administration-copy";
import type { AdministrationOverview } from "./administration-types";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import { displayName } from "./baseer-localization";
import { api, requestId, type ActiveSession } from "./daily-sales-client";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

type Company = AdministrationOverview["companies"][number];
type DialogMode = "create" | "manage" | null;
type CompanyForm = { nameAr: string; nameEn: string; businessTimezone: string; contextLocationCode: string };
type Props = {
  language: "ar" | "en";
  session: ActiveSession;
  companies: AdministrationOverview["companies"];
  owner: boolean;
  onDone: () => Promise<void>;
  onError: (error: unknown) => void;
};
const companySchema = (ar: boolean) => z.object({
  nameAr: z.string().trim().min(1, ar ? "أدخل اسم الشركة بالعربية." : "Enter the company name in Arabic."),
  nameEn: z.string().trim().min(1, ar ? "أدخل اسم الشركة بالإنجليزية." : "Enter the company name in English."),
  businessTimezone: z.string().trim().min(1),
  contextLocationCode: z.string(),
});

export function AdministrationCompaniesPanel({ language, session, companies, owner, onDone, onError }: Props) {
  const text = administrationText(language);
  const [mode, setMode] = useState<DialogMode>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null;
  const visibleCompanies = companies.filter((company) => {
    const term = search.trim().toLocaleLowerCase();
    return (showArchived || company.status === "ACTIVE") && (!term || `${company.nameAr} ${company.nameEn} ${company.businessTimezone}`.toLocaleLowerCase().includes(term));
  });
  const archivedCount = companies.filter((company) => company.status === "ARCHIVED").length;
  const close = () => { setMode(null); setSelectedCompanyId(null); };
  const clearFilters = () => { setSearch(""); setShowArchived(false); };
  const appliedFilters = [
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
    ...(showArchived ? [{ id: "archived", label: text.showArchived, onRemove: () => setShowArchived(false) }] : []),
  ];

  return <section className="administration-section administration-companies-section">
    <header className="administration-section-heading administration-companies-heading">
      <div><h3>{text.companies}</h3></div>
      <div className="administration-companies-toolbar">
        {owner && <button className="daily-sales-primary" type="button" onClick={() => setMode("create")}>+ {text.addCompany}</button>}
      </div>
    </header>
    <BaseerFilterBar controlsPresentation="menu" language={language} search={search} searchLabel={text.companies} searchPlaceholder={language === "ar" ? "ابحث باسم الشركة" : "Search company"} onSearchChange={setSearch} appliedFilters={appliedFilters} onClear={clearFilters} controls={archivedCount > 0 ? <BaseerFilterToggle label={text.showArchived} checked={showArchived} onChange={setShowArchived} /> : undefined} />
    <div className="administration-company-cards">
      {visibleCompanies.map((company, index) => <button className="baseer-card baseer-card--default baseer-card--compact baseer-card--interactive administration-company-card" key={company.id} type="button" onClick={() => { setSelectedCompanyId(company.id); setMode("manage"); }}>
        <span className="administration-company-card__mark" aria-hidden="true">{company.nameAr.trim().slice(0, 1)}</span>
        <span className="administration-company-card__body"><strong>{displayName(language, company)}</strong><small>{language === "ar" ? company.nameEn : company.nameAr}</small><span>{company.contextLocationLabelAr ?? company.businessTimezone}</span></span>
        <span className={company.status === "ACTIVE" ? "administration-company-card__status is-active" : "administration-company-card__status is-disabled"}>{company.status === "ACTIVE" ? text.active : text.archived}</span>
        <span className="administration-company-card__footer">{text.companyNumber(index + 1)}<b>{text.viewEdit} ←</b></span>
      </button>)}
    </div>
    {visibleCompanies.length === 0 && <div className="administration-company-empty">{text.noCompanies}</div>}
    {mode === "create" && <CompanyDialog language={language} session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
    {mode === "manage" && selectedCompany && <CompanyDialog company={selectedCompany} language={language} session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
  </section>;
}

function CompanyDialog({ language, session, company, owner, onDone, onError, onClose }: { language: "ar" | "en"; session: ActiveSession; company?: Company; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) {
  const text = administrationText(language);
  const isCreate = !company;
  const form = useBaseerForm<CompanyForm>({ defaultValues: { nameAr: company?.nameAr ?? "", nameEn: company?.nameEn ?? "", businessTimezone: company?.businessTimezone ?? "Asia/Riyadh", contextLocationCode: company?.contextLocationCode ?? "" }, schema: companySchema(language === "ar"), shouldFocusError: true });
  const values = form.watch();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFileMetadataId, setLogoFileMetadataId] = useState<string | null>(company?.logoFileMetadataId ?? null);
  const [vatRate, setVatRate] = useState("15");
  const [vatBusy, setVatBusy] = useState(false);

  useEffect(() => {
    if (!company?.logoFileMetadataId) return;
    let active = true;
    let receivedUrl: string | null = null;
    void loadAdministrationCompanyLogo(session, company.id).then((url) => {
      receivedUrl = url;
      if (active) setLogoUrl(url); else if (url) URL.revokeObjectURL(url);
    }).catch(() => undefined);
    return () => { active = false; if (receivedUrl) URL.revokeObjectURL(receivedUrl); };
  }, [company?.id, company?.logoFileMetadataId, session]);

  useEffect(() => {
    if (!company) return;
    let active = true;
    void api<{ profile: { vatRateBasisPoints: number } | null }>({ ...session, companyId: company.id }, "/finance/configuration")
      .then((receipt) => { if (active) setVatRate(String((receipt.profile?.vatRateBasisPoints ?? 1500) / 100)); })
      .catch(onError);
    return () => { active = false; };
  }, [company, onError, session]);

  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const selectedLocation = COMPANY_CONTEXT_LOCATIONS.find((location) => location.code === values.contextLocationCode) ?? null;
  const save = async (next: CompanyForm) => {
    if (!owner) return;
    setBusy(true);
    try {
      if (isCreate) await createAdministrationCompany(session, { nameAr: next.nameAr, nameEn: next.nameEn });
      else await updateAdministrationCompany(session, company.id, {
        nameAr: next.nameAr, nameEn: next.nameEn, businessTimezone: next.businessTimezone, logoFileMetadataId,
        contextLocationCode: selectedLocation?.code ?? null,
        contextLocationLabelAr: selectedLocation?.labelAr ?? null,
        contextLatitude: selectedLocation?.latitude ?? null,
        contextLongitude: selectedLocation?.longitude ?? null,
      });
      await onDone();
      onClose();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const changeStatus = async () => {
    if (!company || !owner) return;
    setBusy(true);
    try {
      await updateAdministrationCompanyStatus(session, company.id, company.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE", reason.trim() || undefined);
      await onDone();
      onClose();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !company || !owner) return;
    setBusy(true);
    try {
      const receipt = await uploadAdministrationCompanyLogo(session, company.id, file);
      setLogoFileMetadataId(receipt.id);
      await onDone();
      const nextUrl = URL.createObjectURL(file);
      setLogoUrl((prior) => { if (prior) URL.revokeObjectURL(prior); return nextUrl; });
    } catch (error) { onError(error); } finally { setBusy(false); event.target.value = ""; }
  };
  const saveVatRate = async () => {
    if (!company || !owner) return;
    const vatRateBasisPoints = Math.round(Number(vatRate) * 100);
    if (!Number.isFinite(vatRateBasisPoints) || vatRateBasisPoints < 0 || vatRateBasisPoints > 10_000) return;
    setVatBusy(true);
    try {
      await api({ ...session, companyId: company.id }, "/finance/configuration/vat-rate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vatRateBasisPoints, idempotencyKey: requestId() }) });
    } catch (error) { onError(error); } finally { setVatBusy(false); }
  };
  const title = isCreate ? text.addCompany : `${text.edit}: ${displayName(language, company)}`;

  return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !busy && !vatBusy && onClose()}>
    <section ref={dialogRef} className="daily-sales-dialog administration-company-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header className="daily-sales-dialog__header">
        <div><p className="eyebrow">{text.companyManagement}</p><h3>{title}</h3></div>
        <button className="dialog-icon-button" type="button" aria-label={text.close} disabled={busy || vatBusy} onClick={onClose}>×</button>
      </header>
      <form className="administration-dialog-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void save(next))}>
        {owner ? <footer className="administration-company-dialog__save"><button className="daily-sales-primary" disabled={busy || vatBusy}>{busy ? text.saving : isCreate ? text.createCompany : text.saveChanges}</button></footer> : <p className="daily-sales-message error">{text.ownerOnly}</p>}
        <div className="administration-company-editor-profile">
          {logoUrl ? <img alt={`${text.companyLogo}: ${values.nameAr || text.companies}`} src={logoUrl} /> : <span>{values.nameAr.trim().slice(0, 1) || "ش"}</span>}
          <div><strong>{values.nameAr || text.companies}</strong><small>{isCreate ? text.newCompany : company.status === "ACTIVE" ? text.activeCompany : text.archivedCompany}</small></div>
        </div>
        <label>{text.companyArabicName}<input disabled={!owner || busy} autoFocus aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
        <label>{text.companyEnglishName}<input disabled={!owner || busy} aria-invalid={Boolean(form.formState.errors.nameEn)} {...form.register("nameEn")} />{form.formState.errors.nameEn ? <small role="alert">{form.formState.errors.nameEn.message}</small> : null}</label>
        {!isCreate && owner && <label className="administration-company-logo-upload">{text.companyLogo}<input accept="image/png,image/jpeg,image/webp" disabled={busy || vatBusy} type="file" onChange={(event) => void selectLogo(event)} /><span>{text.companyLogoHint}</span></label>}
        {!isCreate && company && <fieldset className="administration-access-list administration-company-location">
          <legend>{language === "ar" ? "موقع الشركة وسياقها" : "Company location and context"}</legend>
          <label className="administration-company-location__picker">{language === "ar" ? "المدينة" : "City"}<select disabled={!owner || busy} {...form.register("contextLocationCode")}><option value="">{language === "ar" ? "اختر المدينة" : "Select a city"}</option>{COMPANY_CONTEXT_LOCATIONS.map((location) => <option key={location.code} value={location.code}>{language === "ar" ? location.labelAr : location.labelEn}</option>)}</select></label>
          <small>{language === "ar" ? "يحفظ النظام رمز المدينة وإحداثياتها المعتمدة تلقائياً لربط الطقس والمباريات المحلية بهذه الشركة فقط." : "Baseer saves the approved city code and coordinates automatically to connect local weather and fixtures to this company only."}</small>
        </fieldset>}
        {!isCreate && company && <fieldset className="administration-access-list administration-company-tax">
          <legend>{language === "ar" ? "الإعدادات الضريبية" : "Tax settings"}</legend>
          <label>{language === "ar" ? "نسبة ضريبة القيمة المضافة" : "VAT rate"}<input aria-describedby="company-vat-rate-note" disabled={!owner || vatBusy} inputMode="decimal" min="0" max="100" step="0.01" type="number" value={vatRate} onChange={(event) => setVatRate(event.target.value)} /></label>
          <small id="company-vat-rate-note">{language === "ar" ? "تطبّق على الفواتير الجديدة فقط؛ الفواتير السابقة لا تتغير." : "Applies to future invoices only; posted invoices never change."}</small>
          {owner && <footer><button className="daily-sales-secondary" disabled={vatBusy} type="button" onClick={() => void saveVatRate()}>{vatBusy ? text.saving : language === "ar" ? "حفظ النسبة" : "Save rate"}</button></footer>}
        </fieldset>}
        {!isCreate && owner && <fieldset className="administration-company-status-action">
          <legend>{company.status === "ACTIVE" ? text.archiveCompany : text.reactivateCompany}</legend>
          <label>{text.changeReason} ({text.optional})<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={text.shortReason} /></label>
          <button className={company.status === "ACTIVE" ? "daily-sales-danger" : "daily-sales-secondary"} disabled={busy || vatBusy} type="button" onClick={() => void changeStatus()}>{company.status === "ACTIVE" ? "أرشفة الشركة" : "إعادة التفعيل"}</button>
        </fieldset>}
      </form>
    </section>
  </div>;
}

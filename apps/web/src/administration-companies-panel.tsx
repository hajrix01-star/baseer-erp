import { useState, type FormEvent } from "react";

import {
  createAdministrationCompany,
  updateAdministrationCompany,
  updateAdministrationCompanyStatus,
} from "./administration-client";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

type Company = AdministrationOverview["companies"][number];
type DialogMode = "create" | "manage" | null;
type Props = {
  session: ActiveSession;
  companies: AdministrationOverview["companies"];
  owner: boolean;
  onDone: () => Promise<void>;
  onError: (error: unknown) => void;
};

export function AdministrationCompaniesPanel({ session, companies, owner, onDone, onError }: Props) {
  const [mode, setMode] = useState<DialogMode>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null;
  const visibleCompanies = companies.filter((company) => showArchived || company.status === "ACTIVE");
  const archivedCount = companies.filter((company) => company.status === "ARCHIVED").length;
  const close = () => { setMode(null); setSelectedCompanyId(null); };

  return (
    <section className="administration-section administration-companies-section">
      <header className="administration-section-heading administration-companies-heading">
        <div>
          <h3>الشركات</h3>
          <p>اختر بطاقة الشركة لعرض بياناتها وتعديلها. الأرشفة توقف استخدامها دون حذف تاريخها.</p>
        </div>
        <div className="administration-companies-toolbar">
          {archivedCount > 0 && (
            <label className="administration-archive-toggle">
              <input checked={showArchived} type="checkbox" onChange={(event) => setShowArchived(event.target.checked)} />
              عرض المؤرشفة <span>{archivedCount}</span>
            </label>
          )}
          {owner && <button className="daily-sales-primary" type="button" onClick={() => setMode("create")}>+ إضافة شركة</button>}
        </div>
      </header>
      <div className="administration-company-cards">
        {visibleCompanies.map((company, index) => (
          <button
            className="baseer-card baseer-card--default baseer-card--compact baseer-card--interactive administration-company-card"
            key={company.id}
            type="button"
            onClick={() => { setSelectedCompanyId(company.id); setMode("manage"); }}
          >
            <span className="administration-company-card__mark" aria-hidden="true">{company.nameAr.trim().slice(0, 1)}</span>
            <span className="administration-company-card__body">
              <strong>{company.nameAr}</strong>
              <small>{company.nameEn}</small>
              <span>{company.businessTimezone}</span>
            </span>
            <span className={company.status === "ACTIVE" ? "administration-company-card__status is-active" : "administration-company-card__status is-disabled"}>
              {company.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}
            </span>
            <span className="administration-company-card__footer">شركة #{index + 1}<b>عرض وتعديل ←</b></span>
          </button>
        ))}
      </div>
      {visibleCompanies.length === 0 && <div className="administration-company-empty">لا توجد شركات ضمن هذا العرض.</div>}
      {mode === "create" && <CompanyDialog session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
      {mode === "manage" && selectedCompany && <CompanyDialog company={selectedCompany} session={session} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
    </section>
  );
}

function CompanyDialog({ session, company, owner, onDone, onError, onClose }: {
  session: ActiveSession;
  company?: Company;
  owner: boolean;
  onDone: () => Promise<void>;
  onError: (error: unknown) => void;
  onClose: () => void;
}) {
  const isCreate = !company;
  const [nameAr, setNameAr] = useState(company?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(company?.nameEn ?? "");
  const [businessTimezone, setBusinessTimezone] = useState(company?.businessTimezone ?? "Asia/Riyadh");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner) return;
    setBusy(true);
    try {
      if (isCreate) await createAdministrationCompany(session, { nameAr, nameEn });
      else await updateAdministrationCompany(session, company.id, { nameAr, nameEn, businessTimezone, logoFileMetadataId: company.logoFileMetadataId });
      await onDone();
      onClose();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const changeStatus = async () => {
    if (!company || !owner || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await updateAdministrationCompanyStatus(session, company.id, company.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE", reason);
      await onDone();
      onClose();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const title = isCreate ? "إضافة شركة" : `تعديل الشركة — ${company.nameAr}`;
  return (
    <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
      <section ref={dialogRef} className="daily-sales-dialog administration-company-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="daily-sales-dialog__header">
          <div><p className="eyebrow">إدارة الشركات</p><h3>{title}</h3><p>{isCreate ? "أدخل اسم الشركة بالعربية والإنجليزية لإنشائها." : "تُسجّل كل التعديلات في سجل المراجعة."}</p></div>
          <button className="dialog-icon-button" type="button" aria-label="إغلاق" disabled={busy} onClick={onClose}>×</button>
        </header>
        <form className="administration-dialog-form" onSubmit={(event) => void save(event)}>
          <div className="administration-company-editor-profile">
            <span>{nameAr.trim().slice(0, 1) || "ش"}</span>
            <div><strong>{nameAr || "اسم الشركة"}</strong><small>{isCreate ? "شركة جديدة" : company.status === "ACTIVE" ? "شركة نشطة" : "شركة مؤرشفة"}</small></div>
          </div>
          <label>اسم الشركة بالعربية<input required value={nameAr} onChange={(event) => setNameAr(event.target.value)} autoFocus /></label>
          <label>Company name in English<input required value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label>
          <label>المنطقة الزمنية<select value={businessTimezone} onChange={(event) => setBusinessTimezone(event.target.value)}><option value="Asia/Riyadh">Asia/Riyadh</option></select></label>
          {!isCreate && <label className="administration-company-logo-note">الشعار<span>{company.logoFileMetadataId ? "شعار محفوظ" : "سيُتاح رفع الشعار بعد تشغيل خدمة الملفات الآمنة."}</span></label>}
          {!isCreate && owner && <fieldset className="administration-company-status-action"><legend>{company.status === "ACTIVE" ? "أرشفة الشركة" : "إعادة تفعيل الشركة"}</legend><label>سبب التغيير<input minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سبباً مختصراً" /></label><button className={company.status === "ACTIVE" ? "daily-sales-danger" : "daily-sales-secondary"} disabled={busy || reason.trim().length < 3} type="button" onClick={() => void changeStatus()}>{company.status === "ACTIVE" ? "أرشفة الشركة" : "إعادة التفعيل"}</button></fieldset>}
          <footer><button className="daily-sales-secondary" disabled={busy} type="button" onClick={onClose}>إلغاء</button>{owner && <button className="daily-sales-primary" disabled={busy}>{busy ? "جارٍ الحفظ…" : isCreate ? "إنشاء الشركة" : "حفظ التعديلات"}</button>}</footer>
        </form>
      </section>
    </div>
  );
}
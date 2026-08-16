import { useState, type FormEvent } from "react";

import { createAdministrationCompany } from "./administration-client";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";

type Props = { session: ActiveSession; companies: AdministrationOverview["companies"]; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void };

export function AdministrationCompaniesPanel({ session, companies, owner, onDone, onError }: Props) {
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner) return;
    setBusy(true);
    try {
      await createAdministrationCompany(session, { nameAr, nameEn });
      setNameAr("");
      setNameEn("");
      await onDone();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  return <div className="administration-section">
    <h3>الشركات</h3>
    <div className="administration-list">{companies.map((company) => <article key={company.id}><strong>{company.nameAr}</strong><span>{company.nameEn}</span><small>{company.businessTimezone} · {company.status}</small></article>)}</div>
    {owner && <form className="administration-form" onSubmit={(event) => void submit(event)}>
      <h4>إضافة شركة</h4>
      <label>اسم الشركة بالعربية<input required value={nameAr} onChange={(event) => setNameAr(event.target.value)} /></label>
      <label>Company name in English<input required value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label>
      <button className="daily-sales-primary" disabled={busy}>{busy ? "جارٍ الحفظ…" : "إنشاء الشركة"}</button>
    </form>}
  </div>;
}
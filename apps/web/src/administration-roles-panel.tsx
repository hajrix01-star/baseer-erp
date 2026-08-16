import { useState, type FormEvent } from "react";

import { createAdministrationRole } from "./administration-client";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";

type Props = { session: ActiveSession; overview: AdministrationOverview; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void };

export function AdministrationRolesPanel({ session, overview, owner, onDone, onError }: Props) {
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner) return;
    try {
      await createAdministrationRole(session, { code, nameAr, nameEn, permissionCodes: selected });
      setNameAr(""); setNameEn(""); setCode(""); setSelected([]);
      await onDone();
    } catch (error) { onError(error); }
  };
  return <div className="administration-section">
    <h3>الأدوار والصلاحيات</h3>
    <div className="administration-list">{overview.roles.map((role) => <article key={role.id}><strong>{role.nameAr}{role.isSystem ? " · قالب نظام" : ""}</strong><span>{role.permissionCodes.length} صلاحية</span><small>{role.permissionCodes.join("، ")}</small></article>)}</div>
    {owner && <form className="administration-form" onSubmit={(event) => void submit(event)}>
      <h4>دور مخصص</h4>
      <label>رمز الدور<input required pattern="[A-Z][A-Z0-9_]*" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>
      <label>الاسم بالعربية<input required value={nameAr} onChange={(event) => setNameAr(event.target.value)} /></label>
      <label>الاسم بالإنجليزية<input required value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label>
      <fieldset><legend>الصلاحيات</legend>{overview.permissions.map((permission) => <label key={permission.code} className={permission.risk === "sensitive" ? "is-sensitive" : ""}><input type="checkbox" checked={selected.includes(permission.code)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))} />{permission.nameAr}</label>)}</fieldset>
      <button className="daily-sales-primary" disabled={!selected.length}>حفظ الدور</button>
    </form>}
  </div>;
}
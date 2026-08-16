import { useState, type FormEvent } from "react";

import {
  createAdministrationUser,
  resetAdministrationUserPassword,
  updateAdministrationUserStatus,
  withdrawAdministrationMembership,
} from "./administration-client";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";

type Props = {
  session: ActiveSession;
  overview: AdministrationOverview;
  owner: boolean;
  onDone: () => Promise<void>;
  onError: (error: unknown) => void;
};

export function AdministrationUsersPanel({ session, overview, owner, onDone, onError }: Props) {
  const [login, setLogin] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [password, setPassword] = useState("");
  const [companyId, setCompanyId] = useState(overview.companies[0]?.id ?? "");
  const [roleId, setRoleId] = useState(overview.roles[0]?.id ?? "");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [replacementPassword, setReplacementPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedUser = overview.users.find((user) => user.id === selectedUserId) ?? null;

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner) return;
    setBusy(true);
    try {
      await createAdministrationUser(session, { login, nameAr, nameEn, password, companyId, roleId });
      setLogin(""); setNameAr(""); setNameEn(""); setPassword("");
      await onDone();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };

  const runSensitiveAction = async (action: () => Promise<unknown>) => {
    if (!selectedUser || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await action();
      setReason("");
      setReplacementPassword("");
      await onDone();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };

  return <div className="administration-section">
    <h3>المستخدمون</h3>
    <p>تعطيل المستخدم أو سحب وصوله ينهي جلساته النشطة فورًا. لا يسمح النظام بتعطيل آخر مالك نشط.</p>
    <div className="administration-list">
      {overview.users.map((user) => <article key={user.id}>
        <strong>{user.nameAr} · {user.status === "ACTIVE" ? "نشط" : "معطّل"}</strong>
        <span>{user.login}</span>
        <small>{user.memberships.map((membership) => `${membership.companyNameAr}: ${membership.roleNameAr}`).join(" · ") || "غير مرتبط بشركة"}</small>
        {owner && <button className="daily-sales-secondary" type="button" onClick={() => { setSelectedUserId(user.id); setReason(""); setReplacementPassword(""); }}>إدارة الوصول</button>}
      </article>)}
    </div>

    {owner && selectedUser && <section className="administration-form">
      <h4>إدارة: {selectedUser.nameAr}</h4>
      <label>سبب التغيير<input minLength={3} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: انتهاء عقد العمل" /></label>
      <div className="daily-sales-actions">
        <button className="daily-sales-secondary" disabled={busy || reason.trim().length < 3} type="button" onClick={() => void runSensitiveAction(() => updateAdministrationUserStatus(session, selectedUser.id, selectedUser.status === "ACTIVE" ? "DISABLED" : "ACTIVE", reason))}>{selectedUser.status === "ACTIVE" ? "تعطيل المستخدم" : "تفعيل المستخدم"}</button>
      </div>
      {selectedUser.status === "ACTIVE" && <>
        <label>كلمة مرور جديدة<input type="password" minLength={12} value={replacementPassword} onChange={(event) => setReplacementPassword(event.target.value)} placeholder="12 حرفًا على الأقل" /></label>
        <button className="daily-sales-secondary" disabled={busy || reason.trim().length < 3 || replacementPassword.length < 12} type="button" onClick={() => void runSensitiveAction(() => resetAdministrationUserPassword(session, selectedUser.id, replacementPassword, reason))}>إعادة ضبط كلمة المرور وإنهاء الجلسات</button>
      </>}
      {selectedUser.memberships.length > 0 && <fieldset>
        <legend>وصول الشركات</legend>
        {selectedUser.memberships.map((membership) => <div className="administration-membership" key={membership.companyId}><span>{membership.companyNameAr} · {membership.roleNameAr}</span><button className="daily-sales-danger" disabled={busy || reason.trim().length < 3} type="button" onClick={() => void runSensitiveAction(() => withdrawAdministrationMembership(session, selectedUser.id, membership.companyId, reason))}>سحب الوصول</button></div>)}
      </fieldset>}
    </section>}

    {owner && <form className="administration-form" onSubmit={(event) => void createUser(event)}>
      <h4>إضافة مستخدم</h4>
      <label>اسم المستخدم أو البريد<input type="text" required value={login} onChange={(event) => setLogin(event.target.value)} placeholder="ahmed أو ahmed@example.com" autoComplete="username" /></label>
      <label>الاسم بالعربية<input required value={nameAr} onChange={(event) => setNameAr(event.target.value)} /></label>
      <label>الاسم بالإنجليزية<input required value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label>
      <label>كلمة مرور أولية<input type="password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>الشركة<select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{overview.companies.map((company) => <option key={company.id} value={company.id}>{company.nameAr}</option>)}</select></label>
      <label>الدور<select value={roleId} onChange={(event) => setRoleId(event.target.value)}>{overview.roles.map((role) => <option key={role.id} value={role.id}>{role.nameAr}</option>)}</select></label>
      <button className="daily-sales-primary" disabled={busy}>إضافة المستخدم</button>
    </form>}
  </div>;
}
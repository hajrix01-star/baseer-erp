import { useState, type FormEvent, type ReactNode, type RefObject } from "react";

import { createAdministrationUser, replaceAdministrationUserAccess, resetAdministrationUserPassword, updateAdministrationUserDisplayName, updateAdministrationUserLogin, updateAdministrationUserStatus } from "./administration-client";
import { AdministrationUserAvatar, type UserAvatarKind } from "./administration-user-avatar";
import { DataTable } from "./data-table";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

type Props = { session: ActiveSession; overview: AdministrationOverview; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void };
type User = AdministrationOverview["users"][number];
type DialogMode = "create" | "manage" | null;
type LoginParts = { local: string; domain: string };
const activeCompanies = (overview: AdministrationOverview) => overview.companies.filter((company) => company.status === "ACTIVE");
const sameIds = (left: readonly string[], right: readonly string[]) => [...left].sort().join("|") === [...right].sort().join("|");
const splitLogin = (login: string): LoginParts => { const at = login.lastIndexOf("@"); return at > 0 ? { local: login.slice(0, at), domain: login.slice(at + 1) } : { local: login, domain: "hajrix.com" }; };
const composeLogin = (local: string, domain: string) => `${local.trim()}@${domain.trim().replace(/^@/, "")}`;
const administrationAuditReason = "تحديث بيانات المستخدم من الإدارة";

export function AdministrationUsersPanel({ session, overview, owner, onDone, onError }: Props) {
  const [mode, setMode] = useState<DialogMode>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUser = overview.users.find((user) => user.id === selectedUserId) ?? null;
  const close = () => { setMode(null); setSelectedUserId(null); };
  const openUser = (user: User) => { setSelectedUserId(user.id); setMode("manage"); };

  return <section className="administration-section administration-users-section">
    <header className="administration-section-heading"><div><h3>المستخدمون</h3><p>الاسم الظاهر هو الذي يُعرض في الجداول والتقارير؛ واسم الدخول مستقل وقابل للتغيير.</p></div>{owner && <button className="daily-sales-primary" type="button" onClick={() => setMode("create")}>+ إضافة موظف</button>}</header>
    <DataTable ariaLabel="جدول المستخدمين" caption="المستخدمون" rowKey={(row) => row.key} columns={[{ id: "user", header: "الاسم الظاهر", cell: (row) => row.cells.user }, { id: "login", header: "اسم الدخول", cell: (row) => row.cells.login }, { id: "access", header: "الوصول والصلاحية", cell: (row) => row.cells.access }, { id: "language", header: "الواجهة", cell: (row) => row.cells.language }, { id: "status", header: "الحالة", cell: (row) => row.cells.status }]} rows={overview.users.map((user) => ({ key: user.id, cells: { user: <button className="administration-table-user" type="button" onClick={() => openUser(user)}><AdministrationUserAvatar name={user.nameAr} kind={user.avatarKind} /><span><strong>{user.nameAr}</strong><small>{user.nameEn}</small></span></button>, login: user.login, access: user.memberships.length ? <span className="administration-table-access">{user.memberships.map((membership) => <span key={membership.companyId}><strong>{membership.companyNameAr}</strong><small>{membership.roleNameAr}</small></span>)}</span> : "غير مرتبط بشركة", language: user.preferredLanguage === "ar" ? "العربية" : "English", status: <span className={user.status === "ACTIVE" ? "administration-status-pill is-active" : "administration-status-pill is-disabled"}>{user.status === "ACTIVE" ? "نشط" : "مُعطّل"}</span> } }))} />
    {mode === "create" && <CreateUserDialog session={session} overview={overview} onDone={onDone} onError={onError} onClose={close} />}
    {mode === "manage" && selectedUser && <ManageUserDialog session={session} user={selectedUser} overview={overview} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
  </section>;
}

function CompanyCheckboxes({ overview, value, onChange, disabled }: { overview: AdministrationOverview; value: string[]; onChange: (value: string[]) => void; disabled: boolean }) {
  const toggle = (companyId: string) => onChange(value.includes(companyId) ? value.filter((id) => id !== companyId) : [...value, companyId]);
  return <fieldset className="administration-access-list administration-company-checkboxes"><legend>الشركات</legend>{activeCompanies(overview).map((company) => <label key={company.id}><input type="checkbox" checked={value.includes(company.id)} disabled={disabled} onChange={() => toggle(company.id)} /><span>{company.nameAr}</span></label>)}</fieldset>;
}

function LoginFields({ local, domain, onLocal, onDomain, disabled = false }: { local: string; domain: string; onLocal: (value: string) => void; onDomain: (value: string) => void; disabled?: boolean }) {
  return <><label>اسم الدخول<input required disabled={disabled} value={local} onChange={(event) => onLocal(event.target.value)} placeholder="ahmed" autoComplete="username" /></label><label>النطاق<span className="administration-login-domain"><b>@</b><input required disabled={disabled} value={domain} onChange={(event) => onDomain(event.target.value.replace(/^@/, ""))} placeholder="hajrix.com" inputMode="email" /></span></label></>;
}

function PasswordField({ label, value, onChange, autoComplete, required = false }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; required?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="baseer-password-field"><input type={visible ? "text" : "password"} required={required} minLength={6} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} /><button className="daily-sales-secondary" type="button" aria-pressed={visible} onClick={() => setVisible((current) => !current)}>{visible ? "إخفاء" : "إظهار"}</button></span></label>;
}

function CreateUserDialog({ session, overview, onDone, onError, onClose }: Pick<Props, "session" | "overview" | "onDone" | "onError"> & { onClose: () => void }) {
  const companies = activeCompanies(overview);
  const [loginLocal, setLoginLocal] = useState(""); const [loginDomain, setLoginDomain] = useState("hajrix.com"); const [nameAr, setNameAr] = useState(""); const [nameEn, setNameEn] = useState(""); const [password, setPassword] = useState(""); const [preferredLanguage, setPreferredLanguage] = useState<"ar" | "en">("ar"); const [companyIds, setCompanyIds] = useState<string[]>(companies[0] ? [companies[0].id] : []); const [roleId, setRoleId] = useState(overview.roles[0]?.id ?? ""); const [avatarKind, setAvatarKind] = useState<UserAvatarKind>("INITIALS"); const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await createAdministrationUser(session, { login: composeLogin(loginLocal, loginDomain), nameAr, nameEn, password, preferredLanguage, companyIds, roleId, avatarKind }); await onDone(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); } };
  return <Dialog title="إضافة موظف" busy={busy} dialogRef={dialogRef} onClose={onClose}><form className="administration-dialog-form" onSubmit={(event) => void save(event)}><AvatarPicker value={avatarKind} onChange={setAvatarKind} previewName={nameAr || "الموظف"} /><LoginFields local={loginLocal} domain={loginDomain} onLocal={setLoginLocal} onDomain={setLoginDomain} disabled={busy} /><label>الاسم الظاهر بالعربية<input required value={nameAr} onChange={(event) => setNameAr(event.target.value)} /></label><label>الاسم الظاهر بالإنجليزية<input required value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label><label>لغة الواجهة المفضلة<select value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value as "ar" | "en")}><option value="ar">العربية</option><option value="en">English</option></select></label><PasswordField label="كلمة المرور" value={password} onChange={setPassword} autoComplete="new-password" required /><label>الدور<select value={roleId} onChange={(event) => setRoleId(event.target.value)}>{overview.roles.map((role) => <option key={role.id} value={role.id}>{role.nameAr}</option>)}</select></label><CompanyCheckboxes overview={overview} value={companyIds} onChange={setCompanyIds} disabled={busy} /><footer><button className="daily-sales-primary" disabled={busy || !companyIds.length}>{busy ? "جارٍ الحفظ…" : "حفظ الموظف"}</button></footer></form></Dialog>;
}

function ManageUserDialog({ session, user, overview, owner, onDone, onError, onClose }: { session: ActiveSession; user: User; overview: AdministrationOverview; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) {
  const initialLogin = splitLogin(user.login);
  const [loginLocal, setLoginLocal] = useState(initialLogin.local); const [loginDomain, setLoginDomain] = useState(initialLogin.domain); const [nameAr, setNameAr] = useState(user.nameAr); const [nameEn, setNameEn] = useState(user.nameEn); const [replacementPassword, setReplacementPassword] = useState(""); const [companyIds, setCompanyIds] = useState<string[]>(user.memberships.map((membership) => membership.companyId)); const [roleId, setRoleId] = useState(user.memberships[0]?.roleId ?? overview.roles[0]?.id ?? ""); const [busy, setBusy] = useState(false);
  const login = composeLogin(loginLocal, loginDomain);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const hasNameChange = nameAr.trim() !== user.nameAr || nameEn.trim() !== user.nameEn;
  const hasLoginChange = login !== user.login;
  const hasAccessChange = roleId !== (user.memberships[0]?.roleId ?? "") || !sameIds(companyIds, user.memberships.map((membership) => membership.companyId));
  const hasPasswordChange = replacementPassword.length > 0;
  const canSave = owner && companyIds.length > 0 && (hasNameChange || hasLoginChange || hasAccessChange || hasPasswordChange) && (!hasPasswordChange || replacementPassword.length >= 6);
  const run = async (action: () => Promise<unknown>) => { if (!owner) return; setBusy(true); try { await action(); setReplacementPassword(""); await onDone(); } catch (error) { onError(error); } finally { setBusy(false); } };
  const saveAll = () => run(async () => { if (hasNameChange) await updateAdministrationUserDisplayName(session, user.id, { nameAr, nameEn, reason: administrationAuditReason }); if (hasLoginChange) await updateAdministrationUserLogin(session, user.id, { login, reason: administrationAuditReason }); if (hasAccessChange) await replaceAdministrationUserAccess(session, user.id, { roleId, companyIds, reason: administrationAuditReason }); if (hasPasswordChange) await resetAdministrationUserPassword(session, user.id, replacementPassword, administrationAuditReason); });
  return <Dialog title={user.nameAr} busy={busy} dialogRef={dialogRef} onClose={onClose}><div className="administration-dialog-form"><LoginFields local={loginLocal} domain={loginDomain} onLocal={setLoginLocal} onDomain={setLoginDomain} disabled={!owner || busy} /><label>الاسم الظاهر بالعربية<input value={nameAr} disabled={!owner || busy} onChange={(event) => setNameAr(event.target.value)} /></label><label>الاسم الظاهر بالإنجليزية<input value={nameEn} disabled={!owner || busy} onChange={(event) => setNameEn(event.target.value)} /></label><label>الدور<select value={roleId} disabled={!owner || busy} onChange={(event) => setRoleId(event.target.value)}>{overview.roles.map((role) => <option key={role.id} value={role.id}>{role.nameAr} · {role.permissionCodes.length} صلاحية</option>)}</select></label><CompanyCheckboxes overview={overview} value={companyIds} onChange={setCompanyIds} disabled={!owner || busy} />{owner && <section className="administration-sensitive-actions"><PasswordField label="كلمة مرور جديدة" value={replacementPassword} onChange={setReplacementPassword} autoComplete="new-password" /><button className="daily-sales-secondary" disabled={busy} type="button" onClick={() => void run(() => updateAdministrationUserStatus(session, user.id, user.status === "ACTIVE" ? "DISABLED" : "ACTIVE", administrationAuditReason))}>{user.status === "ACTIVE" ? "تعطيل المستخدم" : "تفعيل المستخدم"}</button></section>}<footer>{owner && <button className="daily-sales-primary" disabled={busy || !canSave} type="button" onClick={() => void saveAll()}>{busy ? "جارٍ الحفظ…" : "حفظ التغييرات"}</button>}</footer></div></Dialog>;
}

function AvatarPicker({ value, onChange, previewName }: { value: UserAvatarKind; onChange: (value: UserAvatarKind) => void; previewName: string }) { return <fieldset className="administration-avatar-picker"><legend>الصورة الرمزية</legend><div>{(["INITIALS", "MALE", "FEMALE"] as const).map((kind) => <button className={value === kind ? "is-selected" : ""} key={kind} type="button" onClick={() => onChange(kind)}><AdministrationUserAvatar name={previewName} kind={kind} large /><span>{kind === "INITIALS" ? "حرف الاسم" : kind === "MALE" ? "رجل" : "امرأة"}</span></button>)}</div></fieldset>; }
function Dialog({ title, busy, dialogRef, onClose, children }: { title: string; busy: boolean; dialogRef: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode }) { const close = () => { if (!busy) onClose(); }; return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={close}><section ref={dialogRef} className="daily-sales-dialog administration-user-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header className="daily-sales-dialog__header"><div><p className="eyebrow">إدارة المستخدمين</p><h3>{title}</h3></div><button className="dialog-icon-button" type="button" aria-label="إغلاق" onClick={close} disabled={busy}>×</button></header>{children}</section></div>; }
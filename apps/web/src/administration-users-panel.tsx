import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState, type ReactNode, type RefObject } from "react";
import { z } from "zod";

import { createAdministrationUser, replaceAdministrationUserAccess, resetAdministrationUserPassword, updateAdministrationUserDisplayName, updateAdministrationUserLogin, updateAdministrationUserStatus } from "./administration-client";
import { AdministrationUserAvatar, type UserAvatarKind } from "./administration-user-avatar";
import { DataTable } from "./data-table";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { displayName } from "./baseer-localization";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { administrationText } from "./administration-copy";

type Props = { language: "ar" | "en"; session: ActiveSession; overview: AdministrationOverview; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void };
type User = AdministrationOverview["users"][number];
type DialogMode = "create" | "manage" | null;
type LoginParts = { local: string; domain: string };
const activeCompanies = (overview: AdministrationOverview) => overview.companies.filter((company) => company.status === "ACTIVE");
const uniqueRoleNames = (user: User, language: "ar" | "en") => [...new Set(user.memberships.map((membership) => language === "ar" ? membership.roleNameAr : membership.roleNameEn))];
const sameIds = (left: readonly string[], right: readonly string[]) => [...left].sort().join("|") === [...right].sort().join("|");
const splitLogin = (login: string): LoginParts => { const at = login.lastIndexOf("@"); return at > 0 ? { local: login.slice(0, at), domain: login.slice(at + 1) } : { local: login, domain: "hajrix.com" }; };
const composeLogin = (local: string, domain: string) => `${local.trim()}@${domain.trim().replace(/^@/, "")}`;
const administrationAuditReason = "تحديث بيانات المستخدم من الإدارة";
type CreateUserForm = { loginLocal: string; loginDomain: string; nameAr: string; nameEn: string; password: string; preferredLanguage: "ar" | "en"; companyIds: string[]; roleId: string; avatarKind: UserAvatarKind };
const createUserSchema = (ar: boolean) => z.object({
  loginLocal: z.string().trim().min(1, ar ? "أدخل اسم الدخول." : "Enter a login name."),
  loginDomain: z.string().trim().min(1, ar ? "أدخل نطاق الدخول." : "Enter a login domain."),
  nameAr: z.string().trim().min(1, ar ? "أدخل الاسم بالعربية." : "Enter the Arabic name."),
  nameEn: z.string().trim().min(1, ar ? "أدخل الاسم بالإنجليزية." : "Enter the English name."),
  password: z.string().min(6, ar ? "كلمة المرور ستة أحرف على الأقل." : "Password must have at least six characters."),
  preferredLanguage: z.enum(["ar", "en"]),
  companyIds: z.array(z.string()).min(1, ar ? "اختر شركة واحدة على الأقل." : "Choose at least one company."),
  roleId: z.string().min(1, ar ? "اختر دوراً." : "Choose a role."),
  avatarKind: z.enum(["INITIALS", "MALE", "FEMALE"]),
});

export function AdministrationUsersPanel({ language, session, overview, owner, onDone, onError }: Props) {
  const text = administrationText(language);
  const [mode, setMode] = useState<DialogMode>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const selectedUser = overview.users.find((user) => user.id === selectedUserId) ?? null;
  const activeUsers = overview.users.filter((user) => user.status === "ACTIVE");
  const disabledUsers = overview.users.filter((user) => user.status === "DISABLED");
  const ownerCount = overview.users.filter((user) => user.isOwner).length;
  const term = search.trim().toLocaleLowerCase();
  const visibleUsers = overview.users.filter((user) =>
    (showDisabled || user.status === "ACTIVE") &&
    (!term || `${user.login} ${user.nameAr} ${user.nameEn}`.toLocaleLowerCase().includes(term)),
  );
  const close = () => { setMode(null); setSelectedUserId(null); };
  const openUser = (user: User) => { setSelectedUserId(user.id); setMode("manage"); };
  const appliedFilters = [
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
    ...(!showDisabled && disabledUsers.length ? [{ id: "disabled", label: text.hiddenDisabledUsers(disabledUsers.length), onRemove: () => setShowDisabled(true) }] : []),
  ];

  return <section className="administration-section administration-users-section">
    <header className="administration-section-heading">
      <div><h3>{text.usersManagement}</h3><p>{text.usersDescription}</p></div>
      {owner && <button className="daily-sales-primary" type="button" onClick={() => setMode("create")}>+ {text.addEmployee}</button>}
    </header>
    <div className="administration-users-summary" aria-label={text.users}>
      <span><b>{activeUsers.length}</b><small>{text.activeUserCount}</small></span>
      <span><b>{disabledUsers.length}</b><small>{text.disabledUserCount}</small></span>
      <span><b>{ownerCount}</b><small>{text.systemOwnerCount}</small></span>
    </div>
    <BaseerFilterBar
      language={language}
      search={search}
      searchLabel={text.users}
      searchPlaceholder={language === "ar" ? "ابحث بالاسم أو اسم الدخول" : "Search user or login"}
      onSearchChange={setSearch}
      controls={<button className="daily-sales-secondary administration-users__disabled-toggle" type="button" aria-pressed={showDisabled} onClick={() => setShowDisabled((current) => !current)}>{showDisabled ? text.hideDisabledUsers : text.showDisabledUsers} ({disabledUsers.length})</button>}
      appliedFilters={appliedFilters}
      onClear={() => { setSearch(""); setShowDisabled(true); }}
    />
    <DataTable
      ariaLabel={text.usersTable}
      caption={text.users}
      rowKey={(user) => user.id}
      columns={[
        { id: "user", header: text.displayName, sort: (user) => displayName(language, user), cell: (user) => <button className="administration-table-user" type="button" onClick={() => openUser(user)}><AdministrationUserAvatar name={user.nameAr} kind={user.avatarKind} language={language} /><span><strong>{displayName(language, user)}</strong><small>{language === "ar" ? user.nameEn : user.nameAr}</small></span></button> },
        { id: "login", header: text.loginName, sort: (user) => user.login, cell: (user) => user.login },
        { id: "companies", header: text.companies, sort: (user) => user.memberships.map((membership) => membership.companyNameAr).join(" "), cell: (user) => user.memberships.length ? <div className="administration-table-access">{user.memberships.map((membership) => <span key={membership.companyId}><strong>{language === "ar" ? membership.companyNameAr : membership.companyNameEn}</strong></span>)}</div> : <span>{text.noCompany}</span> },
        { id: "access", header: text.roles, sort: (user) => uniqueRoleNames(user, language).join(" "), cell: (user) => <div className="administration-table-access">{user.isOwner && <strong className="administration-owner-badge">{text.systemOwner}</strong>}{uniqueRoleNames(user, language).map((role) => <span key={role}><strong>{role}</strong></span>)}</div> },
        { id: "language", header: text.interface, sort: (user) => user.preferredLanguage, cell: (user) => user.preferredLanguage === "ar" ? text.arabic : text.english },
        { id: "status", header: text.status, sort: (user) => user.status, cell: (user) => <span className={user.status === "ACTIVE" ? "administration-status-pill is-active" : "administration-status-pill is-disabled"}>{user.status === "ACTIVE" ? text.active : text.disabled}</span> },
      ]}
      rows={visibleUsers}
    />
    {mode === "create" && <CreateUserDialog language={language} session={session} overview={overview} onDone={onDone} onError={onError} onClose={close} />}
    {mode === "manage" && selectedUser && <ManageUserDialog language={language} session={session} user={selectedUser} overview={overview} owner={owner} onDone={onDone} onError={onError} onClose={close} />}
  </section>;
}

function CompanyCheckboxes({ language, overview, value, onChange, disabled }: { language: "ar" | "en"; overview: AdministrationOverview; value: string[]; onChange: (value: string[]) => void; disabled: boolean }) { const text = administrationText(language);
  const toggle = (companyId: string) => onChange(value.includes(companyId) ? value.filter((id) => id !== companyId) : [...value, companyId]);
  return <fieldset className="administration-access-list administration-company-checkboxes"><legend>{text.companiesLegend}</legend>{activeCompanies(overview).map((company) => <label key={company.id}><input type="checkbox" checked={value.includes(company.id)} disabled={disabled} onChange={() => toggle(company.id)} /><span>{displayName(language, company)}</span></label>)}</fieldset>;
}

function LoginFields({ language, local, domain, onLocal, onDomain, disabled = false }: { language: "ar" | "en"; local: string; domain: string; onLocal: (value: string) => void; onDomain: (value: string) => void; disabled?: boolean }) { const text = administrationText(language);
  return <><label>{text.domain}<span className="administration-login-domain"><b>@</b><input required disabled={disabled} value={domain} onChange={(event) => onDomain(event.target.value.replace(/^@/, ""))} placeholder="hajrix.com" inputMode="email" /></span></label><label>{text.loginName}<input required disabled={disabled} value={local} onChange={(event) => onLocal(event.target.value)} placeholder="ahmed" autoComplete="username" /></label></>;
}

function PasswordField({ language, label, value, onChange, autoComplete, required = false }: { language: "ar" | "en"; label: string; value: string; onChange: (value: string) => void; autoComplete: string; required?: boolean }) { const text = administrationText(language);
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="baseer-password-field"><input type={visible ? "text" : "password"} required={required} minLength={6} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} /><button className="daily-sales-secondary" type="button" aria-pressed={visible} onClick={() => setVisible((current) => !current)}>{visible ? text.hide : text.show}</button></span></label>;
}

function CreateUserDialog({ language, session, overview, onDone, onError, onClose }: { language: "ar" | "en"; session: ActiveSession; overview: AdministrationOverview; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) { const text = administrationText(language);
  const companies = activeCompanies(overview);
  const form = useForm<CreateUserForm>({ defaultValues: { loginLocal: "", loginDomain: "hajrix.com", nameAr: "", nameEn: "", password: "", preferredLanguage: "ar", companyIds: companies[0] ? [companies[0].id] : [], roleId: overview.roles[0]?.id ?? "", avatarKind: "INITIALS" }, resolver: zodResolver(createUserSchema(language === "ar")), shouldFocusError: true });
  const values = form.watch();
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const save = async (next: CreateUserForm) => { setBusy(true); try { await createAdministrationUser(session, { login: composeLogin(next.loginLocal, next.loginDomain), nameAr: next.nameAr, nameEn: next.nameEn, password: next.password, preferredLanguage: next.preferredLanguage, companyIds: next.companyIds, roleId: next.roleId, avatarKind: next.avatarKind }); await onDone(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); } };
  return <Dialog language={language} title={text.createEmployee} busy={busy} dialogRef={dialogRef} onClose={onClose}><form className="administration-dialog-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void save(next))}><AvatarPicker language={language} value={values.avatarKind} onChange={(avatarKind) => form.setValue("avatarKind", avatarKind, { shouldDirty: true })} previewName={values.nameAr || text.users} /><LoginFields language={language} local={values.loginLocal} domain={values.loginDomain} onLocal={(loginLocal) => form.setValue("loginLocal", loginLocal, { shouldDirty: true })} onDomain={(loginDomain) => form.setValue("loginDomain", loginDomain, { shouldDirty: true })} disabled={busy} />{form.formState.errors.loginLocal || form.formState.errors.loginDomain ? <small role="alert">{form.formState.errors.loginLocal?.message ?? form.formState.errors.loginDomain?.message}</small> : null}<label>{text.arabicName}<input aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label><label>{text.englishName}<input aria-invalid={Boolean(form.formState.errors.nameEn)} {...form.register("nameEn")} />{form.formState.errors.nameEn ? <small role="alert">{form.formState.errors.nameEn.message}</small> : null}</label><label>{text.preferredLanguage}<select {...form.register("preferredLanguage")}><option value="ar">{text.arabic}</option><option value="en">{text.english}</option></select></label><PasswordField language={language} label={text.password} value={values.password} onChange={(password) => form.setValue("password", password, { shouldDirty: true })} autoComplete="new-password" required />{form.formState.errors.password ? <small role="alert">{form.formState.errors.password.message}</small> : null}<label>{text.role}<select aria-invalid={Boolean(form.formState.errors.roleId)} {...form.register("roleId")}><option value="">—</option>{overview.roles.map((role) => <option key={role.id} value={role.id}>{displayName(language, role)}</option>)}</select>{form.formState.errors.roleId ? <small role="alert">{form.formState.errors.roleId.message}</small> : null}</label><CompanyCheckboxes language={language} overview={overview} value={values.companyIds} onChange={(companyIds) => form.setValue("companyIds", companyIds, { shouldDirty: true, shouldValidate: true })} disabled={busy} />{form.formState.errors.companyIds ? <small role="alert">{form.formState.errors.companyIds.message}</small> : null}<footer><button className="daily-sales-primary" disabled={busy}>{busy ? text.saving : text.saveEmployee}</button></footer></form></Dialog>;
}

function ManageUserDialog({ language, session, user, overview, owner, onDone, onError, onClose }: { language: "ar" | "en"; session: ActiveSession; user: User; overview: AdministrationOverview; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) { const text = administrationText(language);
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
  return <Dialog language={language} title={displayName(language, user)} busy={busy} dialogRef={dialogRef} onClose={onClose}><div className="administration-dialog-form"><LoginFields language={language} local={loginLocal} domain={loginDomain} onLocal={setLoginLocal} onDomain={setLoginDomain} disabled={!owner || busy} /><label>{text.arabicName}<input value={nameAr} disabled={!owner || busy} onChange={(event) => setNameAr(event.target.value)} /></label><label>{text.englishName}<input value={nameEn} disabled={!owner || busy} onChange={(event) => setNameEn(event.target.value)} /></label><label>{text.role}<select value={roleId} disabled={!owner || busy} onChange={(event) => setRoleId(event.target.value)}>{overview.roles.map((role) => <option key={role.id} value={role.id}>{displayName(language, role)} · {role.permissionCodes.length} {text.rolePermissionCount}</option>)}</select></label><CompanyCheckboxes language={language} overview={overview} value={companyIds} onChange={setCompanyIds} disabled={!owner || busy} />{owner && <section className="administration-sensitive-actions"><PasswordField language={language} label={text.newPassword} value={replacementPassword} onChange={setReplacementPassword} autoComplete="new-password" /><button className="daily-sales-secondary" disabled={busy} type="button" onClick={() => void run(() => updateAdministrationUserStatus(session, user.id, user.status === "ACTIVE" ? "DISABLED" : "ACTIVE", administrationAuditReason))}>{user.status === "ACTIVE" ? text.disableUser : text.enableUser}</button></section>}<footer>{owner && <button className="daily-sales-primary" disabled={busy || !canSave} type="button" onClick={() => void saveAll()}>{busy ? text.saving : text.saveChanges}</button>}</footer></div></Dialog>;
}

function AvatarPicker({ language, value, onChange, previewName }: { language: "ar" | "en"; value: UserAvatarKind; onChange: (value: UserAvatarKind) => void; previewName: string }) { const text = administrationText(language); return <fieldset className="administration-avatar-picker"><legend>{text.avatar}</legend><div>{(["INITIALS", "MALE", "FEMALE"] as const).map((kind) => <button className={value === kind ? "is-selected" : ""} key={kind} type="button" onClick={() => onChange(kind)}><AdministrationUserAvatar name={previewName} kind={kind} large language={language} /><span>{kind === "INITIALS" ? text.initials : kind === "MALE" ? text.male : text.female}</span></button>)}</div></fieldset>; }
function Dialog({ language, title, busy, dialogRef, onClose, children }: { language: "ar" | "en"; title: string; busy: boolean; dialogRef: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode }) { const text = administrationText(language); const close = () => { if (!busy) onClose(); }; return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={close}><section ref={dialogRef} className="daily-sales-dialog administration-user-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header className="daily-sales-dialog__header"><div><p className="eyebrow">{text.usersManagement}</p><h3>{title}</h3></div><button className="dialog-icon-button" type="button" aria-label={text.close} onClick={close} disabled={busy}>×</button></header>{children}</section></div>; }

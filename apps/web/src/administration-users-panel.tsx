import { lazy, Suspense, useCallback, useState, type ComponentType, type ReactNode } from "react";

import { createAdministrationUser, replaceAdministrationUserAccess, resetAdministrationUserPassword, updateAdministrationUserDisplayName, updateAdministrationUserLogin, updateAdministrationUserStatus } from "./administration-client";
import { AdministrationUserAvatar, type UserAvatarKind } from "./administration-user-avatar";
import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import { DataTable } from "./data-table";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";
import { displayName } from "./baseer-localization";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerCheckbox, BaseerTextInput } from "./baseer-form-fields";
import { administrationText } from "./administration-copy";
import type { BaseerValidatedFormFieldProps, BaseerValidatedFormSchemaFactory } from "./baseer-validated-form-field";

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
type ManageUserForm = CreateUserForm;
const LazyBaseerValidatedFormField = lazy(async () => ({ default: (await import("./baseer-validated-form-field")).BaseerValidatedFormField }));
function BaseerValidatedFormField<Values extends Record<string, unknown>>(props: BaseerValidatedFormFieldProps<Values>) {
  const Form = LazyBaseerValidatedFormField as unknown as ComponentType<BaseerValidatedFormFieldProps<Values>>;
  return <Suspense fallback={<form id={props.id} className={props.className} data-baseer-rhf-form aria-busy="true" onSubmit={(event) => event.preventDefault()} />}><Form {...props} /></Suspense>;
}

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
      {owner && <BaseerButton type="button" onClick={() => setMode("create")}>+ {text.addEmployee}</BaseerButton>}
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
      controls={<BaseerButton className="administration-users__disabled-toggle" variant="secondary" type="button" aria-pressed={showDisabled} onClick={() => setShowDisabled((current) => !current)}>{showDisabled ? text.hideDisabledUsers : text.showDisabledUsers} ({disabledUsers.length})</BaseerButton>}
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
  return <fieldset className="administration-access-list administration-company-checkboxes"><legend>{text.companiesLegend}</legend>{activeCompanies(overview).map((company) => <label key={company.id}><BaseerCheckbox checked={value.includes(company.id)} disabled={disabled} onChange={() => toggle(company.id)} /><span>{displayName(language, company)}</span></label>)}</fieldset>;
}

function LoginFields({ language, local, domain, onLocal, onDomain, localError, domainError, disabled = false }: { language: "ar" | "en"; local: string; domain: string; onLocal: (value: string) => void; onDomain: (value: string) => void; localError?: string; domainError?: string; disabled?: boolean }) { const text = administrationText(language);
  return <><label>{text.domain}<span className="administration-login-domain"><b>@</b><BaseerTextInput disabled={disabled} aria-invalid={Boolean(domainError)} value={domain} onChange={(event) => onDomain(event.target.value.replace(/^@/, ""))} placeholder="hajrix.com" inputMode="email" /></span>{domainError ? <small role="alert">{domainError}</small> : null}</label><label>{text.loginName}<BaseerTextInput disabled={disabled} aria-invalid={Boolean(localError)} value={local} onChange={(event) => onLocal(event.target.value)} placeholder="ahmed" autoComplete="username" />{localError ? <small role="alert">{localError}</small> : null}</label></>;
}

function PasswordField({ language, label, value, onChange, autoComplete, required = false }: { language: "ar" | "en"; label: string; value: string; onChange: (value: string) => void; autoComplete: string; required?: boolean }) { const text = administrationText(language);
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="baseer-password-field"><input type={visible ? "text" : "password"} required={required} minLength={6} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} /><button className="daily-sales-secondary" type="button" aria-pressed={visible} onClick={() => setVisible((current) => !current)}>{visible ? text.hide : text.show}</button></span></label>;
}

function CreateUserDialog({ language, session, overview, onDone, onError, onClose }: { language: "ar" | "en"; session: ActiveSession; overview: AdministrationOverview; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) { const text = administrationText(language); const companies = activeCompanies(overview);
  const [values, setValues] = useState<CreateUserForm>({ loginLocal: "", loginDomain: "hajrix.com", nameAr: "", nameEn: "", password: "", preferredLanguage: "ar", companyIds: companies[0] ? [companies[0].id] : [], roleId: overview.roles[0]?.id ?? "", avatarKind: "INITIALS" }); const [busy, setBusy] = useState(false);
  const schemaFactory = useCallback<BaseerValidatedFormSchemaFactory>(({ z }) => z.object({ loginLocal: z.string().trim().min(1, language === "ar" ? "أدخل اسم الدخول." : "Enter a login name."), loginDomain: z.string().trim().min(1, language === "ar" ? "أدخل نطاق الدخول." : "Enter a login domain."), nameAr: z.string().trim().min(1, language === "ar" ? "أدخل الاسم بالعربية." : "Enter the Arabic name."), nameEn: z.string().trim().min(1, language === "ar" ? "أدخل الاسم بالإنجليزية." : "Enter the English name."), password: z.string().min(6, language === "ar" ? "كلمة المرور ستة أحرف على الأقل." : "Password must have at least six characters."), preferredLanguage: z.enum(["ar", "en"]), companyIds: z.array(z.string()).min(1, language === "ar" ? "اختر شركة واحدة على الأقل." : "Choose at least one company."), roleId: z.string().min(1, language === "ar" ? "اختر دوراً." : "Choose a role."), avatarKind: z.enum(["INITIALS", "MALE", "FEMALE"]) }), [language]);
  const save = async (next: CreateUserForm) => { setBusy(true); try { await createAdministrationUser(session, { login: composeLogin(next.loginLocal, next.loginDomain), nameAr: next.nameAr, nameEn: next.nameEn, password: next.password, preferredLanguage: next.preferredLanguage, companyIds: next.companyIds, roleId: next.roleId, avatarKind: next.avatarKind }); await onDone(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); } };
  return <Dialog language={language} title={text.createEmployee} busy={busy} onClose={onClose}><BaseerValidatedFormField<CreateUserForm> id="administration-create-user" className="administration-dialog-form" values={values} schemaFactory={schemaFactory} onValid={(next) => void save(next)} errorSummaryLabel={text.checkRequiredFields}>{({ errors }) => <><AvatarPicker language={language} value={values.avatarKind} onChange={(avatarKind) => setValues((current) => ({ ...current, avatarKind }))} previewName={values.nameAr || text.users} /><LoginFields language={language} local={values.loginLocal} domain={values.loginDomain} onLocal={(loginLocal) => setValues((current) => ({ ...current, loginLocal }))} onDomain={(loginDomain) => setValues((current) => ({ ...current, loginDomain }))} localError={errors.loginLocal?.message} domainError={errors.loginDomain?.message} disabled={busy} /><label>{text.arabicName}<BaseerTextInput aria-invalid={Boolean(errors.nameAr)} value={values.nameAr} onChange={(event) => setValues((current) => ({ ...current, nameAr: event.target.value }))} />{errors.nameAr ? <small role="alert">{errors.nameAr.message}</small> : null}</label><label>{text.englishName}<BaseerTextInput aria-invalid={Boolean(errors.nameEn)} value={values.nameEn} onChange={(event) => setValues((current) => ({ ...current, nameEn: event.target.value }))} />{errors.nameEn ? <small role="alert">{errors.nameEn.message}</small> : null}</label><label>{text.preferredLanguage}<BaseerStaticSelect label={text.preferredLanguage} value={values.preferredLanguage} onChange={(event) => setValues((current) => ({ ...current, preferredLanguage: event.target.value as CreateUserForm["preferredLanguage"] }))}><option value="ar">{text.arabic}</option><option value="en">{text.english}</option></BaseerStaticSelect></label><PasswordField language={language} label={text.password} value={values.password} onChange={(password) => setValues((current) => ({ ...current, password }))} autoComplete="new-password" />{errors.password ? <small role="alert">{errors.password.message}</small> : null}<label>{text.role}<select aria-invalid={Boolean(errors.roleId)} value={values.roleId} onChange={(event) => setValues((current) => ({ ...current, roleId: event.target.value }))}><option value="">—</option>{overview.roles.map((role) => <option key={role.id} value={role.id}>{displayName(language, role)}</option>)}</select>{errors.roleId ? <small role="alert">{errors.roleId.message}</small> : null}</label><CompanyCheckboxes language={language} overview={overview} value={values.companyIds} onChange={(companyIds) => setValues((current) => ({ ...current, companyIds }))} disabled={busy} />{errors.companyIds ? <small role="alert">{errors.companyIds.message}</small> : null}<footer><BaseerButton disabled={busy}>{busy ? text.saving : text.saveEmployee}</BaseerButton></footer></>}</BaseerValidatedFormField></Dialog>;
}

function ManageUserDialog({ language, session, user, overview, owner, onDone, onError, onClose }: { language: "ar" | "en"; session: ActiveSession; user: User; overview: AdministrationOverview; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) { const text = administrationText(language); const initialLogin = splitLogin(user.login);
  const [values, setValues] = useState<ManageUserForm>({ loginLocal: initialLogin.local, loginDomain: initialLogin.domain, nameAr: user.nameAr, nameEn: user.nameEn, password: "", preferredLanguage: user.preferredLanguage, companyIds: user.memberships.map((membership) => membership.companyId), roleId: user.memberships[0]?.roleId ?? overview.roles[0]?.id ?? "", avatarKind: user.avatarKind }); const [busy, setBusy] = useState(false);
  const schemaFactory = useCallback<BaseerValidatedFormSchemaFactory>(({ z }) => z.object({ loginLocal: z.string().trim().min(1, language === "ar" ? "أدخل اسم الدخول." : "Enter a login name."), loginDomain: z.string().trim().min(1, language === "ar" ? "أدخل نطاق الدخول." : "Enter a login domain."), nameAr: z.string().trim().min(1, language === "ar" ? "أدخل الاسم بالعربية." : "Enter the Arabic name."), nameEn: z.string().trim().min(1, language === "ar" ? "أدخل الاسم بالإنجليزية." : "Enter the English name."), password: z.union([z.literal(""), z.string().min(6, language === "ar" ? "كلمة المرور ستة أحرف على الأقل." : "Password must have at least six characters.")]), preferredLanguage: z.enum(["ar", "en"]), companyIds: z.array(z.string()).min(1, language === "ar" ? "اختر شركة واحدة على الأقل." : "Choose at least one company."), roleId: z.string().min(1, language === "ar" ? "اختر دوراً." : "Choose a role."), avatarKind: z.enum(["INITIALS", "MALE", "FEMALE"]) }), [language]);
  const login = composeLogin(values.loginLocal, values.loginDomain); const hasNameChange = values.nameAr.trim() !== user.nameAr || values.nameEn.trim() !== user.nameEn; const hasLoginChange = login !== user.login; const hasAccessChange = values.roleId !== (user.memberships[0]?.roleId ?? "") || !sameIds(values.companyIds, user.memberships.map((membership) => membership.companyId)); const hasPasswordChange = values.password.length > 0; const canSave = owner && values.companyIds.length > 0 && (hasNameChange || hasLoginChange || hasAccessChange || hasPasswordChange);
  const run = async (action: () => Promise<unknown>) => { if (!owner) return; setBusy(true); try { await action(); setValues((current) => ({ ...current, password: "" })); await onDone(); } catch (error) { onError(error); } finally { setBusy(false); } }; const saveAll = (next: ManageUserForm) => run(async () => { const nextLogin = composeLogin(next.loginLocal, next.loginDomain); if (next.nameAr.trim() !== user.nameAr || next.nameEn.trim() !== user.nameEn) await updateAdministrationUserDisplayName(session, user.id, { nameAr: next.nameAr, nameEn: next.nameEn, reason: administrationAuditReason }); if (nextLogin !== user.login) await updateAdministrationUserLogin(session, user.id, { login: nextLogin, reason: administrationAuditReason }); if (next.roleId !== (user.memberships[0]?.roleId ?? "") || !sameIds(next.companyIds, user.memberships.map((membership) => membership.companyId))) await replaceAdministrationUserAccess(session, user.id, { roleId: next.roleId, companyIds: next.companyIds, reason: administrationAuditReason }); if (next.password) await resetAdministrationUserPassword(session, user.id, next.password, administrationAuditReason); });
  return <Dialog language={language} title={displayName(language, user)} busy={busy} onClose={onClose}><BaseerValidatedFormField<ManageUserForm> id="administration-manage-user" className="administration-dialog-form" values={values} schemaFactory={schemaFactory} onValid={(next) => void saveAll(next)} errorSummaryLabel={text.checkRequiredFields}>{({ errors }) => <><LoginFields language={language} local={values.loginLocal} domain={values.loginDomain} onLocal={(loginLocal) => setValues((current) => ({ ...current, loginLocal }))} onDomain={(loginDomain) => setValues((current) => ({ ...current, loginDomain }))} localError={errors.loginLocal?.message} domainError={errors.loginDomain?.message} disabled={!owner || busy} /><label>{text.arabicName}<BaseerTextInput aria-invalid={Boolean(errors.nameAr)} value={values.nameAr} disabled={!owner || busy} onChange={(event) => setValues((current) => ({ ...current, nameAr: event.target.value }))} />{errors.nameAr ? <small role="alert">{errors.nameAr.message}</small> : null}</label><label>{text.englishName}<BaseerTextInput aria-invalid={Boolean(errors.nameEn)} value={values.nameEn} disabled={!owner || busy} onChange={(event) => setValues((current) => ({ ...current, nameEn: event.target.value }))} />{errors.nameEn ? <small role="alert">{errors.nameEn.message}</small> : null}</label><label>{text.role}<select aria-invalid={Boolean(errors.roleId)} value={values.roleId} disabled={!owner || busy} onChange={(event) => setValues((current) => ({ ...current, roleId: event.target.value }))}>{overview.roles.map((role) => <option key={role.id} value={role.id}>{displayName(language, role)} · {role.permissionCodes.length} {text.rolePermissionCount}</option>)}</select>{errors.roleId ? <small role="alert">{errors.roleId.message}</small> : null}</label><CompanyCheckboxes language={language} overview={overview} value={values.companyIds} onChange={(companyIds) => setValues((current) => ({ ...current, companyIds }))} disabled={!owner || busy} />{errors.companyIds ? <small role="alert">{errors.companyIds.message}</small> : null}{owner && <section className="administration-sensitive-actions"><PasswordField language={language} label={text.newPassword} value={values.password} onChange={(password) => setValues((current) => ({ ...current, password }))} autoComplete="new-password" />{errors.password ? <small role="alert">{errors.password.message}</small> : null}<BaseerButton variant="secondary" disabled={busy} type="button" onClick={() => void run(() => updateAdministrationUserStatus(session, user.id, user.status === "ACTIVE" ? "DISABLED" : "ACTIVE", administrationAuditReason))}>{user.status === "ACTIVE" ? text.disableUser : text.enableUser}</BaseerButton></section>}<footer>{owner && <BaseerButton disabled={busy || !canSave}>{busy ? text.saving : text.saveChanges}</BaseerButton>}</footer></>}</BaseerValidatedFormField></Dialog>;
}

function AvatarPicker({ language, value, onChange, previewName }: { language: "ar" | "en"; value: UserAvatarKind; onChange: (value: UserAvatarKind) => void; previewName: string }) { const text = administrationText(language); return <fieldset className="administration-avatar-picker"><legend>{text.avatar}</legend><div>{(["INITIALS", "MALE", "FEMALE"] as const).map((kind) => <button className={value === kind ? "is-selected" : ""} key={kind} type="button" onClick={() => onChange(kind)}><AdministrationUserAvatar name={previewName} kind={kind} large language={language} /><span>{kind === "INITIALS" ? text.initials : kind === "MALE" ? text.male : text.female}</span></button>)}</div></fieldset>; }
function Dialog({ language, title, busy, onClose, children }: { language: "ar" | "en"; title: string; busy: boolean; onClose: () => void; children: ReactNode }) { const text = administrationText(language); return <BaseerDialog open title={title} eyebrow={text.usersManagement} language={language} busy={busy} onClose={onClose} className="administration-user-dialog">{children}</BaseerDialog>; }

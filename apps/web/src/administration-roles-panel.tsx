import { lazy, Suspense, useCallback, useState, type ComponentType } from "react";

import { createAdministrationRole, deleteAdministrationRole, updateAdministrationRole } from "./administration-client";
import { BaseerButton } from "./baseer-button";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerCheckbox, BaseerTextInput } from "./baseer-form-fields";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";
import { displayName } from "./baseer-localization";
import { administrationText } from "./administration-copy";
import type { BaseerValidatedFormFieldProps, BaseerValidatedFormSchemaFactory } from "./baseer-validated-form-field";

type Props = { language: "ar" | "en"; session: ActiveSession; overview: AdministrationOverview; owner: boolean; onDone: () => Promise<void>; onError: (error: unknown) => void };
type Permission = AdministrationOverview["permissions"][number];
type Role = AdministrationOverview["roles"][number];
type RoleForm = { nameAr: string; nameEn: string; permissionCodes: string[] };
const LazyBaseerValidatedFormField = lazy(async () => ({ default: (await import("./baseer-validated-form-field")).BaseerValidatedFormField }));
function BaseerValidatedFormField<Values extends Record<string, unknown>>(props: BaseerValidatedFormFieldProps<Values>) {
  const Form = LazyBaseerValidatedFormField as unknown as ComponentType<BaseerValidatedFormFieldProps<Values>>;
  return <Suspense fallback={<form id={props.id} className={props.className} data-baseer-rhf-form aria-busy="true" onSubmit={(event) => event.preventDefault()} />}><Form {...props} /></Suspense>;
}
function normalizeSelection(codes: readonly string[], permissions: Permission[]): string[] {
  const byCode = new Map(permissions.map((permission) => [permission.code, permission]));
  const selected = new Set(codes);
  for (const code of selected) for (const dependency of byCode.get(code)?.requires ?? []) selected.add(dependency);
  return [...selected];
}

export function AdministrationRolesPanel({ language, session, overview, owner, onDone, onError }: Props) { const text = administrationText(language);
  const [editing, setEditing] = useState(false); const [editingRole, setEditingRole] = useState<Role | null>(null); const [values, setValues] = useState<RoleForm>({ nameAr: "", nameEn: "", permissionCodes: [] }); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false); const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
  const roleSchemaFactory = useCallback<BaseerValidatedFormSchemaFactory>(({ z }) => z.object({ nameAr: z.string().trim().min(1, language === "ar" ? "أدخل الاسم بالعربية." : "Enter the Arabic name."), nameEn: z.string().trim().min(1, language === "ar" ? "أدخل الاسم بالإنجليزية." : "Enter the English name."), permissionCodes: z.array(z.string()).min(1, language === "ar" ? "اختر صلاحية واحدة على الأقل." : "Choose at least one permission.") }), [language]);
  const reset = () => { setEditing(false); setEditingRole(null); setValues({ nameAr: "", nameEn: "", permissionCodes: [] }); };
  const startEdit = (role: Role) => { if (role.isSystem) return; setEditingRole(role); setValues({ nameAr: role.nameAr, nameEn: role.nameEn, permissionCodes: normalizeSelection(role.permissionCodes, overview.permissions) }); setEditing(true); };
  const submit = async (next: RoleForm) => { if (!owner) return; setBusy(true); try { if (editingRole) await updateAdministrationRole(session, editingRole.id, { nameAr: next.nameAr, nameEn: next.nameEn, permissionCodes: next.permissionCodes }); else await createAdministrationRole(session, next); await onDone(); reset(); } catch (error) { onError(error); } finally { setBusy(false); setConfirmDelete(false); } };
  const showFirstInvalidRoleField = () => window.requestAnimationFrame(() => {
    const form = document.getElementById("administration-role");
    const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLInputElement) target.focus({ preventScroll: true });
    else target?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  });
  const remove = async () => { if (!owner || !editingRole) return; setBusy(true); try { await deleteAdministrationRole(session, editingRole.id); await onDone(); reset(); } catch (error) { onError(error); } finally { setBusy(false); setConfirmDelete(false); } };
  const toggle = (permissionCode: string, checked: boolean) => setValues((current) => {
    const selected = checked ? [...current.permissionCodes, permissionCode] : current.permissionCodes.filter((item) => item !== permissionCode && !current.permissionCodes.some((selectedCode) => overview.permissions.find((permission) => permission.code === selectedCode)?.requires.includes(permissionCode)));
    return { ...current, permissionCodes: normalizeSelection(selected, overview.permissions) };
  });
  const moduleKeys = [...new Set(overview.permissions.map((permission) => permission.module))].sort((left, right) => (overview.permissions.find((permission) => permission.module === left)?.moduleOrder ?? 999) - (overview.permissions.find((permission) => permission.module === right)?.moduleOrder ?? 999));
  if (editing) return <>{<section className="administration-section administration-role-editor"><header className="administration-section-heading"><div><p className="eyebrow">{text.roles}</p><h3>{editingRole ? text.editRoleName(displayName(language, editingRole)) : text.createRole}</h3></div><BaseerButton variant="secondary" type="button" onClick={reset} disabled={busy}>← {text.returnToRoles}</BaseerButton></header><BaseerValidatedFormField<RoleForm> id="administration-role" className="administration-role-form" values={values} schemaFactory={roleSchemaFactory} onValid={(next) => void submit(next)} onInvalid={showFirstInvalidRoleField} errorSummaryLabel={text.roleRequirements}>{({ errors }) => <><div className="administration-role-basics"><label>{text.arabicName}<BaseerTextInput aria-invalid={Boolean(errors.nameAr)} value={values.nameAr} onChange={(event) => setValues((current) => ({ ...current, nameAr: event.target.value }))} />{errors.nameAr ? <small role="alert">{errors.nameAr.message}</small> : null}</label><label>{text.englishName}<BaseerTextInput aria-invalid={Boolean(errors.nameEn)} value={values.nameEn} onChange={(event) => setValues((current) => ({ ...current, nameEn: event.target.value }))} />{errors.nameEn ? <small role="alert">{errors.nameEn.message}</small> : null}</label></div><fieldset className="administration-permission-picker" aria-invalid={Boolean(errors.permissionCodes)}><legend>{text.selectedPermissions} <small>{values.permissionCodes.length}</small></legend>{moduleKeys.map((moduleKey) => <PermissionModule key={moduleKey} moduleKey={moduleKey} language={language} permissions={overview.permissions} selected={values.permissionCodes} onToggle={toggle} />)}{errors.permissionCodes ? <small role="alert">{errors.permissionCodes.message}</small> : null}</fieldset><footer className="administration-role-editor__footer"><BaseerButton variant="secondary" type="button" onClick={reset} disabled={busy}>{text.cancel}</BaseerButton>{editingRole && <BaseerButton variant="danger" type="button" onClick={() => setConfirmDelete(true)} disabled={busy}>{text.deleteRole}</BaseerButton>}<BaseerButton disabled={busy}>{busy ? text.saving : editingRole ? text.saveChanges : text.createRole}</BaseerButton></footer></>}</BaseerValidatedFormField></section>}<BaseerConfirmDialog open={confirmDelete} title={text.deleteRole} message={`${text.deleteRole}: ${editingRole ? displayName(language, editingRole) : ""}`} confirmLabel={text.deleteRole} language={language} destructive busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} /></>;
  return <section className="administration-section administration-roles-section"><header className="administration-section-heading"><div><h3>{text.roles}</h3></div>{owner && <BaseerButton type="button" onClick={() => { reset(); setEditing(true); }}>+ {text.addRole}</BaseerButton>}</header><div className="administration-role-cards">{overview.roles.map((role) => {
    const effectivePermissionCodes = normalizeSelection(role.permissionCodes, overview.permissions);
    const effectivePermissions = effectivePermissionCodes.map((code) => overview.permissions.find((permission) => permission.code === code) ?? { code, nameAr: code, nameEn: code });
    const isExpanded = expandedRoleId === role.id;
    const permissionDetailsId = `administration-role-permissions-${role.id}`;
    return <article key={role.id}><BaseerButton variant="quiet" className="administration-role-card__summary" type="button" aria-expanded={isExpanded} aria-controls={permissionDetailsId} onClick={() => setExpandedRoleId((current) => current === role.id ? null : role.id)}><span className={role.isSystem ? "administration-role-card__system" : "administration-role-card__custom"}>{role.isSystem ? text.defaultRole : text.customRole}</span><strong>{displayName(language, role)}</strong><small>{language === "ar" ? role.nameEn : role.nameAr}</small><p>{effectivePermissionCodes.length} {text.permissions}</p><span>{isExpanded ? text.hideRolePermissions : text.showRolePermissions}</span></BaseerButton>{isExpanded && <section id={permissionDetailsId} className="administration-role-card__permissions" aria-label={text.effectiveRolePermissions}><strong>{text.effectiveRolePermissions}</strong><ul>{effectivePermissions.map((permission) => <li key={permission.code}>{displayName(language, permission)}</li>)}</ul></section>}{owner && !role.isSystem && <BaseerButton variant="secondary" type="button" onClick={() => startEdit(role)}>{text.editPermissions}</BaseerButton>}</article>;
  })}</div></section>;
}
function PermissionModule({ moduleKey, language, permissions, selected, onToggle }: { moduleKey: string; language: "ar" | "en"; permissions: Permission[]; selected: string[]; onToggle: (permissionCode: string, checked: boolean) => void }) {
  const text = administrationText(language); const modulePermissions = permissions.filter((permission) => permission.module === moduleKey); if (!modulePermissions.length) return null;
  const sections = [...new Map(modulePermissions.map((permission) => [language === "ar" ? permission.sectionAr : permission.sectionEn, modulePermissions.filter((candidate) => (language === "ar" ? candidate.sectionAr : candidate.sectionEn) === (language === "ar" ? permission.sectionAr : permission.sectionEn))])).entries()].sort(([, left], [, right]) => (left[0]?.sectionOrder ?? 999) - (right[0]?.sectionOrder ?? 999));
  const title = language === "ar" ? modulePermissions[0]!.moduleAr : modulePermissions[0]!.moduleEn;
  const dependentCodes = new Set(permissions.flatMap((permission) => selected.includes(permission.code) ? permission.requires : []));
  return <section className="administration-permission-module"><header><h4>{title}</h4><span>{modulePermissions.length} {text.permissions}</span></header><div className="administration-permission-sections">{sections.map(([title, sectionPermissions]) => <section className="administration-permission-section" key={title}><h5>{title}</h5><div>{sectionPermissions.map((permission) => { const automatic = dependentCodes.has(permission.code); return <label key={permission.code} className={permission.risk === "sensitive" ? "is-sensitive" : ""}><BaseerCheckbox checked={selected.includes(permission.code)} disabled={automatic} onChange={(event) => onToggle(permission.code, event.target.checked)} /><span>{displayName(language, permission)}</span>{automatic && <small>{language === "ar" ? "مفعّلة تلقائياً" : "Enabled automatically"}</small>}{permission.risk === "sensitive" && <small>{text.sensitive}</small>}</label>; })}</div></section>)}</div></section>;
}

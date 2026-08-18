import { useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterSelect, BaseerFilterToggle } from "./baseer-filter-controls";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { presentBaseerApiError } from "./baseer-api-error";
import { displayName, localizedEnum } from "./baseer-localization";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { DataTable, type DataTableColumn } from "./data-table";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { categoryText } from "./categories-copy";

type CategoryKind = "PURCHASE" | "EXPENSE" | "SALE";
type Category = { id: string; code: string; nameAr: string; nameEn: string; kind: CategoryKind; status: "ACTIVE" | "ARCHIVED"; parentId: string | null; isPosting: boolean };
type Configuration = { categories: Category[] };
type Form = { code: string; nameAr: string; nameEn: string; kind: CategoryKind; parentId: string; isPosting: boolean };
const blankForm = (): Form => ({ code: "", nameAr: "", nameEn: "", kind: "PURCHASE", parentId: "", isPosting: true });

export function CategoriesWorkspace({ language }: { language: "ar" | "en" }) {
  const text = categoryText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"ALL" | CategoryKind>("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Category | null>(null);
  const [form, setForm] = useState<Form>(blankForm);

  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await api<Configuration>(current, "/finance/configuration");
      setCategories(result.categories);
    } catch (error) {
      setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.loading) });
    } finally { setLoading(false); }
  }, [language, text.loading]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const source = categories.filter((item) => showArchived || item.status === "ACTIVE");
    return source.filter((item) => (kind === "ALL" || item.kind === kind) && (!term || [item.code, item.nameAr, item.nameEn].join(" ").toLowerCase().includes(term))).sort((a, b) => a.code.localeCompare(b.code));
  }, [categories, kind, search, showArchived]);
  const active = useMemo(() => categories.filter((item) => item.status === "ACTIVE"), [categories]);
  const groups = active.filter((item) => !item.isPosting).length;
  const posting = active.filter((item) => item.isPosting).length;
  const parentOptions = useMemo(() => active.filter((item) => !item.isPosting && item.kind === form.kind && item.id !== editing?.id), [active, editing?.id, form.kind]);
  const clearFilters = () => { setSearch(""); setKind("ALL"); setShowArchived(false); };
  const appliedFilters = [
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
    ...(kind !== "ALL" ? [{ id: "kind", label: localizedEnum(language, kind), onRemove: () => setKind("ALL") }] : []),
    ...(showArchived ? [{ id: "archived", label: text.showArchived, onRemove: () => setShowArchived(false) }] : []),
  ];
  const openDialog = (item?: Category) => {
    setEditing(item ?? null);
    setForm(item ? { code: item.code, nameAr: item.nameAr, nameEn: item.nameEn, kind: item.kind, parentId: item.parentId ?? "", isPosting: item.isPosting } : blankForm());
    setDialogOpen(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const current = activeSession();
    if (!current || saving) return;
    setSaving(true); setMessage({ kind: "idle", text: "" });
    const payload = { ...form, parentId: form.parentId || undefined, idempotencyKey: requestId() };
    try {
      await api(current, editing ? "/finance/master-data/categories/update" : "/finance/master-data/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { ...payload, categoryId: editing.id } : payload) });
      setDialogOpen(false); setEditing(null); setMessage({ kind: "success", text: text.categorySaved }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.title) }); }
    finally { setSaving(false); }
  };
  const archive = async () => {
    const current = activeSession();
    if (!current || !archiveTarget || saving) return;
    setSaving(true);
    try {
      await api(current, "/finance/master-data/categories/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: archiveTarget.id, idempotencyKey: requestId() }) });
      setArchiveTarget(null); setMessage({ kind: "success", text: text.categoryArchived }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.archiveCategory) }); }
    finally { setSaving(false); }
  };
  const columns: DataTableColumn<Category>[] = [
    { id: "code", header: text.code, cell: (item) => item.code },
    { id: "category", header: text.category, cell: (item) => <strong>{item.parentId ? "↳ " : ""}{displayName(language, item)}</strong> },
    { id: "kind", header: text.kind, cell: (item) => localizedEnum(language, item.kind) },
    { id: "parent", header: text.parent, cell: (item) => item.parentId ? displayName(language, categories.find((parent) => parent.id === item.parentId) ?? { nameAr: "—", nameEn: "—" }) : "—" },
    { id: "posting", header: text.posting, cell: (item) => item.isPosting ? text.posting : text.groups },
    { id: "status", header: text.status, cell: (item) => item.status === "ACTIVE" ? text.active : text.archived },
    { id: "action", header: text.action, align: "end", cell: (item) => <span className="baseer-inline-actions"><BaseerButton type="button" variant="secondary" onClick={() => openDialog(item)} disabled={item.status !== "ACTIVE"}>{text.edit}</BaseerButton>{item.status === "ACTIVE" ? <BaseerButton type="button" variant="danger" onClick={() => setArchiveTarget(item)}>{text.archive}</BaseerButton> : null}</span> },
  ];
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="daily-sales-workspace" aria-label={text.title}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.title}</p><h3>{text.title}</h3></div><span className="baseer-inline-actions"><BaseerButton type="button" variant="primary" onClick={() => openDialog()} disabled={saving}>{text.addCategory}</BaseerButton></span></header>
    {message.kind !== "idle" ? <p className={`daily-sales-message ${message.kind}`}>{message.text}</p> : null}
    <div className="baseer-card-grid administration-role-cards"><BaseerCard><span>{text.categoriesCount}</span><strong>{categories.length}</strong></BaseerCard><BaseerCard><span>{text.activeCategories}</span><strong>{active.length}</strong></BaseerCard><BaseerCard><span>{text.postingCategories}</span><strong>{posting}</strong></BaseerCard><BaseerCard><span>{text.groupCategories}</span><strong>{groups}</strong></BaseerCard></div>
    <BaseerCard><BaseerFilterBar controlsPresentation="menu" language={language} search={search} searchLabel={text.search} searchPlaceholder={text.search} onSearchChange={setSearch} appliedFilters={appliedFilters} onClear={clearFilters} controls={<><BaseerFilterSelect label={text.kind} value={kind} onChange={(event) => setKind(event.target.value as "ALL" | CategoryKind)}><option value="ALL">{text.allKinds}</option><option value="PURCHASE">{localizedEnum(language, "PURCHASE")}</option><option value="EXPENSE">{localizedEnum(language, "EXPENSE")}</option><option value="SALE">{localizedEnum(language, "SALE")}</option></BaseerFilterSelect><BaseerFilterToggle label={text.showArchived} checked={showArchived} onChange={setShowArchived} /></>} />{loading ? <p>{text.loading}</p> : visible.length ? <DataTable ariaLabel={text.title} caption={text.tableCaption} columns={columns} rows={visible} rowKey={(item) => item.id} /> : <p>{text.noResults}</p>}</BaseerCard>
    <BaseerDialog open={dialogOpen} title={editing ? text.editCategory : text.addCategory} language={language} busy={saving} onClose={() => { setDialogOpen(false); setEditing(null); }} footer={<><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => { setDialogOpen(false); setEditing(null); }}>{text.clear}</BaseerButton><BaseerButton type="submit" form="category-form" variant="primary" disabled={saving}>{editing ? text.save : text.add}</BaseerButton></>}><form id="category-form" className="administration-form" onSubmit={(event) => void save(event)}><label>{text.code}<input required value={form.code} onChange={(event) => setForm((value) => ({ ...value, code: event.target.value }))} /></label><label>{text.nameAr}<input required value={form.nameAr} onChange={(event) => setForm((value) => ({ ...value, nameAr: event.target.value }))} /></label><label>{text.nameEn}<input required value={form.nameEn} onChange={(event) => setForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label>{text.kind}<select value={form.kind} disabled={Boolean(editing)} onChange={(event) => setForm((value) => ({ ...value, kind: event.target.value as CategoryKind, parentId: "" }))}><option value="PURCHASE">{localizedEnum(language, "PURCHASE")}</option><option value="EXPENSE">{localizedEnum(language, "EXPENSE")}</option><option value="SALE">{localizedEnum(language, "SALE")}</option></select>{editing ? <small>{text.accountingTypeFixed}</small> : null}</label><label>{text.parent}<select value={form.parentId} onChange={(event) => setForm((value) => ({ ...value, parentId: event.target.value }))}><option value="">{text.noParent}</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{displayName(language, item)}</option>)}</select></label><label><input type="checkbox" checked={form.isPosting} onChange={(event) => setForm((value) => ({ ...value, isPosting: event.target.checked }))} /> {form.isPosting ? text.acceptsPosting : text.groupOnly}</label></form></BaseerDialog>
    <BaseerConfirmDialog open={Boolean(archiveTarget)} language={language} busy={saving} destructive title={text.archiveTitle} message={text.archiveMessage} confirmLabel={text.archiveCategory} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archive()} />
  </section>;
}

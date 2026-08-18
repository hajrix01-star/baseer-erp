import { useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { presentBaseerApiError } from "./baseer-api-error";
import { displayName, localizedEnum } from "./baseer-localization";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { categoryText } from "./categories-copy";
import { FinanceCategoryTree, type FinanceCategoryKind, type FinanceCategoryTreeItem } from "./finance-category-tree";

type CategoryKind = FinanceCategoryKind;
type Category = FinanceCategoryTreeItem;
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
  const [kind, setKind] = useState<CategoryKind>("PURCHASE");
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [details, setDetails] = useState<Category | null>(null);
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
    const source = categories.filter((item) => item.kind === kind && (showArchived || item.status === "ACTIVE"));
    if (!term) return source;
    const byId = new Map(source.map((item) => [item.id, item]));
    const included = new Set(source.filter((item) => [item.code, item.nameAr, item.nameEn].join(" ").toLowerCase().includes(term)).map((item) => item.id));
    for (const id of [...included]) { let parent = byId.get(id)?.parentId ?? null; while (parent) { included.add(parent); parent = byId.get(parent)?.parentId ?? null; } }
    return source.filter((item) => included.has(item.id));
  }, [categories, kind, search, showArchived]);
  const active = useMemo(() => categories.filter((item) => item.status === "ACTIVE"), [categories]);
  const parentOptions = useMemo(() => active.filter((item) => !item.isPosting && item.kind === form.kind && item.id !== editing?.id), [active, editing?.id, form.kind]);
  const clearFilters = () => { setSearch(""); setShowArchived(false); };
  const appliedFilters = [
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
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
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="daily-sales-workspace" aria-label={text.title}>
    <header className="administration-section-heading"><h3>{text.title}</h3><span className="baseer-inline-actions"><BaseerButton type="button" variant="primary" onClick={() => openDialog()} disabled={saving}>{text.addCategory}</BaseerButton></span></header>
    {message.kind !== "idle" ? <p className={`daily-sales-message ${message.kind}`}>{message.text}</p> : null}
    <BaseerWorkspaceTabs ariaLabel={text.kind} idPrefix="finance-category-kind" activeId={kind} onChange={(value) => setKind(value as CategoryKind)} tabs={[{ id: "PURCHASE", label: localizedEnum(language, "PURCHASE") }, { id: "EXPENSE", label: localizedEnum(language, "EXPENSE") }, { id: "SALE", label: localizedEnum(language, "SALE") }]} />
    <BaseerBatchPanel id={`finance-category-kind-panel-${kind}`} labelledBy={`finance-category-kind-${kind}`}><BaseerFilterBar controlsPresentation="menu" language={language} search={search} searchLabel={text.search} searchPlaceholder={text.search} onSearchChange={setSearch} appliedFilters={appliedFilters} onClear={clearFilters} controls={<BaseerFilterToggle label={text.showArchived} checked={showArchived} onChange={setShowArchived} />} />{loading ? <p>{text.loading}</p> : visible.length ? <FinanceCategoryTree key={kind} language={language} categories={visible} onOpen={setDetails} /> : <p>{text.noResults}</p>}</BaseerBatchPanel>
    <BaseerDialog open={details !== null} title={details ? displayName(language, details) : text.title} language={language} busy={saving} onClose={() => setDetails(null)} footer={details ? <><BaseerButton type="button" variant="secondary" disabled={details.status !== "ACTIVE"} onClick={() => { const item = details; setDetails(null); openDialog(item); }}>{text.edit}</BaseerButton>{details.status === "ACTIVE" ? <BaseerButton type="button" variant="danger" onClick={() => { setArchiveTarget(details); setDetails(null); }}>{text.archive}</BaseerButton> : null}</> : null}>{details ? <div className="administration-list"><article><strong>{text.code}: {details.code}</strong><span>{text.kind}: {localizedEnum(language, details.kind)}</span><span>{text.parent}: {details.parentId ? displayName(language, categories.find((item) => item.id === details.parentId) ?? { nameAr: "—", nameEn: "—" }) : text.noParent}</span><span>{details.isPosting ? text.acceptsPosting : text.groupOnly}</span><span>{details.status === "ACTIVE" ? text.active : text.archived}</span></article></div> : null}</BaseerDialog>
    <BaseerDialog open={dialogOpen} title={editing ? text.editCategory : text.addCategory} language={language} busy={saving} onClose={() => { setDialogOpen(false); setEditing(null); }} footer={<><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => { setDialogOpen(false); setEditing(null); }}>{text.clear}</BaseerButton><BaseerButton type="submit" form="category-form" variant="primary" disabled={saving}>{editing ? text.save : text.add}</BaseerButton></>}><form id="category-form" className="administration-form" onSubmit={(event) => void save(event)}><label>{text.code}<input required value={form.code} onChange={(event) => setForm((value) => ({ ...value, code: event.target.value }))} /></label><label>{text.nameAr}<input required value={form.nameAr} onChange={(event) => setForm((value) => ({ ...value, nameAr: event.target.value }))} /></label><label>{text.nameEn}<input required value={form.nameEn} onChange={(event) => setForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label>{text.kind}<select value={form.kind} disabled={Boolean(editing)} onChange={(event) => setForm((value) => ({ ...value, kind: event.target.value as CategoryKind, parentId: "" }))}><option value="PURCHASE">{localizedEnum(language, "PURCHASE")}</option><option value="EXPENSE">{localizedEnum(language, "EXPENSE")}</option><option value="SALE">{localizedEnum(language, "SALE")}</option></select>{editing ? <small>{text.accountingTypeFixed}</small> : null}</label><label>{text.parent}<select value={form.parentId} onChange={(event) => setForm((value) => ({ ...value, parentId: event.target.value }))}><option value="">{text.noParent}</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{displayName(language, item)}</option>)}</select></label><label><input type="checkbox" checked={form.isPosting} onChange={(event) => setForm((value) => ({ ...value, isPosting: event.target.checked }))} /> {form.isPosting ? text.acceptsPosting : text.groupOnly}</label></form></BaseerDialog>
    <BaseerConfirmDialog open={Boolean(archiveTarget)} language={language} busy={saving} destructive title={text.archiveTitle} message={text.archiveMessage} confirmLabel={text.archiveCategory} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archive()} />
  </section>;
}

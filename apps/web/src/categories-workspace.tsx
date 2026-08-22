import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { presentBaseerApiError } from "./baseer-api-error";
import { displayName, localizedEnum } from "./baseer-localization";
import { uiCopy } from "./baseer-ui-copy";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { categoryText } from "./categories-copy";
import { FinanceCategoryTree, type FinanceCategoryKind, type FinanceCategoryTreeItem } from "./finance-category-tree";

export type CategoryKind = FinanceCategoryKind;
export type Category = FinanceCategoryTreeItem & { suggestedSupplierId: string | null };
export type Supplier = { id: string; nameAr: string; nameEn: string | null; supplierType: "PURCHASE" | "EXPENSE"; status: "ACTIVE" };
type Configuration = { categories: Category[]; suppliers: Supplier[] };
export type CategoryForm = { code: string; nameAr: string; nameEn: string; kind: CategoryKind; parentId: string; suggestedSupplierId: string; isPosting: boolean };
const blankForm = (): CategoryForm => ({ code: "", nameAr: "", nameEn: "", kind: "PURCHASE", parentId: "", suggestedSupplierId: "", isPosting: true });
const LazyFinanceCategoryFormDialog = lazy(async () => ({ default: (await import("./finance-category-form-dialog")).FinanceCategoryFormDialog }));

export function CategoriesWorkspace({ language }: { language: "ar" | "en" }) {
  const text = categoryText(language);
  const shared = uiCopy(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
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
  const [form, setForm] = useState<CategoryForm>(blankForm);

  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await api<Configuration>(current, "/finance/configuration");
      setCategories(result.categories); setSuppliers(result.suppliers);
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
  const clearFilters = () => { setSearch(""); setShowArchived(false); };
  const appliedFilters = [
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
    ...(showArchived ? [{ id: "archived", label: text.showArchived, onRemove: () => setShowArchived(false) }] : []),
  ];
  const openDialog = (item?: Category) => {
    setEditing(item ?? null);
    setForm(item ? { code: item.code, nameAr: item.nameAr, nameEn: item.nameEn, kind: item.kind, parentId: item.parentId ?? "", suggestedSupplierId: item.suggestedSupplierId ?? "", isPosting: item.isPosting } : blankForm());
    setDialogOpen(true);
  };
  const save = async (nextForm: CategoryForm) => {
    const current = activeSession();
    if (!current || saving) return;
    setSaving(true); setMessage({ kind: "idle", text: "" });
    const payload = { ...nextForm, parentId: nextForm.parentId || undefined, suggestedSupplierId: nextForm.isPosting ? nextForm.suggestedSupplierId || undefined : undefined, idempotencyKey: requestId() };
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
    <BaseerBatchPanel id={`finance-category-kind-panel-${kind}`} labelledBy={`finance-category-kind-${kind}`}><BaseerFilterBar controlsPresentation="menu" language={language} search={search} searchLabel={text.search} searchPlaceholder={text.search} onSearchChange={setSearch} appliedFilters={appliedFilters} onClear={clearFilters} controls={<BaseerFilterToggle label={text.showArchived} checked={showArchived} onChange={setShowArchived} />} />{loading ? <p>{text.loading}</p> : visible.length ? <FinanceCategoryTree key={kind} language={language} categories={visible} onOpen={(item) => setDetails(categories.find((category) => category.id === item.id) ?? null)} /> : <p>{text.noResults}</p>}</BaseerBatchPanel>
    <BaseerDialog open={details !== null} title={details ? displayName(language, details) : text.title} language={language} busy={saving} onClose={() => setDetails(null)} footer={details ? <><BaseerButton type="button" variant="secondary" disabled={details.status !== "ACTIVE"} onClick={() => { const item = details; setDetails(null); openDialog(item); }}>{text.edit}</BaseerButton>{details.status === "ACTIVE" ? <BaseerButton type="button" variant="danger" onClick={() => { setArchiveTarget(details); setDetails(null); }}>{text.archive}</BaseerButton> : null}</> : null}>{details ? <div className="administration-list"><article><strong>{text.code}: {details.code}</strong><span>{text.kind}: {localizedEnum(language, details.kind)}</span><span>{text.parent}: {details.parentId ? displayName(language, categories.find((item) => item.id === details.parentId) ?? { nameAr: "—", nameEn: "—" }) : text.noParent}</span><span>{text.suggestedSupplier}: {details.suggestedSupplierId ? displayName(language, suppliers.find((item) => item.id === details.suggestedSupplierId) ?? { nameAr: "—", nameEn: "—" }) : text.noSuggestedSupplier}</span><span>{details.isPosting ? text.acceptsPosting : text.groupOnly}</span><span>{details.status === "ACTIVE" ? text.active : text.archived}</span></article></div> : null}</BaseerDialog>
    <Suspense fallback={null}><LazyFinanceCategoryFormDialog open={dialogOpen} language={language} busy={saving} value={form} editing={editing} categories={categories} suppliers={suppliers} onClose={() => { setDialogOpen(false); setEditing(null); }} onSubmit={save} /></Suspense>
    <BaseerConfirmDialog open={Boolean(archiveTarget)} language={language} busy={saving} destructive title={text.archiveTitle} message={text.archiveMessage} confirmLabel={text.archiveCategory} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archive()} />
  </section>;
}

import { useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterSelect, BaseerFilterToggle } from "./baseer-filter-controls";
import { DataTable, type DataTableColumn } from "./data-table";
import { BaseerDatePicker } from "./baseer-date-picker";
import { presentBaseerApiError } from "./baseer-api-error";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { displayName, localizedEnum } from "./baseer-localization";
import { financeText } from "./finance-copy";

type SupplierRecord = { id: string; nameAr: string; nameEn: string | null; phone: string | null; taxNumber: string | null; isTaxRegistered: boolean; supplierType: "PURCHASE" | "EXPENSE"; status: "ACTIVE" | "ARCHIVED"; categoryId: string | null };
type SupplierForm = { nameAr: string; nameEn: string; phone: string; taxNumber: string; supplierType: "PURCHASE" | "EXPENSE"; categoryId: string; isTaxRegistered: boolean };
type Configuration = { profile: { baseSeedVersion: number; accountingMode: string; vatAccountingEnabled: boolean; initializedAt: string } | null; periods: Array<{ id: string; nameAr: string; nameEn: string; startDate: string; endDate: string; status: "OPEN" | "CLOSED" | "LOCKED" }>; vaults: Array<{ id: string; nameAr: string; nameEn: string; type: "CASH" | "BANK" | "APP"; status: "ACTIVE" | "ARCHIVED"; isSalesChannel: boolean; isPaymentDestination: boolean }>; categories: Array<{ id: string; code: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" | "SALE"; status: "ACTIVE" | "ARCHIVED"; parentId: string | null; isPosting: boolean }>; suppliers: SupplierRecord[]; standardSuppliers: Array<{ key: string; nameAr: string; nameEn: string }> };
type VaultChoice = "CASH" | "BANK" | "HUNGERSTATION" | "JAHEZ" | "KEETA";
const BASE_FINANCE_SEED_VERSION = 7;
const vaultChoices: Array<{ value: VaultChoice; nameAr: string; nameEn: string }> = [{ value: "CASH", nameAr: "نقد", nameEn: "Cash" }, { value: "BANK", nameAr: "بنك", nameEn: "Bank" }, { value: "HUNGERSTATION", nameAr: "هنقرستيشن", nameEn: "HungerStation" }, { value: "JAHEZ", nameAr: "جاهز", nameEn: "Jahez" }, { value: "KEETA", nameAr: "كيتا", nameEn: "Keeta" }];
const dateValue = (offset = 0) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };

export function FinanceSetupWorkspace({ language, view = "setup" }: { language: "ar" | "en"; view?: "setup" | "suppliers" }) {
  const text = financeText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [form, setForm] = useState({ nameAr: "الفترة المالية الحالية", nameEn: "Current fiscal period", startDate: dateValue(-30), endDate: dateValue(), selectedVaults: ["CASH", "BANK"] as VaultChoice[], selectedStandardSupplierKeys: [] as string[] });
  const [categoryForm, setCategoryForm] = useState({ code: "", nameAr: "", nameEn: "", kind: "PURCHASE" as "PURCHASE" | "EXPENSE" | "SALE", parentId: "" });
  const [supplierForm, setSupplierForm] = useState<SupplierForm>({ nameAr: "", nameEn: "", phone: "", taxNumber: "", supplierType: "PURCHASE", categoryId: "", isTaxRegistered: false });
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);
  const [supplierDetails, setSupplierDetails] = useState<SupplierRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SupplierRecord | null>(null);
  const [selectedStandardSupplierKeys, setSelectedStandardSupplierKeys] = useState<string[]>([]);
  const load = useCallback(async () => { const current = activeSession(); setSession(current); if (!current) return; setConfiguration(await api<Configuration>(current, "/finance/configuration")); }, []);
  useEffect(() => { void load().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.loadingFinanceSetup) })); }, [language, load]);
  const activeCategories = useMemo(() => configuration?.categories.filter((item) => item.status === "ACTIVE") ?? [], [configuration]);
  const activeSuppliers = useMemo(() => configuration?.suppliers.filter((item) => item.status === "ACTIVE") ?? [], [configuration]);
  const postingCategories = useMemo(() => activeCategories.filter((item) => item.isPosting !== false), [activeCategories]);
  const categoryRows = useMemo(() => { const children = new Map<string, typeof activeCategories>(); for (const item of activeCategories) { if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]); } return activeCategories.filter((item) => !item.parentId).flatMap((parent) => [parent, ...(children.get(parent.id) ?? [])]); }, [activeCategories]);
  const setup = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); setMessage({ kind: "idle", text: "" }); try { await api(current, "/finance/company-setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fiscalPeriodNameAr: form.nameAr, fiscalPeriodNameEn: form.nameEn, fiscalPeriodStartDate: form.startDate, fiscalPeriodEndDate: form.endDate, selectedVaults: form.selectedVaults, selectedStandardSupplierKeys: form.selectedStandardSupplierKeys, idempotencyKey: requestId() }) }); setMessage({ kind: "success", text: text.financeSetupReady }); await load(); } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.noFinanceSetup) }); } finally { setSaving(false); } };
  const refreshFoundation = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await api(current, "/finance/company-setup/refresh-foundation", { method: "POST" }); setMessage({ kind: "success", text: text.financeSeedUpdated }); await load(); } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.updateFinanceSeed) }); } finally { setSaving(false); } };
  const syncStandardSuppliers = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving || !selectedStandardSupplierKeys.length) return; setSaving(true); try { const receipt = await api<{ supplierIds: string[]; taxNumbersUpdated: number }>(current, "/finance/company-setup/standard-suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedStandardSupplierKeys, idempotencyKey: requestId() }) }); setMessage({ kind: "success", text: text.standardSuppliersSynced(receipt.supplierIds.length) }); setSelectedStandardSupplierKeys([]); await load(); } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.standardSuppliers) }); } finally { setSaving(false); } };  const createCategory = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); try { await api(current, "/finance/master-data/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...categoryForm, parentId: categoryForm.parentId || undefined, idempotencyKey: requestId() }) }); setCategoryForm({ code: "", nameAr: "", nameEn: "", kind: "PURCHASE", parentId: "" }); setMessage({ kind: "success", text: text.categorySaved }); await load(); } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.categories) }); } finally { setSaving(false); } };
  const openSupplierDialog = (supplier?: SupplierRecord) => {
    setEditingSupplier(supplier ?? null);
    setSupplierForm(supplier ? { nameAr: supplier.nameAr, nameEn: supplier.nameEn ?? "", phone: supplier.phone ?? "", taxNumber: supplier.taxNumber ?? "", supplierType: supplier.supplierType, categoryId: supplier.categoryId ?? "", isTaxRegistered: supplier.isTaxRegistered } : { nameAr: "", nameEn: "", phone: "", taxNumber: "", supplierType: "PURCHASE", categoryId: "", isTaxRegistered: false });
    setSupplierDialogOpen(true);
  };
  const saveSupplier = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || saving) return; if (!supplierForm.categoryId) { setMessage({ kind: "error", text: text.selectCategory }); return; } setSaving(true);
    try {
      const payload = { nameAr: supplierForm.nameAr, nameEn: supplierForm.nameEn || undefined, phone: supplierForm.phone || undefined, taxNumber: supplierForm.taxNumber || undefined, supplierType: supplierForm.supplierType, categoryId: supplierForm.categoryId, isTaxRegistered: supplierForm.isTaxRegistered, idempotencyKey: requestId() };
      await api(current, editingSupplier ? "/finance/master-data/suppliers/update" : "/finance/master-data/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingSupplier ? { ...payload, supplierId: editingSupplier.id } : payload) });
      setMessage({ kind: "success", text: text.supplierSaved }); setSupplierDialogOpen(false); setEditingSupplier(null); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.suppliers) }); } finally { setSaving(false); }
  };
  const archiveSupplier = async () => {
    const current = activeSession(); if (!current || !archiveTarget || saving) return; setSaving(true);
    try { await api(current, "/finance/master-data/suppliers/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId: archiveTarget.id, idempotencyKey: requestId() }) }); setMessage({ kind: "success", text: text.archiveSuccess }); setArchiveTarget(null); await load(); }
    catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.archive) }); } finally { setSaving(false); }
  };
  if (!session) return <DailySalesSignIn language={language} />;
  if (view === "suppliers") return <SuppliersWorkspacePanel language={language} configuration={configuration} loading={!configuration} saving={saving} message={message} form={supplierForm} editingSupplier={editingSupplier} supplierDetails={supplierDetails} dialogOpen={supplierDialogOpen} archiveTarget={archiveTarget} onOpen={openSupplierDialog} onOpenDetails={setSupplierDetails} onClose={() => { setSupplierDialogOpen(false); setEditingSupplier(null); }} onCloseDetails={() => setSupplierDetails(null)} onChange={setSupplierForm} onSave={saveSupplier} onArchiveRequest={setArchiveTarget} onArchiveCancel={() => setArchiveTarget(null)} onArchive={archiveSupplier} />;
  return <section className="daily-sales-workspace finance-setup-workspace" aria-label={text.setup}><header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.setup}</h3></div></header>{message.kind !== "idle" && <p className={`daily-sales-message ${message.kind}`}>{message.text}</p>}{!configuration ? <BaseerCard><p>{text.loadingCompanySetup}</p></BaseerCard> : !configuration.profile ? <BaseerCard><form className="administration-form" onSubmit={(event) => void setup(event)}><h3>{text.initialiseFinance}</h3><label>{text.periodNameArabic}<input required value={form.nameAr} onChange={(event) => setForm((value) => ({ ...value, nameAr: event.target.value }))} /></label><label>{text.periodNameEnglish}<input required value={form.nameEn} onChange={(event) => setForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label>{text.periodStart}<BaseerDatePicker language={language} label={text.periodStart} max={dateValue()} value={form.startDate} onChange={(startDate) => setForm((value) => ({ ...value, startDate }))} /></label><label>{text.periodEnd}<BaseerDatePicker language={language} label={text.periodEnd} max={dateValue()} min={form.startDate} value={form.endDate} onChange={(endDate) => setForm((value) => ({ ...value, endDate }))} /></label><fieldset className="finance-setup-choices"><legend>{text.initialVaults}</legend>{vaultChoices.map((choice) => <label key={choice.value}><input type="checkbox" checked={form.selectedVaults.includes(choice.value)} onChange={(event) => setForm((value) => ({ ...value, selectedVaults: event.target.checked ? [...value.selectedVaults, choice.value] : value.selectedVaults.filter((item) => item !== choice.value) }))} /> {displayName(language, choice)}</label>)}</fieldset><fieldset className="finance-setup-choices"><legend>{text.optionalStandardSuppliers}</legend>{(configuration.standardSuppliers ?? []).map((choice) => <label key={choice.key}><input type="checkbox" checked={form.selectedStandardSupplierKeys.includes(choice.key)} onChange={(event) => setForm((value) => ({ ...value, selectedStandardSupplierKeys: event.target.checked ? [...value.selectedStandardSupplierKeys, choice.key] : value.selectedStandardSupplierKeys.filter((item) => item !== choice.key) }))} /> {displayName(language, choice)}</label>)}</fieldset><BaseerButton variant="primary" disabled={saving || !form.selectedVaults.length}>{saving ? text.saving : text.saveFinanceSetup}</BaseerButton></form></BaseerCard> : <><div className="baseer-card-grid finance-setup-readiness"><BaseerCard><span>{text.currentPeriod}</span><strong>{configuration.periods.find((item) => item.status === "OPEN") ? displayName(language, configuration.periods.find((item) => item.status === "OPEN") ?? { nameAr: language === "ar" ? "لا توجد فترة مفتوحة" : "No open period" }) : (language === "ar" ? "لا توجد فترة مفتوحة" : "No open period")}</strong></BaseerCard><BaseerCard><span>{text.activeVaults}</span><strong>{configuration.vaults.filter((item) => item.status === "ACTIVE").length}</strong></BaseerCard><BaseerCard><span>{text.activeCategories}</span><strong>{activeCategories.length}</strong></BaseerCard><BaseerCard><span>{text.activeSuppliers}</span><strong>{activeSuppliers.length}</strong></BaseerCard></div>{configuration.profile.baseSeedVersion < BASE_FINANCE_SEED_VERSION && <BaseerCard><h3>{text.seedUpdate}</h3><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => void refreshFoundation()}>{text.updateFinanceSeed}</BaseerButton></BaseerCard>}<BaseerCard><h3>{text.standardSuppliers}</h3><form className="finance-setup-choices" onSubmit={(event) => void syncStandardSuppliers(event)}><fieldset><legend>{text.chooseSuppliers}</legend>{(configuration.standardSuppliers ?? []).map((choice) => <label key={choice.key}><input type="checkbox" checked={selectedStandardSupplierKeys.includes(choice.key)} onChange={(event) => setSelectedStandardSupplierKeys((value) => event.target.checked ? [...value, choice.key] : value.filter((item) => item !== choice.key))} /> {displayName(language, choice)}</label>)}</fieldset><BaseerButton variant="secondary" disabled={saving || !selectedStandardSupplierKeys.length}>{saving ? text.savingSuppliers : text.addSelectedSuppliers}</BaseerButton></form></BaseerCard><BaseerCard><h3>{text.categories}</h3><div className="administration-list">{categoryRows.map((category) => <article key={category.id}><strong>{category.parentId ? "↳ " : ""}{displayName(language, category)}</strong><span>{category.code}</span><span>{category.isPosting !== false ? text.postingCategory : text.mainGroup}</span></article>)}</div><form className="administration-form" onSubmit={(event) => void createCategory(event)}><label>{text.categoryCode}<input required value={categoryForm.code} onChange={(event) => setCategoryForm((value) => ({ ...value, code: event.target.value }))} /></label><label>{text.nameArabic}<input required value={categoryForm.nameAr} onChange={(event) => setCategoryForm((value) => ({ ...value, nameAr: event.target.value }))} /></label><label>{text.nameEnglish}<input required value={categoryForm.nameEn} onChange={(event) => setCategoryForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label>{text.vaultType}<select value={categoryForm.kind} onChange={(event) => setCategoryForm((value) => ({ ...value, kind: event.target.value as typeof value.kind, parentId: "" }))}><option value="PURCHASE">{localizedEnum(language, "PURCHASE")}</option><option value="EXPENSE">{localizedEnum(language, "EXPENSE")}</option><option value="SALE">{localizedEnum(language, "SALE")}</option></select></label><label>{text.categoryParent}<select value={categoryForm.parentId} onChange={(event) => setCategoryForm((value) => ({ ...value, parentId: event.target.value }))}><option value="">{text.noParent}</option>{activeCategories.filter((item) => !item.isPosting && item.kind === categoryForm.kind).map((category) => <option key={category.id} value={category.id}>{displayName(language, category)}</option>)}</select></label><BaseerButton variant="secondary" disabled={saving}>{text.add} {text.categories}</BaseerButton></form></BaseerCard><BaseerCard><h3>{text.suppliers}</h3><strong>{activeSuppliers.length}</strong></BaseerCard></>}</section>;
}

function SuppliersWorkspacePanel({
  language,
  configuration,
  loading,
  saving,
  message,
  form,
  editingSupplier,
  supplierDetails,
  dialogOpen,
  archiveTarget,

  onOpen,
  onOpenDetails,
  onClose,
  onCloseDetails,
  onChange,
  onSave,
  onArchiveRequest,
  onArchiveCancel,
  onArchive,
}: {
  language: "ar" | "en";
  configuration: Configuration | null;
  loading: boolean;
  saving: boolean;
  message: { kind: "idle" | "success" | "error"; text: string };
  form: SupplierForm;
  editingSupplier: SupplierRecord | null;
  supplierDetails: SupplierRecord | null;
  dialogOpen: boolean;
  archiveTarget: SupplierRecord | null;
onOpen: (supplier?: SupplierRecord) => void;
  onOpenDetails: (supplier: SupplierRecord) => void;
  onClose: () => void;
  onCloseDetails: () => void;
  onChange: (value: SupplierForm) => void;
  onSave: (event: React.FormEvent) => Promise<void>;
  onArchiveRequest: (supplier: SupplierRecord) => void;
  onArchiveCancel: () => void;
  onArchive: () => Promise<void>;
}) {
  const text = financeText(language);
  const activeCategories = configuration?.categories.filter((item) => item.status === "ACTIVE" && item.isPosting) ?? [];
  const categoriesForType = activeCategories.filter((category) => category.kind === form.supplierType);
  const categoryNames = new Map(activeCategories.map((item) => [item.id, displayName(language, item)]));
  const suppliers = configuration?.suppliers ?? [];
  const [search, setSearch] = useState("");
  const [supplierType, setSupplierType] = useState<"ALL" | SupplierRecord["supplierType"]>("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const visibleSuppliers = suppliers.filter((supplier) => {
    const term = search.trim().toLocaleLowerCase();
    return (showArchived || supplier.status === "ACTIVE") && (supplierType === "ALL" || supplier.supplierType === supplierType) && (!term || `${supplier.nameAr} ${supplier.nameEn ?? ""} ${supplier.taxNumber ?? ""} ${supplier.phone ?? ""}`.toLocaleLowerCase().includes(term));
  });
  const clearFilters = () => { setSearch(""); setSupplierType("ALL"); setShowArchived(false); };
  const appliedFilters = [
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
    ...(supplierType !== "ALL" ? [{ id: "type", label: supplierType === "PURCHASE" ? text.purchaseInvoice : text.expenseInvoice, onRemove: () => setSupplierType("ALL") }] : []),
    ...(showArchived ? [{ id: "archived", label: text.showArchived, onRemove: () => setShowArchived(false) }] : []),
  ];
  const columns: readonly DataTableColumn<SupplierRecord>[] = [
    { id: "supplier", header: text.supplier, sort: (supplier) => displayName(language, supplier), cell: (supplier) => <button className="administration-table-user" type="button" onClick={() => onOpenDetails(supplier)}>{displayName(language, supplier)}</button> },
    { id: "type", header: text.invoiceType, sort: (supplier) => supplier.supplierType, cell: (supplier) => supplier.supplierType === "PURCHASE" ? text.purchaseInvoice : text.expenseInvoice, align: "center" },
    { id: "category", header: text.defaultCategory, sort: (supplier) => supplier.categoryId ? categoryNames.get(supplier.categoryId) ?? "" : "", cell: (supplier) => supplier.categoryId ? categoryNames.get(supplier.categoryId) ?? "—" : "—" },
    { id: "tax", header: text.taxNumber, sort: (supplier) => supplier.taxNumber, cell: (supplier) => supplier.taxNumber ?? "—" },
    { id: "phone", header: text.phone, sort: (supplier) => supplier.phone, cell: (supplier) => supplier.phone ?? "—" },
    { id: "status", header: text.status, sort: (supplier) => supplier.status, cell: (supplier) => supplier.status === "ACTIVE" ? text.active : text.archive, align: "center" },
  ];
  return <section className="daily-sales-workspace finance-setup-workspace" aria-label={text.suppliers}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.operations}</p><h3>{text.suppliers}</h3></div><div className="baseer-inline-actions"><BaseerButton type="button" variant="primary" onClick={() => onOpen()}>{text.add} {text.supplier}</BaseerButton></div></header>
    {message.kind !== "idle" ? <p className={`daily-sales-message ${message.kind}`}>{message.text}</p> : null}
    {loading ? <BaseerCard><p>{text.loadingCompanySetup}</p></BaseerCard> : !configuration?.profile ? <BaseerCard><p>{text.setupRequired}</p></BaseerCard> : <BaseerCard><BaseerFilterBar controlsPresentation="menu" language={language} search={search} searchLabel={text.suppliers} searchPlaceholder={language === "ar" ? "ابحث باسم المورد أو الرقم الضريبي" : "Search supplier or tax number"} onSearchChange={setSearch} appliedFilters={appliedFilters} onClear={clearFilters} controls={<><BaseerFilterSelect label={text.invoiceType} value={supplierType} onChange={(event) => setSupplierType(event.target.value as typeof supplierType)}><option value="ALL">{text.all}</option><option value="PURCHASE">{text.purchaseInvoice}</option><option value="EXPENSE">{text.expenseInvoice}</option></BaseerFilterSelect><BaseerFilterToggle label={text.showArchived} checked={showArchived} onChange={setShowArchived} /></>} />{visibleSuppliers.length ? <DataTable ariaLabel={text.suppliers} caption={text.suppliers} columns={columns} rows={visibleSuppliers} rowKey={(supplier) => supplier.id} /> : <p className="empty-results">{text.noResults}</p>}</BaseerCard>}
    <BaseerDialog open={supplierDetails !== null} title={supplierDetails ? displayName(language, supplierDetails) : text.supplier} language={language} busy={saving} onClose={onCloseDetails} footer={supplierDetails ? <><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => { const supplier = supplierDetails; onCloseDetails(); onOpen(supplier); }}>{text.edit}</BaseerButton>{supplierDetails.status === "ACTIVE" ? <BaseerButton type="button" variant="danger" disabled={saving} onClick={() => { onArchiveRequest(supplierDetails); onCloseDetails(); }}>{text.archive}</BaseerButton> : null}</> : null}>
      {supplierDetails ? <div className="administration-list"><article><span>{text.invoiceType}: {supplierDetails.supplierType === "PURCHASE" ? text.purchaseInvoice : text.expenseInvoice}</span><span>{text.defaultCategory}: {supplierDetails.categoryId ? categoryNames.get(supplierDetails.categoryId) ?? "—" : "—"}</span><span>{text.phone}: {supplierDetails.phone ?? "—"}</span><span>{text.taxNumber}: {supplierDetails.taxNumber ?? "—"}</span><span>{text.taxRegistered}: {supplierDetails.isTaxRegistered ? "✓" : "—"}</span><span>{text.status}: {supplierDetails.status === "ACTIVE" ? text.active : text.archive}</span></article></div> : null}
    </BaseerDialog>
    <BaseerDialog open={dialogOpen} title={`${editingSupplier ? text.edit : text.add} ${text.supplier}`} language={language} busy={saving} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" disabled={saving} onClick={onClose}>{text.cancel}</BaseerButton><BaseerButton type="submit" form="baseer-supplier-form" variant="primary" disabled={saving}>{saving ? text.saving : text.save}</BaseerButton></>}>
      <form id="baseer-supplier-form" className="administration-form" onSubmit={(event) => void onSave(event)}>
        <label>{text.nameArabic}<input required value={form.nameAr} onChange={(event) => onChange({ ...form, nameAr: event.target.value })} /></label>
        <label>{text.nameEnglish}<input value={form.nameEn} onChange={(event) => onChange({ ...form, nameEn: event.target.value })} /></label>
        <label>{text.phone}<input inputMode="tel" value={form.phone} onChange={(event) => onChange({ ...form, phone: event.target.value })} /></label>
        <label>{text.taxNumber}<input value={form.taxNumber} onChange={(event) => onChange({ ...form, taxNumber: event.target.value })} /></label>
        <label>{text.invoiceType}<select value={form.supplierType} onChange={(event) => onChange({ ...form, supplierType: event.target.value as SupplierForm["supplierType"], categoryId: "" })}><option value="PURCHASE">{text.purchaseInvoice}</option><option value="EXPENSE">{text.expenseInvoice}</option></select></label>
        <label>{text.defaultCategory}<select required value={form.categoryId} onChange={(event) => onChange({ ...form, categoryId: event.target.value })}><option value="">{text.selectCategory}</option>{categoriesForType.map((category) => <option value={category.id} key={category.id}>{displayName(language, category)}</option>)}</select></label>
        <label><input type="checkbox" checked={form.isTaxRegistered} onChange={(event) => onChange({ ...form, isTaxRegistered: event.target.checked })} /> {text.taxRegistered}</label>
      </form>
    </BaseerDialog>
    <BaseerConfirmDialog open={archiveTarget !== null} title={text.archive} message={archiveTarget ? `${text.archive}: ${displayName(language, archiveTarget)}. ${text.archiveConfirmation}` : ""} confirmLabel={text.archive} destructive busy={saving} language={language} onCancel={onArchiveCancel} onConfirm={() => void onArchive()} />
  </section>;
}

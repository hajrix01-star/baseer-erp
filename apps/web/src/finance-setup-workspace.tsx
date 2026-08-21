import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterSelect, BaseerFilterToggle } from "./baseer-filter-controls";
import { DataTable, type DataTableColumn } from "./data-table";
import { BaseerStepper } from "./baseer-stepper";
import { presentBaseerApiError } from "./baseer-api-error";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { displayName, localizedEnum } from "./baseer-localization";
import { financeText } from "./finance-copy";
import { uiCopy } from "./baseer-ui-copy";

type SupplierRecord = { id: string; nameAr: string; nameEn: string | null; phone: string | null; taxNumber: string | null; isTaxRegistered: boolean; supplierType: "PURCHASE" | "EXPENSE"; status: "ACTIVE" | "ARCHIVED"; categoryId: string | null };
type SupplierForm = { nameAr: string; nameEn: string; phone: string; taxNumber: string; supplierType: "PURCHASE" | "EXPENSE"; categoryId: string; isTaxRegistered: boolean };
type InitialFinanceForm = { nameAr: string; nameEn: string; startDate: string; endDate: string; selectedVaults: VaultChoice[]; selectedStandardSupplierKeys: string[] };
type Configuration = { profile: { baseSeedVersion: number; accountingMode: string; vatAccountingEnabled: boolean; initializedAt: string } | null; periods: Array<{ id: string; nameAr: string; nameEn: string; startDate: string; endDate: string; status: "OPEN" | "CLOSED" | "LOCKED" }>; vaults: Array<{ id: string; nameAr: string; nameEn: string; type: "CASH" | "BANK" | "APP"; status: "ACTIVE" | "ARCHIVED"; isSalesChannel: boolean; isPaymentDestination: boolean }>; categories: Array<{ id: string; code: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" | "SALE"; status: "ACTIVE" | "ARCHIVED"; parentId: string | null; isPosting: boolean }>; suppliers: SupplierRecord[]; standardSuppliers: Array<{ key: string; nameAr: string; nameEn: string }> };
type FinanceReadiness = { companyId: string; requiredBaseSeedVersion: number; profile: { baseSeedVersion: number; accountingMode: string; vatAccountingEnabled: boolean; vatRateBasisPoints: number; initializedAt: string } | null; openPeriod: { id: string; nameAr: string; nameEn: string; startDate: string; endDate: string; status: "OPEN" } | null; counts: { activeVaults: number; activeAccounts: number; activeCategories: number; activeSuppliers: number }; issues: Array<"FINANCE_NOT_INITIALIZED" | "NO_OPEN_PERIOD" | "NO_ACTIVE_VAULT" | "NO_POSTING_CATEGORY">; standardSuppliers: Array<{ key: string; nameAr: string; nameEn: string }> };
type VaultChoice = "CASH" | "BANK" | "HUNGERSTATION" | "JAHEZ" | "KEETA";
// Referenced only by a retired, unreachable legacy branch kept temporarily for
// source compatibility. The live workspace uses requiredBaseSeedVersion from API.
const BASE_FINANCE_SEED_VERSION = 8;
const vaultChoices: Array<{ value: VaultChoice; nameAr: string; nameEn: string }> = [{ value: "CASH", nameAr: "نقد", nameEn: "Cash" }, { value: "BANK", nameAr: "بنك", nameEn: "Bank" }, { value: "HUNGERSTATION", nameAr: "هنقرستيشن", nameEn: "HungerStation" }, { value: "JAHEZ", nameAr: "جاهز", nameEn: "Jahez" }, { value: "KEETA", nameAr: "كيتا", nameEn: "Keeta" }];
const dateValue = (offset = 0) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };
const LazyBaseerDatePicker = lazy(async () => ({ default: (await import("./baseer-date-picker")).BaseerDatePicker }));

/** The calendar control is fetched only when the finance setup form renders. */
function BaseerDatePicker(props: ComponentProps<typeof LazyBaseerDatePicker>) {
  return <Suspense fallback={<input aria-label={props.label} type="date" value={props.value} min={props.min} max={props.max} disabled />}><LazyBaseerDatePicker {...props} /></Suspense>;
}

export function FinanceSetupWorkspace({ language, view = "setup" }: { language: "ar" | "en"; view?: "setup" | "suppliers" }) {
  const text = financeText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [configurationState, setConfiguration] = useState<Configuration | null>(null);
  const configuration = configurationState as Configuration & { profile: NonNullable<Configuration["profile"]> };
  const [readiness, setReadiness] = useState<FinanceReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [form, setForm] = useState<InitialFinanceForm>({ nameAr: "الفترة المالية الحالية", nameEn: "Current fiscal period", startDate: dateValue(-30), endDate: dateValue(), selectedVaults: ["CASH", "BANK"], selectedStandardSupplierKeys: [] });
  const [categoryForm, setCategoryForm] = useState({ code: "", nameAr: "", nameEn: "", kind: "PURCHASE" as "PURCHASE" | "EXPENSE" | "SALE", parentId: "" });
  const [supplierForm, setSupplierForm] = useState<SupplierForm>({ nameAr: "", nameEn: "", phone: "", taxNumber: "", supplierType: "PURCHASE", categoryId: "", isTaxRegistered: false });
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);
  const [supplierDetails, setSupplierDetails] = useState<SupplierRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SupplierRecord | null>(null);
  const [selectedStandardSupplierKeys, setSelectedStandardSupplierKeys] = useState<string[]>([]);
  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) { setReadinessLoading(false); return; }
    setReadinessLoading(true);
    try {
      if (view === "suppliers") {
        setConfiguration(await api<Configuration>(current, "/finance/configuration"));
        return;
      }
      setReadiness(await api<FinanceReadiness>(current, "/finance/configuration/readiness"));
    } finally {
      setReadinessLoading(false);
    }
  }, [view]);
  useEffect(() => { void load().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.loadingFinanceSetup) })); }, [language, load]);
  const activeCategories = useMemo(() => configuration?.categories.filter((item) => item.status === "ACTIVE") ?? [], [configuration]);
  const activeSuppliers = useMemo(() => configuration?.suppliers.filter((item) => item.status === "ACTIVE") ?? [], [configuration]);
  const postingCategories = useMemo(() => activeCategories.filter((item) => item.isPosting !== false), [activeCategories]);
  const categoryRows = useMemo(() => { const children = new Map<string, typeof activeCategories>(); for (const item of activeCategories) { if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]); } return activeCategories.filter((item) => !item.parentId).flatMap((parent) => [parent, ...(children.get(parent.id) ?? [])]); }, [activeCategories]);
  const setup = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); setMessage({ kind: "idle", text: "" }); try { await api(current, "/finance/company-setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fiscalPeriodNameAr: form.nameAr, fiscalPeriodNameEn: form.nameEn, fiscalPeriodStartDate: form.startDate, fiscalPeriodEndDate: form.endDate, selectedVaults: form.selectedVaults, selectedStandardSupplierKeys: form.selectedStandardSupplierKeys, idempotencyKey: requestId() }) }); setMessage({ kind: "success", text: text.financeSetupReady }); await load(); } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.noFinanceSetup) }); } finally { setSaving(false); } };
  const refreshFoundation = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await api(current, "/finance/company-setup/refresh-foundation", { method: "POST" }); setMessage({ kind: "success", text: text.financeSeedUpdated }); await load(); } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.updateFinanceSeed) }); } finally { setSaving(false); } };
  const addStandardSuppliers = async (supplierKeys: string[]): Promise<boolean> => { const current = activeSession(); if (!current || saving || !supplierKeys.length) return false; setSaving(true); try { const receipt = await api<{ supplierIds: string[] }>(current, "/finance/company-setup/standard-suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedStandardSupplierKeys: supplierKeys, idempotencyKey: requestId() }) }); setMessage({ kind: "success", text: text.standardSuppliersSynced(receipt.supplierIds.length) }); await load(); return true; } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.standardSuppliers) }); return false; } finally { setSaving(false); } };
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
  if (!readiness) return <section className="daily-sales-workspace finance-setup-workspace" aria-label={text.setup}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.setup}</h3></div></header>
    <BaseerCard>
      {message.kind === "error" ? <>
        <p className="daily-sales-message error" role="alert">{message.text}</p>
        <BaseerButton type="button" variant="secondary" onClick={() => void load().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.loadingFinanceSetup) }))}>
          {language === "ar" ? "إعادة المحاولة" : "Retry"}
        </BaseerButton>
      </> : <p>{readinessLoading ? text.loadingCompanySetup : text.loadingFinanceSetup}</p>}
    </BaseerCard>
  </section>;
  if (!readiness.profile) return <InitialFinanceSetup language={language} text={text} form={form} saving={saving} standardSuppliers={readiness.standardSuppliers} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} onSubmit={setup} />;
  return <FinanceSettingsHub language={language} text={text} readiness={readiness} saving={saving} message={message} onRefreshFoundation={refreshFoundation} onAddStandardSuppliers={addStandardSuppliers} />;
  return <section className="daily-sales-workspace finance-setup-workspace" aria-label={text.setup}><header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.setup}</h3></div></header>{message.kind !== "idle" && <p className={`daily-sales-message ${message.kind}`}>{message.text}</p>}{!configuration ? <BaseerCard><p>{text.loadingCompanySetup}</p></BaseerCard> : !configuration.profile ? <BaseerCard><form className="administration-form" onSubmit={(event) => void setup(event)}><h3>{text.initialiseFinance}</h3><label>{text.periodNameArabic}<input required value={form.nameAr} onChange={(event) => setForm((value) => ({ ...value, nameAr: event.target.value }))} /></label><label>{text.periodNameEnglish}<input required value={form.nameEn} onChange={(event) => setForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label>{text.periodStart}<BaseerDatePicker language={language} label={text.periodStart} max={dateValue()} value={form.startDate} onChange={(startDate) => setForm((value) => ({ ...value, startDate }))} /></label><label>{text.periodEnd}<BaseerDatePicker language={language} label={text.periodEnd} max={dateValue()} min={form.startDate} value={form.endDate} onChange={(endDate) => setForm((value) => ({ ...value, endDate }))} /></label><fieldset className="finance-setup-choices"><legend>{text.initialVaults}</legend>{vaultChoices.map((choice) => <label key={choice.value}><input type="checkbox" checked={form.selectedVaults.includes(choice.value)} onChange={(event) => setForm((value) => ({ ...value, selectedVaults: event.target.checked ? [...value.selectedVaults, choice.value] : value.selectedVaults.filter((item) => item !== choice.value) }))} /> {displayName(language, choice)}</label>)}</fieldset><fieldset className="finance-setup-choices"><legend>{text.optionalStandardSuppliers}</legend>{(configuration.standardSuppliers ?? []).map((choice) => <label key={choice.key}><input type="checkbox" checked={form.selectedStandardSupplierKeys.includes(choice.key)} onChange={(event) => setForm((value) => ({ ...value, selectedStandardSupplierKeys: event.target.checked ? [...value.selectedStandardSupplierKeys, choice.key] : value.selectedStandardSupplierKeys.filter((item) => item !== choice.key) }))} /> {displayName(language, choice)}</label>)}</fieldset><BaseerButton variant="primary" disabled={saving || !form.selectedVaults.length}>{saving ? text.saving : text.saveFinanceSetup}</BaseerButton></form></BaseerCard> : <><div className="baseer-card-grid finance-setup-readiness"><BaseerCard><span>{text.currentPeriod}</span><strong>{configuration.periods.find((item) => item.status === "OPEN") ? displayName(language, configuration.periods.find((item) => item.status === "OPEN") ?? { nameAr: language === "ar" ? "لا توجد فترة مفتوحة" : "No open period" }) : (language === "ar" ? "لا توجد فترة مفتوحة" : "No open period")}</strong></BaseerCard><BaseerCard><span>{text.activeVaults}</span><strong>{configuration.vaults.filter((item) => item.status === "ACTIVE").length}</strong></BaseerCard><BaseerCard><span>{text.activeCategories}</span><strong>{activeCategories.length}</strong></BaseerCard><BaseerCard><span>{text.activeSuppliers}</span><strong>{activeSuppliers.length}</strong></BaseerCard></div>{configuration.profile.baseSeedVersion < BASE_FINANCE_SEED_VERSION && <BaseerCard><h3>{text.seedUpdate}</h3><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => void refreshFoundation()}>{text.updateFinanceSeed}</BaseerButton></BaseerCard>}<BaseerCard><h3>{text.standardSuppliers}</h3><form className="finance-setup-choices" onSubmit={(event) => void syncStandardSuppliers(event)}><fieldset><legend>{text.chooseSuppliers}</legend>{(configuration.standardSuppliers ?? []).map((choice) => <label key={choice.key}><input type="checkbox" checked={selectedStandardSupplierKeys.includes(choice.key)} onChange={(event) => setSelectedStandardSupplierKeys((value) => event.target.checked ? [...value, choice.key] : value.filter((item) => item !== choice.key))} /> {displayName(language, choice)}</label>)}</fieldset><BaseerButton variant="secondary" disabled={saving || !selectedStandardSupplierKeys.length}>{saving ? text.savingSuppliers : text.addSelectedSuppliers}</BaseerButton></form></BaseerCard><BaseerCard><h3>{text.categories}</h3><div className="administration-list">{categoryRows.map((category) => <article key={category.id}><strong>{category.parentId ? "↳ " : ""}{displayName(language, category)}</strong><span>{category.code}</span><span>{category.isPosting !== false ? text.postingCategory : text.mainGroup}</span></article>)}</div><form className="administration-form" onSubmit={(event) => void createCategory(event)}><label>{text.categoryCode}<input required value={categoryForm.code} onChange={(event) => setCategoryForm((value) => ({ ...value, code: event.target.value }))} /></label><label>{text.nameArabic}<input required value={categoryForm.nameAr} onChange={(event) => setCategoryForm((value) => ({ ...value, nameAr: event.target.value }))} /></label><label>{text.nameEnglish}<input required value={categoryForm.nameEn} onChange={(event) => setCategoryForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label>{text.vaultType}<select value={categoryForm.kind} onChange={(event) => setCategoryForm((value) => ({ ...value, kind: event.target.value as typeof value.kind, parentId: "" }))}><option value="PURCHASE">{localizedEnum(language, "PURCHASE")}</option><option value="EXPENSE">{localizedEnum(language, "EXPENSE")}</option><option value="SALE">{localizedEnum(language, "SALE")}</option></select></label><label>{text.categoryParent}<select value={categoryForm.parentId} onChange={(event) => setCategoryForm((value) => ({ ...value, parentId: event.target.value }))}><option value="">{text.noParent}</option>{activeCategories.filter((item) => !item.isPosting && item.kind === categoryForm.kind).map((category) => <option key={category.id} value={category.id}>{displayName(language, category)}</option>)}</select></label><BaseerButton variant="secondary" disabled={saving}>{text.add} {text.categories}</BaseerButton></form></BaseerCard><BaseerCard><h3>{text.suppliers}</h3><strong>{activeSuppliers.length}</strong></BaseerCard></>}</section>;
}

function InitialFinanceSetup({ language, text, form, saving, standardSuppliers, onChange, onSubmit }: {
  language: "ar" | "en";
  text: ReturnType<typeof financeText>;
  form: InitialFinanceForm;
  saving: boolean;
  standardSuppliers: Array<{ key: string; nameAr: string; nameEn: string }>;
  onChange: (patch: Partial<InitialFinanceForm>) => void;
  onSubmit: (event: React.FormEvent) => Promise<void>;
}) {
  const copy = uiCopy(language);
  const [step, setStep] = useState(0);
  const steps = [
    { id: "period", label: text.currentPeriod },
    { id: "vaults", label: text.initialVaults },
    { id: "suppliers", label: text.optionalStandardSuppliers },
    { id: "review", label: text.saveFinanceSetup },
  ];
  const canProceed = step === 0
    ? Boolean(form.nameAr.trim() && form.nameEn.trim() && form.startDate && form.endDate && form.startDate <= form.endDate)
    : step === 1 ? form.selectedVaults.length > 0 : true;
  const toggleVault = (vault: VaultChoice, checked: boolean) => onChange({ selectedVaults: checked ? [...form.selectedVaults, vault] : form.selectedVaults.filter((item) => item !== vault) });
  const toggleSupplier = (key: string, checked: boolean) => onChange({ selectedStandardSupplierKeys: checked ? [...form.selectedStandardSupplierKeys, key] : form.selectedStandardSupplierKeys.filter((item) => item !== key) });

  return <section className="daily-sales-workspace finance-setup-workspace" aria-label={text.setup}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.initialiseFinance}</h3></div></header>
    <BaseerCard>
      <form className="administration-form" onSubmit={(event) => void onSubmit(event)}>
        <BaseerStepper ariaLabel={text.initialiseFinance} steps={steps} activeStep={step} onStepChange={setStep} footer={<>
          <BaseerButton type="button" variant="secondary" disabled={step === 0 || saving} onClick={() => setStep((current) => current - 1)}>{copy.previous}</BaseerButton>
          {step === 2 ? <BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setStep(3)}>{language === "ar" ? "تخطي الموردين الآن" : "Skip suppliers for now"}</BaseerButton> : null}
          {step < steps.length - 1
            ? <BaseerButton type="button" variant="primary" disabled={!canProceed || saving} onClick={() => setStep((current) => current + 1)}>{copy.next}</BaseerButton>
            : <BaseerButton type="submit" variant="primary" disabled={saving || !form.selectedVaults.length}>{saving ? text.saving : text.saveFinanceSetup}</BaseerButton>}
        </>}>
          {step === 0 ? <div className="administration-form">
            <label>{text.periodNameArabic}<input required value={form.nameAr} onChange={(event) => onChange({ nameAr: event.target.value })} /></label>
            <label>{text.periodNameEnglish}<input required value={form.nameEn} onChange={(event) => onChange({ nameEn: event.target.value })} /></label>
            <label>{text.periodStart}<BaseerDatePicker language={language} label={text.periodStart} max={dateValue()} value={form.startDate} onChange={(startDate) => onChange({ startDate })} /></label>
            <label>{text.periodEnd}<BaseerDatePicker language={language} label={text.periodEnd} max={dateValue()} min={form.startDate} value={form.endDate} onChange={(endDate) => onChange({ endDate })} /></label>
          </div> : null}
          {step === 1 ? <fieldset className="finance-setup-choices"><legend>{text.initialVaults}</legend>{vaultChoices.map((choice) => <label key={choice.value}><input type="checkbox" checked={form.selectedVaults.includes(choice.value)} onChange={(event) => toggleVault(choice.value, event.target.checked)} /> {displayName(language, choice)}</label>)}</fieldset> : null}
          {step === 2 ? <fieldset className="finance-setup-choices"><legend>{text.chooseSuppliers}</legend>{standardSuppliers.map((choice) => <label key={choice.key}><input type="checkbox" checked={form.selectedStandardSupplierKeys.includes(choice.key)} onChange={(event) => toggleSupplier(choice.key, event.target.checked)} /> {displayName(language, choice)}</label>)}</fieldset> : null}
          {step === 3 ? <div className="administration-list"><article><span>{text.currentPeriod}: {form.nameAr}</span><span>{text.initialVaults}: {form.selectedVaults.length}</span><span>{text.standardSuppliers}: {form.selectedStandardSupplierKeys.length}</span></article></div> : null}
        </BaseerStepper>
      </form>
    </BaseerCard>
  </section>;
}

function FinanceSettingsHub({ language, text, readiness, saving, message, onRefreshFoundation, onAddStandardSuppliers }: {
  language: "ar" | "en";
  text: ReturnType<typeof financeText>;
  readiness: FinanceReadiness;
  saving: boolean;
  message: { kind: "idle" | "success" | "error"; text: string };
  onRefreshFoundation: () => Promise<void>;
  onAddStandardSuppliers: (supplierKeys: string[]) => Promise<boolean>;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const profile = readiness.profile;
  if (!profile) return null;
  const goTo = (hash: string) => { window.location.hash = hash; };
  const ready = readiness.issues.length === 0;
  const issueText = (issue: FinanceReadiness["issues"][number]) => issue === "NO_OPEN_PERIOD" ? (language === "ar" ? "لا توجد فترة مالية مفتوحة" : "No fiscal period is open") : issue === "NO_ACTIVE_VAULT" ? (language === "ar" ? "أضف خزينة أو قناة دفع نشطة" : "Add an active vault or payment channel") : issue === "NO_POSTING_CATEGORY" ? (language === "ar" ? "أضف فئة قابلة للترحيل" : "Add a posting category") : (language === "ar" ? "التهيئة المالية لم تكتمل" : "Finance setup is incomplete");
  const cards = [
    { icon: "◷", title: text.currentPeriod, value: readiness.openPeriod ? displayName(language, readiness.openPeriod) : "—", detail: readiness.openPeriod ? `${readiness.openPeriod.startDate} — ${readiness.openPeriod.endDate}` : issueText("NO_OPEN_PERIOD"), action: language === "ar" ? "إدارة الفترات" : "Manage periods", target: "#module=finance&section=0" },
    { icon: "▦", title: language === "ar" ? "البنية المحاسبية" : "Accounting structure", value: `${readiness.counts.activeAccounts} / ${readiness.counts.activeCategories}`, detail: language === "ar" ? "حسابات نشطة / فئات قابلة للترحيل" : "Active accounts / posting categories", action: language === "ar" ? "فتح الحسابات والفئات" : "Open accounts & categories", target: "#module=finance&section=3" },
    { icon: "◉", title: language === "ar" ? "السيولة والدفع" : "Cash & payments", value: String(readiness.counts.activeVaults), detail: text.vaultsAndPaymentChannels, action: text.vaults, target: "#module=finance&section=2" },
    { icon: "⌁", title: text.suppliers, value: String(readiness.counts.activeSuppliers), detail: text.standardSuppliersDescription, action: language === "ar" ? "إدارة الموردين" : "Manage suppliers", target: "#module=operations&section=4" },
  ];
  return <section className="daily-sales-workspace finance-setup-workspace" aria-label={text.setup}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.setup}</h3><p>{language === "ar" ? "متابعة جاهزية المالية والوصول إلى القسم المالك لكل إعداد." : "Review finance readiness and open the owning workspace for each setting."}</p></div><div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}><span className="daily-sales-badge">{ready ? (language === "ar" ? "جاهزة" : "Ready") : (language === "ar" ? "تحتاج متابعة" : "Needs attention")}</span><BaseerButton type="button" variant="secondary" onClick={() => setReviewOpen(true)}>{language === "ar" ? "مراجعة وإكمال التهيئة" : "Review setup"}</BaseerButton></div></header>
    {message.kind !== "idle" ? <p className={`daily-sales-message ${message.kind}`}>{message.text}</p> : null}
    {!ready ? <BaseerCard><strong>{language === "ar" ? "إجراءات مطلوبة" : "Required actions"}</strong><ul>{readiness.issues.map((issue) => <li key={issue}>{issueText(issue)}</li>)}</ul></BaseerCard> : null}
    <div className="baseer-card-grid">{cards.map((card) => <BaseerCard key={card.title}><div style={{ display: "grid", gap: "0.65rem" }}><span aria-hidden="true" style={{ color: "var(--brand-primary)", fontSize: "1.35rem", fontWeight: 800 }}>{card.icon}</span><span>{card.title}</span><strong>{card.value}</strong><p>{card.detail}</p><BaseerButton type="button" variant="secondary" onClick={() => goTo(card.target)}>{card.action}</BaseerButton></div></BaseerCard>)}</div>
    <BaseerCard><div style={{ display: "flex", gap: "0.75rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}><div><h3>{text.seedUpdate}</h3><p>{text.seedUpdateDescription}</p></div><BaseerButton type="button" variant="secondary" disabled={saving || profile.baseSeedVersion >= readiness.requiredBaseSeedVersion} onClick={() => void onRefreshFoundation()}>{profile.baseSeedVersion >= readiness.requiredBaseSeedVersion ? text.seedCurrent : text.updateFinanceSeed}</BaseerButton></div></BaseerCard>
    <FinanceSetupReviewDialog open={reviewOpen} language={language} readiness={readiness} saving={saving} onClose={() => setReviewOpen(false)} onRefreshFoundation={onRefreshFoundation} onAddStandardSuppliers={onAddStandardSuppliers} />
  </section>;
}

/**
 * A completed setup is reviewed safely rather than reset. Financial master
 * data and posted history remain in their owning workspaces.
 */
function FinanceSetupReviewDialog({ open, language, readiness, saving, onClose, onRefreshFoundation, onAddStandardSuppliers }: {
  open: boolean;
  language: "ar" | "en";
  readiness: FinanceReadiness;
  saving: boolean;
  onClose: () => void;
  onRefreshFoundation: () => Promise<void>;
  onAddStandardSuppliers: (supplierKeys: string[]) => Promise<boolean>;
}) {
  const copy = uiCopy(language);
  const text = financeText(language);
  const [step, setStep] = useState(0);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const goTo = (hash: string) => { onClose(); window.location.hash = hash; };
  const steps = language === "ar"
    ? [{ id: "status", label: "الجاهزية" }, { id: "period", label: "الفترة" }, { id: "structure", label: "الحسابات والسيولة" }, { id: "suppliers", label: "الموردون" }, { id: "update", label: "التحديث" }]
    : [{ id: "status", label: "Readiness" }, { id: "period", label: "Period" }, { id: "structure", label: "Accounts & cash" }, { id: "suppliers", label: "Suppliers" }, { id: "update", label: "Update" }];
  const profile = readiness.profile;
  const action = (label: string, target: string) => <BaseerButton type="button" variant="secondary" onClick={() => goTo(target)}>{label}</BaseerButton>;
  const stepContent = step === 0
    ? <BaseerCard><h3>{readiness.issues.length ? (language === "ar" ? "تحتاج بعض الخطوات إلى متابعة" : "A few actions need attention") : (language === "ar" ? "التهيئة الأساسية مكتملة" : "Core setup is complete")}</h3><p>{language === "ar" ? "هذه المراجعة لا تعيد ضبط الشركة ولا تحذف أي بيانات. افتح كل قسم لإضافة أو تعديل ما يخصه." : "This review never resets the company or deletes data. Open each workspace to add or change its own settings."}</p></BaseerCard>
    : step === 1
      ? <BaseerCard><h3>{language === "ar" ? "الفترة المالية" : "Fiscal period"}</h3><p>{readiness.openPeriod ? `${displayName(language, readiness.openPeriod)} · ${readiness.openPeriod.startDate} — ${readiness.openPeriod.endDate}` : (language === "ar" ? "لا توجد فترة مفتوحة." : "No fiscal period is open.")}</p>{action(language === "ar" ? "إدارة الفترات" : "Manage periods", "#module=finance&section=0")}</BaseerCard>
      : step === 2
        ? <div style={{ display: "grid", gap: "0.75rem" }}><BaseerCard><h3>{language === "ar" ? "الحسابات والفئات" : "Accounts & categories"}</h3><p>{language === "ar" ? `${readiness.counts.activeAccounts} حسابات نشطة و${readiness.counts.activeCategories} فئات قابلة للترحيل.` : `${readiness.counts.activeAccounts} active accounts and ${readiness.counts.activeCategories} posting categories.`}</p>{action(language === "ar" ? "فتح الحسابات والفئات" : "Open accounts & categories", "#module=finance&section=3")}</BaseerCard><BaseerCard><h3>{language === "ar" ? "الخزائن وطرق الدفع" : "Vaults & payment methods"}</h3><p>{language === "ar" ? `${readiness.counts.activeVaults} خزائن أو قنوات دفع نشطة.` : `${readiness.counts.activeVaults} active vaults or payment channels.`}</p>{action(language === "ar" ? "إدارة السيولة" : "Manage cash", "#module=finance&section=2")}</BaseerCard></div>
        : step === 3
          ? <BaseerCard><h3>{language === "ar" ? "الموردون القياسيون" : "Standard suppliers"}</h3><p>{language === "ar" ? "اختياري. يمكنك إضافتهم الآن أو إدارة جميع الموردين من قسم العمليات." : "Optional. Add them now or manage all suppliers in Operations."}</p><fieldset className="finance-setup-choices"><legend>{language === "ar" ? "اختر الموردين المراد إضافتهم" : "Choose suppliers to add"}</legend>{readiness.standardSuppliers.map((supplier) => <label key={supplier.key}><input type="checkbox" checked={selectedSuppliers.includes(supplier.key)} onChange={(event) => setSelectedSuppliers((current) => event.target.checked ? [...current, supplier.key] : current.filter((key) => key !== supplier.key))} /> {displayName(language, supplier)}</label>)}</fieldset><div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}><BaseerButton type="button" variant="primary" disabled={saving || !selectedSuppliers.length} onClick={() => void onAddStandardSuppliers(selectedSuppliers).then((saved) => { if (saved) setSelectedSuppliers([]); })}>{language === "ar" ? "إضافة المختار" : "Add selected"}</BaseerButton>{action(language === "ar" ? "إدارة الموردين" : "Manage suppliers", "#module=operations&section=4")}</div></BaseerCard>
          : <BaseerCard><h3>{language === "ar" ? "تحديث البذرة المالية" : "Finance foundation update"}</h3><p>{profile && profile.baseSeedVersion >= readiness.requiredBaseSeedVersion ? text.seedReviewCurrentDescription : text.seedReviewUpdateDescription}</p><BaseerButton type="button" variant="secondary" disabled={saving || !profile || profile.baseSeedVersion >= readiness.requiredBaseSeedVersion} onClick={() => void onRefreshFoundation()}>{language === "ar" ? "تحديث الآن" : "Update now"}</BaseerButton></BaseerCard>;
  return <BaseerDialog open={open} language={language} title={language === "ar" ? "مراجعة وإكمال تهيئة المالية" : "Review and complete finance setup"} onClose={onClose} busy={saving} size="wide" footer={<><BaseerButton type="button" variant="secondary" disabled={saving || step === 0} onClick={() => setStep((current) => current - 1)}>{copy.previous}</BaseerButton>{step < steps.length - 1 ? <BaseerButton type="button" variant="primary" disabled={saving} onClick={() => setStep((current) => current + 1)}>{copy.next}</BaseerButton> : <BaseerButton type="button" variant="primary" disabled={saving} onClick={onClose}>{copy.close}</BaseerButton>}</>}><BaseerStepper ariaLabel={language === "ar" ? "خطوات مراجعة التهيئة" : "Setup review steps"} steps={steps} activeStep={step} onStepChange={setStep} footer={null}>{stepContent}</BaseerStepper></BaseerDialog>;
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

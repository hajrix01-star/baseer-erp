import { useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { DataTable } from "./data-table";
import { activeSession, api, requestId } from "./daily-sales-client";
import { formatNumber } from "./number-format";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

export type RecurringExpenseConfiguration = {
  profile: { vatAccountingEnabled: boolean; vatRateBasisPoints: number } | null;
  vaults: Array<{ id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean; paymentMethod: PaymentMethod; paymentMethods: PaymentMethod[] }>;
  categories: Array<{ id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE"; status: "ACTIVE"; suggestedSupplierId: string | null }>;
  suppliers: Array<{ id: string; nameAr: string; nameEn: string | null; status: "ACTIVE" }>;
};
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP";
type PaymentAllocationDraft = { id: string; vaultId: string; paymentMethod: PaymentMethod | ""; grossAmount: string };
type IndividualPaymentForm = { profileId: string; paymentDate: string; coverageYear: string; coverageStartMonth: string; grossAmount: string; isTaxable: boolean; supplierInvoiceNumber: string; supplierInvoiceMissingReason: string; supplierInvoiceDate: string; allocations: PaymentAllocationDraft[] };
export type Profile = { id: string; nameAr: string; nameEn: string; supplierId: string | null; supplierNameAr: string | null; supplierNameEn: string | null; categoryId: string; categoryNameAr: string; categoryNameEn: string; serviceNumber: string | null; expectedAmount: string; intervalMonths: number; nextReminderDate: string; defaultVaultId: string | null; allowAmountOverride: boolean; status: "ACTIVE" | "ARCHIVED"; notes: string | null };
type ProfileForm = { nameAr: string; nameEn: string; categoryId: string; supplierId: string; serviceNumber: string; expectedAmount: string; intervalMonths: string; nextReminderDate: string; defaultVaultId: string; allowAmountOverride: boolean; notes: string };
const money = (value: string) => formatNumber(value);
const emptyProfile = (businessDate: string): ProfileForm => ({ nameAr: "", nameEn: "", categoryId: "", supplierId: "", serviceNumber: "", expectedAmount: "", intervalMonths: "1", nextReminderDate: businessDate, defaultVaultId: "", allowAmountOverride: true, notes: "" });
const coverageStartMonth = (profile: Profile, date: string) => String(Math.floor((Number(date.slice(5, 7)) - 1) / profile.intervalMonths) * profile.intervalMonths + 1);
const paymentMethodLabel = (text: ReturnType<typeof financeText>, method: PaymentMethod) => ({ CASH: text.cash, BANK_TRANSFER: text.bankTransfer, BANK_CARD: text.bankCard, BANK_PAYMENT: text.bankPayment, APP: text.app }[method]);

export function RecurringExpenseWorkspace({ language, configuration, profiles, businessDate, reload }: { language: "ar" | "en"; configuration: RecurringExpenseConfiguration; profiles: Profile[]; businessDate: string; reload: () => Promise<void> }) {
  const text = financeText(language);
  const session = activeSession();
  const [creating, setCreating] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(() => emptyProfile(businessDate));
  const [archiveTarget, setArchiveTarget] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "idle" | "error" | "success"; text: string }>({ type: "idle", text: "" });
  const categories = useMemo(() => configuration?.categories.filter((item) => item.status === "ACTIVE" && item.kind === "EXPENSE") ?? [], [configuration]);
  const suppliers = useMemo(() => configuration?.suppliers.filter((item) => item.status === "ACTIVE") ?? [], [configuration]);
  const vaults = useMemo(() => configuration?.vaults.filter((item) => item.status === "ACTIVE" && item.isPaymentDestination) ?? [], [configuration]);
  const dueCount = profiles.filter((profile) => profile.status === "ACTIVE" && profile.nextReminderDate.slice(0, 10) <= businessDate).length;
  const updateProfile = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setProfileForm((current) => ({ ...current, [key]: value }));
  const chooseCategory = (categoryId: string) => {
    const category = categories.find((item) => item.id === categoryId);
    setProfileForm((current) => ({ ...current, categoryId, supplierId: category?.suggestedSupplierId ?? "" }));
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || saving) return;
    if (!profileForm.nameAr.trim() || !profileForm.categoryId || !profileForm.expectedAmount || !profileForm.nextReminderDate) { setMessage({ type: "error", text: text.recurringDefinition }); return; }
    setSaving(true); setMessage({ type: "idle", text: "" });
    try {
      await api(current, "/finance/recurring-expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nameAr: profileForm.nameAr.trim(), ...(profileForm.nameEn.trim() ? { nameEn: profileForm.nameEn.trim() } : {}), categoryId: profileForm.categoryId, ...(profileForm.supplierId ? { supplierId: profileForm.supplierId } : {}), ...(profileForm.serviceNumber.trim() ? { serviceNumber: profileForm.serviceNumber.trim() } : {}), expectedAmount: profileForm.expectedAmount, intervalMonths: Number(profileForm.intervalMonths), nextReminderDate: profileForm.nextReminderDate, ...(profileForm.defaultVaultId ? { defaultVaultId: profileForm.defaultVaultId } : {}), allowAmountOverride: profileForm.allowAmountOverride, ...(profileForm.notes.trim() ? { notes: profileForm.notes.trim() } : {}), idempotencyKey: requestId() }) });
      setProfileForm(emptyProfile(businessDate)); setCreating(false); setMessage({ type: "success", text: text.recurringSaved }); await reload();
    } catch (error) { setMessage({ type: "error", text: presentBaseerApiError(error, language, text.recurringDefinition) }); } finally { setSaving(false); }
  };
  const archive = async (profile: Profile) => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await api(current, "/finance/recurring-expenses/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: profile.id, idempotencyKey: requestId() }) }); setMessage({ type: "success", text: text.archiveSuccess }); await reload(); } catch (error) { setMessage({ type: "error", text: presentBaseerApiError(error, language, text.archive) }); } finally { setSaving(false); } };
  if (!session) return null;
  return <section className="recurring-expense-workspace" aria-label={text.recurringExpenses}>
    <header className="recurring-expense-heading"><div><p className="eyebrow">{text.recurringExpenses}</p><h3>{text.recurringTitle}</h3><span>{dueCount ? dueCount + " " + text.due : text.allTracked}</span></div><BaseerButton type="button" variant="primary" onClick={() => setCreating(true)}>{text.addRecurring}</BaseerButton></header>
    {message.type !== "idle" && <p className={`daily-sales-message ${message.type}`}>{message.text}</p>}
    <BaseerDialog open={creating} title={text.addRecurring} language={language} busy={saving} onClose={() => setCreating(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setCreating(false)}>{text.cancel}</BaseerButton><BaseerButton type="submit" form="recurring-profile-form" variant="primary" disabled={saving}>{saving ? text.saving : text.saveRecurring}</BaseerButton></>}>
      <form id="recurring-profile-form" className="administration-form" onSubmit={(event) => void saveProfile(event)}>
        <label>{text.nameArabic}<input required value={profileForm.nameAr} placeholder={language === "ar" ? "كهرباء الفرع" : "Branch electricity"} onChange={(event) => updateProfile("nameAr", event.target.value)} /></label>
        <label>{text.nameEnglish}<input value={profileForm.nameEn} placeholder="Branch electricity" onChange={(event) => updateProfile("nameEn", event.target.value)} /></label>
        <label>{text.financialCategory}<select required value={profileForm.categoryId} onChange={(event) => chooseCategory(event.target.value)}><option value="">{text.selectCategory}</option>{categories.map((item) => <option value={item.id} key={item.id}>{displayName(language, item)}</option>)}</select></label>
        <label>{text.supplier}<select value={profileForm.supplierId} onChange={(event) => updateProfile("supplierId", event.target.value)}><option value="">{text.optional}</option>{suppliers.map((item) => <option value={item.id} key={item.id}>{displayName(language, item)}</option>)}</select></label>
        <label>{text.serviceNumber}<input value={profileForm.serviceNumber} placeholder={text.optional} onChange={(event) => updateProfile("serviceNumber", event.target.value)} /></label>
        <label>{text.expectedAmount} (SAR)<input required inputMode="decimal" value={profileForm.expectedAmount} placeholder={text.enterAmount} onChange={(event) => updateProfile("expectedAmount", event.target.value)} /></label>
        <label>{text.paymentCycle}<select value={profileForm.intervalMonths} onChange={(event) => updateProfile("intervalMonths", event.target.value)}>{[1,2,3,4,6,12].map((month) => <option key={month} value={month}>{month === 1 ? text.monthly : text.everyMonths(month)}</option>)}</select></label>
        <label>{text.nextDueDate}<BaseerDatePicker language={language} label={text.nextDueDate} value={profileForm.nextReminderDate} onChange={(value) => updateProfile("nextReminderDate", value)} /></label>
        <label>{text.defaultPaymentChannel}<select value={profileForm.defaultVaultId} onChange={(event) => updateProfile("defaultVaultId", event.target.value)}><option value="">{text.setAtPayment}</option>{vaults.map((item) => <option value={item.id} key={item.id}>{displayName(language, item)}</option>)}</select></label>
        <label><input type="checkbox" checked={profileForm.allowAmountOverride} onChange={(event) => updateProfile("allowAmountOverride", event.target.checked)} /> {text.allowAmountOverride}</label>
        <label style={{ gridColumn: "1 / -1" }}>{text.notes}<input value={profileForm.notes} placeholder={text.optional} onChange={(event) => updateProfile("notes", event.target.value)} /></label>
      </form>
    </BaseerDialog>
    <div className="recurring-profile-list">{profiles.filter((profile) => profile.status === "ACTIVE").map((profile) => <BaseerCard key={profile.id}><article className="recurring-profile"><div><span className="eyebrow">{profile.intervalMonths === 1 ? text.monthly : text.everyMonths(profile.intervalMonths)}</span><h4>{displayName(language, profile)}</h4><p>{displayName(language, { nameAr: profile.categoryNameAr, nameEn: profile.categoryNameEn })}{profile.supplierNameAr ? ` · ${displayName(language, { nameAr: profile.supplierNameAr, nameEn: profile.supplierNameEn })}` : ""}{profile.serviceNumber ? ` · ${profile.serviceNumber}` : ""}</p></div><div className="recurring-profile__amount"><span>{text.expected}</span><strong>SAR {money(profile.expectedAmount)}</strong><small>{text.dueDate} {profile.nextReminderDate}</small></div><div className="recurring-profile__actions"><BaseerButton type="button" variant="primary" onClick={() => setArchiveTarget(profile)}>{text.archive}</BaseerButton></div></article></BaseerCard>)}</div>
    {!profiles.filter((profile) => profile.status === "ACTIVE").length && <BaseerCard><p className="empty-results">{text.noRecurringDescription}</p></BaseerCard>}
  <BaseerConfirmDialog open={archiveTarget !== null} title={text.archive} message={archiveTarget ? `${text.archive}: ${displayName(language, archiveTarget)}. ${text.archiveConfirmation}` : ""} confirmLabel={text.archive} destructive busy={saving} language={language} onCancel={() => setArchiveTarget(null)} onConfirm={() => { if (archiveTarget) void archive(archiveTarget).finally(() => setArchiveTarget(null)); }} /></section>;
}
type RecurringBatchRow = { id: string; profileId: string; coverageYear: string; coverageStartMonth: string; grossAmount: string; vaultId: string; isTaxable: boolean; invoiceNumber: string; supplierInvoiceDate: string; missingReason: string };
const newRecurringBatchRow = (businessDate: string): RecurringBatchRow => ({ id: requestId(), profileId: "", coverageYear: businessDate.slice(0, 4), coverageStartMonth: String(Number(businessDate.slice(5, 7))), grossAmount: "", vaultId: "", isTaxable: true, invoiceNumber: "", supplierInvoiceDate: "", missingReason: "" });
const recurringBatchRows = (businessDate: string, profiles: readonly Profile[]) => {
  const dueProfiles = profiles.filter((profile) => profile.status === "ACTIVE" && profile.nextReminderDate.slice(0, 10) <= businessDate);
  return dueProfiles.length ? dueProfiles.map((profile) => ({ ...newRecurringBatchRow(businessDate), profileId: profile.id, coverageYear: profile.nextReminderDate.slice(0, 4), coverageStartMonth: coverageStartMonth(profile, profile.nextReminderDate), grossAmount: profile.expectedAmount, vaultId: profile.defaultVaultId ?? "" })) : [newRecurringBatchRow(businessDate)];
};
const recurringBatchRowHasValue = (row: RecurringBatchRow) => Boolean(row.profileId || row.grossAmount || row.vaultId || row.invoiceNumber || row.supplierInvoiceDate || row.missingReason );

/** A single atomic settlement command for several recurring profiles, mirroring the batch-row workflow. */
export function RecurringExpensePaymentBatch({ language, configuration, profiles, businessDate, reload }: { language: "ar" | "en"; configuration: RecurringExpenseConfiguration; profiles: Profile[]; businessDate: string; reload: () => Promise<void> }) {
  const text = financeText(language);
  const [rows, setRows] = useState<RecurringBatchRow[]>(() => recurringBatchRows(businessDate, profiles));
  const [paymentDate, setPaymentDate] = useState(businessDate);
  const [message, setMessage] = useState<{ type: "idle" | "error" | "success"; text: string }>({ type: "idle", text: "" });
  const [saving, setSaving] = useState(false);
  const activeProfiles = useMemo(() => profiles.filter((profile) => profile.status === "ACTIVE"), [profiles]);
  const vaults = useMemo(() => configuration.vaults.filter((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination), [configuration]);
  const [individual, setIndividual] = useState<IndividualPaymentForm | null>(null);
  const individualDialogRef = useDialogFocusTrap({ open: individual !== null, saving, onClose: () => setIndividual(null) });
  const enteredRows = useMemo(() => rows.filter(recurringBatchRowHasValue), [rows]);
  const newAllocation = (vaultId = ""): PaymentAllocationDraft => {
    const vault = vaults.find((item) => item.id === vaultId);
    return { id: requestId(), vaultId, paymentMethod: vault?.paymentMethods[0] ?? vault?.paymentMethod ?? "", grossAmount: "" };
  };
  const openIndividualPayment = (profileId: string) => {
    const profile = activeProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    const coverageDate = profile.nextReminderDate.slice(0, 10) <= businessDate ? profile.nextReminderDate : businessDate;
    setIndividual({ profileId, paymentDate: businessDate, coverageYear: coverageDate.slice(0, 4), coverageStartMonth: coverageStartMonth(profile, coverageDate), grossAmount: profile.expectedAmount, isTaxable: Boolean(configuration.profile?.vatAccountingEnabled), supplierInvoiceNumber: "", supplierInvoiceMissingReason: "", supplierInvoiceDate: "", allocations: [{ ...newAllocation(profile.defaultVaultId ?? ""), grossAmount: profile.expectedAmount }] });
  };
  const updateIndividual = <K extends Exclude<keyof IndividualPaymentForm, "allocations">>(key: K, value: IndividualPaymentForm[K]) => setIndividual((current) => current ? { ...current, [key]: value } : current);
  const updateAllocation = (allocationId: string, patch: Partial<PaymentAllocationDraft>) => setIndividual((current) => current ? { ...current, allocations: current.allocations.map((allocation) => {
    if (allocation.id !== allocationId) return allocation;
    if (patch.vaultId !== undefined) {
      const vault = vaults.find((item) => item.id === patch.vaultId);
      return { ...allocation, ...patch, paymentMethod: vault?.paymentMethods[0] ?? vault?.paymentMethod ?? "" };
    }
    return { ...allocation, ...patch };
  }) } : current);
  const individualAllocated = individual?.allocations.reduce((total, allocation) => total + (Number(allocation.grossAmount) || 0), 0) ?? 0;
  const submitIndividual = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || !individual || saving) return;
    const profile = activeProfiles.find((item) => item.id === individual.profileId);
    if (!profile || !individual.grossAmount || Number(individual.grossAmount) <= 0 || !individual.allocations.length || individual.allocations.some((allocation) => !allocation.vaultId || !allocation.paymentMethod || !allocation.grossAmount || Number(allocation.grossAmount) <= 0) || Math.abs(individualAllocated - Number(individual.grossAmount)) > 0.0001 || (!individual.supplierInvoiceNumber.trim() && !individual.supplierInvoiceMissingReason.trim()) || (individual.supplierInvoiceNumber.trim() && individual.supplierInvoiceMissingReason.trim())) { setMessage({ type: "error", text: text.individualPaymentValidation }); return; }
    setSaving(true); setMessage({ type: "idle", text: "" });
    try {
      await api(current, "/finance/recurring-expenses/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: individual.profileId, businessDate: individual.paymentDate, coverageYear: Number(individual.coverageYear), coverageStartMonth: Number(individual.coverageStartMonth), grossAmount: individual.grossAmount, isTaxable: individual.isTaxable, allocations: individual.allocations.map(({ vaultId, paymentMethod, grossAmount }) => ({ vaultId, paymentMethod, grossAmount })), ...(individual.supplierInvoiceNumber.trim() ? { supplierInvoiceNumber: individual.supplierInvoiceNumber.trim() } : { supplierInvoiceMissingReason: individual.supplierInvoiceMissingReason.trim() }), ...(individual.supplierInvoiceDate ? { supplierInvoiceDate: individual.supplierInvoiceDate } : {}), idempotencyKey: requestId() }) });
      setIndividual(null); setMessage({ type: "success", text: text.individualPaymentSaved }); await reload();
    } catch (error) { setMessage({ type: "error", text: presentBaseerApiError(error, language, text.recordSettlement) }); } finally { setSaving(false); }
  };
  const change = <K extends keyof RecurringBatchRow>(rowId: string, key: K, value: RecurringBatchRow[K]) => setRows((current) => current.map((row) => row.id === rowId ? { ...row, [key]: value } : row));
  const chooseProfile = (rowId: string, profileId: string) => setRows((current) => current.map((row) => {
    if (row.id !== rowId) return row;
    const profile = activeProfiles.find((item) => item.id === profileId);
    return { ...row, profileId, grossAmount: profile?.expectedAmount ?? row.grossAmount, vaultId: profile?.defaultVaultId ?? row.vaultId };
  }));
  const remove = (rowId: string) => setRows((current) => current.length === 1 ? current : current.filter((row) => row.id !== rowId));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || saving) return;
    if (!enteredRows.length) { setMessage({ type: "error", text: text.atLeastOneRow }); return; }
    const coverage = new Set<string>();
    for (const [index, row] of enteredRows.entries()) {
      const key = `${row.profileId}:${row.coverageYear}:${row.coverageStartMonth}`;
      if (!row.profileId || !row.grossAmount || Number(row.grossAmount) <= 0 || !row.vaultId || (!row.invoiceNumber.trim() && !row.missingReason.trim()) || (row.invoiceNumber.trim() && row.missingReason.trim()) || coverage.has(key)) { setMessage({ type: "error", text: text.paymentValidation(index + 1) }); return; }
      coverage.add(key);
    }
    setSaving(true); setMessage({ type: "idle", text: "" });
    try {
      const receipt = await api<{ documentCount: number }>(current, "/finance/recurring-expenses/payments/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessDate: paymentDate, items: enteredRows.map((row) => ({ profileId: row.profileId, coverageYear: Number(row.coverageYear), coverageStartMonth: Number(row.coverageStartMonth), grossAmount: row.grossAmount, vaultId: row.vaultId, isTaxable: row.isTaxable, ...(row.invoiceNumber.trim() ? { supplierInvoiceNumber: row.invoiceNumber.trim() } : { supplierInvoiceMissingReason: row.missingReason.trim() }), ...(row.supplierInvoiceDate ? { supplierInvoiceDate: row.supplierInvoiceDate } : {}) })), idempotencyKey: requestId() }) });
      setRows(recurringBatchRows(businessDate, profiles)); setPaymentDate(businessDate); setMessage({ type: "success", text: text.recurringBatchSaved(receipt.documentCount) }); await reload();
    } catch (error) { setMessage({ type: "error", text: presentBaseerApiError(error, language, text.recurringBatchTitle) }); } finally { setSaving(false); }
  };
  return <><BaseerCard className="baseer-batch-workspace"><form className="baseer-batch-form" onSubmit={(event) => void submit(event)}>
    <div className="baseer-batch-header"><label>{text.paymentDate}<BaseerDatePicker language={language} label={text.paymentDate} max={businessDate} value={paymentDate} onChange={setPaymentDate} /></label><label>{text.recurringProfile}<select aria-label={text.recurringProfile} defaultValue="" onChange={(event) => { if (event.target.value) { openIndividualPayment(event.target.value); event.target.value = ""; } }}><option value="">{text.selectRecurringProfile}</option>{activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{displayName(language, profile)}</option>)}</select></label></div>
    {message.type !== "idle" ? <p className={`daily-sales-message ${message.type}`}>{message.text}</p> : null}
    <DataTable ariaLabel={text.recurringBatchTitle} caption={text.recurringBatchTitle} className="baseer-batch-entry-table" rowKey={(row) => row.id} rows={rows} columns={[
      { id: "row", header: text.rowNumber, align: "center", cell: (row) => <span className="baseer-batch-entry-table__row-number">{rows.indexOf(row) + 1}</span> },
      { id: "profile", header: text.recurringProfile, cell: (row) => <select aria-label={text.recurringProfile} value={row.profileId} onChange={(event) => chooseProfile(row.id, event.target.value)}><option value="">{text.selectRecurringProfile}</option>{activeProfiles.map((profile) => <option value={profile.id} key={profile.id}>{displayName(language, profile)}</option>)}</select> },
      { id: "coverageYear", header: text.coverageYear, align: "center", cell: (row) => <input aria-label={text.coverageYear} type="number" min="2000" max="2100" value={row.coverageYear} onChange={(event) => change(row.id, "coverageYear", event.target.value)} /> },
      { id: "coverageMonth", header: text.coverageMonth, cell: (row) => <select aria-label={text.coverageMonth} value={row.coverageStartMonth} onChange={(event) => change(row.id, "coverageStartMonth", event.target.value)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}</option>)}</select> },
      { id: "amount", header: `${text.totalAmount} (SAR)`, numeric: true, cell: (row) => { const profile = activeProfiles.find((item) => item.id === row.profileId); return <input aria-label={text.totalAmount} required disabled={Boolean(profile && !profile.allowAmountOverride)} inputMode="decimal" placeholder={text.enterAmount} value={row.grossAmount} onChange={(event) => change(row.id, "grossAmount", event.target.value)} />; } },
      { id: "vault", header: text.paymentChannel, cell: (row) => <select aria-label={text.paymentChannel} value={row.vaultId} onChange={(event) => change(row.id, "vaultId", event.target.value)}><option value="">{text.selectChannel}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{displayName(language, vault)}</option>)}</select> },
      { id: "invoice", header: text.invoiceNumber, cell: (row) => <input aria-label={text.invoiceNumber} value={row.invoiceNumber} placeholder={text.supplierInvoiceNumber} onChange={(event) => change(row.id, "invoiceNumber", event.target.value)} /> },
      { id: "invoiceDate", header: text.supplierInvoiceDate, cell: (row) => <input aria-label={text.supplierInvoiceDate} max={paymentDate} type="date" value={row.supplierInvoiceDate} onChange={(event) => change(row.id, "supplierInvoiceDate", event.target.value)} /> },
      { id: "tax", header: text.tax, align: "center", cell: (row) => <BaseerButton aria-label={row.isTaxable ? text.taxOn : text.taxOff} title={row.isTaxable ? text.taxOn : text.taxOff} className="baseer-batch-entry-table__tax" disabled={!configuration.profile?.vatAccountingEnabled} type="button" variant="secondary" onClick={() => change(row.id, "isTaxable", !row.isTaxable)}>{row.isTaxable && configuration.profile?.vatAccountingEnabled ? `${(configuration.profile?.vatRateBasisPoints ?? 1500) / 100}%` : "—"}</BaseerButton> },
      { id: "remove", header: "", align: "center", cell: (row) => <BaseerButton aria-label={text.removeRow} type="button" variant="secondary" className="baseer-batch-entry-table__remove" disabled={rows.length === 1} onClick={() => remove(row.id)}>×</BaseerButton> },
    ]} />
    <footer className="baseer-batch-footer"><div className="baseer-batch-total" /><div><BaseerButton type="button" variant="secondary" onClick={() => setRows((current) => [...current, newRecurringBatchRow(businessDate)])}>{text.addRow}</BaseerButton><BaseerButton variant="primary" disabled={saving}>{saving ? text.saving : text.savePaymentCount(enteredRows.length)}</BaseerButton></div></footer>
  </form></BaseerCard>{individual ? <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !saving && setIndividual(null)}><section ref={individualDialogRef} className="daily-sales-dialog" role="dialog" aria-modal="true" aria-labelledby="recurring-payment-dialog-title" onMouseDown={(event) => event.stopPropagation()}><header className="daily-sales-dialog__header"><div><h3 id="recurring-payment-dialog-title">{text.recordSettlement}</h3><p>{displayName(language, activeProfiles.find((profile) => profile.id === individual.profileId)!)}</p></div><button className="dialog-icon-button" type="button" aria-label={text.cancel} disabled={saving} onClick={() => setIndividual(null)}>×</button></header><form className="recurring-expense-form" onSubmit={(event) => void submitIndividual(event)}><div className="recurring-expense-grid"><label>{text.paymentDate}<BaseerDatePicker language={language} label={text.paymentDate} max={businessDate} value={individual.paymentDate} onChange={(value) => updateIndividual("paymentDate", value)} /></label><label>{text.coverageYear}<input type="number" min="2000" max="2100" value={individual.coverageYear} onChange={(event) => updateIndividual("coverageYear", event.target.value)} /></label><label>{text.coverageMonth}<select value={individual.coverageStartMonth} onChange={(event) => updateIndividual("coverageStartMonth", event.target.value)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}</option>)}</select></label><label>{text.totalAmount} (SAR)<input disabled={!activeProfiles.find((profile) => profile.id === individual.profileId)?.allowAmountOverride} inputMode="decimal" value={individual.grossAmount} onChange={(event) => updateIndividual("grossAmount", event.target.value)} /></label>{configuration.profile?.vatAccountingEnabled ? <label className="purchase-tax-toggle"><input type="checkbox" checked={individual.isTaxable} onChange={(event) => updateIndividual("isTaxable", event.target.checked)} />{individual.isTaxable ? text.taxOn : text.taxOff}</label> : null}<label>{text.invoiceNumber}<input value={individual.supplierInvoiceNumber} placeholder={text.supplierInvoiceNumber} onChange={(event) => updateIndividual("supplierInvoiceNumber", event.target.value)} /></label><label>{text.supplierInvoiceDate}<input type="date" max={individual.paymentDate} value={individual.supplierInvoiceDate} onChange={(event) => updateIndividual("supplierInvoiceDate", event.target.value)} /></label><label className="recurring-span">{text.invoiceMissingReason}<input value={individual.supplierInvoiceMissingReason} placeholder={text.optional} onChange={(event) => updateIndividual("supplierInvoiceMissingReason", event.target.value)} /></label></div><DataTable ariaLabel={text.paymentAllocations} caption={text.paymentAllocations} rowKey={(allocation) => allocation.id} rows={individual.allocations} columns={[{ id: "vault", header: text.paymentChannel, cell: (allocation) => <select value={allocation.vaultId} onChange={(event) => updateAllocation(allocation.id, { vaultId: event.target.value })}><option value="">{text.selectChannel}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{displayName(language, vault)}</option>)}</select> }, { id: "method", header: text.paymentMethod, cell: (allocation) => { const vault = vaults.find((item) => item.id === allocation.vaultId); return <select value={allocation.paymentMethod} disabled={!vault} onChange={(event) => updateAllocation(allocation.id, { paymentMethod: event.target.value as PaymentMethod })}><option value="">{text.paymentMethod}</option>{(vault?.paymentMethods ?? []).map((method) => <option key={method} value={method}>{paymentMethodLabel(text, method)}</option>)}</select>; } }, { id: "amount", header: `${text.amount} (SAR)`, numeric: true, cell: (allocation) => <input inputMode="decimal" value={allocation.grossAmount} onChange={(event) => updateAllocation(allocation.id, { grossAmount: event.target.value })} /> }, { id: "remove", header: "", align: "center", cell: (allocation) => <BaseerButton type="button" aria-label={text.removeRow} variant="secondary" disabled={individual.allocations.length === 1} onClick={() => setIndividual((current) => current ? { ...current, allocations: current.allocations.filter((item) => item.id !== allocation.id) } : current)}>×</BaseerButton> }]} /><footer><span>{text.allocationTotal}: SAR {money(String(individualAllocated))}</span><BaseerButton type="button" variant="secondary" onClick={() => setIndividual((current) => current ? { ...current, allocations: [...current.allocations, newAllocation()] } : current)}>{text.addPaymentAllocation}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={() => setIndividual(null)}>{text.cancel}</BaseerButton><BaseerButton variant="primary" disabled={saving}>{saving ? text.saving : text.recordSettlement}</BaseerButton></footer></form></section></div> : null}</>;
}

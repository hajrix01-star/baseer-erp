import { useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { DataTable } from "./data-table";
import { activeSession, api, requestId } from "./daily-sales-client";
import { formatNumber } from "./number-format";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

export type RecurringExpenseConfiguration = {
  profile: { vatAccountingEnabled: boolean; vatRateBasisPoints: number } | null;
  vaults: Array<{ id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean }>;
  categories: Array<{ id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE"; status: "ACTIVE"; suggestedSupplierId: string | null }>;
  suppliers: Array<{ id: string; nameAr: string; nameEn: string | null; status: "ACTIVE" }>;
};
export type Profile = { id: string; nameAr: string; nameEn: string; supplierId: string | null; supplierNameAr: string | null; supplierNameEn: string | null; categoryId: string; categoryNameAr: string; categoryNameEn: string; serviceNumber: string | null; expectedAmount: string; intervalMonths: number; nextReminderDate: string; defaultVaultId: string | null; allowAmountOverride: boolean; status: "ACTIVE" | "ARCHIVED"; notes: string | null };
type ProfileForm = { nameAr: string; nameEn: string; categoryId: string; supplierId: string; serviceNumber: string; expectedAmount: string; intervalMonths: string; nextReminderDate: string; defaultVaultId: string; allowAmountOverride: boolean; notes: string };
const money = (value: string) => formatNumber(value);
const emptyProfile = (businessDate: string): ProfileForm => ({ nameAr: "", nameEn: "", categoryId: "", supplierId: "", serviceNumber: "", expectedAmount: "", intervalMonths: "1", nextReminderDate: businessDate, defaultVaultId: "", allowAmountOverride: true, notes: "" });

export function RecurringExpenseWorkspace({ language, configuration, profiles, businessDate, reload }: { language: "ar" | "en"; configuration: RecurringExpenseConfiguration; profiles: Profile[]; businessDate: string; reload: () => Promise<void> }) {
  const text = financeText(language);
  const session = activeSession();
  const [creating, setCreating] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(() => emptyProfile(businessDate));
  const [archiveTarget, setArchiveTarget] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "idle" | "error" | "success"; text: string }>({ type: "idle", text: "" });
  const dialogRef = useDialogFocusTrap({ open: creating, saving, onClose: () => setCreating(false) });
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
    {creating && <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !saving && setCreating(false)}><section ref={dialogRef} className="daily-sales-dialog" role="dialog" aria-modal="true" aria-labelledby="recurring-expense-dialog-title" onMouseDown={(event) => event.stopPropagation()}><header className="daily-sales-dialog__header"><div><h3 id="recurring-expense-dialog-title">{text.addRecurring}</h3></div><button className="dialog-icon-button" type="button" aria-label={text.cancel} disabled={saving} onClick={() => setCreating(false)}>×</button></header><form className="recurring-expense-form" onSubmit={(event) => void saveProfile(event)}><div className="recurring-expense-grid"><label>{text.nameArabic}<input required value={profileForm.nameAr} placeholder={language === "ar" ? "كهرباء الفرع" : "Branch electricity"} onChange={(event) => updateProfile("nameAr", event.target.value)} /></label><label>{text.nameEnglish}<input value={profileForm.nameEn} placeholder="Branch electricity" onChange={(event) => updateProfile("nameEn", event.target.value)} /></label><label>{text.financialCategory}<select required value={profileForm.categoryId} onChange={(event) => chooseCategory(event.target.value)}><option value="">{text.selectCategory}</option>{categories.map((item) => <option value={item.id} key={item.id}>{displayName(language, item)}</option>)}</select></label><label>{text.supplier}<select value={profileForm.supplierId} onChange={(event) => updateProfile("supplierId", event.target.value)}><option value="">{text.optional}</option>{suppliers.map((item) => <option value={item.id} key={item.id}>{displayName(language, item)}</option>)}</select></label><label>{text.serviceNumber}<input value={profileForm.serviceNumber} placeholder={text.optional} onChange={(event) => updateProfile("serviceNumber", event.target.value)} /></label><label>{text.expectedAmount} (SAR)<input required inputMode="decimal" value={profileForm.expectedAmount} placeholder={text.enterAmount} onChange={(event) => updateProfile("expectedAmount", event.target.value)} /></label><label>{text.paymentCycle}<select value={profileForm.intervalMonths} onChange={(event) => updateProfile("intervalMonths", event.target.value)}>{[1,2,3,4,6,12].map((month) => <option key={month} value={month}>{month === 1 ? text.monthly : text.everyMonths(month)}</option>)}</select></label><label>{text.nextDueDate}<BaseerDatePicker language={language} label={text.nextDueDate} value={profileForm.nextReminderDate} onChange={(value) => updateProfile("nextReminderDate", value)} /></label><label>{text.defaultPaymentChannel}<select value={profileForm.defaultVaultId} onChange={(event) => updateProfile("defaultVaultId", event.target.value)}><option value="">{text.setAtPayment}</option>{vaults.map((item) => <option value={item.id} key={item.id}>{displayName(language, item)}</option>)}</select></label><label className="purchase-tax-toggle"><input type="checkbox" checked={profileForm.allowAmountOverride} onChange={(event) => updateProfile("allowAmountOverride", event.target.checked)} />{text.allowAmountOverride}</label><label className="recurring-span">{text.notes}<input value={profileForm.notes} placeholder={text.optional} onChange={(event) => updateProfile("notes", event.target.value)} /></label></div><footer><BaseerButton variant="primary" disabled={saving}>{saving ? text.saving : text.saveRecurring}</BaseerButton></footer></form></section></div>}
    <div className="recurring-profile-list">{profiles.filter((profile) => profile.status === "ACTIVE").map((profile) => <BaseerCard key={profile.id}><article className="recurring-profile"><div><span className="eyebrow">{profile.intervalMonths === 1 ? text.monthly : text.everyMonths(profile.intervalMonths)}</span><h4>{displayName(language, profile)}</h4><p>{displayName(language, { nameAr: profile.categoryNameAr, nameEn: profile.categoryNameEn })}{profile.supplierNameAr ? ` · ${displayName(language, { nameAr: profile.supplierNameAr, nameEn: profile.supplierNameEn })}` : ""}{profile.serviceNumber ? ` · ${profile.serviceNumber}` : ""}</p></div><div className="recurring-profile__amount"><span>{text.expected}</span><strong>SAR {money(profile.expectedAmount)}</strong><small>{text.dueDate} {profile.nextReminderDate}</small></div><div className="recurring-profile__actions"><BaseerButton type="button" variant="primary" onClick={() => setArchiveTarget(profile)}>{text.archive}</BaseerButton></div></article></BaseerCard>)}</div>
    {!profiles.filter((profile) => profile.status === "ACTIVE").length && <BaseerCard><p className="empty-results">{text.noRecurringDescription}</p></BaseerCard>}
  <BaseerConfirmDialog open={archiveTarget !== null} title={text.archive} message={archiveTarget ? `${text.archive}: ${displayName(language, archiveTarget)}. ${text.archiveConfirmation}` : ""} confirmLabel={text.archive} destructive busy={saving} language={language} onCancel={() => setArchiveTarget(null)} onConfirm={() => { if (archiveTarget) void archive(archiveTarget).finally(() => setArchiveTarget(null)); }} /></section>;
}
type RecurringBatchRow = { id: string; profileId: string; coverageYear: string; coverageStartMonth: string; grossAmount: string; vaultId: string; isTaxable: boolean; invoiceNumber: string; supplierInvoiceDate: string; missingReason: string };
const newRecurringBatchRow = (businessDate: string): RecurringBatchRow => ({ id: requestId(), profileId: "", coverageYear: businessDate.slice(0, 4), coverageStartMonth: String(Number(businessDate.slice(5, 7))), grossAmount: "", vaultId: "", isTaxable: true, invoiceNumber: "", supplierInvoiceDate: "", missingReason: "" });
const recurringBatchRows = (businessDate: string) => Array.from({ length: 3 }, () => newRecurringBatchRow(businessDate));
const recurringBatchRowHasValue = (row: RecurringBatchRow) => Boolean(row.profileId || row.grossAmount || row.vaultId || row.invoiceNumber || row.supplierInvoiceDate || row.missingReason );

/** A single atomic settlement command for several recurring profiles, mirroring the batch-row workflow. */
export function RecurringExpensePaymentBatch({ language, configuration, profiles, businessDate, reload }: { language: "ar" | "en"; configuration: RecurringExpenseConfiguration; profiles: Profile[]; businessDate: string; reload: () => Promise<void> }) {
  const text = financeText(language);
  const [rows, setRows] = useState<RecurringBatchRow[]>(() => recurringBatchRows(businessDate));
  const [paymentDate, setPaymentDate] = useState(businessDate);
  const [message, setMessage] = useState<{ type: "idle" | "error" | "success"; text: string }>({ type: "idle", text: "" });
  const [saving, setSaving] = useState(false);
  const activeProfiles = useMemo(() => profiles.filter((profile) => profile.status === "ACTIVE"), [profiles]);
  const vaults = useMemo(() => configuration.vaults.filter((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination), [configuration]);
  const enteredRows = useMemo(() => rows.filter(recurringBatchRowHasValue), [rows]);
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
      setRows(recurringBatchRows(businessDate)); setPaymentDate(businessDate); setMessage({ type: "success", text: text.recurringBatchSaved(receipt.documentCount) }); await reload();
    } catch (error) { setMessage({ type: "error", text: presentBaseerApiError(error, language, text.recurringBatchTitle) }); } finally { setSaving(false); }
  };
  return <BaseerCard className="baseer-batch-workspace"><form className="baseer-batch-form" onSubmit={(event) => void submit(event)}>
    <div className="baseer-batch-header"><label>{text.paymentDate}<BaseerDatePicker language={language} label={text.paymentDate} max={businessDate} value={paymentDate} onChange={setPaymentDate} /></label></div>
    {message.type !== "idle" ? <p className={`daily-sales-message ${message.type}`}>{message.text}</p> : null}
    <DataTable ariaLabel={text.recurringBatchTitle} caption={text.recurringBatchTitle} className="baseer-batch-entry-table" rowKey={(row) => row.id} rows={rows} columns={[
      { id: "row", header: text.rowNumber, align: "center", cell: (row) => <span className="baseer-batch-entry-table__row-number">{rows.indexOf(row) + 1}</span> },
      { id: "profile", header: text.recurringProfile, cell: (row) => <select aria-label={text.recurringProfile} value={row.profileId} onChange={(event) => chooseProfile(row.id, event.target.value)}><option value="">{text.selectRecurringProfile}</option>{activeProfiles.map((profile) => <option value={profile.id} key={profile.id}>{displayName(language, profile)}</option>)}</select> },
      { id: "coverageYear", header: text.coverageYear, align: "center", cell: (row) => <input aria-label={text.coverageYear} type="number" min="2000" max="2100" value={row.coverageYear} onChange={(event) => change(row.id, "coverageYear", event.target.value)} /> },
      { id: "coverageMonth", header: text.coverageMonth, cell: (row) => <select aria-label={text.coverageMonth} value={row.coverageStartMonth} onChange={(event) => change(row.id, "coverageStartMonth", event.target.value)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}</option>)}</select> },
      { id: "amount", header: `${text.totalAmount} (SAR)`, numeric: true, cell: (row) => { const profile = activeProfiles.find((item) => item.id === row.profileId); return <input aria-label={text.totalAmount} required disabled={Boolean(profile && !profile.allowAmountOverride)} inputMode="decimal" placeholder={text.enterAmount} value={row.grossAmount} onChange={(event) => change(row.id, "grossAmount", event.target.value)} />; } },
      { id: "vault", header: text.paymentChannel, cell: (row) => <select aria-label={text.paymentChannel} value={row.vaultId} onChange={(event) => change(row.id, "vaultId", event.target.value)}><option value="">{text.selectChannel}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{displayName(language, vault)}</option>)}</select> },
      { id: "invoice", header: text.invoiceNumber, cell: (row) => <input aria-label={text.invoiceNumber} value={row.invoiceNumber} placeholder={text.supplierInvoiceNumber} onChange={(event) => change(row.id, "invoiceNumber", event.target.value)} /> },
      { id: "invoiceDate", header: text.supplierInvoiceDate, cell: (row) => <BaseerDatePicker language={language} label={text.supplierInvoiceDate} max={paymentDate} value={row.supplierInvoiceDate} onChange={(value) => change(row.id, "supplierInvoiceDate", value)} /> },
      { id: "tax", header: text.tax, align: "center", cell: (row) => <BaseerButton aria-label={row.isTaxable ? text.taxOn : text.taxOff} title={row.isTaxable ? text.taxOn : text.taxOff} className="baseer-batch-entry-table__tax" disabled={!configuration.profile?.vatAccountingEnabled} type="button" variant="secondary" onClick={() => change(row.id, "isTaxable", !row.isTaxable)}>{row.isTaxable && configuration.profile?.vatAccountingEnabled ? `${(configuration.profile?.vatRateBasisPoints ?? 1500) / 100}%` : "—"}</BaseerButton> },
      { id: "remove", header: "", align: "center", cell: (row) => <BaseerButton aria-label={text.removeRow} type="button" variant="secondary" className="baseer-batch-entry-table__remove" disabled={rows.length === 1} onClick={() => remove(row.id)}>×</BaseerButton> },
    ]} />
    <footer className="baseer-batch-footer"><div className="baseer-batch-total" /><div><BaseerButton type="button" variant="secondary" onClick={() => setRows((current) => [...current, newRecurringBatchRow(businessDate)])}>{text.addRow}</BaseerButton><BaseerButton variant="primary" disabled={saving}>{saving ? text.saving : text.savePaymentCount(enteredRows.length)}</BaseerButton></div></footer>
  </form></BaseerCard>;
}

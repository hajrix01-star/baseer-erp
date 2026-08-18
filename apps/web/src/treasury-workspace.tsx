import { useCallback, useEffect, useMemo, useState } from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import { BaseerPeriodFilter, baseerPeriodLabel, baseerPeriodQuery, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { DataTable, type DataTableColumn } from "./data-table";
import { presentBaseerApiError } from "./baseer-api-error";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { formatMoney } from "./number-format";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";

type Language = "ar" | "en";
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP";
type Vault = { id: string; nameAr: string; nameEn: string; type: "CASH" | "BANK" | "APP"; paymentMethods: PaymentMethod[]; status: "ACTIVE" | "ARCHIVED"; isSalesChannel: boolean; isPaymentDestination: boolean; sortOrder: number; balanceAsOf: string; inflow: string; outflow: string };
type TreasuryReceipt = { companyId: string; businessDate: string; asOfBusinessDate: string; fromBusinessDate: string | null; toBusinessDate: string | null; summary: AmountSummary; groups: Array<{ key: "COLLECTION_CHANNELS" | "OTHER_VAULTS" | "ARCHIVED"; count: number } & AmountSummary>; vaults: Vault[] };
type AmountSummary = { balanceAsOf: string; inflow: string; outflow: string; net?: string };
type ActivityItem = { id: string; journalEntryId: string; businessDate: string; sourceType: string; sourceReference: string; description: string | null; counterpartNameAr: string | null; counterpartNameEn: string | null; inflow: string; outflow: string };
type ActivityReceipt = { vault: Vault; asOfBusinessDate: string; summary: AmountSummary; items: ActivityItem[]; nextCursor: string | null };
type VaultForm = { nameAr: string; nameEn: string; type: Vault["type"]; paymentMethods: PaymentMethod[]; isSalesChannel: boolean; isPaymentDestination: boolean };
const emptyVault: VaultForm = { nameAr: "", nameEn: "", type: "CASH", paymentMethods: ["CASH"], isSalesChannel: false, isPaymentDestination: true };

export function TreasuryWorkspace({ language }: { language: Language }) {
  const text = financeText(language);
  const orderLabel = language === "ar" ? "ترتيب" : "Order";
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [workspace, setWorkspace] = useState<TreasuryReceipt | null>(null);
  const [message, setMessage] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [saving, setSaving] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const [formTarget, setFormTarget] = useState<Vault | null>(null);
  const [vaultForm, setVaultForm] = useState<VaultForm>(emptyVault);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string[]>([]);
  const [transfer, setTransfer] = useState({ fromVaultId: "", toVaultId: "", amount: "", businessDate: "", notes: "" });
  const [detail, setDetail] = useState<Vault | null>(null);
  const [activity, setActivity] = useState<ActivityReceipt | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Vault | null>(null);

  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    const query = new URLSearchParams(baseerPeriodQuery(period));
    if (showArchived) query.set("includeArchived", "true");
    const receipt = await api<TreasuryReceipt>(current, `/finance/treasury?${query.toString()}`);
    setWorkspace(receipt);
    setTransfer((value) => value.businessDate ? value : { ...value, businessDate: receipt.businessDate });
  }, [period, showArchived]);

  useEffect(() => { void load().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.loadingVaults) })); }, [language, load, text.loadingVaults]);

  const activeVaults = useMemo(() => workspace?.vaults.filter((vault) => vault.status === "ACTIVE") ?? [], [workspace]);
  const matchingVaults = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? (workspace?.vaults ?? []).filter((vault) => `${vault.nameAr} ${vault.nameEn} ${vault.type}`.toLocaleLowerCase().includes(term)) : workspace?.vaults ?? [];
  }, [search, workspace]);
  const groups = useMemo(() => ({
    channels: matchingVaults.filter((vault) => vault.status === "ACTIVE" && vault.isSalesChannel),
    others: matchingVaults.filter((vault) => vault.status === "ACTIVE" && !vault.isSalesChannel),
    archived: matchingVaults.filter((vault) => vault.status === "ARCHIVED"),
  }), [matchingVaults]);

  const openAdd = () => { setFormTarget(null); setVaultForm(emptyVault); setFormMode("add"); };
  const openOrder = () => { setOrderDraft(activeVaults.map((vault) => vault.id)); setShowOrder(true); };
  const moveVault = (index: number, direction: -1 | 1) => setOrderDraft((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target]!, next[index]!]; return next; });
  const saveOrder = async () => {
    const current = activeSession(); if (!current || saving || !orderDraft.length) return;
    setSaving(true); setMessage({ kind: "idle", text: "" });
    try { await api(current, "/finance/vaults/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vaultIds: orderDraft, idempotencyKey: requestId() }) }); setShowOrder(false); setMessage({ kind: "success", text: text.saveSucceeded }); await load(); }
    catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, orderLabel) }); }
    finally { setSaving(false); }
  };
  const openEdit = (vault: Vault) => { setFormTarget(vault); setVaultForm({ nameAr: vault.nameAr, nameEn: vault.nameEn, type: vault.type, paymentMethods: vault.paymentMethods, isSalesChannel: vault.isSalesChannel, isPaymentDestination: vault.isPaymentDestination }); setFormMode("edit"); };
  const togglePaymentMethod = (method: PaymentMethod) => setVaultForm((value) => ({ ...value, paymentMethods: value.paymentMethods.includes(method) ? value.paymentMethods.length > 1 ? value.paymentMethods.filter((item) => item !== method) : value.paymentMethods : [...value.paymentMethods, method] }));
  const openDetail = async (vault: Vault, cursor?: string) => {
    const current = activeSession();
    if (!current) return;
    setDetail(vault); setActivityLoading(true);
    try {
      const query = new URLSearchParams(baseerPeriodQuery(period));
      if (cursor) query.set("cursor", cursor);
      const next = await api<ActivityReceipt>(current, `/finance/treasury/${vault.id}/activity?${query.toString()}`);
      setActivity((previous) => cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.vaultActivity) }); }
    finally { setActivityLoading(false); }
  };

  const saveVault = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || saving) return;
    setSaving(true); setMessage({ kind: "idle", text: "" });
    try {
      if (formMode === "edit" && formTarget) await api(current, "/finance/vaults/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vaultId: formTarget.id, ...vaultForm, idempotencyKey: requestId() }) });
      else await api(current, "/finance/vaults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...vaultForm, idempotencyKey: requestId() }) });
      setFormMode(null); setMessage({ kind: "success", text: text.saveSucceeded }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.vaults) }); }
    finally { setSaving(false); }
  };

  const saveTransfer = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || saving) return;
    setSaving(true); setMessage({ kind: "idle", text: "" });
    try {
      await api(current, "/finance/treasury/transfers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...transfer, ...(transfer.notes.trim() ? { notes: transfer.notes.trim() } : {}), idempotencyKey: requestId() }) });
      setTransfer({ fromVaultId: "", toVaultId: "", amount: "", businessDate: "", notes: "" }); setShowTransfer(false); setMessage({ kind: "success", text: text.transferSaved }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.transfer) }); }
    finally { setSaving(false); }
  };

  const archiveVault = async () => {
    const current = activeSession(); if (!current || !archiveTarget || saving) return;
    setSaving(true); setMessage({ kind: "idle", text: "" });
    try {
      const receipt = await api<{ result: "deleted" | "archived" }>(current, "/finance/vaults/remove-or-archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vaultId: archiveTarget.id, idempotencyKey: requestId() }) });
      setArchiveTarget(null); setDetail(null); setMessage({ kind: "success", text: receipt.result === "archived" ? text.archiveSuccess : text.saveSucceeded }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.archiveVault) }); }
    finally { setSaving(false); }
  };

  const restoreVault = async (vault: Vault) => {
    const current = activeSession(); if (!current || saving) return;
    setSaving(true); setMessage({ kind: "idle", text: "" });
    try {
      await api(current, "/finance/vaults/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vaultId: vault.id, idempotencyKey: requestId() }) });
      setDetail(null); setMessage({ kind: "success", text: text.saveSucceeded }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.restoreVault) }); }
    finally { setSaving(false); }
  };

  if (!session) return <DailySalesSignIn language={language} />;
  const titleFor = (key: "channels" | "others" | "archived") => key === "channels" ? text.salesChannels : key === "others" ? text.otherVaults : text.archive;
  const defaultPeriod = defaultBaseerPeriodRange();
  const hasCustomPeriod = period.preset !== defaultPeriod.preset || period.from !== defaultPeriod.from || period.to !== defaultPeriod.to || period.months.join(",") !== defaultPeriod.months.join(",");
  const clearFilters = () => { setSearch(""); setShowArchived(false); setPeriod(defaultBaseerPeriodRange()); };
  const orderRows = orderDraft.map((id, index) => ({ id, index, vault: activeVaults.find((vault) => vault.id === id)! }));
  const appliedFilters = [
    ...(hasCustomPeriod ? [{ id: "period", label: baseerPeriodLabel(period, language), onRemove: () => setPeriod(defaultBaseerPeriodRange()) }] : []),
    ...(search.trim() ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }] : []),
    ...(showArchived ? [{ id: "archived", label: text.showArchived, onRemove: () => setShowArchived(false) }] : []),
  ];
  return <section className="daily-sales-workspace finance-setup-workspace" aria-label={text.vaults}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.vaults}</h3></div><div className="page-actions"><BaseerButton type="button" variant="secondary" onClick={openOrder}>{orderLabel}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={() => setShowTransfer(true)}>{text.transfer}</BaseerButton><BaseerButton type="button" variant="primary" onClick={openAdd}>{text.addVault}</BaseerButton></div></header>
    <BaseerFilterBar controlsPresentation="menu" language={language} search={search} searchLabel={text.vaults} searchPlaceholder={language === "ar" ? "ابحث باسم الخزينة أو البنك" : "Search vault or bank"} onSearchChange={setSearch} appliedFilters={appliedFilters} onClear={clearFilters} controls={<><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} /><BaseerFilterToggle label={text.showArchived} checked={showArchived} onChange={setShowArchived} /></>} />
    {message.kind !== "idle" ? <p className={`daily-sales-message ${message.kind}`}>{message.text}</p> : null}
    {!workspace ? <BaseerCard><p>{text.loadingVaults}</p></BaseerCard> : <>
      <BaseerSummaryMetricGrid className="treasury-summary-cards"><BaseerSummaryMetric tone="muted" label={text.currentBalance} value={formatMoney(workspace.summary.balanceAsOf)} /><BaseerSummaryMetric tone="muted" label={text.incoming} value={formatMoney(workspace.summary.inflow)} /><BaseerSummaryMetric tone="muted" label={text.outgoing} value={formatMoney(workspace.summary.outflow)} /></BaseerSummaryMetricGrid>
      {(["channels", "others", "archived"] as const).map((key) => <section key={key} className="treasury-vault-group"><header className="administration-section-heading"><h3>{titleFor(key)} <small>({groups[key].length})</small></h3></header><VaultCards vaults={groups[key]} language={language} text={text} onOpen={(vault) => void openDetail(vault)} onEdit={openEdit} onArchive={setArchiveTarget} onRestore={(vault) => void restoreVault(vault)} /></section>)}
    </>}
    <BaseerDialog open={formMode !== null} language={language} busy={saving} title={formMode === "edit" ? text.edit : text.addVault} onClose={() => setFormMode(null)} footer={<><BaseerButton type="button" onClick={() => setFormMode(null)}>{text.cancel}</BaseerButton><BaseerButton type="submit" variant="primary" form="vault-form" disabled={saving}>{saving ? text.saving : formMode === "edit" ? text.save : text.saveVault}</BaseerButton></>}><form id="vault-form" className="administration-form" onSubmit={(event) => void saveVault(event)}><label>{text.nameArabic}<input required value={vaultForm.nameAr} onChange={(event) => setVaultForm((value) => ({ ...value, nameAr: event.target.value }))} /></label><label>{text.nameEnglish}<input required value={vaultForm.nameEn} onChange={(event) => setVaultForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label>{text.vaultType}<select value={vaultForm.type} onChange={(event) => { const type = event.target.value as Vault["type"]; setVaultForm((value) => ({ ...value, type, paymentMethods: defaultPaymentMethods(type) })); }}><option value="CASH">{text.cash}</option><option value="BANK">{text.bank}</option><option value="APP">{text.app}</option></select></label><fieldset><legend>{text.paymentMethod}</legend>{paymentMethodOptions(vaultForm.type, text).map((option) => <label key={option.value}><input type="checkbox" disabled={!vaultForm.isPaymentDestination} checked={vaultForm.paymentMethods.includes(option.value)} onChange={() => togglePaymentMethod(option.value)} /> {option.label}</label>)}</fieldset><fieldset><legend>{text.vaults}</legend><label><input type="checkbox" checked={vaultForm.isSalesChannel} onChange={(event) => setVaultForm((value) => ({ ...value, isSalesChannel: event.target.checked }))} /> {text.collectionChannel}</label><label><input type="checkbox" checked={vaultForm.isPaymentDestination} onChange={(event) => setVaultForm((value) => ({ ...value, isPaymentDestination: event.target.checked }))} /> {text.paymentDestination}</label></fieldset></form></BaseerDialog>
    <BaseerDialog open={showOrder} language={language} busy={saving} title={orderLabel} onClose={() => setShowOrder(false)} footer={<><BaseerButton type="button" onClick={() => setShowOrder(false)}>{text.cancel}</BaseerButton><BaseerButton type="button" variant="primary" disabled={saving} onClick={() => void saveOrder()}>{saving ? text.saving : text.save}</BaseerButton></>}><DataTable ariaLabel={orderLabel} caption={orderLabel} columns={[{ id: "order", header: "#", align: "center", numeric: true, cell: (row) => row.index + 1 }, { id: "vault", header: text.vaults, cell: (row) => displayName(language, row.vault) }, { id: "actions", header: text.edit, align: "end", cell: (row) => <><BaseerButton type="button" disabled={row.index === 0} onClick={() => moveVault(row.index, -1)} aria-label={orderLabel}>↑</BaseerButton><BaseerButton type="button" disabled={row.index === orderRows.length - 1} onClick={() => moveVault(row.index, 1)} aria-label={orderLabel}>↓</BaseerButton></> }]} rows={orderRows} rowKey={(row) => row.id} /></BaseerDialog><BaseerDialog open={showTransfer} language={language} busy={saving} title={text.transfer} onClose={() => setShowTransfer(false)} footer={<><BaseerButton type="button" onClick={() => setShowTransfer(false)}>{text.cancel}</BaseerButton><BaseerButton type="submit" form="vault-transfer" variant="primary" disabled={saving}>{saving ? text.saving : text.saveTransfer}</BaseerButton></>}><form id="vault-transfer" className="administration-form" onSubmit={(event) => void saveTransfer(event)}><label>{text.fromVault}<select required value={transfer.fromVaultId} onChange={(event) => setTransfer((value) => ({ ...value, fromVaultId: event.target.value }))}><option value="">{text.selectVault}</option>{activeVaults.map((vault) => <option key={vault.id} value={vault.id}>{displayName(language, vault)}</option>)}</select></label><label>{text.toVault}<select required value={transfer.toVaultId} onChange={(event) => setTransfer((value) => ({ ...value, toVaultId: event.target.value }))}><option value="">{text.selectVault}</option>{activeVaults.filter((vault) => vault.id !== transfer.fromVaultId).map((vault) => <option key={vault.id} value={vault.id}>{displayName(language, vault)}</option>)}</select></label><label>{text.amount}<input required inputMode="decimal" value={transfer.amount} onChange={(event) => setTransfer((value) => ({ ...value, amount: event.target.value }))} /></label><BaseerDatePicker language={language} label={text.transferDate} max={workspace?.businessDate ?? ""} value={transfer.businessDate} onChange={(businessDate) => setTransfer((value) => ({ ...value, businessDate }))} /><label>{text.optionalNotes}<input value={transfer.notes} onChange={(event) => setTransfer((value) => ({ ...value, notes: event.target.value }))} /></label></form></BaseerDialog>
    <BaseerDialog open={detail !== null} language={language} title={detail ? `${text.vaults} — ${displayName(language, detail)}` : text.vaults} onClose={() => { setDetail(null); setActivity(null); }} footer={detail ? <><BaseerButton type="button" onClick={() => { setDetail(null); openEdit(detail); }}>{text.edit}</BaseerButton>{detail.status === "ARCHIVED" ? <BaseerButton type="button" variant="primary" disabled={saving} onClick={() => void restoreVault(detail)}>{text.restoreVault}</BaseerButton> : <BaseerButton type="button" variant="danger" disabled={saving} onClick={() => setArchiveTarget(detail)}>{text.archive}</BaseerButton>}</> : null}>{activityLoading || !activity ? <p>{text.loading}</p> : <ActivityPanel activity={activity} language={language} text={text} onMore={() => detail && void openDetail(detail, activity.nextCursor ?? undefined)} />}</BaseerDialog>
    <BaseerConfirmDialog open={archiveTarget !== null} title={text.archiveVault} message={archiveTarget ? `${text.archiveVault}: ${displayName(language, archiveTarget)}. ${text.archiveConfirmation}` : ""} confirmLabel={text.archive} destructive busy={saving} language={language} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archiveVault()} />
  </section>;
}

function VaultCards({ vaults, language, text, onOpen, onEdit, onArchive, onRestore }: { vaults: Vault[]; language: Language; text: ReturnType<typeof financeText>; onOpen: (vault: Vault) => void; onEdit: (vault: Vault) => void; onArchive: (vault: Vault) => void; onRestore: (vault: Vault) => void }) { if (!vaults.length) return <p className="empty-results">{text.noResults}</p>; return <div className="administration-role-cards treasury-vault-cards">{vaults.map((vault) => <BaseerCard key={vault.id} padding="compact" className={`baseer-metric-card${vault.status === "ARCHIVED" ? " baseer-metric-card--archived" : ""}`}><header className="baseer-metric-card__header"><div className="baseer-metric-card__identity"><span className="baseer-metric-card__icon"><VaultGlyph type={vault.type} /></span><span className="baseer-metric-card__copy"><strong>{displayName(language, vault)}</strong><small>{language === "ar" ? vault.nameEn : vault.nameAr}</small></span></div><details className="baseer-card-action-menu"><summary aria-label={text.vaultActivity}>⋮</summary><div role="menu"><button type="button" role="menuitem" className="baseer-card-action-menu__item" onClick={() => onOpen(vault)}>{text.vaultActivity}</button><button type="button" role="menuitem" className="baseer-card-action-menu__item" onClick={() => onEdit(vault)}>{text.edit}</button><button type="button" role="menuitem" className="baseer-card-action-menu__item is-warning" onClick={() => vault.status === "ARCHIVED" ? onRestore(vault) : onArchive(vault)}>{vault.status === "ARCHIVED" ? text.restoreVault : text.archive}</button></div></details></header><div className="baseer-metric-card__balance"><small>{text.currentBalance}</small><strong className={Number(vault.balanceAsOf) < 0 ? "is-negative" : undefined}>{formatMoney(vault.balanceAsOf)}</strong></div><div className="baseer-metric-card__flows"><span><small>↑ {text.incoming}</small><strong className="is-inflow">{formatMoney(vault.inflow)}</strong></span><span><small>↓ {text.outgoing}</small><strong>{formatMoney(vault.outflow)}</strong></span></div><footer className="baseer-metric-card__footer">{vault.paymentMethods.map((method) => <span className="daily-sales-badge" key={method}>{paymentMethodLabel(text, method)}</span>)}{vault.isSalesChannel ? <span className="daily-sales-badge">{text.salesChannel}</span> : null}{vault.isPaymentDestination ? <span className="daily-sales-badge">{text.paymentDestination}</span> : null}</footer></BaseerCard>)}</div>; }
function defaultPaymentMethods(type: Vault["type"]): PaymentMethod[] { return [type === "BANK" ? "BANK_TRANSFER" : type === "CASH" ? "CASH" : "APP"]; }
function paymentMethodOptions(type: Vault["type"], text: ReturnType<typeof financeText>) { return type === "BANK" ? [{ value: "BANK_TRANSFER" as const, label: text.bankTransfer }, { value: "BANK_CARD" as const, label: text.bankCard }, { value: "BANK_PAYMENT" as const, label: text.bankPayment }] : [{ value: defaultPaymentMethods(type)[0]!, label: type === "CASH" ? text.cash : text.app }]; }
function paymentMethodLabel(text: ReturnType<typeof financeText>, method: PaymentMethod) { return method === "BANK_TRANSFER" ? text.bankTransfer : method === "BANK_CARD" ? text.bankCard : method === "BANK_PAYMENT" ? text.bankPayment : method === "CASH" ? text.cash : text.app; }

function VaultGlyph({ type }: { type: Vault["type"] }) { return <span className={`baseer-vault-glyph baseer-vault-glyph--${type.toLowerCase()}`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" width="20" height="20"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M12 13h.01" /></svg></span>; }
function ActivityPanel({ activity, language, text, onMore }: { activity: ActivityReceipt; language: Language; text: ReturnType<typeof financeText>; onMore: () => void }) { const columns: DataTableColumn<ActivityItem>[] = [{ id: "date", header: language === "ar" ? "التاريخ" : "Date", cell: (item) => item.businessDate }, { id: "reference", header: language === "ar" ? "المرجع" : "Reference", cell: (item) => item.description ?? item.sourceReference }, { id: "counterpart", header: language === "ar" ? "الطرف المقابل" : "Counterpart", cell: (item) => language === "ar" ? item.counterpartNameAr ?? "—" : item.counterpartNameEn ?? "—" }, { id: "in", header: text.incoming, numeric: true, align: "end", cell: (item) => formatMoney(item.inflow) }, { id: "out", header: text.outgoing, numeric: true, align: "end", cell: (item) => formatMoney(item.outflow) }]; return <><div className="baseer-card-grid"><BaseerSummaryMetric tone="muted" label={text.currentBalance} value={formatMoney(activity.summary.balanceAsOf)} /><BaseerSummaryMetric tone="muted" label={text.incoming} value={formatMoney(activity.summary.inflow)} /><BaseerSummaryMetric tone="muted" label={text.outgoing} value={formatMoney(activity.summary.outflow)} /></div>{activity.items.length ? <DataTable ariaLabel={text.vaultActivity} caption={text.vaultActivity} columns={columns} rows={activity.items} rowKey={(item) => item.id} /> : <p className="empty-results">{text.noMovements}</p>}{activity.nextCursor ? <BaseerButton type="button" disabled={false} onClick={onMore}>{text.loadMore}</BaseerButton> : null}</>; }

import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { activeSession, api, listAvailableCompanies, type AvailableCompany } from "./daily-sales-client";
import { formatMoney, formatNumberFixed, normalizeBaseerNumericInput } from "./number-format";
import { BaseerEmptyState, BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import "./vat-simulation-shell.css";

const VatSimulationEditorDialog = lazy(async () => ({ default: (await import("./vat-simulation-editor-dialog")).VatSimulationEditorDialog }));

type Language = "ar" | "en";
type Simulation = Readonly<{
  id: string; year: number; quarter: number; vatRateBasisPoints: number;
  salesTaxableAmount: string; outputVatAmount: string; purchasesTaxableAmount: string; inputVatAmount: string;
  priorAdjustments: string; balanceCarried: string; paymentTarget: string | null; notes: string | null;
  sourceLedgerRevision: string | null; sourceImportedAt: string | null; updatedAt: string;
}>;
type Draft = Omit<Simulation, "id" | "updatedAt">;
type Message = { tone: "success" | "warning" | "danger"; text: string } | null;
type SimulationList = { vatRateBasisPoints: number; simulations: Simulation[] };
type OverviewRow = { companyId: string; companyName: string; year: number; simulations: readonly Simulation[] };
type VatReport = { state: "NOT_READY"; messageAr: string } | {
  state: "NO_DATA" | "READY"; ledgerRevision: string;
  rows: readonly { code: "output_vat" | "input_vat" | "vat_paid" | "vat_refunded"; amount: { raw: string } }[];
};

const copy = {
  ar: {
    eyebrow: "التقارير ← الضرائب", title: "محاكاة VAT",
    company: "الشركة", companyPlaceholder: "اختر الشركة", year: "السنة", quarter: "الربع", sales: "المبيعات",
    purchases: "المشتريات", inputs: "المدخلات", results: "النتائج", beforeVat: "قبل الضريبة", vatAmount: "قيمة VAT", totalIncludingVat: "الإجمالي شامل الضريبة", target: "مبلغ الدفع المستهدف", save: "حفظ المحاكاة", add: "إضافة محاكاة", delete: "حذف المحاكاة", deleteTitle: "تأكيد حذف المحاكاة", deleting: "جارٍ الحذف…", deleted: "تم حذف المحاكاة.", deleteConfirm: "هل تريد حذف هذه المحاكاة؟ لا يمكن التراجع عن الحذف.", copyValue: "نسخ الرقم", copied: "تم النسخ", copyFailed: "تعذر نسخ الرقم.",
    saving: "جارٍ الحفظ…", saved: "تم حفظ المحاكاة.", import: "استيراد التقرير",
    importing: "جارٍ الاستيراد…", rate: "نسبة VAT", net: "صافي المستحق الحالي",
    totalPurchases: "إجمالي المشتريات بعد التعديل", additionalPurchases: "المشتريات الإضافية المطلوبة",
    previous: "المحاكاة السابقة", open: "فتح وتعديل", empty: "لا توجد محاكاة محفوظة لهذه الشركة والسنة.",
    allSimulations: "كل المحاكاة المحفوظة", loadingSimulations: "جارٍ تحميل المحاكاة…", noSavedSimulations: "لا توجد محاكاة محفوظة حتى الآن.", companyColumn: "الشركة",
    newQuarter: "محاكاة جديدة", source: "تم الاستيراد من إصدار دفتر الأستاذ", noSource: "مدخلات يدوية",
    noCompany: "اختر شركة لعرض محاكاتها.", noCompanies: "لا توجد شركة متاحة تملك صلاحية التقارير.",
    failed: "تعذر تحميل المحاكاة. حاول مرة أخرى.",
  },
  en: {
    eyebrow: "Reports → Tax", title: "VAT simulation",
    company: "Company", companyPlaceholder: "Select a company", year: "Year", quarter: "Quarter", sales: "Sales",
    purchases: "Purchases", inputs: "Inputs", results: "Results", beforeVat: "Before VAT", vatAmount: "VAT amount", totalIncludingVat: "Total including VAT", target: "Target payment amount", save: "Save simulation", add: "Add simulation", delete: "Delete simulation", deleteTitle: "Confirm simulation deletion", deleting: "Deleting…", deleted: "Simulation deleted.", deleteConfirm: "Delete this simulation? This cannot be undone.", copyValue: "Copy number", copied: "Copied", copyFailed: "The number could not be copied.",
    saving: "Saving…", saved: "Simulation saved.", import: "Import report",
    importing: "Importing…", rate: "VAT rate", net: "Current net due",
    totalPurchases: "Total purchases after adjustment", additionalPurchases: "Additional purchases required",
    previous: "Saved simulations", open: "Open and edit", empty: "No saved simulation for this company and year.",
    allSimulations: "All saved simulations", loadingSimulations: "Loading simulations…", noSavedSimulations: "No simulations have been saved yet.", companyColumn: "Company",
    newQuarter: "New simulation", source: "Imported from ledger revision", noSource: "Manual inputs",
    noCompany: "Select a company to view its simulations.", noCompanies: "No report-enabled company is available.",
    failed: "The simulation could not be loaded. Try again.",
  },
} as const;

function initialDraft(year: number, quarter: number, rate: number): Draft {
  return { year, quarter, vatRateBasisPoints: rate, salesTaxableAmount: "0", outputVatAmount: "0", purchasesTaxableAmount: "0", inputVatAmount: "0", priorAdjustments: "0", balanceCarried: "0", paymentTarget: "0", notes: null, sourceLedgerRevision: null, sourceImportedAt: null };
}
function draftOf(value: Simulation): Draft { const { id: _id, updatedAt: _updatedAt, ...draft } = value; return draft; }
function numberOf(value: string | null | undefined) { const result = Number(value ?? 0); return Number.isFinite(result) ? result : 0; }
function apiAmount(value: number) { return String(Math.round(value * 10_000) / 10_000); }
function quarterRange(year: number, quarter: number) {
  const first = (quarter - 1) * 3 + 1;
  const last = first + 2;
  return { from: `${year}-${String(first).padStart(2, "0")}-01`, to: `${year}-${String(last).padStart(2, "0")}-${new Date(Date.UTC(year, last, 0)).getUTCDate()}` };
}

export function VatSimulationWorkspace({ language }: { language: Language }) {
  const text = copy[language];
  const [session] = useState(activeSession);
  const [companies, setCompanies] = useState<readonly AvailableCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [rate, setRate] = useState(1500);
  const [simulations, setSimulations] = useState<readonly Simulation[]>([]);
  const [overviewRows, setOverviewRows] = useState<readonly OverviewRow[]>([]);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(year, quarter, 1500));
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [busy, setBusy] = useState<"import" | "save" | "delete" | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const years = useMemo(() => Array.from({ length: Math.max(1, new Date().getFullYear() - 2024 + 1) }, (_, index) => 2024 + index), []);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    void listAvailableCompanies(session).then((items) => {
      if (!disposed) setCompanies(items.filter((item) => item.permissionCodes.includes("reports.read")));
    }).catch(() => { if (!disposed) setMessage({ tone: "danger", text: text.failed }); });
    return () => { disposed = true; };
  }, [session, text.failed]);

  useEffect(() => {
    if (!session || !companies.length) { setOverviewRows([]); return; }
    let disposed = false;
    setOverviewLoading(true);
    void Promise.all(companies.flatMap((company) => years.map(async (overviewYear) => {
      const result = await api<SimulationList>(session, `/reports/vat-simulations?year=${overviewYear}`, { headers: { "X-Baseer-Company-Id": company.id } });
      return { companyId: company.id, companyName: language === "ar" ? company.nameAr : company.nameEn || company.nameAr, year: overviewYear, simulations: result.simulations } satisfies OverviewRow;
    }))).then((rows) => {
      if (!disposed) setOverviewRows(rows.filter((row) => row.simulations.length).sort((left, right) => left.companyName.localeCompare(right.companyName) || right.year - left.year));
    }).catch((error) => {
      if (!disposed) setMessage({ tone: "danger", text: presentBaseerApiError(error, language, text.failed) });
    }).finally(() => { if (!disposed) setOverviewLoading(false); });
    return () => { disposed = true; };
  }, [companies, language, session, text.failed, years]);

  useEffect(() => {
    if (!session || !companyId) { setSimulations([]); return; }
    let disposed = false;
    setMessage(null);
    void api<SimulationList>(session, `/reports/vat-simulations?year=${year}`, { headers: { "X-Baseer-Company-Id": companyId } })
      .then((result) => { if (!disposed) { setRate(result.vatRateBasisPoints); setSimulations(result.simulations); } })
      .catch((error) => { if (!disposed) setMessage({ tone: "danger", text: presentBaseerApiError(error, language, text.failed) }); });
    return () => { disposed = true; };
  }, [companyId, language, session, text.failed, year]);

  const selected = useMemo(() => simulations.find((item) => item.quarter === quarter) ?? null, [quarter, simulations]);
  useEffect(() => { setDraft(selected ? draftOf(selected) : initialDraft(year, quarter, rate)); }, [quarter, rate, selected, year]);
  const taxRate = draft.vatRateBasisPoints / 10_000;
  const net = numberOf(draft.outputVatAmount) - numberOf(draft.inputVatAmount);
  const targetPayment = Math.max(0, numberOf(draft.paymentTarget));
  const totalRequiredInputVat = Math.max(0, numberOf(draft.outputVatAmount) - targetPayment);
  const totalRequiredPurchases = taxRate > 0 ? totalRequiredInputVat / taxRate : 0;
  const additionalPurchases = Math.max(0, totalRequiredPurchases - numberOf(draft.purchasesTaxableAmount));
  const cleanTotalPurchases = apiAmount(totalRequiredPurchases);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const setTaxable = (field: "salesTaxableAmount" | "purchasesTaxableAmount", value: string) => {
    const normalized = normalizeBaseerNumericInput(value);
    const vat = apiAmount(numberOf(normalized) * taxRate);
    setDraft((current) => field === "salesTaxableAmount" ? { ...current, salesTaxableAmount: normalized, outputVatAmount: vat } : { ...current, purchasesTaxableAmount: normalized, inputVatAmount: vat });
  };
  const copyTotalPurchases = async () => {
    try {
      await navigator.clipboard.writeText(cleanTotalPurchases);
      setCopiedValue(cleanTotalPurchases);
    } catch {
      setMessage({ tone: "danger", text: text.copyFailed });
    }
  };
  const openOverviewSimulation = (row: OverviewRow, item: Simulation) => {
    if (editorOpen && companyId === row.companyId && year === row.year && quarter === item.quarter) { setEditorOpen(false); return; }
    setCompanyId(row.companyId); setYear(row.year); setQuarter(item.quarter); setDraft(draftOf(item)); setEditorOpen(true);
  };
  const startNewSimulation = () => {
    const nextCompanyId = companyId || companies[0]?.id;
    if (!nextCompanyId) { setMessage({ tone: "warning", text: text.noCompany }); return; }
    const nextQuarter = nextCompanyId === companyId ? ([1, 2, 3, 4].find((item) => !simulations.some((simulation) => simulation.quarter === item)) ?? quarter) : quarter;
    setCompanyId(nextCompanyId); setQuarter(nextQuarter); setDraft(initialDraft(year, nextQuarter, rate)); setEditorOpen(true);
  };
  const importReport = async () => {
    if (!session || !companyId) return;
    setBusy("import"); setMessage(null);
    try {
      const period = quarterRange(year, quarter);
      const report = await api<VatReport>(session, `/reports/internal-vat?from=${period.from}&to=${period.to}`, { headers: { "X-Baseer-Company-Id": companyId } });
      if (report.state === "NOT_READY") { setMessage({ tone: "warning", text: report.messageAr }); return; }
      const output = report.rows.find((row) => row.code === "output_vat")?.amount.raw ?? "0";
      const input = report.rows.find((row) => row.code === "input_vat")?.amount.raw ?? "0";
      setDraft((current) => ({ ...current, outputVatAmount: output, inputVatAmount: input, salesTaxableAmount: taxRate ? apiAmount(numberOf(output) / taxRate) : "0", purchasesTaxableAmount: taxRate ? apiAmount(numberOf(input) / taxRate) : "0", sourceLedgerRevision: report.ledgerRevision, sourceImportedAt: new Date().toISOString() }));
    } catch (error) { setMessage({ tone: "danger", text: presentBaseerApiError(error, language, text.import) }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!session || !companyId) return;
    setBusy("save"); setMessage(null);
    try {
      const saved = await api<Simulation>(session, "/reports/vat-simulations", {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Baseer-Company-Id": companyId },
        body: JSON.stringify({ year, quarter, salesTaxableAmount: draft.salesTaxableAmount, outputVatAmount: draft.outputVatAmount, purchasesTaxableAmount: draft.purchasesTaxableAmount, inputVatAmount: draft.inputVatAmount, priorAdjustments: "0", balanceCarried: "0", paymentTarget: draft.paymentTarget?.trim() || null, notes: null, sourceLedgerRevision: draft.sourceLedgerRevision }),
      });
      setSimulations((items) => [...items.filter((item) => item.quarter !== quarter), saved].sort((left, right) => left.quarter - right.quarter));
      const company = companies.find((item) => item.id === companyId);
      const companyName = company ? (language === "ar" ? company.nameAr : company.nameEn || company.nameAr) : companyId;
      setOverviewRows((rows) => {
        const existing = rows.find((row) => row.companyId === companyId && row.year === year);
        const updated = existing
          ? { ...existing, simulations: [...existing.simulations.filter((item) => item.quarter !== quarter), saved].sort((left, right) => left.quarter - right.quarter) }
          : { companyId, companyName, year, simulations: [saved] };
        return [...rows.filter((row) => row !== existing), updated].sort((left, right) => left.companyName.localeCompare(right.companyName) || right.year - left.year);
      });
      setMessage({ tone: "success", text: text.saved });
    } catch (error) { setMessage({ tone: "danger", text: presentBaseerApiError(error, language, text.save) }); }
    finally { setBusy(null); }
  };

  const removeSimulation = async () => {
    if (!session || !companyId || !selected) return;
    setDeleteConfirmOpen(false);
    setBusy("delete"); setMessage(null);
    try {
      await api<{ id: string }>(session, `/reports/vat-simulations/${selected.id}`, { method: "DELETE", headers: { "X-Baseer-Company-Id": companyId } });
      setSimulations((items) => items.filter((item) => item.id !== selected.id));
      setOverviewRows((rows) => rows.flatMap((row) => {
        if (row.companyId !== companyId || row.year !== year) return [row];
        const next = row.simulations.filter((item) => item.id !== selected.id);
        return next.length ? [{ ...row, simulations: next }] : [];
      }));
      setEditorOpen(false); setMessage({ tone: "success", text: text.deleted });
    } catch (error) { setMessage({ tone: "danger", text: presentBaseerApiError(error, language, text.delete) }); }
    finally { setBusy(null); }
  };

  if (!session) return <BaseerWorkspace><BaseerNotice tone="danger">{language === "ar" ? "سجّل الدخول أولًا لاستخدام المحاكاة." : "Sign in to use the simulation."}</BaseerNotice></BaseerWorkspace>;
  return <BaseerWorkspace className="vat-simulation-workspace"><div className="vat-simulation-workspace__content" dir={language === "ar" ? "rtl" : "ltr"}>
    <BaseerSectionHeader eyebrow={text.eyebrow} title={text.title} actions={<BaseerButton type="button" variant="primary" onClick={startNewSimulation}>{text.add}</BaseerButton>} />
    <BaseerCard variant="form-or-receipt" className="vat-simulation-workspace__scope" padding="compact">
      <div className="vat-simulation-workspace__scope-field vat-simulation-workspace__scope-field--company">
        <span>{text.company}</span>
        <div className="vat-simulation-workspace__company-buttons" role="group" aria-label={text.company}>
          {companies.map((company) => <BaseerButton key={company.id} type="button" variant={company.id === companyId ? "primary" : "secondary"} className={company.id === companyId ? "is-selected" : undefined} aria-pressed={company.id === companyId} onClick={() => setCompanyId(company.id)}>{language === "ar" ? company.nameAr : company.nameEn || company.nameAr}</BaseerButton>)}
        </div>
      </div>
      <label className="vat-simulation-workspace__scope-field">
        <span>{text.year}</span>
        <select dir="ltr" lang="en" value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </label>
    </BaseerCard>
    {!companies.length ? <BaseerEmptyState title={text.noCompanies} description="" /> : null}
    {companies.length ? <BaseerCard variant="joined-ledger" className="vat-simulation-workspace__overview" padding="compact"><header><h3>{text.allSimulations}</h3></header>{overviewLoading ? <p>{text.loadingSimulations}</p> : overviewRows.length ? <div className="vat-simulation-workspace__overview-table" role="region" aria-label={text.allSimulations} tabIndex={0}><table><thead><tr><th scope="col">{text.companyColumn}</th><th scope="col">{text.year}</th>{([1, 2, 3, 4] as const).map((item) => <th key={item} scope="col">Q{item}</th>)}</tr></thead><tbody>{overviewRows.map((row) => <tr key={`${row.companyId}:${row.year}`}><th scope="row">{row.companyName}</th><td dir="ltr">{row.year}</td>{([1, 2, 3, 4] as const).map((item) => { const record = row.simulations.find((simulation) => simulation.quarter === item); const isOpen = editorOpen && companyId === row.companyId && year === row.year && quarter === item; return <td key={item}>{record ? <button type="button" className={isOpen ? "is-open" : undefined} onClick={() => openOverviewSimulation(row, record)} aria-pressed={isOpen} aria-label={`${row.companyName} · ${row.year} · Q${item}`} dir="ltr">{formatMoney(numberOf(record.outputVatAmount) - numberOf(record.inputVatAmount), "SAR", language)}</button> : "—"}</td>; })}</tr>)}</tbody></table></div> : <p>{text.noSavedSimulations}</p>}</BaseerCard> : null}
    {!companyId && companies.length ? <BaseerNotice>{text.noCompany}</BaseerNotice> : null}
    {message ? <BaseerNotice tone={message.tone}>{message.text}</BaseerNotice> : null}
    {editorOpen && companyId ? <Suspense fallback={<BaseerCard aria-busy="true"><p role="status">{text.loadingSimulations}</p></BaseerCard>}><VatSimulationEditorDialog open language={language} title={selected ? `Q${quarter} · ${year}` : text.add} quarter={quarter} year={year} selected={Boolean(selected)} busy={busy} draft={draft} net={net} additionalPurchases={additionalPurchases} totalRequiredPurchases={totalRequiredPurchases} copied={copiedValue === cleanTotalPurchases} labels={{ add: text.add, delete: text.delete, deleting: text.deleting, save: text.save, saving: text.saving, inputs: text.inputs, quarter: text.quarter, import: text.import, importing: text.importing, sales: text.sales, purchases: text.purchases, beforeVat: text.beforeVat, target: text.target, results: text.results, vatAmount: text.vatAmount, net: text.net, additionalPurchases: text.additionalPurchases, totalPurchases: text.totalPurchases, copyValue: text.copyValue, copied: text.copied }} onClose={() => { setDeleteConfirmOpen(false); setEditorOpen(false); }} onQuarterChange={setQuarter} onImport={() => void importReport()} onTaxableChange={setTaxable} onTargetChange={(value) => setDraft((current) => ({ ...current, paymentTarget: value || null }))} onCopy={() => void copyTotalPurchases()} onDelete={() => setDeleteConfirmOpen(true)} onSave={() => void save()} /></Suspense> : null}
    <BaseerConfirmDialog open={deleteConfirmOpen} title={text.deleteTitle} message={text.deleteConfirm} confirmLabel={text.delete} destructive busy={busy === "delete"} language={language} onCancel={() => !busy && setDeleteConfirmOpen(false)} onConfirm={() => void removeSimulation()} />
  </div></BaseerWorkspace>;
}

import { Fragment } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { FinancialEvidenceDialog, type FinancialEvidenceMoney } from "./financial-evidence-dialog";
import { formatCount, formatDate, formatMoney } from "./number-format";
import "./command-center-workspace.css";

type Language = "ar" | "en";
type MoneyDisplay = Readonly<{ raw: string; display: string; sign: "positive" | "negative" | "zero" }>;
type FinancialEvidence = Readonly<{ items: readonly Readonly<{ evidenceId: string; businessDate: string; amount: MoneyDisplay; source: { journalEntryId: string; labelAr: string; labelEn: string; reference: string; counterparty?: { labelAr: string; labelEn: string } | null; origin?: { labelAr: string; labelEn: string; route: string } | null } }>[] }>;
type SourceJournal = Readonly<{ journalEntry: { businessDate: string; labelAr?: string; labelEn?: string; sourceType?: string; sourceReference: string; description: string | null; counterparty?: { labelAr: string; labelEn: string } | null; status: "POSTED" | "REVERSED"; lines: readonly { id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debit: MoneyDisplay; credit: MoneyDisplay }[] } }>;

function MoneyValue({ money, language, onClick, label }: { money: MoneyDisplay; language: Language; onClick?: () => void; label?: string }) {
  const value = <bdi className={`command-center__money ${money.sign === "negative" ? "is-negative" : money.sign === "positive" ? "is-positive" : ""}`} dir="ltr">{money.sign === "negative" ? "−" : ""}{formatMoney(Math.abs(Number(money.raw)), "SAR", language)}</bdi>;
  return onClick ? <button type="button" className="command-center__amount-link" onClick={onClick} aria-label={label}>{value}</button> : value;
}

function EvidenceTable({ language, items, selectedEventId, detailsLabel, onSelect, onOpenSource, openSourceLabel, openLocationLabel }: { language: Language; items: FinancialEvidence["items"]; selectedEventId: string | null; detailsLabel: string; onSelect: (eventId: string) => void; onOpenSource: (eventId: string) => void; openSourceLabel: string; openLocationLabel: string }) {
  return <div className="command-center__evidence-table-shell"><table className="command-center__evidence-table"><thead><tr><th>{language === "ar" ? "العملية" : "Operation"}</th><th>{language === "ar" ? "المرجع والتاريخ" : "Reference and date"}</th><th>{language === "ar" ? "المبلغ" : "Amount"}</th></tr></thead><tbody>{items.map((item) => <Fragment key={item.evidenceId}><tr><td><strong>{language === "ar" ? item.source.labelAr : item.source.labelEn || item.source.labelAr}</strong>{item.source.origin ? <small>{language === "ar" ? item.source.origin.labelAr : item.source.origin.labelEn}</small> : null}</td><td><bdi dir="ltr">{item.source.reference}</bdi><small dir="ltr">{formatDate(item.businessDate, language)}</small></td><td><MoneyValue money={item.amount} language={language} label={`${detailsLabel} — ${item.source.reference}`} onClick={() => onSelect(item.evidenceId)} /></td></tr>{selectedEventId === item.evidenceId ? <tr className="command-center__evidence-table-actions"><td colSpan={3}><BaseerButton type="button" variant="secondary" onClick={() => onOpenSource(item.evidenceId)}>{openSourceLabel}</BaseerButton>{item.source.origin ? <BaseerButton type="button" variant="quiet" onClick={() => { window.location.hash = item.source.origin!.route; }}>{openLocationLabel}</BaseerButton> : null}</td></tr> : null}</Fragment>)}</tbody></table></div>;
}

function SourceJournalView({ language, source, reference, onBack, backLabel, debitLabel, creditLabel }: { language: Language; source: SourceJournal; reference: string | null; onBack: () => void; backLabel: string; debitLabel: string; creditLabel: string }) {
  const entry = source.journalEntry;
  return <div className="command-center__source-journal" dir={language === "ar" ? "rtl" : "ltr"}><BaseerButton type="button" variant="secondary" onClick={onBack}>{backLabel}</BaseerButton><p><strong dir="ltr">{reference ?? entry.sourceReference}</strong> · <bdi dir="ltr">{formatDate(entry.businessDate, language)}</bdi>{entry.description ? ` · ${entry.description}` : ""}</p><table><thead><tr><th>#</th><th>{language === "ar" ? "الحساب" : "Account"}</th><th>{debitLabel}</th><th>{creditLabel}</th></tr></thead><tbody>{entry.lines.map((line) => <tr key={line.id}><td><bdi dir="ltr">{formatCount(line.lineNumber, language)}</bdi></td><td>{line.accountCode} · {language === "ar" ? line.accountNameAr : line.accountNameEn}</td><td dir="ltr">{formatMoney(line.debit.raw, "SAR", language)}</td><td dir="ltr">{formatMoney(line.credit.raw, "SAR", language)}</td></tr>)}</tbody></table></div>;
}

type EvidencePanelProps = { language: Language; title: string; busy: boolean; onClose: () => void; onOpenDialog?: () => void; onRetry: () => void; message: string; selectedEventId: string | null; onSelect: (eventId: string) => void; onOpenSource: (eventId: string) => void; onBack: () => void; evidence: FinancialEvidence | null; source: SourceJournal | null; reference: string | null; labels: { retry: string; close: string; openWindow: string; loadingOperations: string; noOperations: string; details: string; openSource: string; openLocation: string; back: string; debit: string; credit: string } };

function EvidenceContent({ language, busy: _busy, onRetry, message, selectedEventId, onSelect, onOpenSource, onBack, evidence, source, reference, labels }: Omit<EvidencePanelProps, "title" | "onClose">) {
  return source ? <SourceJournalView language={language} source={source} reference={reference} onBack={onBack} backLabel={labels.back} debitLabel={labels.debit} creditLabel={labels.credit} /> : message ? <><p className="command-center__evidence-message is-error">{message}</p><BaseerButton type="button" variant="secondary" onClick={onRetry}>{labels.retry}</BaseerButton></> : !evidence ? <p className="command-center__evidence-message">{labels.loadingOperations}</p> : evidence.items.length ? <EvidenceTable language={language} items={evidence.items} selectedEventId={selectedEventId} detailsLabel={labels.details} onSelect={onSelect} onOpenSource={onOpenSource} openSourceLabel={labels.openSource} openLocationLabel={labels.openLocation} /> : <p className="command-center__evidence-message">{labels.noOperations}</p>;
}

/** Inline companion for the Command Center cash-movement report. */
export function CommandCenterEvidencePanel({ language, title, busy, onClose, onOpenDialog, ...props }: EvidencePanelProps) {
  return <BaseerCard className="command-center__cash-detail" padding="compact" variant="record" aria-busy={busy}><header className="command-center__cash-detail-header"><h3>{title}</h3><span>{onOpenDialog ? <BaseerButton type="button" variant="quiet" onClick={onOpenDialog}>{props.labels.openWindow}</BaseerButton> : null}<BaseerButton type="button" variant="quiet" onClick={onClose}>{props.labels.close}</BaseerButton></span></header><EvidenceContent language={language} busy={busy} {...props} /></BaseerCard>;
}

export function CommandCenterEvidenceDialog({ open, language, title, amount, shareOfBasePercent, busy, onClose, onRetry, message, selectedEventId: _selectedEventId, onSelect: _onSelect, onOpenSource, onBack, evidence, source, reference: _reference, labels }: { open: boolean; language: Language; title: string; amount?: FinancialEvidenceMoney | null; shareOfBasePercent?: string | null; busy: boolean; onClose: () => void; onRetry: () => void; message: string; selectedEventId: string | null; onSelect: (eventId: string) => void; onOpenSource: (eventId: string) => void; onBack: () => void; evidence: FinancialEvidence | null; source: SourceJournal | null; reference: string | null; labels: { retry: string; close: string; openWindow: string; loadingOperations: string; noOperations: string; details: string; openSource: string; openLocation: string; back: string; debit: string; credit: string } }) {
  const entry = source?.journalEntry;
  return <FinancialEvidenceDialog
    open={open}
    language={language}
    title={title}
    amount={amount}
    shareOfBasePercent={shareOfBasePercent}
    shareLabel={language === "ar" ? "من المبيعات المحصلة" : "Of collected sales"}
    loading={busy}
    error={message || null}
    operations={evidence ? evidence.items.map((item) => ({
      id: item.evidenceId,
      kind: language === "ar" ? item.source.labelAr : item.source.labelEn || item.source.labelAr,
      counterparty: item.source.counterparty ? (language === "ar" ? item.source.counterparty.labelAr : item.source.counterparty.labelEn || item.source.counterparty.labelAr) : null,
      reference: item.source.reference,
      businessDate: item.businessDate,
      amount: item.amount,
      origin: item.source.origin ? (language === "ar" ? item.source.origin.labelAr : item.source.origin.labelEn || item.source.origin.labelAr) : null,
    })) : null}
    journal={entry ? {
      reference: entry.sourceReference,
      businessDate: entry.businessDate,
      description: [
        language === "ar" ? entry.labelAr : entry.labelEn || entry.labelAr,
        entry.counterparty ? `${language === "ar" ? "المورد / الجهة" : "Supplier / party"}: ${language === "ar" ? entry.counterparty.labelAr : entry.counterparty.labelEn || entry.counterparty.labelAr}` : null,
        entry.description,
      ].filter(Boolean).join(" · "),
      status: entry.status,
      lines: entry.lines.map((line) => ({ id: line.id, lineNumber: line.lineNumber, accountCode: line.accountCode, accountName: language === "ar" ? line.accountNameAr : line.accountNameEn || line.accountNameAr, debitAmount: line.debit.raw, creditAmount: line.credit.raw })),
    } : null}
    onRetry={onRetry}
    onOpenJournal={(eventId) => onOpenSource(eventId)}
    onOpenOrigin={(operation) => {
      const item = evidence?.items.find((candidate) => candidate.evidenceId === operation.id);
      if (item?.source.origin) window.location.hash = item.source.origin.route;
    }}
    onBackToOperations={onBack}
    onClose={onClose}
  />;
}

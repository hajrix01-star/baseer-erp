import { useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import { formatDate, formatMoney, formatPercent, type BaseerLanguage } from "./number-format";
import "./financial-evidence-dialog.css";

export type FinancialEvidenceMoney = Readonly<{
  raw: string;
  display: string;
  sign: "positive" | "negative" | "zero";
}>;

/**
 * The presentation contract deliberately contains identifiers and labels only.
 * Evidence pages and source journals remain owned by the report reader on the
 * server; this component never derives a list of operations from a total.
 */
export type FinancialEvidenceOperation = Readonly<{
  id: string;
  kind: string;
  counterparty?: string | null;
  reference: string;
  businessDate: string;
  amount: FinancialEvidenceMoney;
  origin?: string | null;
}>;

export type FinancialEvidenceJournal = Readonly<{
  reference: string;
  businessDate: string;
  description?: string | null;
  status?: "POSTED" | "REVERSED" | null;
  lines: readonly Readonly<{
    id: string;
    lineNumber: number;
    accountCode: string;
    accountName: string;
    debitAmount: string;
    creditAmount: string;
  }>[];
}>;

type Props = Readonly<{
  open: boolean;
  language: BaseerLanguage;
  /** The financial item that the user clicked, such as "Purchases". */
  title: string;
  amount?: FinancialEvidenceMoney | null;
  shareOfBasePercent?: string | null;
  shareLabel?: string;
  operations?: readonly FinancialEvidenceOperation[] | null;
  journal?: FinancialEvidenceJournal | null;
  loading?: boolean;
  error?: string | null;
  nextPageAvailable?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
  /** Invoked with a server-issued evidence operation id; it must fetch the journal. */
  onOpenJournal?: (operationId: string) => void;
  onOpenOrigin?: (operation: FinancialEvidenceOperation) => void;
  onBackToOperations?: () => void;
  onClose: () => void;
}>;

const copy = {
  ar: {
    amount: "مبلغ البند",
    share: "من الإجمالي",
    operations: "العمليات المكوِّنة للمبلغ",
    operation: "العملية",
    counterparty: "الجهة",
    reference: "المرجع",
    date: "التاريخ",
    amountColumn: "المبلغ",
    openJournal: "فتح القيد",
    openOrigin: "فتحها في قسمها",
    more: "تحميل المزيد",
    retry: "إعادة المحاولة",
    close: "إغلاق",
    back: "العودة للعمليات",
    loading: "جارٍ تحميل العمليات…",
    empty: "لا توجد عمليات مصدر لهذا البند ضمن الفترة المحددة.",
    journal: "القيد المصدر",
    debit: "مدين",
    credit: "دائن",
    posted: "مثبت",
    reversed: "ملغى",
  },
  en: {
    amount: "Line amount",
    share: "Of total",
    operations: "Operations behind this amount",
    operation: "Operation",
    counterparty: "Party",
    reference: "Reference",
    date: "Date",
    amountColumn: "Amount",
    openJournal: "Open journal",
    openOrigin: "Open in its area",
    more: "Load more",
    retry: "Retry",
    close: "Close",
    back: "Back to operations",
    loading: "Loading operations…",
    empty: "There are no source operations for this item in the selected period.",
    journal: "Source journal",
    debit: "Debit",
    credit: "Credit",
    posted: "Posted",
    reversed: "Reversed",
  },
} as const;

function Money({ money, language }: { money: FinancialEvidenceMoney; language: BaseerLanguage }) {
  const value = money.display || formatMoney(Math.abs(Number(money.raw)), "SAR", language);
  return <bdi className={`financial-evidence-dialog__money${money.sign === "negative" ? " is-negative" : money.sign === "positive" ? " is-positive" : ""}`} dir="ltr">{money.sign === "negative" ? "−" : ""}{value}</bdi>;
}

/**
 * Shared evidence window for financial totals across reports and the Command
 * Center. It is intentionally display-only: callers provide data from the
 * appropriate live or frozen report evidence endpoint.
 */
export function FinancialEvidenceDialog({ open, language, title, amount, shareOfBasePercent, shareLabel, operations, journal, loading = false, error, nextPageAvailable = false, onLoadMore, onRetry, onOpenJournal, onOpenOrigin, onBackToOperations, onClose }: Props) {
  const text = copy[language];
  const [expandedOperationId, setExpandedOperationId] = useState<string | null>(null);
  const dialogTitle = journal ? text.journal : title;
  const shownShareLabel = shareLabel ?? text.share;

  const close = () => {
    setExpandedOperationId(null);
    onClose();
  };

  const back = () => {
    setExpandedOperationId(null);
    onBackToOperations?.();
  };

  return <BaseerDialog open={open} size="wide" language={language} title={dialogTitle} busy={loading} onClose={close} className="financial-evidence-dialog" footer={<BaseerButton type="button" onClick={close}>{text.close}</BaseerButton>}>
    <section className="financial-evidence-dialog__content" dir={language === "ar" ? "rtl" : "ltr"} aria-live="polite">
      {journal ? <JournalView language={language} journal={journal} text={text} onBack={back} /> : <>
        {amount ? <header className="financial-evidence-dialog__summary">
          <div><span>{text.amount}</span><Money money={amount} language={language} /></div>
          {shareOfBasePercent !== null && shareOfBasePercent !== undefined ? <div><span>{shownShareLabel}</span><bdi dir="ltr">{formatPercent(shareOfBasePercent, language)}</bdi></div> : null}
        </header> : null}

        <div className="financial-evidence-dialog__section-heading"><h4>{text.operations}</h4><span>{operations?.length ?? 0}</span></div>
        {error ? <div className="financial-evidence-dialog__state is-error" role="alert"><p>{error}</p>{onRetry ? <BaseerButton type="button" variant="secondary" disabled={loading} onClick={onRetry}>{text.retry}</BaseerButton> : null}</div> : null}
        {!error && operations === null ? <div className="financial-evidence-dialog__state" role="status"><p>{text.loading}</p></div> : null}
        {!error && operations !== null && operations !== undefined && operations.length === 0 ? <div className="financial-evidence-dialog__state"><p>{text.empty}</p></div> : null}
        {!error && operations && operations.length ? <ol className="financial-evidence-dialog__operations" aria-label={text.operations}>{operations.map((operation) => {
          const expanded = expandedOperationId === operation.id;
          return <li key={operation.id}>
            <article className={`financial-evidence-dialog__operation${expanded ? " is-expanded" : ""}`}>
              <button type="button" className="financial-evidence-dialog__operation-summary" aria-expanded={expanded} onClick={() => setExpandedOperationId((current) => current === operation.id ? null : operation.id)}>
                <span className="financial-evidence-dialog__operation-main"><strong>{operation.kind}</strong>{operation.counterparty ? <small>{operation.counterparty}</small> : null}</span>
                <Money money={operation.amount} language={language} />
              </button>
              <dl className="financial-evidence-dialog__operation-meta">
                <div><dt>{text.reference}</dt><dd dir="ltr">{operation.reference}</dd></div>
                <div><dt>{text.date}</dt><dd dir="ltr">{formatDate(operation.businessDate, language)}</dd></div>
                {operation.origin ? <div><dt>{text.counterparty}</dt><dd>{operation.origin}</dd></div> : null}
              </dl>
              {expanded ? <div className="financial-evidence-dialog__operation-actions">
                {onOpenJournal ? <BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => onOpenJournal(operation.id)}>{text.openJournal}</BaseerButton> : null}
                {onOpenOrigin ? <BaseerButton type="button" variant="quiet" disabled={loading} onClick={() => onOpenOrigin(operation)}>{text.openOrigin}</BaseerButton> : null}
              </div> : null}
            </article>
          </li>;
        })}</ol> : null}
        {nextPageAvailable && !error ? <div className="financial-evidence-dialog__more">{onLoadMore ? <BaseerButton type="button" variant="secondary" disabled={loading} onClick={onLoadMore}>{text.more}</BaseerButton> : null}</div> : null}
      </>}
    </section>
  </BaseerDialog>;
}

function JournalView({ language, journal, text, onBack }: { language: BaseerLanguage; journal: FinancialEvidenceJournal; text: typeof copy[BaseerLanguage]; onBack: () => void }) {
  return <section className="financial-evidence-dialog__journal" dir={language === "ar" ? "rtl" : "ltr"}>
    <BaseerButton type="button" variant="secondary" onClick={onBack}>{text.back}</BaseerButton>
    <header><div><strong dir="ltr">{journal.reference}</strong><span dir="ltr">{formatDate(journal.businessDate, language)}</span></div>{journal.status ? <span className={`financial-evidence-dialog__journal-status${journal.status === "REVERSED" ? " is-reversed" : ""}`}>{journal.status === "REVERSED" ? text.reversed : text.posted}</span> : null}{journal.description ? <p>{journal.description}</p> : null}</header>
    <div className="financial-evidence-dialog__journal-table-shell"><table><thead><tr><th>#</th><th>{text.operation}</th><th>{text.debit}</th><th>{text.credit}</th></tr></thead><tbody>{journal.lines.map((line) => <tr key={line.id}><td dir="ltr">{line.lineNumber}</td><td><span dir="ltr">{line.accountCode}</span> · {line.accountName}</td><td dir="ltr">{formatMoney(line.debitAmount, "SAR", language)}</td><td dir="ltr">{formatMoney(line.creditAmount, "SAR", language)}</td></tr>)}</tbody></table></div>
  </section>;
}

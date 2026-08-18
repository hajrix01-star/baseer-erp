import { DataTable, type DataTableColumn } from "./data-table";
import { BaseerButton } from "./baseer-button";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import type { Closing } from "./daily-sales-client";
import { formatMoney, formatNumber } from "./number-format";

export function DailySalesHistory({
  language,
  closings,
  historyLimit,
  hasMore,
  onLoadMore,
  onView,
}: {
  language: DailySalesLanguage;
  closings: readonly Closing[];
  historyLimit: number | null;
  hasMore: boolean;
  onLoadMore?: () => void;
  onView: (closing: Closing) => void;
}) {
  const copy = dailySalesText[language];
  const cancelledLabel = language === "ar" ? "\u0645\u0644\u063a\u0649" : "Cancelled";
  const recordLabel = language === "ar" ? "\u0627\u0644\u0633\u062c\u0644" : "Record";
  const columns: readonly DataTableColumn<Closing>[] = [
    {
      id: "record",
      header: recordLabel,
      cell: (closing) => (
        <button
          className="daily-sales-record-link"
          type="button"
          onClick={() => onView(closing)}
        >
          <strong dir="ltr">{closing.documentNumber}</strong>
          <small>{closing.businessDate.slice(0, 10)}</small>
        </button>
      ),
    },
    {
      id: "scope",
      header: copy.scope,
      cell: (closing) => copy[closing.scope.toLowerCase() as "morning" | "evening" | "all"],
    },
    {
      id: "gross",
      header: copy.gross,
      cell: (closing) => <span dir="ltr">{formatMoney(closing.grossAmount)}</span>,
      align: "end",
      numeric: true,
    },
    {
      id: "customers",
      header: copy.customers,
      cell: (closing) => <span dir="ltr">{formatNumber(closing.customerCount)}</span>,
      align: "end",
      numeric: true,
    },
    {
      id: "cash-handover",
      header: copy.cashHandoverShort,
      cell: (closing) => (
        <span dir="ltr">
          {closing.cashHandoverAmount ? formatMoney(closing.cashHandoverAmount) : "\u2014"}
        </span>
      ),
      align: "end",
      numeric: true,
    },
    {
      id: "status",
      header: copy.status,
      cell: (closing) => (
        <span className={`daily-sales-badge ${closing.status.toLowerCase()}`}>
          {closing.status === "REVERSED" ? cancelledLabel : copy[closing.status]}
        </span>
      ),
      align: "center",
      className: "daily-sales-register__status",
    },
  ];

  return (
    <section className="daily-sales-history">
      <div>
        <h3>{copy.closings}</h3>
        <p>{copy.reversalHint}</p>
        {historyLimit !== null && historyLimit <= 7 && (
          <p>{copy.historyLimited.replace("{count}", String(historyLimit))}</p>
        )}
      </div>
      {closings.length === 0 ? (
        <p className="daily-sales-empty-copy">{copy.noClosings}</p>
      ) : (
        <DataTable
          ariaLabel={copy.closings}
          caption={copy.closings}
          className="daily-sales-register"
          columns={columns}
          rows={closings}
          rowKey={(closing) => closing.closingId}
        />
      )}
      {hasMore && onLoadMore ? <BaseerButton type="button" variant="secondary" onClick={onLoadMore}>{copy.loadMore}</BaseerButton> : null}
    </section>
  );
}

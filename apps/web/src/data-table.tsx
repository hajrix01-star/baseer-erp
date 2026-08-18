import { useState, type ReactNode } from "react";

export type DataTableColumn<Row> = {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  width?: string;
  align?: "start" | "end" | "center";
  numeric?: boolean;
  className?: string;
  /** Use only for complete local collections. Paginated financial registers sort on the server. */
  sort?: (row: Row) => string | number | null | undefined;
};

export function DataTable<Row>({
  ariaLabel,
  caption,
  className,
  columns,
  rows,
  rowKey,
}: {
  ariaLabel: string;
  caption: string;
  className?: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}) {
  const [sort, setSort] = useState<{ id: string; d: boolean } | null>(null);
  const tableClassName = ["baseer-data-table", className].filter(Boolean).join(" ");
  const sortedRows = sort ? [...rows].sort((left, right) => {
    const column = columns.find((item) => item.id === sort.id);
    const leftValue = column?.sort?.(left);
    const rightValue = column?.sort?.(right);
    const comparison = leftValue == null ? (rightValue == null ? 0 : 1) : rightValue == null ? -1 : typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue));
    return sort.d ? -comparison : comparison;
  }) : rows;

  return (
    <div className={tableClassName} role="region" aria-label={ariaLabel} tabIndex={0}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <colgroup>
          {columns.map((column) => <col key={column.id} style={column.width ? { width: column.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                aria-sort={sort?.id === column.id ? (sort.d ? "descending" : "ascending") : undefined}
                className={[
                  `baseer-data-table__${column.align ?? "start"}`,
                  column.numeric ? "baseer-data-table__numeric" : "",
                  column.className ?? "",
                ].filter(Boolean).join(" ")}
              >
                {column.sort ? <button className="baseer-sort" type="button" onClick={() => setSort((current) => current?.id !== column.id ? { id: column.id, d: false } : current.d ? null : { id: column.id, d: true })}>{column.header}<span aria-hidden="true">{sort?.id === column.id ? sort.d ? "▼" : "▲" : "▾"}</span></button> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={[
                    `baseer-data-table__${column.align ?? "start"}`,
                    column.numeric ? "baseer-data-table__numeric" : "",
                    column.className ?? "",
                  ].filter(Boolean).join(" ")}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

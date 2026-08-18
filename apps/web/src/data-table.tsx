import type { ReactNode } from "react";

export type DataTableColumn<Row> = {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  width?: string;
  align?: "start" | "end" | "center";
  numeric?: boolean;
  className?: string;
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
  const tableClassName = ["baseer-data-table", className].filter(Boolean).join(" ");

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
                className={[
                  `baseer-data-table__${column.align ?? "start"}`,
                  column.numeric ? "baseer-data-table__numeric" : "",
                  column.className ?? "",
                ].filter(Boolean).join(" ")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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

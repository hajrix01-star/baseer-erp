import { useState } from "react";

import { BaseerDataGrid, type BaseerDataGridColumn } from "./baseer-data-grid";

/** @deprecated Use BaseerDataGrid directly. This adapter keeps complete legacy lists on the shared grid. */
export type DataTableColumn<Row extends object> = BaseerDataGridColumn<Row>;

export function DataTable<Row extends object>({
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
  const sortedRows = sort ? [...rows].sort((left, right) => {
    const column = columns.find((item) => item.id === sort.id);
    const leftValue = column?.sort?.(left);
    const rightValue = column?.sort?.(right);
    const comparison = leftValue == null ? (rightValue == null ? 0 : 1) : rightValue == null ? -1 : typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue));
    return sort.d ? -comparison : comparison;
  }) : rows;

  return <BaseerDataGrid
    ariaLabel={ariaLabel}
    caption={caption}
    className={className}
    columns={columns}
    rows={sortedRows}
    rowKey={rowKey}
    serverSortColumnId={sort?.id}
    sortDirection={sort?.d ? "desc" : "asc"}
    onClientSortChange={(columnId) => setSort((current) => current?.id !== columnId ? { id: columnId, d: false } : current.d ? null : { id: columnId, d: true })}
  />;
}

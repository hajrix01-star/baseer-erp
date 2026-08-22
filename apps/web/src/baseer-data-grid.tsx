import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, type ReactNode } from 'react';

export type BaseerDataGridColumn<Row extends Record<string, unknown>> = Readonly<{
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  width?: string;
  align?: 'start' | 'end' | 'center';
  numeric?: boolean;
}>;

const features = tableFeatures({});

/** Headless table model behind Baseer's existing semantic table and tokens. */
export function BaseerDataGrid<Row extends Record<string, unknown>>({ ariaLabel, caption, columns, rows, rowKey }: {
  ariaLabel: string;
  caption: string;
  columns: readonly BaseerDataGridColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}) {
  const helper = createColumnHelper<typeof features, Row>();
  const tableColumns = useMemo(() => columns.map((column) => helper.display({
    id: column.id,
    header: () => column.header,
    cell: ({ row }) => column.cell(row.original),
  })), [columns]);
  const table = useTable<typeof features, Row>({ features, columns: tableColumns, data: rows, getRowId: rowKey });

  return <div className="baseer-data-table" role="region" aria-label={ariaLabel} tabIndex={0}>
    <table>
      <caption className="visually-hidden">{caption}</caption>
      <colgroup>{columns.map((column) => <col key={column.id} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} scope="col" className={`baseer-data-table__${columns.find((column) => column.id === header.id)?.align ?? 'start'}`}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getAllCells().map((cell) => <td key={cell.id} className={`baseer-data-table__${columns.find((column) => column.id === cell.column.id)?.align ?? 'start'}`}>{<table.FlexRender cell={cell} />}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

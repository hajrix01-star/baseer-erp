import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, type ReactNode } from 'react';

export type BaseerDataGridColumn<Row extends object> = Readonly<{
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  width?: string;
  align?: 'start' | 'end' | 'center';
  numeric?: boolean;
  className?: string;
  /** A compatibility adapter may opt into local sorting for a complete collection. */
  sort?: (row: Row) => string | number | null | undefined;
}>;

const features = tableFeatures({});

/**
 * Display-grid adapter for an already bounded result set. It must not receive
 * a partial page and then sort, filter or aggregate it in the browser.
 */
export type BaseerDataGridProps<Row extends object> = {
  ariaLabel: string;
  caption: string;
  className?: string;
  columns: readonly BaseerDataGridColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  serverSortColumnId?: string;
  sortDirection?: 'asc' | 'desc';
  onSortDirectionChange?: () => void;
  /** Reserved for the legacy DataTable adapter when every row is already loaded. */
  onClientSortChange?: (columnId: string) => void;
};

export function BaseerDataGrid<Row extends object>({ ariaLabel, caption, className, columns, rows, rowKey, serverSortColumnId, sortDirection, onSortDirectionChange, onClientSortChange }: BaseerDataGridProps<Row>) {
  const helper = createColumnHelper<typeof features, Row>();
  const tableColumns = useMemo(() => columns.map((column) => helper.display({
    id: column.id,
    header: () => column.header,
    cell: ({ row }) => column.cell(row.original),
  })), [columns]);
  const table = useTable<typeof features, Row>({ features, columns: tableColumns, data: rows, getRowId: rowKey });

  return <div className={["baseer-data-table", className].filter(Boolean).join(" ")} role="region" aria-label={ariaLabel} tabIndex={0}>
    <table>
      <caption className="visually-hidden">{caption}</caption>
      <colgroup>{columns.map((column) => <col key={column.id} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
        const column = columns.find((entry) => entry.id === header.id);
        const serverSortable = header.id === serverSortColumnId && onSortDirectionChange;
        const clientSortable = Boolean(onClientSortChange && column?.sort);
        const sortable = serverSortable || clientSortable;
        const className = [`baseer-data-table__${column?.align ?? 'start'}`, column?.numeric ? 'baseer-data-table__numeric' : '', column?.className ?? ''].filter(Boolean).join(' ');
        return <th key={header.id} scope="col" aria-sort={header.id === serverSortColumnId ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined} className={className}>{header.isPlaceholder ? null : sortable ? <button className="baseer-sort" type="button" onClick={() => clientSortable ? onClientSortChange?.(header.id) : onSortDirectionChange?.()}><table.FlexRender header={header} /><span aria-hidden="true">{header.id === serverSortColumnId ? (sortDirection === 'asc' ? '▲' : '▼') : '▾'}</span></button> : <table.FlexRender header={header} />}</th>;
      })}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getAllCells().map((cell) => { const column = columns.find((entry) => entry.id === cell.column.id); const className = [`baseer-data-table__${column?.align ?? 'start'}`, column?.numeric ? 'baseer-data-table__numeric' : '', column?.className ?? ''].filter(Boolean).join(' '); return <td key={cell.id} className={className}>{column?.cell(row.original)}</td>; })}</tr>)}</tbody>
    </table>
  </div>;
}

export type BaseerServerGridPage<Row extends object> = Readonly<{
  rows: readonly Row[];
  nextCursor: string | null;
  asOf: string;
}>;

export type BaseerServerDataGridProps<Row extends object> = Omit<Parameters<typeof BaseerDataGrid<Row>>[0], "rows"> & {
  page: BaseerServerGridPage<Row>;
  loadMoreControl?: ReactNode;
};

/**
 * Controlled server-grid contract. The caller sends filter/sort/cursor intent
 * to a server allow-list; this adapter only renders the returned page.
 */
export function BaseerServerDataGrid<Row extends object>({ page, loadMoreControl, ...props }: BaseerServerDataGridProps<Row>) {
  return <><BaseerDataGrid {...props} rows={page.rows} />{page.nextCursor ? loadMoreControl : null}</>;
}

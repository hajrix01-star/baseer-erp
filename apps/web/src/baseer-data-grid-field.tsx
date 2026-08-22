import { lazy, Suspense, type ComponentType } from "react";

import type { BaseerDataGridProps } from "./baseer-data-grid";

const LazyBaseerDataGrid = lazy(async () => {
  const module = await import("./baseer-data-grid");
  return { default: module.BaseerDataGrid as ComponentType<BaseerDataGridProps<object>> };
});

/** Keeps TanStack Table outside module-route bundles while preserving one Baseer contract. */
export function BaseerDataGridField<Row extends object>(props: BaseerDataGridProps<Row>) {
  const Grid = LazyBaseerDataGrid as unknown as ComponentType<BaseerDataGridProps<Row>>;
  return <Suspense fallback={<div className="baseer-data-table" role="status" aria-label={props.ariaLabel} aria-busy="true" />}><Grid {...props} /></Suspense>;
}

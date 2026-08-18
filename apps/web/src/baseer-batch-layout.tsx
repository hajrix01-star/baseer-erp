import type { ReactNode } from "react";

import { BaseerButton } from "./baseer-button";

export type BaseerWorkspaceTab = { id: string; label: ReactNode };

/** Shared connected tabs for an operational batch workspace. */
export function BaseerBatchTabs({ ariaLabel, tabs, activeId, idPrefix, onChange }: { ariaLabel: string; tabs: readonly BaseerWorkspaceTab[]; activeId: string; idPrefix: string; onChange: (id: string) => void }) {
  return <nav aria-label={ariaLabel} role="tablist" style={{ display: "inline-flex", alignSelf: "flex-start", gap: 0, marginBlockEnd: "-1px", position: "relative", zIndex: 1 }}>
    {tabs.map((tab) => {
      const active = tab.id === activeId;
      return <BaseerButton key={tab.id} id={`${idPrefix}-${tab.id}`} role="tab" aria-selected={active} aria-controls={`${idPrefix}-panel-${tab.id}`} type="button" variant="secondary" style={{ minHeight: "2.5rem", paddingInline: "1rem", border: active ? "1px solid var(--line)" : "1px solid transparent", borderBottom: active ? "1px solid var(--surface)" : "1px solid var(--line)", borderRadius: "8px 8px 0 0", color: active ? "var(--brand-deep)" : "var(--muted)", background: active ? "var(--surface)" : "transparent", boxShadow: "none" }} onClick={() => onChange(tab.id)}>{tab.label}</BaseerButton>;
    })}
  </nav>;
}

export function BaseerBatchPanel({ id, labelledBy, children }: { id: string; labelledBy: string; children: ReactNode }) {
  return <div id={id} role="tabpanel" aria-labelledby={labelledBy} style={{ minWidth: 0, border: "1px solid var(--line)", borderRadius: "8px", borderStartStartRadius: 0, background: "var(--surface)", boxShadow: "none", padding: "var(--card-padding-compact)" }}>{children}</div>;
}

export function BaseerBatchHeader({ children }: { children: ReactNode }) {
  return <div className="baseer-batch-header">{children}</div>;
}

export function BaseerBatchFooter({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return <footer className="baseer-batch-footer"><div className="baseer-batch-total">{summary}</div><div>{children}</div></footer>;
}

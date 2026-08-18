import type { CSSProperties, ReactNode } from "react";

import { BaseerButton } from "./baseer-button";

export type BaseerWorkspaceTab = { id: string; label: ReactNode };

const tabListStyle: CSSProperties = { display: "inline-flex", alignSelf: "flex-start", gap: 0, marginBlockEnd: "-1px", position: "relative", zIndex: 1 };
const inactiveTabStyle: CSSProperties = { minHeight: "2.5rem", paddingInline: "1rem", border: "1px solid transparent", borderBottom: "1px solid var(--line)", borderRadius: "8px 8px 0 0", color: "var(--muted)", background: "transparent", boxShadow: "none" };
const activeTabStyle = { ...inactiveTabStyle, border: "1px solid var(--line)", borderBottom: "1px solid var(--surface)", color: "var(--brand-deep)", background: "var(--surface)" };

/** Shared connected tabs for an operational batch workspace. */
export function BaseerWorkspaceTabs({ ariaLabel, tabs, activeId, idPrefix, onChange }: { ariaLabel: string; tabs: readonly BaseerWorkspaceTab[]; activeId: string; idPrefix: string; onChange: (id: string) => void }) {
  return <nav aria-label={ariaLabel} role="tablist" style={tabListStyle}>
    {tabs.map((tab) => {
      const active = tab.id === activeId;
      return <BaseerButton key={tab.id} id={`${idPrefix}-${tab.id}`} role="tab" aria-selected={active} aria-controls={`${idPrefix}-panel-${tab.id}`} type="button" variant="secondary" style={active ? activeTabStyle : inactiveTabStyle} onClick={() => onChange(tab.id)}>{tab.label}</BaseerButton>;
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

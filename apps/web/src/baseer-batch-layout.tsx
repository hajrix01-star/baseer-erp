import type { ReactNode } from "react";

import { BaseerButton } from "./baseer-button";

export type BaseerWorkspaceTab = { id: string; label: ReactNode };

/** Shared connected tabs for an operational batch workspace. */
export function BaseerWorkspaceTabs({ ariaLabel, tabs, activeId, idPrefix, onChange }: { ariaLabel: string; tabs: readonly BaseerWorkspaceTab[]; activeId: string; idPrefix: string; onChange: (id: string) => void }) {
  return <nav className="baseer-workspace-tabs" aria-label={ariaLabel} role="tablist">
    {tabs.map((tab) => {
      const active = tab.id === activeId;
      return <BaseerButton key={tab.id} id={`${idPrefix}-${tab.id}`} role="tab" aria-selected={active} aria-controls={`${idPrefix}-panel-${tab.id}`} type="button" variant="secondary" className={active ? "is-active" : undefined} onClick={() => onChange(tab.id)}>{tab.label}</BaseerButton>;
    })}
  </nav>;
}

export function BaseerBatchPanel({ id, labelledBy, children }: { id: string; labelledBy: string; children: ReactNode }) {
  return <div id={id} role="tabpanel" aria-labelledby={labelledBy} className="baseer-batch-panel">{children}</div>;
}

export function BaseerBatchHeader({ children }: { children: ReactNode }) {
  return <div className="baseer-batch-header">{children}</div>;
}

export function BaseerBatchFooter({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return <footer className="baseer-batch-footer"><div className="baseer-batch-total">{summary}</div><div>{children}</div></footer>;
}

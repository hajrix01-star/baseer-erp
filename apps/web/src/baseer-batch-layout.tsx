import type { KeyboardEvent, ReactNode } from "react";

import { BaseerButton } from "./baseer-button";

export type BaseerWorkspaceTab = { id: string; label: ReactNode };

function tabNavigationIndex(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number, length: number) {
  if (event.key === "Home") return 0;
  if (event.key === "End") return length - 1;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return null;
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  return (currentIndex + direction + length) % length;
}

/** Shared connected tabs for an operational batch workspace. */
export function BaseerWorkspaceTabs({ ariaLabel, tabs, activeId, idPrefix, onChange }: { ariaLabel: string; tabs: readonly BaseerWorkspaceTab[]; activeId: string; idPrefix: string; onChange: (id: string) => void }) {
  return <nav className="baseer-workspace-tabs" aria-label={ariaLabel} role="tablist">
    {tabs.map((tab, index) => {
      const active = tab.id === activeId;
      return <BaseerButton key={tab.id} id={`${idPrefix}-${tab.id}`} role="tab" aria-selected={active} aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={active ? 0 : -1} type="button" variant="secondary" className={active ? "is-active" : undefined} onKeyDown={(event) => {
        const nextIndex = tabNavigationIndex(event, index, tabs.length);
        if (nextIndex === null) return;
        event.preventDefault();
        const next = tabs[nextIndex];
        if (!next) return;
        onChange(next.id);
        requestAnimationFrame(() => document.getElementById(`${idPrefix}-${next.id}`)?.focus());
      }} onClick={() => onChange(tab.id)}>{tab.label}</BaseerButton>;
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

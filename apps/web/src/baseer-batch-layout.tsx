import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { BaseerButton } from "./baseer-button";

export type BaseerWorkspaceTab = { id: string; label: ReactNode };

function tabNavigationIndex(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number, length: number) {
  if (event.key === "Home") return 0;
  if (event.key === "End") return length - 1;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
  const directionScope = event.currentTarget.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir;
  const rightToLeft = directionScope === "rtl";
  const direction = event.key === "ArrowLeft" ? (rightToLeft ? 1 : -1) : (rightToLeft ? -1 : 1);
  return (currentIndex + direction + length) % length;
}

/** Shared connected tabs for an operational batch workspace. */
export function BaseerWorkspaceTabs({ ariaLabel, tabs, activeId, idPrefix, onChange }: { ariaLabel: string; tabs: readonly BaseerWorkspaceTab[]; activeId: string; idPrefix: string; onChange: (id: string) => void }) {
  const [focusedId, setFocusedId] = useState(activeId);
  useEffect(() => setFocusedId(activeId), [activeId]);
  const selectTab = (id: string) => {
    setFocusedId(id);
    onChange(id);
  };
  return <nav className="baseer-workspace-tabs" aria-label={ariaLabel} role="tablist">
    {tabs.map((tab, index) => {
      const active = tab.id === activeId;
      const focused = tab.id === focusedId;
      return <BaseerButton key={tab.id} id={`${idPrefix}-${tab.id}`} role="tab" aria-selected={active} aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={focused ? 0 : -1} type="button" variant="secondary" className={active ? "is-active" : undefined} onFocus={() => setFocusedId(tab.id)} onKeyDown={(event) => {
        const nextIndex = tabNavigationIndex(event, index, tabs.length);
        if (nextIndex !== null) {
          event.preventDefault();
          const next = tabs[nextIndex];
          if (!next) return;
          setFocusedId(next.id);
          requestAnimationFrame(() => document.getElementById(`${idPrefix}-${next.id}`)?.focus());
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectTab(tab.id);
      }} onClick={() => selectTab(tab.id)}>{tab.label}</BaseerButton>;
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

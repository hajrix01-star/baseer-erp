import { useMemo, useState, type CSSProperties } from "react";

import { displayName } from "./baseer-localization";

export type FinanceCategoryKind = "PURCHASE" | "EXPENSE" | "SALE";
export type FinanceCategoryTreeItem = { id: string; code: string; nameAr: string; nameEn: string; kind: FinanceCategoryKind; status: "ACTIVE" | "ARCHIVED"; parentId: string | null; isPosting: boolean };

const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1.75rem minmax(0, 1fr) auto", alignItems: "center", gap: ".5rem", minHeight: "2.75rem", paddingInline: ".25rem", borderBlockEnd: "1px solid var(--line)" };
const cardGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))", gap: ".75rem" };
const cardStyle: CSSProperties = { minWidth: 0, padding: ".625rem", border: "1px solid var(--line)", borderRadius: "var(--card-radius)", background: "var(--surface)", boxShadow: "0 8px 24px rgb(11 36 26 / 5%)" };
const itemButtonStyle: CSSProperties = { minWidth: 0, padding: 0, border: 0, color: "var(--ink)", background: "transparent", font: "inherit", fontWeight: 700, cursor: "pointer", textAlign: "start", lineHeight: 1.45, overflowWrap: "anywhere" };
const toggleStyle: CSSProperties = { width: "1.75rem", height: "1.75rem", padding: 0, border: 0, color: "var(--muted)", background: "transparent", font: "inherit", cursor: "pointer" };
const codeStyle: CSSProperties = { padding: ".125rem .375rem", borderRadius: "999px", color: "var(--muted)", background: "color-mix(in srgb, var(--brand) 7%, var(--surface))", fontSize: "var(--font-caption)", fontVariantNumeric: "tabular-nums" };
const badgeStyle: CSSProperties = { justifySelf: "end", padding: ".125rem .375rem", borderRadius: "999px", color: "var(--brand-deep)", background: "color-mix(in srgb, var(--brand) 10%, var(--surface))", fontSize: "var(--font-caption)", whiteSpace: "nowrap" };

/** Shared, ledger-safe presentation of category groups and posting leaves. */
export function FinanceCategoryTree({ language, categories, onOpen }: { language: "ar" | "en"; categories: readonly FinanceCategoryTreeItem[]; onOpen: (item: FinanceCategoryTreeItem) => void }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(categories.filter((item) => !item.parentId).map((item) => item.id)));
  const children = useMemo(() => {
    const grouped = new Map<string | null, FinanceCategoryTreeItem[]>();
    for (const item of categories) grouped.set(item.parentId && categories.some((candidate) => candidate.id === item.parentId) ? item.parentId : null, [...(grouped.get(item.parentId && categories.some((candidate) => candidate.id === item.parentId) ? item.parentId : null) ?? []), item]);
    for (const items of grouped.values()) items.sort((left, right) => left.code.localeCompare(right.code));
    return grouped;
  }, [categories]);
  const roots = children.get(null) ?? [];
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const render = (item: FinanceCategoryTreeItem, level: number): React.ReactNode => {
    const nested = children.get(item.id) ?? [];
    const hasChildren = nested.length > 0;
    const isExpanded = expanded.has(item.id);
    return <div key={item.id} role="treeitem" aria-level={level} aria-expanded={hasChildren ? isExpanded : undefined} style={{ marginInlineStart: `${(level - 1) * 1.1}rem` }}>
      <div style={rowStyle}>
        {hasChildren ? <button type="button" style={toggleStyle} onClick={() => toggle(item.id)} aria-label={isExpanded ? (language === "ar" ? "طي المجموعة" : "Collapse group") : (language === "ar" ? "فتح المجموعة" : "Expand group")}>{isExpanded ? "▾" : "▸"}</button> : <span aria-hidden="true" style={{ color: "var(--line)", textAlign: "center" }}>•</span>}
        <button type="button" style={itemButtonStyle} onClick={() => onOpen(item)}>{displayName(language, item)} <span style={codeStyle}>{item.code}</span></button>
        <span style={badgeStyle}>{item.isPosting ? (language === "ar" ? "يقبل القيود" : "Posting") : (language === "ar" ? "مجموعة" : "Group")}</span>
      </div>
      {hasChildren && isExpanded ? <div role="group">{nested.map((child) => render(child, level + 1))}</div> : null}
    </div>;
  };
  if (!roots.length) return null;
  return <div role="tree" aria-label={language === "ar" ? "شجرة البنود المالية" : "Financial category tree"} style={cardGridStyle}>{roots.map((root) => <section key={root.id} style={cardStyle}>{render(root, 1)}</section>)}</div>;
}

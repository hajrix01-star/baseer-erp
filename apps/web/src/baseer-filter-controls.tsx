import type { SelectHTMLAttributes } from "react";

type BaseerFilterSelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string };
export function BaseerFilterSelect({ label, children, style, ...props }: BaseerFilterSelectProps) { return <label style={{ position: "relative", display: "block" }}><span className="visually-hidden">{label}</span><select className="baseer-filter-bar__select" style={{ appearance: "none", paddingInlineEnd: "2rem", ...style }} {...props}>{children}</select><span aria-hidden="true" style={{ pointerEvents: "none", position: "absolute", insetInlineEnd: "0.65rem", insetBlockStart: "50%", transform: "translateY(-50%)", color: "var(--brand-deep)", fontSize: "0.8rem" }}>▾</span></label>; }

type BaseerFilterToggleProps = { label: string; checked: boolean; onChange: (checked: boolean) => void };
export function BaseerFilterToggle({ label, checked, onChange }: BaseerFilterToggleProps) { return <label className="administration-archive-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }
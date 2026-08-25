import type { SelectHTMLAttributes } from "react";

import { BaseerCheckbox } from "./baseer-form-fields";

type BaseerFilterSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "style"> & { label: string };
/** Fixed-choice filter control. Visual tokens stay in the central filter-bar contract. */
export function BaseerFilterSelect({ label, children, ...props }: BaseerFilterSelectProps) { return <label className="baseer-filter-select"><span className="visually-hidden">{label}</span><select className="baseer-filter-bar__select" {...props}>{children}</select><span className="baseer-filter-select__chevron" aria-hidden="true">▾</span></label>; }

type BaseerFilterToggleProps = { label: string; checked: boolean; onChange: (checked: boolean) => void };
export function BaseerFilterToggle({ label, checked, onChange }: BaseerFilterToggleProps) { return <label className="administration-archive-toggle"><BaseerCheckbox checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }

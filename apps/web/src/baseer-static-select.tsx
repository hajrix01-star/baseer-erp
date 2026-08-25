import { forwardRef, type SelectHTMLAttributes } from "react";

type BaseerStaticSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "style"> & { label: string };

/** Short, fixed-choice form field. Keeps its visual contract in the shared form tokens. */
export const BaseerStaticSelect = forwardRef<HTMLSelectElement, BaseerStaticSelectProps>(function BaseerStaticSelect({ label, children, ...props }, ref) {
  return <span className="baseer-static-select"><select ref={ref} aria-label={props["aria-label"] ?? label} {...props}>{children}</select><span className="baseer-static-select__chevron" aria-hidden="true">▾</span></span>;
});

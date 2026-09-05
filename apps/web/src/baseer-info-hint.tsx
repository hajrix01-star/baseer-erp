import type { ReactNode } from "react";

type BaseerInfoHintProps = Readonly<{
  label: string;
  children: ReactNode;
}>;

/**
 * A concise, keyboard-accessible explanation for a term—not a place to hide
 * material status, a warning, or the number itself. Native disclosure keeps
 * this small interaction reliable on touch devices without another dependency.
 */
export function BaseerInfoHint({ label, children }: BaseerInfoHintProps) {
  return (
    <details className="baseer-info-hint">
      <summary aria-label={label}>؟</summary>
      <span className="baseer-info-hint__panel" role="note">{children}</span>
    </details>
  );
}

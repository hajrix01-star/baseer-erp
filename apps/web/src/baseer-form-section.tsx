import type { ReactNode } from "react";

import "./baseer-form.css";

/** Form sections use their title as the only visible guidance. */
export function BaseerFormSection({ title, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={["baseer-form-section", className].filter(Boolean).join(" ")}><header><h3>{title}</h3></header>{children}</section>;
}

export function BaseerFormGrid({ children, columns = "two", className }: { children: ReactNode; columns?: "one" | "two" | "three"; className?: string }) {
  return <div className={["baseer-form-grid", `baseer-form-grid--${columns}`, className].filter(Boolean).join(" ")}>{children}</div>;
}

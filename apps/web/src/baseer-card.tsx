import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type BaseerCardTone = "default" | "muted";
export type BaseerCardPadding = "default" | "compact";

export function BaseerCard({
  children,
  className,
  padding = "default",
  tone = "default",
  ...props
}: ComponentPropsWithoutRef<"article"> & {
  children: ReactNode;
  padding?: BaseerCardPadding;
  tone?: BaseerCardTone;
}) {
  const cardClassName = [
    "baseer-card",
    `baseer-card--${tone}`,
    `baseer-card--${padding}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article {...props} className={cardClassName}>
      {children}
    </article>
  );
}

/** Shared interactive-card primitive for directory and selection views. */
export function BaseerCardButton({ children, className, ...props }: ComponentPropsWithoutRef<"button"> & { children: ReactNode }) {
  return <button {...props} className={["baseer-card", "baseer-card--default", "baseer-card--compact", "baseer-card--interactive", className].filter(Boolean).join(" ")}>{children}</button>;
}

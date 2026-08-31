import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { BaseerSectionIcon, type SectionGlyph } from "./baseer-section-icon";

export type BaseerCardTone = "default" | "muted";
export type BaseerCardPadding = "default" | "compact";
/**
 * Deliberately small structural vocabulary for shared ERP surfaces.  A
 * workspace may add its own content classes, but should not invent a second
 * card anatomy when one of these roles describes it.
 */
export const BASEER_CARD_VARIANTS = [
  "surface",
  "metric",
  "record",
  "chart",
  "form-or-receipt",
  "joined-ledger",
] as const;
export type BaseerCardVariant = (typeof BASEER_CARD_VARIANTS)[number];

type BaseerCardClassOptions = {
  className?: string;
  padding?: BaseerCardPadding;
  tone?: BaseerCardTone;
  variant?: BaseerCardVariant;
  interactive?: boolean;
};

/** Exported pure helper keeps the primitive class contract straightforward to test. */
export function baseerCardClassName({
  className,
  padding = "default",
  tone = "default",
  variant = "surface",
  interactive = false,
}: BaseerCardClassOptions) {
  return [
    "baseer-card",
    `baseer-card--${tone}`,
    `baseer-card--${padding}`,
    `baseer-card--${variant}`,
    interactive ? "baseer-card--interactive" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function BaseerCard({
  children,
  className,
  padding = "default",
  tone = "default",
  variant = "surface",
  contextIcon,
  ...props
}: ComponentPropsWithoutRef<"article"> & {
  children: ReactNode;
  padding?: BaseerCardPadding;
  tone?: BaseerCardTone;
  variant?: BaseerCardVariant;
  /** Use false when the card already renders a more precise icon in its content. */
  contextIcon?: SectionGlyph | false;
}) {
  const cardClassName = baseerCardClassName({ className, padding, tone, variant });
  const glyph = contextIcon === false || contextIcon === undefined ? null : contextIcon;

  return (
    <article {...props} className={cardClassName} data-baseer-card-glyph={glyph ?? undefined}>
      {glyph ? <span className="baseer-card__context-icon" aria-hidden="true"><BaseerSectionIcon glyph={glyph} /></span> : null}
      {children}
    </article>
  );
}

/** Shared interactive-card primitive for directory and selection views. */
export function BaseerCardButton({
  children,
  className,
  padding = "compact",
  tone = "default",
  variant = "surface",
  contextIcon,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  children: ReactNode;
  padding?: BaseerCardPadding;
  tone?: BaseerCardTone;
  variant?: BaseerCardVariant;
  contextIcon?: SectionGlyph | false;
}) {
  const glyph = contextIcon === false || contextIcon === undefined ? null : contextIcon;
  return <button {...props} className={baseerCardClassName({ className, padding, tone, variant, interactive: true })} data-baseer-card-glyph={glyph ?? undefined}>{glyph ? <span className="baseer-card__context-icon" aria-hidden="true"><BaseerSectionIcon glyph={glyph} /></span> : null}{children}</button>;
}

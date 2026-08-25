import type { ButtonHTMLAttributes, ReactNode } from "react";

export type BaseerButtonVariant = "primary" | "secondary" | "danger" | "icon" | "quiet";

type ButtonAttributes = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

/**
 * Icon-only controls do not have an accessible name in their visible content.
 * Keep that requirement in the shared contract, rather than relying on every
 * consumer to remember it during review.
 */
type IconButtonProps = ButtonAttributes & {
  children: ReactNode;
  variant: "icon";
  "aria-label": string;
};

type TextButtonProps = ButtonAttributes & {
  children: ReactNode;
  variant?: Exclude<BaseerButtonVariant, "icon">;
};

export type BaseerButtonProps = IconButtonProps | TextButtonProps;

/**
 * Shared action primitive. `type` deliberately remains native-by-default so a
 * button used in a validated form still submits unless its consumer opts out.
 */
export function BaseerButton({
  children,
  className,
  variant = "secondary",
  ...props
}: BaseerButtonProps) {
  const buttonClassName = [
    "baseer-button",
    `baseer-button--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button {...props} className={buttonClassName}>
      {children}
    </button>
  );
}

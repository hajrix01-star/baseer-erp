import type { ButtonHTMLAttributes, ReactNode } from "react";

export type BaseerButtonVariant = "primary" | "secondary" | "danger" | "icon";

export function BaseerButton({
  children,
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: BaseerButtonVariant;
}) {
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
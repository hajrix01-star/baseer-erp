import type { ReactNode } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import type { BaseerLanguage } from "./baseer-ui-copy";
import "./baseer-form.css";

export type BaseerFormDialogSize = "compact" | "standard" | "wide";

type Props = {
  open: boolean;
  title: string;
  language: BaseerLanguage;
  formId: string;
  submitLabel: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  submitDisabled?: boolean;
  cancelLabel?: string;
  size?: BaseerFormDialogSize;
  className?: string;
};

/** Shared form shell: predictable width, footer actions, focus handling and RTL-safe spacing. */
export function BaseerFormDialog({ open, title, language, formId, submitLabel, onClose, children, busy = false, submitDisabled = false, cancelLabel, size = "standard", className }: Props) {
  const resolvedCancel = cancelLabel ?? (language === "ar" ? "إلغاء" : "Cancel");
  return <BaseerDialog open={open} title={title} language={language} busy={busy} size={size === "wide" ? "wide" : "default"} className={["baseer-form-dialog", `baseer-form-dialog--${size}`, className].filter(Boolean).join(" ")} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{resolvedCancel}</BaseerButton><BaseerButton type="submit" form={formId} disabled={busy || submitDisabled}>{submitLabel}</BaseerButton></>}>{children}</BaseerDialog>;
}

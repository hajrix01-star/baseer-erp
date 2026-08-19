import { useEffect, useRef } from "react";

const dialogStack: symbol[] = [];

function addToDialogStack(dialogId: symbol) {
  const existingIndex = dialogStack.indexOf(dialogId);
  if (existingIndex !== -1) dialogStack.splice(existingIndex, 1);
  dialogStack.push(dialogId);
}

function removeFromDialogStack(dialogId: symbol) {
  const index = dialogStack.lastIndexOf(dialogId);
  if (index !== -1) dialogStack.splice(index, 1);
}

function isTopmostDialog(dialogId: symbol) {
  return dialogStack.at(-1) === dialogId;
}

/** Keeps keyboard navigation inside a dialog without stealing focus while fields change. */
export function useDialogFocusTrap({
  open,
  saving,
  onClose,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const dialogIdRef = useRef(Symbol("baseer-dialog"));
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const dialogId = dialogIdRef.current;
    addToDialogStack(dialogId);
    return () => removeFromDialogStack(dialogId);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ) ?? [],
      );
    const timer = window.setTimeout(() => focusable()[0]?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ) ?? [],
      );
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog(dialogIdRef.current)) return;
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, saving]);

  return dialogRef;
}

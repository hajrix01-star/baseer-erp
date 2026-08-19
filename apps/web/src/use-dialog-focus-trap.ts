import { useEffect, useRef } from "react";

const dialogStack: symbol[] = [];
const dialogErrorHandlers = new Map<symbol, (message: string) => void>();
const dialogStateHandlers = new Map<symbol, (topmost: boolean) => void>();
let previousBodyOverflow: string | null = null;

function syncDialogStates() {
  const topmost = dialogStack.at(-1);
  dialogStateHandlers.forEach((handler, dialogId) => handler(dialogId === topmost));
}

function addToDialogStack(dialogId: symbol) {
  if (!dialogStack.length && typeof document !== "undefined") {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  const existingIndex = dialogStack.indexOf(dialogId);
  if (existingIndex !== -1) dialogStack.splice(existingIndex, 1);
  dialogStack.push(dialogId);
  syncDialogStates();
}

function removeFromDialogStack(dialogId: symbol) {
  const index = dialogStack.lastIndexOf(dialogId);
  if (index !== -1) dialogStack.splice(index, 1);
  dialogErrorHandlers.delete(dialogId);
  dialogStateHandlers.delete(dialogId);
  if (!dialogStack.length && typeof document !== "undefined") {
    document.body.style.overflow = previousBodyOverflow ?? "";
    previousBodyOverflow = null;
  }
  syncDialogStates();
}

function isTopmostDialog(dialogId: symbol) {
  return dialogStack.at(-1) === dialogId;
}

/** Routes an operation error to the active modal instead of a notice hidden behind its backdrop. */
export function reportTopmostDialogError(message: string) {
  const dialogId = dialogStack.at(-1);
  const handler = dialogId ? dialogErrorHandlers.get(dialogId) : undefined;
  if (!handler) return false;
  handler(message);
  return true;
}

/** Keeps keyboard navigation inside a dialog without stealing focus while fields change. */
export function useDialogFocusTrap({
  open,
  saving,
  onClose,
  onError,
  onTopmostChange,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onError?: (message: string) => void;
  onTopmostChange?: (topmost: boolean) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const dialogIdRef = useRef(Symbol("baseer-dialog"));
  const closeRef = useRef(onClose);
  const errorRef = useRef(onError);
  const topmostRef = useRef(onTopmostChange);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    topmostRef.current = onTopmostChange;
  }, [onTopmostChange]);

  useEffect(() => {
    if (!open) return;
    const dialogId = dialogIdRef.current;
    dialogStateHandlers.set(dialogId, (topmost) => {
      dialogRef.current?.toggleAttribute("inert", !topmost);
      topmostRef.current?.(topmost);
    });
    addToDialogStack(dialogId);
    if (errorRef.current) dialogErrorHandlers.set(dialogId, (message) => errorRef.current?.(message));
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

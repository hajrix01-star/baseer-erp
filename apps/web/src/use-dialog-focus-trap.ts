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

/** The dialog contract owns every normally tabbable HTML surface, not only form controls. */
function focusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], area[href], button, input, select, textarea, iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0);
}

/**
 * A focused editable control summons the virtual keyboard on phones. A modal
 * should announce itself first; the user can then choose the field to edit.
 */
function usesCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

function focusDialogContainer(dialog: HTMLElement | null) {
  if (!dialog) return;
  // Some standalone dialogs use the hook directly instead of BaseerDialog.
  // Keep the shared contract valid for those dialogs as well.
  dialog.tabIndex = -1;
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement) {
    activeElement.blur();
  }
  dialog.focus({ preventScroll: true });
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
    const timer = window.setTimeout(() => {
      if (usesCoarsePointer()) {
        focusDialogContainer(dialogRef.current);
        return;
      }
      focusableElements(dialogRef.current)[0]?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog(dialogIdRef.current)) return;
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableElements(dialogRef.current);
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

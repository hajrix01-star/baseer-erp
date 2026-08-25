import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import "./baseer-menu.css";

type BaseerMenuProps = Readonly<{
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
}>;

function menuItems(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((item) => !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true");
}

/**
 * Accessible disclosure menu contract for compact contextual actions.
 *
 * Children must be native interactive elements carrying `role="menuitem"`.
 */
export function BaseerMenu({ label, trigger, children, className = "", triggerClassName = "", menuClassName = "" }: BaseerMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const focusItem = (position: "first" | "last") => {
    const items = menuItems(menuRef.current);
    (position === "first" ? items[0] : items.at(-1))?.focus();
  };

  const openAndFocus = (position: "first" | "last") => {
    setOpen(true);
    requestAnimationFrame(() => focusItem(position));
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Home") {
      event.preventDefault();
      openAndFocus("first");
    } else if (event.key === "ArrowUp" || event.key === "End") {
      event.preventDefault();
      openAndFocus("last");
    } else if (event.key === "Escape") {
      close(false);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (!items.length) return;
    const focusAt = (index: number) => items[(index + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(items.length - 1);
    }
  };

  return <div ref={rootRef} className={`baseer-menu ${className}`.trim()}>
    <button ref={triggerRef} type="button" className={`baseer-button baseer-button--secondary baseer-menu__trigger ${triggerClassName}`.trim()} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((current) => !current)} onKeyDown={onTriggerKeyDown}>{trigger}</button>
    {open ? <div ref={menuRef} id={menuId} className={`baseer-menu__list ${menuClassName}`.trim()} role="menu" aria-label={label} onKeyDown={onMenuKeyDown} onClick={(event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')) close(false);
    }}>{children}</div> : null}
  </div>;
}

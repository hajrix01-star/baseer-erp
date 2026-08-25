import { forwardRef, type ComponentProps } from "react";

/** Shared text input that preserves refs required by React Hook Form and focus management. */
export const BaseerTextInput = forwardRef<HTMLInputElement, ComponentProps<"input">>(function BaseerTextInput({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={["baseer-text-input", className].filter(Boolean).join(" ")} />;
});

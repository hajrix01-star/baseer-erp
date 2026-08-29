import type { KeyboardEvent, ReactNode } from "react";

import { BaseerButton } from "./baseer-button";

export type BaseerStep = { id: string; label: ReactNode };

function availableStepIndex(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number, availableCount: number) {
  if (event.key === "Home") return 0;
  if (event.key === "End") return availableCount - 1;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return null;
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  return (currentIndex + direction + availableCount) % availableCount;
}

/**
 * Compact, keyboard-accessible setup progress. It deliberately uses the
 * existing button and card tokens so setup journeys do not introduce a second
 * visual language.
 */
export function BaseerStepper({ ariaLabel, steps, activeStep, onStepChange, children, footer }: {
  ariaLabel: string;
  steps: readonly BaseerStep[];
  activeStep: number;
  onStepChange: (step: number) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return <section className="baseer-stepper">
    <nav className="baseer-stepper__tabs" aria-label={ariaLabel} role="tablist">
      {steps.map((step, index) => {
        const active = index === activeStep;
        return <BaseerButton key={step.id} id={`baseer-step-${step.id}`} role="tab" aria-selected={active} aria-controls={`baseer-step-panel-${step.id}`} tabIndex={active ? 0 : -1} type="button" variant={active ? "primary" : "secondary"} disabled={index > activeStep} onKeyDown={(event) => {
          const nextIndex = availableStepIndex(event, index, activeStep + 1);
          if (nextIndex === null) return;
          event.preventDefault();
          const next = steps[nextIndex];
          if (!next) return;
          onStepChange(nextIndex);
          requestAnimationFrame(() => document.getElementById(`baseer-step-${next.id}`)?.focus());
        }} onClick={() => onStepChange(index)}>{index + 1}. {step.label}</BaseerButton>;
      })}
    </nav>
    <div className="baseer-stepper__panel" id={`baseer-step-panel-${steps[activeStep]?.id ?? ""}`} role="tabpanel" aria-labelledby={`baseer-step-${steps[activeStep]?.id ?? ""}`}>{children}</div>
    <footer className="baseer-stepper__footer">{footer}</footer>
  </section>;
}

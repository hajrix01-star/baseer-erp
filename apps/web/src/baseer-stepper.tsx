import type { ReactNode } from "react";

import { BaseerButton } from "./baseer-button";

export type BaseerStep = { id: string; label: ReactNode };

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
  return <section style={{ display: "grid", gap: "1rem" }}>
    <nav aria-label={ariaLabel} role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
      {steps.map((step, index) => {
        const active = index === activeStep;
        return <BaseerButton key={step.id} id={`baseer-step-${step.id}`} role="tab" aria-selected={active} type="button" variant={active ? "primary" : "secondary"} disabled={index > activeStep} onClick={() => onStepChange(index)}>{index + 1}. {step.label}</BaseerButton>;
      })}
    </nav>
    <div role="tabpanel" aria-labelledby={`baseer-step-${steps[activeStep]?.id ?? ""}`}>{children}</div>
    <footer style={{ display: "flex", gap: ".5rem", justifyContent: "flex-start" }}>{footer}</footer>
  </section>;
}

import { lazy, Suspense, type ComponentType } from "react";
import type { BaseerValidatedFormProps } from "./baseer-validated-form";

const LazyBaseerValidatedForm = lazy(async () => ({ default: (await import("./baseer-validated-form")).BaseerValidatedForm }));

export type { BaseerValidatedFormSchemaFactory } from "./baseer-validated-form";
export type BaseerValidatedFormFieldProps<Values extends Record<string, unknown>> = BaseerValidatedFormProps<Values>;

/** Keeps the RHF/Zod runtime behind the first form interaction/paint. */
export function BaseerValidatedFormField<Values extends Record<string, unknown>>(props: BaseerValidatedFormFieldProps<Values>) {
  const Form = LazyBaseerValidatedForm as unknown as ComponentType<BaseerValidatedFormFieldProps<Values>>;
  const fallbackChildren = typeof props.children === "function" ? null : props.children;
  return <Suspense fallback={<form id={props.id} className={props.className} data-baseer-rhf-form aria-busy="true" onSubmit={(event) => event.preventDefault()}>{fallbackChildren ? <fieldset disabled>{fallbackChildren}</fieldset> : null}</form>}>
    <Form {...props} />
  </Suspense>;
}

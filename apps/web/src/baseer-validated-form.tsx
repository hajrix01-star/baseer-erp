import type { FieldErrors, FieldValues } from "react-hook-form";
import { useMemo, type FormHTMLAttributes, type ReactNode } from "react";
import {
  array,
  boolean,
  custom,
  enum as enumeration,
  literal,
  object,
  string,
  union,
  type ZodTypeAny,
} from "zod";
import { useBaseerForm } from "./baseer-form-state";

const schemaLibrary = {
  array,
  boolean,
  custom,
  enum: enumeration,
  literal,
  object,
  string,
  union,
};

const validatedDecimalString = (message: string, scale = 4, maxIntegerDigits?: number) => string().regex(new RegExp(maxIntegerDigits
  ? `^(?:0|[1-9]\\d{0,${maxIntegerDigits - 1}})(?:\\.\\d{1,${scale}})?$`
  : `^\\d+(?:\\.\\d{1,${scale}})?$`), message);

export type BaseerValidatedFormSchemaFactory = (library: {
  z: typeof schemaLibrary;
  baseerDecimalString: typeof validatedDecimalString;
}) => ZodTypeAny;

export type BaseerValidatedFormRenderProps<Values extends FieldValues> = {
  errors: FieldErrors<Values>;
};

export type BaseerValidatedFormProps<Values extends FieldValues> = Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit" | "children"> & {
  values: Values;
  /** Legacy eager schema support. Prefer schemaFactory in lazy form chunks. */
  schema?: ZodTypeAny;
  /** Builds Zod and Decimal validation only after this lazy form chunk loads. */
  schemaFactory?: BaseerValidatedFormSchemaFactory;
  onValid: (values: Values) => void | Promise<void>;
  children?: ReactNode | ((props: BaseerValidatedFormRenderProps<Values>) => ReactNode);
  errorSummaryLabel: string;
};

/**
 * Central migration adapter for controlled legacy forms. It adds one RHF/Zod
 * boundary without changing their API payloads; new forms should register
 * individual fields through useBaseerForm for field-level focus and errors.
 */
export function BaseerValidatedForm<Values extends FieldValues>({ values, schema, schemaFactory, onValid, children, errorSummaryLabel, ...props }: BaseerValidatedFormProps<Values>) {
  const resolvedSchema = useMemo(() => schema ?? schemaFactory?.({ z: schemaLibrary, baseerDecimalString: validatedDecimalString }), [schema, schemaFactory]);
  if (!resolvedSchema) throw new Error("BaseerValidatedForm requires schema or schemaFactory.");
  const form = useBaseerForm<Values>({ values, schema: resolvedSchema, shouldFocusError: true });
  const invalid = Object.keys(form.formState.errors).length > 0;
  return <form {...props} data-baseer-rhf-form noValidate onSubmit={form.handleSubmit((next) => onValid(next))}>
    {typeof children === "function" ? children({ errors: form.formState.errors }) : children}
    {invalid ? <p className="daily-sales-message error" role="alert">{errorSummaryLabel}</p> : null}
  </form>;
}

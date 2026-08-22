import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, type FieldValues, type UseFormProps, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

/**
 * The single Baseer gateway for client-side form state. It deliberately owns
 * only usability (field errors, focus and reset); HTTP validation and every
 * financial rule remain authoritative on the server.
 */
export type BaseerFormOptions<Values extends FieldValues> = Omit<UseFormProps<Values>, "resolver"> & {
  schema: z.ZodTypeAny;
};

export function useBaseerForm<Values extends FieldValues>({ schema, shouldFocusError = true, ...options }: BaseerFormOptions<Values>): UseFormReturn<Values> {
  return useForm<Values>({
    ...options,
    resolver: zodResolver(schema as never) as UseFormProps<Values>["resolver"],
    shouldFocusError,
  });
}

/** Decimal values cross the UI/API boundary as strings; never coerce them to JS numbers. */
export const baseerDecimalString = (message: string, scale = 4, maxIntegerDigits?: number) => z.string().regex(new RegExp(maxIntegerDigits
  ? `^(?:0|[1-9]\\d{0,${maxIntegerDigits - 1}})(?:\\.\\d{1,${scale}})?$`
  : `^\\d+(?:\\.\\d{1,${scale}})?$`), message);

/** Dynamic collections use the same gateway; screens never import React Hook Form directly. */
export { z, useFieldArray };

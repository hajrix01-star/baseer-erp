import { useEffect, useMemo } from "react";

import { useBaseerForm, z } from "./baseer-form-state";

type BaseerRequiredTextareaFormProps = {
  formId: string;
  open: boolean;
  label: string;
  requiredMessage: string;
  busy?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
};

/**
 * Small Baseer adapter for a single required explanation. It owns only
 * client-side form state and accessibility; the server remains authoritative.
 */
export function BaseerRequiredTextareaForm({ formId, open, label, requiredMessage, busy = false, onSubmit }: BaseerRequiredTextareaFormProps) {
  const schema = useMemo(() => z.object({ value: z.string().trim().min(1, requiredMessage) }), [requiredMessage]);
  type Values = z.infer<typeof schema>;
  const { formState: { errors }, handleSubmit, register, reset } = useBaseerForm<Values>({
    defaultValues: { value: "" },
    schema,
  });

  useEffect(() => { if (open) reset({ value: "" }); }, [open, reset]);

  return <form id={formId} className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={handleSubmit(async ({ value }) => onSubmit(value))}>
    <label>{label}<textarea aria-describedby={errors.value ? `${formId}-error` : undefined} disabled={busy} {...register("value")} /></label>
    {errors.value ? <p id={`${formId}-error`} className="daily-sales-message error" role="alert">{errors.value.message}</p> : null}
  </form>;
}

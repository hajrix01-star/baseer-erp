import { lazy, Suspense, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { financeText } from "./finance-copy";
import type { Profile, RecurringExpenseConfiguration } from "./recurring-expense-workspace-runtime";

export type { Profile, ProfileForm, RecurringExpenseConfiguration } from "./recurring-expense-workspace-runtime";

const RecurringExpenseWorkspaceRuntime = lazy(async () => ({ default: (await import("./recurring-expense-workspace-runtime")).RecurringExpenseWorkspaceRuntime }));
const RecurringExpensePaymentBatchRuntime = lazy(async () => ({ default: (await import("./recurring-expense-workspace-runtime")).RecurringExpensePaymentBatchRuntime }));

type WorkspaceProps = { language: "ar" | "en"; configuration: RecurringExpenseConfiguration; profiles: Profile[]; businessDate: string; reload: () => Promise<void> };

/** Recurring expenses are a primary view and open directly; posting payments remains explicit. */
export function RecurringExpenseWorkspace(props: WorkspaceProps) {
  const text = financeText(props.language);
  return <Suspense fallback={<BaseerCard aria-busy="true">{text.loading}</BaseerCard>}><RecurringExpenseWorkspaceRuntime {...props} /></Suspense>;
}

/** The batch entry form is an explicit financial action and is therefore not part of the overview payload. */
export function RecurringExpensePaymentBatch(props: WorkspaceProps) {
  const [open, setOpen] = useState(false);
  const text = financeText(props.language);
  if (open) return <Suspense fallback={<BaseerCard aria-busy="true">{text.loading}</BaseerCard>}><RecurringExpensePaymentBatchRuntime {...props} /></Suspense>;
  return <BaseerCard><strong>{text.recurringBatchTitle}</strong><BaseerButton type="button" onClick={() => setOpen(true)}>{props.language === "ar" ? "فتح دفعات المصروفات الدورية" : "Open recurring expense payments"}</BaseerButton></BaseerCard>;
}

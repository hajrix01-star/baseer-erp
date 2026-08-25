import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession } from "./daily-sales-client";
import { financeText } from "./finance-copy";
import { hasActivePermission } from "./module-access";

type ExpensesWorkspaceTab = "items" | "batch" | "history";

const ExpensesObligationsWorkspaceRuntime = lazy(async () => ({ default: (await import("./expenses-obligations-workspace-runtime")).ExpensesObligationsWorkspaceRuntime }));

/** Permission is still enforced, while the authorized workspace opens directly. */
export function ExpensesObligationsWorkspace({ language, activeTab = "items", onTabChange }: { language: "ar" | "en"; activeTab?: ExpensesWorkspaceTab; onTabChange?: (tab: ExpensesWorkspaceTab) => void }) {
  const session = activeSession();
  const text = financeText(language);
  const allowed = (hasActivePermission("finance.configuration.read") && hasActivePermission("finance.loans.read") && hasActivePermission("finance.purchase_expense.read"))
    || (hasActivePermission("finance.configuration.read") && hasActivePermission("finance.purchase_expense.read"))
    || (hasActivePermission("finance.loans.read") && hasActivePermission("finance.purchase_expense.read"));
  if (!session) return <DailySalesSignIn language={language} />;
  if (!allowed) return <BaseerCard>{language === "ar" ? "لا تملك صلاحية عرض هذا الجزء من المصروفات والالتزامات." : "You do not have permission to view this expenses and obligations area."}</BaseerCard>;
  return <Suspense fallback={<BaseerCard aria-busy="true">{text.loading}</BaseerCard>}><ExpensesObligationsWorkspaceRuntime language={language} activeTab={activeTab} onTabChange={onTabChange} /></Suspense>;
}

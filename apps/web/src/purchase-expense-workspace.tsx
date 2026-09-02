import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type PurchaseWorkspaceTab = "entry" | "history" | "credit";

const PurchaseExpenseWorkspaceContent = lazy(async () => ({ default: (await import("./purchase-expense-workspace-content")).PurchaseExpenseWorkspaceContent }));

/**
 * Purchase first paint is a concise, read-only summary. The costly entry,
 * history, and credit workflows remain lazy until the user opens management.
 */
export function PurchaseExpenseWorkspace({ language, migrationReviewLocked = false, activeTab = "entry", onTabChange }: { language: "ar" | "en"; migrationReviewLocked?: boolean; activeTab?: PurchaseWorkspaceTab; onTabChange?: (tab: PurchaseWorkspaceTab) => void }) {
  const text = language === "ar" ? "جارٍ تحميل المشتريات…" : "Loading purchases…";
  return <Suspense fallback={<BaseerCard aria-busy="true">{text}</BaseerCard>}><PurchaseExpenseWorkspaceContent language={language} migrationReviewLocked={migrationReviewLocked} activeTab={activeTab} onTabChange={onTabChange} /></Suspense>;
}

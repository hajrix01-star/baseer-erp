import { lazy, Suspense } from "react";
import type { ModuleId } from "./modules";
import type { PageId } from "./page-registry";

const AdministrationWorkspace = lazy(async () => ({ default: (await import("./administration-workspace")).AdministrationWorkspace }));
const BackupRecoveryWorkspace = lazy(async () => ({ default: (await import("./backup-recovery-workspace")).BackupRecoveryWorkspace }));
const NurixMigrationWorkspace = lazy(async () => ({ default: (await import("./nurix-migration-workspace")).NurixMigrationWorkspace }));
const CommandCenterSalesCalendar = lazy(async () => ({ default: (await import("./command-center-workspace")).CommandCenterWorkspace }));
const OwnerDashboardWorkspace = lazy(async () => ({ default: (await import("./owner-dashboard-workspace")).OwnerDashboardWorkspace }));
const DecisionIntelligenceWorkspace = lazy(async () => ({ default: (await import("./decision-intelligence-workspace")).DecisionIntelligenceWorkspace }));
const MarketingWorkspace = lazy(async () => ({ default: (await import("./marketing-workspace")).MarketingWorkspace }));
const OperationsOverviewWorkspace = lazy(async () => ({ default: (await import("./operations-overview-workspace")).OperationsOverviewWorkspace }));
const DailySalesWorkspace = lazy(async () => ({ default: (await import("./daily-sales-workspace")).DailySalesWorkspace }));
const OperationsExecutionWorkspace = lazy(async () => ({ default: (await import("./operations-execution-workspace")).OperationsExecutionWorkspace }));
const OperationsReportsWorkspace = lazy(async () => ({ default: (await import("./operations-reports-workspace")).OperationsReportsWorkspace }));
const OperationsAssetsWarrantyWorkspace = lazy(async () => ({ default: (await import("./operations-assets-warranty-workspace")).OperationsAssetsWarrantyWorkspace }));
const SalesAnalyticsWorkspace = lazy(async () => ({ default: (await import("./sales-analytics-workspace")).SalesAnalyticsWorkspace }));
const PurchaseExpenseWorkspace = lazy(async () => ({ default: (await import("./purchase-expense-workspace")).PurchaseExpenseWorkspace }));
const ExpensesObligationsWorkspace = lazy(async () => ({ default: (await import("./expenses-obligations-workspace")).ExpensesObligationsWorkspace }));
const FinanceSetupWorkspace = lazy(async () => ({ default: (await import("./finance-setup-workspace")).FinanceSetupWorkspace }));
const InvoiceRegisterWorkspace = lazy(async () => ({ default: (await import("./invoice-register-workspace")).InvoiceRegisterWorkspace }));
const TreasuryWorkspace = lazy(async () => ({ default: (await import("./treasury-workspace")).TreasuryWorkspace }));
const FinanceAccountsWorkspace = lazy(async () => ({ default: (await import("./finance-accounts-workspace")).FinanceAccountsWorkspace }));
const CategoriesWorkspace = lazy(async () => ({ default: (await import("./categories-workspace")).CategoriesWorkspace }));
const HrOverviewWorkspace = lazy(async () => ({ default: (await import("./hr-overview-workspace")).HrOverviewWorkspace }));
const HrWorkspace = lazy(async () => ({ default: (await import("./hr-workspace-router")).HrWorkspaceRouter }));
const ReportsOverviewWorkspace = lazy(async () => ({ default: (await import("./reports-overview-workspace")).ReportsOverviewWorkspace }));
const ReportsWorkspace = lazy(async () => ({ default: (await import("./reports-workspace")).ReportsWorkspace }));
const InternalVatReportWorkspace = lazy(async () => ({ default: (await import("./internal-vat-report-workspace")).InternalVatReportWorkspace }));
const ReportDocumentsWorkspace = lazy(async () => ({ default: (await import("./report-documents-workspace")).ReportDocumentsWorkspace }));
const OperationsCatalogWorkspace = lazy(async () => ({ default: (await import("./operations-catalog-workspace")).OperationsCatalogWorkspace }));
const VatSimulationWorkspace = lazy(async () => ({ default: (await import("./vat-simulation-workspace")).VatSimulationWorkspace }));

type Props = {
  route: { moduleId: ModuleId; section: number; pageId: PageId; stage?: string };
  language: "ar" | "en";
  permissionCodes: readonly string[] | null;
  onStage: (stage: string) => void;
  loading: string;
  loadingPurchases: string;
  loadingFinanceSetup: string;
  loadingVaults: string;
  loadingAdministration: string;
};

function Fallback({ children }: { children: string }) {
  return <section className="module-page__placeholder">{children}</section>;
}

export function WorkspacePageContent({ route, language, permissionCodes, onStage, loading, loadingPurchases, loadingFinanceSetup, loadingVaults, loadingAdministration }: Props) {
  const content = route.moduleId === "reports" && route.pageId === "reports-hajri-tax" ? <VatSimulationWorkspace language={language} />
    : route.moduleId === "administration" && route.pageId === "administration-backup" ? <BackupRecoveryWorkspace language={language} />
    : route.moduleId === "administration" && route.pageId === "administration-nurix-migration" ? <NurixMigrationWorkspace language={language} />
    : route.moduleId === "operations" && route.section === 0 ? <OperationsOverviewWorkspace language={language} />
    : route.moduleId === "command" && route.section === 2 ? <SalesAnalyticsWorkspace language={language} />
    : route.moduleId === "command" && route.section === 3 ? <OwnerDashboardWorkspace language={language} />
    : route.moduleId === "decision" ? <DecisionIntelligenceWorkspace language={language} section={route.section} permissionCodes={permissionCodes} />
    : route.moduleId === "marketing" ? <MarketingWorkspace language={language} section={route.section} permissionCodes={permissionCodes} />
    : route.moduleId === "operations" && route.section === 9 ? <OperationsAssetsWarrantyWorkspace language={language} />
    : route.moduleId === "reports" && route.section === 0 ? <ReportsOverviewWorkspace language={language} />
    : route.moduleId === "reports" && route.section === 1 ? <ReportsWorkspace language={language} initialReport={route.stage === "cash-performance" ? "cash-performance" : "trial-balance"} />
    : route.moduleId === "reports" && route.section === 2 ? <InternalVatReportWorkspace language={language} />
    : route.moduleId === "reports" && route.section === 4 ? <ReportDocumentsWorkspace language={language} />
    : route.moduleId === "hr" && route.section === 0 ? <HrOverviewWorkspace language={language} />
    : route.moduleId === "hr" ? <HrWorkspace language={language} section={route.section} />
    : route.moduleId === "operations" && route.section === 1 ? <DailySalesWorkspace language={language} />
    : route.moduleId === "operations" && route.section === 2 ? <PurchaseExpenseWorkspace language={language} activeTab={route.stage === "credit" ? "credit" : "entry"} onTabChange={onStage} />
    : route.moduleId === "operations" && route.section === 3 ? <ExpensesObligationsWorkspace language={language} activeTab={route.stage === "batch" || route.stage === "history" ? route.stage : "items"} onTabChange={onStage} />
    : route.moduleId === "operations" && route.section === 4 ? <FinanceSetupWorkspace language={language} view="suppliers" />
    : route.moduleId === "operations" && route.section === 5 ? <OperationsCatalogWorkspace language={language} />
    : route.moduleId === "operations" && route.section === 6 ? <OperationsExecutionWorkspace language={language} />
    : route.moduleId === "operations" && route.section === 8 ? <OperationsReportsWorkspace language={language} />
    : route.moduleId === "finance" && route.pageId === "finance-settings" ? <FinanceSetupWorkspace language={language} />
    : route.moduleId === "finance" && route.pageId === "finance-ledger" ? <InvoiceRegisterWorkspace language={language} />
    : route.moduleId === "finance" && route.pageId === "finance-treasury" ? <TreasuryWorkspace language={language} />
    : route.moduleId === "finance" && route.pageId === "finance-accounts" ? <FinanceAccountsWorkspace language={language} />
    : route.moduleId === "finance" && route.pageId === "finance-categories" ? <CategoriesWorkspace language={language} />
    : route.moduleId === "administration" ? <AdministrationWorkspace language={language} section={route.section} />
    : route.moduleId === "command" && (route.section === 0 || route.section === 1) ? <CommandCenterSalesCalendar language={language} permissionCodes={permissionCodes} section={route.section} />
    : null;
  if (!content) return <section className="module-page__placeholder" />;
  const fallback = route.moduleId === "operations" && route.section === 2 ? loadingPurchases
    : route.moduleId === "finance" && route.pageId === "finance-treasury" ? loadingVaults
    : route.moduleId === "finance" ? loadingFinanceSetup
    : route.moduleId === "administration" ? loadingAdministration
    : route.moduleId === "operations" && route.section === 4 ? loadingFinanceSetup
    : loading;
  return <Suspense fallback={<Fallback>{fallback}</Fallback>}>{content}</Suspense>;
}

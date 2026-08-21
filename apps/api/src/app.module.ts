import { Module } from '@nestjs/common';

import { AiCredentialVault } from './ai-platform/ai-credential-vault.js';
import { AdministrationController } from './administration/administration.controller.js';
import { AdministrationService } from './administration/administration.service.js';
import { TenantAdministrationContextService } from './administration/tenant-administration-context.service.js';
import { AiPlatformController } from './ai-platform/ai-platform.controller.js';
import { AiRuntimeController } from './ai-platform/ai-runtime.controller.js';
import { AiProviderAdapterRegistry } from './ai-platform/ai-provider-adapter-registry.js';
import { AiRuntimeService } from './ai-platform/ai-runtime.service.js';
import { AiRuntimeRateLimitService } from './ai-platform/ai-runtime-rate-limit.service.js';
import { AiPlatformService } from './ai-platform/ai-platform.service.js';

import { BusinessDateController } from './business-date/business-date.controller.js';
import { BUSINESS_DATE_CLOCK, BusinessDateService } from './business-date/business-date.service.js';
import { CompanyAccessController } from './company-context/company-access.controller.js';
import { CompanyAccessService } from './company-context/company-access.service.js';
import { CompanyContextService } from './company-context/company-context.service.js';
import { DocumentSerialService, IdempotencyService } from './core-controls/index.js';
import { DatabaseService } from './database/database.service.js';
import { FileMetadataController } from './file-metadata/file-metadata.controller.js';
import { FileMetadataService } from './file-metadata/file-metadata.service.js';
import { FinanceFoundationService } from './finance/finance-foundation.service.js';
import { FinancePeriodService } from './finance/finance-period.service.js';
import { FinancePeriodLifecycleService } from './finance/finance-period-lifecycle.service.js';
import { FinancePeriodCommandService } from './finance/finance-period-command.service.js';
import { FinancePeriodCommandController } from './finance/finance-period-command.controller.js';
import { JournalPostingService } from './finance/journal/journal-posting.service.js';
import { FinanceVaultService } from './finance/finance-vault.service.js';
import { SupplierCopyController } from './finance/supplier-copy.controller.js';
import { SupplierCopyService } from './finance/supplier-copy.service.js';
import { SupplierDuesService } from './finance/supplier-dues.service.js';
import { SupplierDueQueriesService } from './finance/supplier-due-queries.service.js';
import { SupplierDuesController } from './finance/supplier-dues.controller.js';
import { PurchaseExpenseController } from './finance/purchase-expense.controller.js';
import { PurchaseExpenseService } from './finance/purchase-expense.service.js';
import { SupplierDueReportsController } from './finance/supplier-due-reports.controller.js';
import { RecurringExpenseController } from './finance/recurring-expense.controller.js';
import { RecurringExpenseService } from './finance/recurring-expense.service.js';
import { InclusiveLoanService } from './finance/inclusive-loan.service.js';
import { InclusiveLoanRepaymentService } from './finance/inclusive-loan-repayment.service.js';
import { InclusiveLoansController } from './finance/inclusive-loans.controller.js';
import { CompanyFinanceSetupService } from './finance/company-finance-setup.service.js';
import { CompanyFinanceSetupController } from './finance/company-finance-setup.controller.js';
import { VaultManagementService } from './finance/vault-management.service.js';
import { VaultManagementController } from './finance/vault-management.controller.js';
import { TreasuryController } from './finance/treasury.controller.js';
import { InvoiceRegisterController } from './finance/invoice-register.controller.js';
import { TreasuryService } from './finance/treasury.service.js';
import { InvoiceRegisterService } from './finance/invoice-register.service.js';
import { FinanceAccountsController } from './finance/finance-accounts.controller.js';
import { FinanceAccountsService } from './finance/finance-accounts.service.js';
import { FinanceConfigurationService } from './finance/finance-configuration.service.js';
import { FinancePnlMappingService } from './finance/finance-pnl-mapping.service.js';
import { ReportRunService } from './reports/report-run.service.js';
import { ReportCatalogService } from './reports/report-catalog.service.js';
import { ReportCatalogController } from './reports/report-catalog.controller.js';
import { ReportsController } from './reports/reports.controller.js';
import { CashPerformanceCoverageService } from './reports/cash-performance-coverage.service.js';
import { PersonalCashPerformanceReportService } from './reports/personal-cash-performance-report.service.js';
import { CashPerformanceHistoricalImportService } from './reports/cash-performance-historical-import.service.js';
import { LedgerTrialBalanceController } from './reports/ledger-trial-balance.controller.js';
import { LedgerTrialBalanceReportService } from './reports/ledger-trial-balance-report.service.js';
import { InternalVatReportController } from './reports/internal-vat-report.controller.js';
import { InternalVatReportService } from './reports/internal-vat-report.service.js';
import { ReportDocumentController } from './reports/report-document.controller.js';
import { ReportDocumentService } from './reports/report-document.service.js';
import { FinanceCashPerformanceEventService } from './finance/finance-cash-performance-event.service.js';
import { FinanceVatSettlementService } from './finance/finance-vat-settlement.service.js';
import { FinanceConfigurationController } from './finance/finance-configuration.controller.js';
import { ExpensesObligationsReadController } from './finance/expenses-obligations-read.controller.js';
import { ExpensesObligationsReadService } from './finance/expenses-obligations-read.service.js';
import { FinanceMasterDataController } from './finance/finance-master-data.controller.js';
import { FinanceMasterDataService } from './finance/finance-master-data.service.js';
import { DailySalesController } from './finance/daily-sales.controller.js';
import { DailySalesService } from './finance/daily-sales.service.js';
import { DailySalesCommandSupportService } from './finance/daily-sales-command-support.service.js';
import { DailySalesWriteService } from './finance/daily-sales-write.service.js';
import { DailySalesProjectionService } from './finance/daily-sales-projection.service.js';
import { DailySalesReadService } from './finance/daily-sales-read.service.js';
import { DailySalesPostingService } from './finance/daily-sales-posting.service.js';
import { OperationalCalendarService } from './finance/operational-calendar.service.js';
import { HealthController } from './health/health.controller.js';
import { ObservabilityController } from './observability/observability.controller.js';
import { ObservabilityService } from './observability/observability.service.js';
import { RequestObservabilityInterceptor } from './observability/request-observability.interceptor.js';
import { AuthController } from './identity/auth.controller.js';
import { AuthService } from './identity/auth.service.js';
import { IdentityTokenService } from './identity/identity-token.service.js';
import { OutputController } from './output/output.controller.js';
import { OutputService } from './output/output.service.js';
import { HrController } from './hr/hr.controller.js';
import { HrService } from './hr/hr.service.js';
import { HrAdvanceService } from './hr/hr-advance.service.js';
import { HrAdministrativeDeductionService } from './hr/hr-administrative-deduction.service.js';
import { HrPayrollService } from './hr/hr-payroll.service.js';
import { HrLeaveService } from './hr/hr-leave.service.js';
import { HrEmployeeDocumentController } from './hr/hr-employee-document.controller.js';
import { HrEmployeeDocumentService } from './hr/hr-employee-document.service.js';
import { HrEmployeeLetterController } from './hr/hr-employee-letter.controller.js';
import { HrEmployeeLetterService } from './hr/hr-employee-letter.service.js';
import { HrFinalSettlementController } from './hr/hr-final-settlement.controller.js';
import { HrFinalSettlementService } from './hr/hr-final-settlement.service.js';
import { HrOverviewController } from './hr/hr-overview.controller.js';
import { HrOverviewService } from './hr/hr-overview.service.js';
import { OperationsCatalogController } from './operations/operations-catalog.controller.js';
import { OperationsCatalogService } from './operations/operations-catalog.service.js';
import { OperationsExecutionController } from './operations/operations-execution.controller.js';
import { OperationsExecutionService } from './operations/operations-execution.service.js';
import { OperationsInternalRegistrationController } from './operations/operations-internal-registration.controller.js';
import { OperationsInternalRegistrationService } from './operations/operations-internal-registration.service.js';
import { OperationsAssetsWarrantyController } from './operations/operations-assets-warranty.controller.js';
import { OperationsAssetsWarrantyService } from './operations/operations-assets-warranty.service.js';
import { DecisionIntelligenceController } from './decision-intelligence/decision-intelligence.controller.js';
import { DecisionIntelligenceService } from './decision-intelligence/decision-intelligence.service.js';

@Module({
  controllers: [AdministrationController, HealthController, CompanyAccessController, AiPlatformController, AiRuntimeController, AuthController, OutputController, BusinessDateController, FileMetadataController, ObservabilityController, SupplierCopyController, SupplierDuesController, PurchaseExpenseController, CompanyFinanceSetupController, InclusiveLoansController, FinanceConfigurationController, ExpensesObligationsReadController, FinanceMasterDataController, VaultManagementController, TreasuryController, InvoiceRegisterController, FinanceAccountsController, FinancePeriodCommandController, SupplierDueReportsController, DailySalesController, RecurringExpenseController, HrController, HrEmployeeDocumentController, HrEmployeeLetterController, HrFinalSettlementController, HrOverviewController, ReportCatalogController, ReportsController, LedgerTrialBalanceController, InternalVatReportController, ReportDocumentController, OperationsCatalogController, OperationsExecutionController, OperationsInternalRegistrationController, OperationsAssetsWarrantyController, DecisionIntelligenceController],
  providers: [
    DatabaseService,
    TenantAdministrationContextService,
    AdministrationService,
    AiCredentialVault,
    AiPlatformService,
    AiProviderAdapterRegistry,
    AiRuntimeService,
    AiRuntimeRateLimitService,
    { provide: BUSINESS_DATE_CLOCK, useValue: { now: () => new Date() } },
    BusinessDateService,
    AuthService,
    IdentityTokenService,
    CompanyContextService,
    CompanyAccessService,
    IdempotencyService,
    DocumentSerialService,
    FileMetadataService,
    FinanceFoundationService,
    FinancePeriodService,
    FinancePeriodLifecycleService,
    FinancePeriodCommandService,
    JournalPostingService,
    FinanceVaultService,
    SupplierCopyService,
    SupplierDuesService,
    PurchaseExpenseService,
    SupplierDueQueriesService,
    RecurringExpenseService,
    InclusiveLoanService,
    InclusiveLoanRepaymentService,
    CompanyFinanceSetupService,
    VaultManagementService, TreasuryService, InvoiceRegisterService, FinanceAccountsService,
    FinanceConfigurationService,
    FinancePnlMappingService,
    ReportRunService,
    ReportCatalogService,
    CashPerformanceCoverageService,
    CashPerformanceHistoricalImportService,
    PersonalCashPerformanceReportService,
    LedgerTrialBalanceReportService,
    InternalVatReportService,
    ReportDocumentService,
    FinanceCashPerformanceEventService,
    FinanceVatSettlementService,
    ExpensesObligationsReadService,
    FinanceMasterDataService,
    DailySalesProjectionService,
    DailySalesReadService,
    DailySalesPostingService,
    OperationalCalendarService,
    DailySalesCommandSupportService,
    DailySalesWriteService,
    DailySalesService,
    ObservabilityService,
    RequestObservabilityInterceptor,
    OutputService,
    HrService,
    HrAdvanceService,
    HrAdministrativeDeductionService,
    HrPayrollService,
    HrLeaveService,
    HrEmployeeDocumentService,
    HrEmployeeLetterService,
    HrFinalSettlementService,
    HrOverviewService,
    OperationsCatalogService,
    OperationsExecutionService,
    OperationsInternalRegistrationService,
    OperationsAssetsWarrantyService,
    DecisionIntelligenceService,
  ],
})
export class AppModule {}

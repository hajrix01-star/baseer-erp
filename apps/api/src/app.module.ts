import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AiCredentialVault } from './ai-platform/ai-credential-vault.js';
import { AiConsumptionGuardService } from './ai-platform/ai-consumption-guard.service.js';
import { AiInterpretationService } from './ai-platform/ai-interpretation.service.js';
import { AiInterpretationCenterService } from './ai-platform/ai-interpretation-center.service.js';
import { AdministrationController } from './administration/administration.controller.js';
import { AdministrationService } from './administration/administration.service.js';
import { TenantAdministrationContextService } from './administration/tenant-administration-context.service.js';
import { AiPlatformController } from './ai-platform/ai-platform.controller.js';
import { AiRuntimeController } from './ai-platform/ai-runtime.controller.js';
import { AiProviderAdapterRegistry } from './ai-platform/ai-provider-adapter-registry.js';
import { AiRuntimeService } from './ai-platform/ai-runtime.service.js';
import { AnalysisReadinessService } from './ai-platform/analysis-readiness.service.js';
import { AiRuntimeRateLimitService } from './ai-platform/ai-runtime-rate-limit.service.js';
import { AiPlatformService } from './ai-platform/ai-platform.service.js';

import { BusinessDateController } from './business-date/business-date.controller.js';
import { BUSINESS_DATE_CLOCK, BusinessDateService } from './business-date/business-date.service.js';
import { BackupController } from './backup/backup.controller.js';
import { BackupService } from './backup/backup.service.js';
import { BackupDownloadService } from './backup/backup-download.service.js';
import { CompanyArchiveExporter } from './backup/company-archive-exporter.js';
import { BackupWorkerService } from './backup/backup-worker.service.js';
import { RestoreAsNewService } from './backup/restore-as-new.service.js';
import { BackupPolicyService } from './backup/backup-policy.service.js';
import { NurixMigrationReviewController } from './nurix-migration/nurix-migration-review.controller.js';
import { NurixMigrationReviewService } from './nurix-migration/nurix-migration-review.service.js';
import { NurixExcelImportController } from './nurix-migration/nurix-excel-import.controller.js';
import { NurixExcelImportService } from './nurix-migration/nurix-excel-import.service.js';
import { NurixExcelFinancialImportService } from './nurix-migration/nurix-excel-financial-import.service.js';
import { NurixExcelFinancialMigrationService } from './nurix-migration/nurix-excel-financial-migration.service.js';
import { NurixExcelCompletionService } from './nurix-migration/nurix-excel-completion.service.js';
import { NurixExcelDailySalesMigrationService } from './nurix-migration/nurix-excel-daily-sales-migration.service.js';
import { NurixExcelPackageClosureAuditService } from './nurix-migration/nurix-excel-package-closure-audit.service.js';
import { NurixExcelRecurringMigrationService } from './nurix-migration/nurix-excel-recurring-migration.service.js';
import { NurixExcelReferenceAllocationMigrationService } from './nurix-migration/nurix-excel-reference-allocation-migration.service.js';
import { NurixExcelEvidenceArchiveService } from './nurix-migration/nurix-excel-evidence-archive.service.js';
import { NurixExcelHrHistoryImportService } from './nurix-migration/nurix-excel-hr-history-import.service.js';
import { NurixExcelSupplierDuplicateCleanupService } from './nurix-migration/nurix-excel-supplier-duplicate-cleanup.service.js';
import { NurixHistoricalPayrollMigrationService } from './nurix-migration/nurix-historical-payroll-migration.service.js';
import { NurixExcelStagingStorageService } from './nurix-migration/nurix-excel-staging-storage.service.js';
import { BackupScheduleDispatcherService, BackupScheduleRunnerService } from './backup/schedule-dispatcher.js';
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
import { AccrualProfitLossController } from './reports/accrual-profit-loss.controller.js';
import { AccrualProfitLossReportService } from './reports/accrual-profit-loss-report.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { CashPerformanceCoverageService } from './reports/cash-performance-coverage.service.js';
import { PersonalCashPerformanceReportService } from './reports/personal-cash-performance-report.service.js';
import { FinancialEvidenceRegistryService } from './reports/financial-evidence-registry.service.js';
import { CashPerformanceHistoricalImportService } from './reports/cash-performance-historical-import.service.js';
import { LedgerTrialBalanceController } from './reports/ledger-trial-balance.controller.js';
import { LedgerTrialBalanceReportService } from './reports/ledger-trial-balance-report.service.js';
import { InternalVatReportController } from './reports/internal-vat-report.controller.js';
import { InternalVatReportService } from './reports/internal-vat-report.service.js';
import { VatSimulationController } from './reports/vat-simulation.controller.js';
import { VatSimulationService } from './reports/vat-simulation.service.js';
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
import { HrHistoricalPayrollEvidenceReadService } from './hr/hr-historical-payroll-evidence-read.service.js';
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
import { AttendanceController } from './attendance/attendance.controller.js';
import { AttendanceService } from './attendance/attendance.service.js';
import { OperationsCatalogController } from './operations/operations-catalog.controller.js';
import { OperationsCatalogService } from './operations/operations-catalog.service.js';
import { OperationsExecutionController } from './operations/operations-execution.controller.js';
import { OperationsExecutionService } from './operations/operations-execution.service.js';
import { OperationsInternalRegistrationController } from './operations/operations-internal-registration.controller.js';
import { OperationsInternalRegistrationService } from './operations/operations-internal-registration.service.js';
import { OperationsInventoryReportingController } from './operations/operations-inventory-reporting.controller.js';
import { OperationsInventoryReportingService } from './operations/operations-inventory-reporting.service.js';
import { OperationsAssetsWarrantyController } from './operations/operations-assets-warranty.controller.js';
import { OperationsAssetsWarrantyService } from './operations/operations-assets-warranty.service.js';
import { OperationsOverviewController } from './operations/operations-overview.controller.js';
import { OperationsOverviewService } from './operations/operations-overview.service.js';
import { DecisionIntelligenceController } from './decision-intelligence/decision-intelligence.controller.js';
import { DecisionIntelligenceService } from './decision-intelligence/decision-intelligence.service.js';
import { DecisionContextImportService } from './decision-intelligence/decision-context-import.service.js';
import { DecisionContextResearchService } from './decision-intelligence/decision-context-research.service.js';
import { MarketingController } from './marketing/marketing.controller.js';
import { MarketingGooglePlatformService } from './marketing/marketing-google-platform.service.js';
import { MarketingGoogleOAuthService } from './marketing/marketing-google-oauth.service.js';
import { MarketingGoogleBusinessOAuthPilotService } from './marketing/marketing-google-business-oauth-pilot.service.js';
import { MarketingGoogleCredentialVault } from './marketing/marketing-google-credential-vault.js';
import { MarketingService } from './marketing/marketing.service.js';
import { InboundEvidenceController } from './inbound-evidence/inbound-evidence.controller.js';
import { InboundEvidenceService } from './inbound-evidence/inbound-evidence.service.js';
import { InboundEvidenceGmailService } from './inbound-evidence/inbound-evidence-gmail.service.js';
import { InboundEvidenceDocumentIntelligenceService } from './inbound-evidence/inbound-evidence-document-intelligence.service.js';
import { OwnerDailyBriefController } from './owner-daily-brief/owner-daily-brief.controller.js';
import { OwnerDailyBriefService } from './owner-daily-brief/owner-daily-brief.service.js';
import { OwnerDailyBriefSchedulerService } from './owner-daily-brief/owner-daily-brief-scheduler.service.js';
import { AttendanceLocationRetentionSchedulerService } from './attendance/attendance-location-retention-scheduler.service.js';
import { OwnerDashboardController } from './owner-dashboard/owner-dashboard.controller.js';
import { OwnerDashboardService } from './owner-dashboard/owner-dashboard.service.js';
import { OfficialReportRunsController } from './reports/official-report-runs.controller.js';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      // Deliberately no global guard: ordinary ERP reads must not share the
      // authentication attack budget. AuthController opts in per endpoint.
      throttlers: [
        { name: 'authIp', limit: 10, ttl: 900_000, blockDuration: 900_000 },
        { name: 'authIdentity', limit: 5, ttl: 900_000, blockDuration: 900_000 },
        // A single private API instance can use in-process limits safely. If
        // deployments gain replicas, move these named policies to shared storage.
        { name: 'report', limit: 60, ttl: 60_000, blockDuration: 60_000 },
        { name: 'output', limit: 20, ttl: 60_000, blockDuration: 60_000 },
        { name: 'fileWrite', limit: 12, ttl: 60_000, blockDuration: 60_000 },
        { name: 'attendancePin', limit: 6, ttl: 60_000, blockDuration: 15 * 60_000 },
      ],
    }),
  ],
  controllers: [AdministrationController, BackupController, NurixMigrationReviewController, NurixExcelImportController, HealthController, CompanyAccessController, AiPlatformController, AiRuntimeController, AuthController, OutputController, BusinessDateController, FileMetadataController, ObservabilityController, SupplierCopyController, SupplierDuesController, PurchaseExpenseController, CompanyFinanceSetupController, InclusiveLoansController, FinanceConfigurationController, ExpensesObligationsReadController, FinanceMasterDataController, VaultManagementController, TreasuryController, InvoiceRegisterController, FinanceAccountsController, FinancePeriodCommandController, SupplierDueReportsController, DailySalesController, RecurringExpenseController, HrController, HrEmployeeDocumentController, HrEmployeeLetterController, HrFinalSettlementController, HrOverviewController, AttendanceController, ReportCatalogController, ReportsController, AccrualProfitLossController, LedgerTrialBalanceController, InternalVatReportController, VatSimulationController, ReportDocumentController, OfficialReportRunsController, OperationsCatalogController, OperationsExecutionController, OperationsInternalRegistrationController, OperationsInventoryReportingController, OperationsAssetsWarrantyController, OperationsOverviewController, DecisionIntelligenceController, MarketingController, InboundEvidenceController, OwnerDailyBriefController, OwnerDashboardController],
  providers: [
    DatabaseService,
    BackupService,
    BackupDownloadService,
    CompanyArchiveExporter,
    BackupWorkerService,
    BackupPolicyService,
    NurixMigrationReviewService,
    NurixExcelStagingStorageService,
    NurixExcelImportService,
    NurixExcelFinancialImportService,
    NurixExcelFinancialMigrationService,
    NurixExcelCompletionService,
    NurixExcelDailySalesMigrationService,
    NurixExcelPackageClosureAuditService,
    NurixExcelRecurringMigrationService,
    NurixExcelReferenceAllocationMigrationService,
    NurixExcelEvidenceArchiveService,
    NurixExcelHrHistoryImportService,
    NurixExcelSupplierDuplicateCleanupService,
    NurixHistoricalPayrollMigrationService,
    BackupScheduleDispatcherService,
    BackupScheduleRunnerService,
    {
      provide: RestoreAsNewService,
      useFactory: (downloads: BackupDownloadService) => new RestoreAsNewService(downloads),
      inject: [BackupDownloadService],
    },
    TenantAdministrationContextService,
    AdministrationService,
    AiCredentialVault,
    AiConsumptionGuardService,
    AiInterpretationService,
    AiInterpretationCenterService,
    AiPlatformService,
    AiProviderAdapterRegistry,
    AiRuntimeService,
    AnalysisReadinessService,
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
    AccrualProfitLossReportService,
    CashPerformanceCoverageService,
    CashPerformanceHistoricalImportService,
    PersonalCashPerformanceReportService,
    FinancialEvidenceRegistryService,
    LedgerTrialBalanceReportService,
    InternalVatReportService,
    VatSimulationService,
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
    HrHistoricalPayrollEvidenceReadService,
    HrPayrollService,
    HrLeaveService,
    HrEmployeeDocumentService,
    HrEmployeeLetterService,
    HrFinalSettlementService,
    HrOverviewService,
    AttendanceService,
    AttendanceLocationRetentionSchedulerService,
    OperationsCatalogService,
    OperationsExecutionService,
    OperationsInternalRegistrationService,
    OperationsInventoryReportingService,
    OperationsAssetsWarrantyService,
    OperationsOverviewService,
    DecisionIntelligenceService,
    DecisionContextImportService,
    DecisionContextResearchService,
    MarketingGooglePlatformService,
    MarketingGoogleOAuthService,
    MarketingGoogleCredentialVault,
    MarketingGoogleBusinessOAuthPilotService,
    MarketingService,
    InboundEvidenceService,
    InboundEvidenceGmailService,
    InboundEvidenceDocumentIntelligenceService,
    OwnerDailyBriefService,
    OwnerDailyBriefSchedulerService,
    OwnerDashboardService,
  ],
})
export class AppModule {}

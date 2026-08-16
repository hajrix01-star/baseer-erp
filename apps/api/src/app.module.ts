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
import { RecurringExpenseService } from './finance/recurring-expense.service.js';
import { InclusiveLoanService } from './finance/inclusive-loan.service.js';
import { InclusiveLoanRepaymentService } from './finance/inclusive-loan-repayment.service.js';
import { InclusiveLoansController } from './finance/inclusive-loans.controller.js';
import { CompanyFinanceSetupService } from './finance/company-finance-setup.service.js';
import { CompanyFinanceSetupController } from './finance/company-finance-setup.controller.js';
import { VaultManagementService } from './finance/vault-management.service.js';
import { VaultManagementController } from './finance/vault-management.controller.js';
import { FinanceConfigurationService } from './finance/finance-configuration.service.js';
import { FinanceConfigurationController } from './finance/finance-configuration.controller.js';
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
import { SignInRateLimitService } from './identity/sign-in-rate-limit.service.js';
import { OutputController } from './output/output.controller.js';
import { OutputService } from './output/output.service.js';

@Module({
  controllers: [AdministrationController, HealthController, CompanyAccessController, AiPlatformController, AiRuntimeController, AuthController, OutputController, BusinessDateController, FileMetadataController, ObservabilityController, SupplierCopyController, SupplierDuesController, PurchaseExpenseController, CompanyFinanceSetupController, InclusiveLoansController, FinanceConfigurationController, FinanceMasterDataController, VaultManagementController, FinancePeriodCommandController, SupplierDueReportsController, DailySalesController],
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
    SignInRateLimitService,
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
    VaultManagementService,
    FinanceConfigurationService,
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
  ],
})
export class AppModule {}

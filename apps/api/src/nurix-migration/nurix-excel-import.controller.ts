import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { executeNurixExcelMasterDataRequestSchema, nurixExcelImportDryRunReceiptSchema, nurixExcelImportDryRunRequestSchema, nurixExcelImportTemplateReceiptSchema, nurixExcelMasterDataExecutionReceiptSchema, nurixHistoricalPayrollEvidenceReceiptSchema, nurixMigrationRunIdSchema } from '@baseer-erp/contracts';
import { TenantAdministrationContextService } from '../administration/tenant-administration-context.service.js';
import { NurixExcelImportService } from './nurix-excel-import.service.js';
import { NurixExcelFinancialMigrationService } from './nurix-excel-financial-migration.service.js';
import { NurixExcelCompletionService } from './nurix-excel-completion.service.js';
import { NurixExcelDailySalesMigrationService } from './nurix-excel-daily-sales-migration.service.js';
import { NurixExcelPackageClosureAuditService } from './nurix-excel-package-closure-audit.service.js';
import { NurixExcelRecurringMigrationService } from './nurix-excel-recurring-migration.service.js';
import { NurixExcelReferenceAllocationMigrationService } from './nurix-excel-reference-allocation-migration.service.js';
import { NurixExcelEvidenceArchiveService } from './nurix-excel-evidence-archive.service.js';
import { NurixExcelHrHistoryImportService } from './nurix-excel-hr-history-import.service.js';
import { NurixHistoricalPayrollMigrationService } from './nurix-historical-payroll-migration.service.js';

/**
 * This route intentionally has a single immutable decision.  The approved
 * values are defined and audited in the recurring remediation transform; an
 * HTTP caller can neither supply an amount nor broaden that allow-list.
 */
const ZERO_EXPECTED_REMEDIATION_APPROVAL = 'APPLY_APPROVED_ZERO_EXPECTED_REMEDIATION_V1';

/**
 * Deliberately metadata-only. Multipart XLSX upload is not wired yet, so this
 * controller cannot accidentally treat a browser declaration as financial
 * source data. The future parser will own file storage, cell inspection and
 * row receipts behind the same routes.
 */
@Controller('nurix-migration/excel-import')
export class NurixExcelImportController {
  constructor(
    private readonly context: TenantAdministrationContextService,
    private readonly imports: NurixExcelImportService,
    private readonly financialImports: NurixExcelFinancialMigrationService,
    private readonly completion: NurixExcelCompletionService,
    private readonly dailySalesImports: NurixExcelDailySalesMigrationService,
    private readonly closureAudit: NurixExcelPackageClosureAuditService,
    private readonly recurringImports: NurixExcelRecurringMigrationService,
    private readonly referenceAllocationImports: NurixExcelReferenceAllocationMigrationService,
    private readonly evidenceArchives: NurixExcelEvidenceArchiveService,
    private readonly hrHistoryImports: NurixExcelHrHistoryImportService,
    private readonly historicalPayroll: NurixHistoricalPayrollMigrationService,
  ) {}

  @Get('template')
  async template(@Headers('authorization') authorization?: string) {
    // The template exposes the controlled migration protocol, so keep it in
    // the same tenant-owner boundary as the preflight endpoint.
    await this.context.authorizeOwner(this.accessToken(authorization));
    return nurixExcelImportTemplateReceiptSchema.parse(this.imports.template());
  }

  @Get('field-map')
  async fieldMap(@Headers('authorization') authorization?: string) {
    await this.context.authorizeOwner(this.accessToken(authorization));
    return this.imports.fieldMap();
  }

  /** Read-only owner view for payroll history archived from Noorix. */
  @Get('historical-payroll')
  async historicalPayrollEvidence(@Query('companyId') companyId: string | undefined, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(companyId);
    if (!id.success) throw new BadRequestException('Invalid historical payroll company identifier.');
    return nurixHistoricalPayrollEvidenceReceiptSchema.parse(await this.historicalPayroll.listEvidence(await this.context.authorizeOwner(this.accessToken(authorization)), id.data));
  }

  /** Actual package-to-writer completion gate; it never infers completion from preflight. */
  @Get('packages/:packageId/checklist')
  async checklist(@Param('packageId') packageId: string, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    if (!id.success) throw new BadRequestException('Invalid Excel package identifier.');
    return this.completion.checklist(await this.context.authorizeOwner(this.accessToken(authorization)), id.data);
  }

  /** Fail-closed evidence audit. This is the only migration view suitable for an unlock decision. */
  @Get('packages/:packageId/closure-audit')
  async closureAuditReport(@Param('packageId') packageId: string, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    if (!id.success) throw new BadRequestException('Invalid Excel package identifier.');
    return this.closureAudit.audit(await this.context.authorizeOwner(this.accessToken(authorization)), id.data);
  }

  @Post('packages/dry-run')
  @HttpCode(200)
  async dryRun(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const request = nurixExcelImportDryRunRequestSchema.safeParse(this.payload(body));
    if (!request.success) throw new BadRequestException('Invalid Noorix Excel package declaration.');
    return nurixExcelImportDryRunReceiptSchema.parse(await this.imports.dryRun(await this.context.authorizeOwner(this.accessToken(authorization)), request.data));
  }

  /** A deliberately narrow writer: account/category/employee master data only. */
  @Post('packages/:packageId/master-data')
  @HttpCode(200)
  async executeMasterData(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const request = executeNurixExcelMasterDataRequestSchema.safeParse(this.payload(body));
    if (!id.success || !request.success) throw new BadRequestException('Invalid Excel master-data execution request.');
    return nurixExcelMasterDataExecutionReceiptSchema.parse(await this.imports.executeMasterData(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, request.data));
  }

  /** Owner-only historical financial writer; it resumes the same immutable plan. */
  @Post('packages/:packageId/financial')
  @HttpCode(200)
  async executeFinancial(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('Invalid financial Excel execution request.');
    const record = payload as Record<string, unknown>;
    const reason = typeof record.reason === 'string' ? record.reason.trim() : undefined;
    const waveSize = typeof record.waveSize === 'number' ? record.waveSize : undefined;
    return this.financialImports.execute(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, { ...(reason ? { reason } : {}), ...(waveSize === undefined ? {} : { waveSize }) });
  }

  @Post('packages/:packageId/daily-sales')
  @HttpCode(200)
  async executeDailySales(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('Invalid daily-sales Excel execution request.');
    const record = payload as Record<string, unknown>;
    return this.dailySalesImports.execute(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, { ...(typeof record.reason === 'string' ? { reason: record.reason } : {}), ...(typeof record.waveSize === 'number' ? { waveSize: record.waveSize } : {}) });
  }

  /** Historical recurring profiles and paid installments, with immutable source lineage. */
  @Post('packages/:packageId/recurring-expenses')
  @HttpCode(200)
  async executeRecurringExpenses(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('Invalid recurring-expense Excel execution request.');
    const record = payload as Record<string, unknown>;
    return this.recurringImports.execute(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, {
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(typeof record.waveSize === 'number' ? { waveSize: record.waveSize } : {}),
    });
  }

  /**
   * Owner-only, deliberately fixed remediation for the individually approved
   * zero-expected recurring profiles. Its request has no monetary fields and
   * therefore cannot turn this narrow historical repair into a free-form
   * recurring-expense writer.
   */
  @Post('packages/:packageId/recurring-expenses/zero-expected-remediation')
  @HttpCode(200)
  async executeZeroExpectedRecurringRemediation(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new BadRequestException('Invalid zero-expected recurring remediation request.');
    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 1 || keys[0] !== 'approval' || record.approval !== ZERO_EXPECTED_REMEDIATION_APPROVAL)
      throw new BadRequestException(`This endpoint requires the fixed approval ${ZERO_EXPECTED_REMEDIATION_APPROVAL}.`);
    return this.recurringImports.executeZeroExpectedProfileRemediation(
      await this.context.authorizeOwner(this.accessToken(authorization)),
      id.data,
      { reason: 'Owner approved the fixed zero-expected recurring-profile remediation v1.' },
    );
  }

  /** Supplier, vault, and allocation lineage only; it never creates financial documents. */
  @Post('packages/:packageId/reference-provision')
  @HttpCode(200)
  async preprovisionReferences(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('Invalid reference-provision Excel execution request.');
    const record = payload as Record<string, unknown>;
    return this.referenceAllocationImports.preprovision(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, {
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(typeof record.waveSize === 'number' ? { waveSize: record.waveSize } : {}),
    });
  }

  /** Supplier, vault, and allocation lineage only; it never creates financial documents. */
  @Post('packages/:packageId/references-and-allocations')
  @HttpCode(200)
  async executeReferencesAndAllocations(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('Invalid references and allocations Excel execution request.');
    const record = payload as Record<string, unknown>;
    return this.referenceAllocationImports.execute(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, {
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(typeof record.waveSize === 'number' ? { waveSize: record.waveSize } : {}),
    });
  }

  /** Non-financial historical archive, including explicitly pending review decisions. */
  @Post('packages/:packageId/historical-evidence')
  @HttpCode(200)
  async archiveHistoricalEvidence(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('Invalid historical-evidence Excel execution request.');
    const record = payload as Record<string, unknown>;
    return this.evidenceArchives.execute(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, {
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(typeof record.waveSize === 'number' ? { waveSize: record.waveSize } : {}),
    });
  }

  /** HR history preserves unsupported obligations as evidence; it does not post payroll or advances. */
  @Post('packages/:packageId/hr-history')
  @HttpCode(200)
  async executeHrHistory(@Param('packageId') packageId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(packageId);
    const payload = this.payload(body);
    if (!id.success || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('Invalid HR-history Excel execution request.');
    const record = payload as Record<string, unknown>;
    const waveSize = typeof record.waveSize === 'number' ? record.waveSize : 50;
    return this.hrHistoryImports.executeVerifiedPackage(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, waveSize);
  }

  private accessToken(value?: string): string {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    if (!match?.[1]) throw new UnauthorizedException('Invalid authentication credentials.');
    return match[1];
  }

  private payload(body: unknown): unknown {
    if (typeof body !== 'string') return body;
    try { return JSON.parse(body) as unknown; }
    catch { throw new BadRequestException('Invalid Noorix Excel package declaration.'); }
  }
}

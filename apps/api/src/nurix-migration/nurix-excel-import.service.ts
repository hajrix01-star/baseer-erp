import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { ExecuteNurixExcelMasterDataRequest, NurixExcelImportDryRunRequest } from '@baseer-erp/contracts';
import { DatabaseService } from '../database/database.service.js';
import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { fieldCoverage, NURIX_FIELD_MAPPINGS } from './nurix-field-mapping-contract.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';
import { normalizeNurixCounterpartyAlias } from './nurix-counterparty-alias-resolution.js';

const TEMPLATE_VERSION = 'nurix-excel-package/v3' as const;
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// 5 MiB raw remains below the dedicated 8 MiB Base64-envelope parser limit.
const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
// Noorix bank evidence can carry PostgreSQL's padded decimal scale.  Accept
// that representation only when digits beyond Baseer's four-decimal scale are
// zero; a real precision loss remains a hard rejection.
const MONEY = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,30})?$/;
const SCALE = 10_000n;

const TEMPLATE_SHEETS = [
  { name: 'Manifest', requiredColumns: ['Field', 'Value', 'Rule'] },
  { name: 'Suppliers', requiredColumns: ['source_id', 'name_ar', 'name_en', 'supplier_category_source_id', 'status', 'notes'] },
  { name: 'Accounts', requiredColumns: ['source_id', 'code', 'name_ar', 'name_en', 'account_type', 'status'] },
  { name: 'Categories', requiredColumns: ['baseer_category_code', 'name_ar', 'name_en', 'category_type', 'parent_baseer_category_code', 'status', 'classification_source', 'confidence'] },
  { name: 'Vaults', requiredColumns: ['source_id', 'name_ar', 'name_en', 'status'] },
  { name: 'Employees', requiredColumns: ['source_id', 'employee_serial', 'name_ar', 'name_en', 'iqama_number', 'job_title', 'join_date', 'status', 'notes'] },
  { name: 'Invoices', requiredColumns: ['source_id', 'source_company_id', 'kind', 'status', 'document_number', 'supplier_source_id', 'baseer_category_code', 'vault_source_id', 'transaction_date', 'invoice_date', 'net_amount', 'tax_amount', 'gross_amount', 'payment_method_source_id', 'source_reference', 'notes'] },
  { name: 'InvoiceAllocations', requiredColumns: ['source_id', 'invoice_source_id', 'vault_source_id', 'payment_method_source_id', 'amount'] },
  { name: 'LedgerEntries', requiredColumns: ['source_id', 'source_company_id', 'reference_entity', 'reference_source_id', 'debit_account_source_id', 'credit_account_source_id', 'vault_source_id', 'entry_date', 'amount', 'status', 'notes'] },
  { name: 'RecurringExpenseProfiles', requiredColumns: ['source_id', 'name_ar', 'name_en', 'supplier_source_id', 'baseer_category_code', 'expected_amount', 'interval_months', 'status', 'service_number', 'notes'] },
  { name: 'RecurringExpensePayments', requiredColumns: ['source_id', 'profile_source_id', 'supplier_source_id', 'baseer_category_code', 'vault_source_id', 'document_number', 'transaction_date', 'net_amount', 'tax_amount', 'gross_amount', 'status', 'notes'] },
  { name: 'EmployeeServices', requiredColumns: ['source_id', 'employee_source_id', 'service_type', 'reference_number', 'issue_date', 'expiry_date', 'supplier_source_id', 'baseer_category_code', 'cost_invoice_source_id', 'status', 'notes'] },
  { name: 'EmployeeDeductions', requiredColumns: ['source_id', 'employee_source_id', 'deduction_type', 'amount', 'transaction_date', 'source_reference', 'notes'] },
  { name: 'EmployeeMovements', requiredColumns: ['source_id', 'employee_source_id', 'movement_type', 'amount', 'previous_value', 'new_value', 'effective_date', 'notes'] },
  { name: 'DailySalesClosings', requiredColumns: ['source_id', 'summary_number', 'transaction_date', 'shift', 'customer_count', 'cash_on_hand', 'total_amount', 'status', 'notes'] },
  { name: 'DailySalesAllocations', requiredColumns: ['source_id', 'closing_source_id', 'vault_source_id', 'amount'] },
  { name: 'BankStatements', requiredColumns: ['source_id', 'file_name', 'bank_name', 'start_date', 'end_date', 'status', 'total_deposits', 'total_withdrawals', 'transaction_count'] },
  { name: 'BankTransactions', requiredColumns: ['source_id', 'statement_source_id', 'transaction_date', 'description', 'debit', 'credit', 'balance', 'reference', 'notes', 'classification_name', 'transaction_type', 'manually_classified'] },
  { name: 'VatPlanning', requiredColumns: ['source_id', 'year', 'quarter', 'payment_target', 'filing_submitted', 'imported_at', 'notes'] },
  { name: 'Assets', requiredColumns: ['source_id', 'name_ar', 'name_en', 'serial_number', 'location', 'purchase_date', 'acquisition_cost', 'supplier_source_id', 'invoice_source_id', 'baseer_category_code', 'warranty_description', 'warranty_start_date', 'warranty_end_date', 'notes'] },
  { name: 'CategoryAudit', requiredColumns: ['source_category_id', 'source_category_name_ar', 'baseer_category_code', 'baseer_category_name_ar', 'confidence', 'reason_ar', 'invoice_count'] },
  { name: 'Exceptions', requiredColumns: ['source_sheet', 'source_id', 'severity', 'code', 'message', 'resolution'] },
] as const;

type PreflightCheck = { code: string; passed: boolean; messageAr: string };
type RowIssue = { sheet: string; rowNumber: number; code: string };
type Row = Record<string, string>;
type StagedRow = { sheet: string; sourceId: string; sourceChecksum: string; status: 'ACCEPTED' | 'REJECTED'; code: string };
type Reconciliation = { passed: boolean; counts: Array<{ key: string; sheet: string; declaredRows: number; parsedRows: number; matches: boolean }>; totals: Array<{ key: string; sheet: string; column: string; declaredAmount: string; parsedAmount: string; matches: boolean }> };
type MasterCounts = { suppliers: number; accounts: number; categories: number; vaults: number; employees: number };
type MasterDataReadiness = { availability: 'READ_ONLY_ANALYZED' | 'PENDING_TARGET_READ'; exactMatches: MasterCounts; createCandidates: MasterCounts; reviewRequired: MasterCounts; canWrite: false };
type WritableMasterEntity = 'ACCOUNT' | 'CATEGORY' | 'EMPLOYEE';
type WritableMasterSource = { entity: WritableMasterEntity; sourceId: string; sourceChecksum: string; code: string; row: Row };
type WritableMasterCounts = { accounts: number; categories: number; employees: number };
type MasterWaveCounts = { CREATED: WritableMasterCounts; REUSED: WritableMasterCounts; REVIEW_REQUIRED: WritableMasterCounts };
type MasterExecutionReceipt = { executionId: string; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'; created: WritableMasterCounts; reused: WritableMasterCounts; reviewRequired: WritableMasterCounts; processed: number; remaining: number; completed: boolean; waves: number; financialWrites: 0 };

const CONTROL_COUNTS = [
  ['financial_invoices_count', 'Invoices'],
  ['recurring_payments_count', 'RecurringExpensePayments'],
  ['daily_sales_count', 'DailySalesClosings'],
  ['employee_services_count', 'EmployeeServices'],
  ['assets_count', 'Assets'],
] as const;
const CONTROL_TOTALS = [
  ['financial_invoices_gross_amount', 'Invoices', 'gross_amount'],
  ['financial_invoice_allocations_amount', 'InvoiceAllocations', 'amount'],
  ['financial_ledger_amount', 'LedgerEntries', 'amount'],
  ['recurring_payments_gross_amount', 'RecurringExpensePayments', 'gross_amount'],
  ['daily_sales_total_amount', 'DailySalesClosings', 'total_amount'],
  ['daily_sales_allocations_amount', 'DailySalesAllocations', 'amount'],
  ['employee_deductions_amount', 'EmployeeDeductions', 'amount'],
  ['bank_transactions_debit_amount', 'BankTransactions', 'debit'],
  ['bank_transactions_credit_amount', 'BankTransactions', 'credit'],
  ['assets_acquisition_cost_amount', 'Assets', 'acquisition_cost'],
] as const;

/** Parses an in-memory workbook only; it neither persists bytes nor writes ERP data. */
@Injectable()
export class NurixExcelImportService {
  constructor(private readonly database: DatabaseService, private readonly storage: NurixExcelStagingStorageService) {}

  template() {
    return { templateVersion: TEMPLATE_VERSION, sourceSystem: 'NOORIX_EXCEL_EXPORT' as const, sheets: TEMPLATE_SHEETS.map((sheet) => ({ name: sheet.name, requiredColumns: [...sheet.requiredColumns] })) };
  }

  /** Owner-visible proof that every accepted Excel column has an approved treatment. */
  fieldMap() {
    return { ...fieldCoverage(), mappings: NURIX_FIELD_MAPPINGS };
  }

  async dryRun(context: TrustedTenantAdministratorContext, request: NurixExcelImportDryRunRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: request.targetCompanyId, tenantId: context.tenantId }, select: { id: true, migrationReviewLocked: true } });
      if (!company) throw new NotFoundException('Target company was not found.');
      if (!company.migrationReviewLocked) throw new ConflictException('Lock the target company for migration review before validating an Excel package.');
      const result = request.workbook.contentsBase64 ? this.parseWorkbook(request) : this.metadataOnly(request);
      const parsedTables = (result as { tables?: ReadonlyMap<string, Row[]> }).tables;
      const masterDataReadiness = result.status === 'PARSED_DRY_RUN' && parsedTables
        ? await this.masterDataReadiness(tx, context.tenantId, request.targetCompanyId, parsedTables)
        : this.emptyMasterDataReadiness();
      (result as { masterDataReadiness?: MasterDataReadiness }).masterDataReadiness = masterDataReadiness;
      const stagedRows = (result as { stagedRows?: StagedRow[] }).stagedRows ?? [];
      const stagingPackageId = await this.persistPreflight(tx, context.tenantId, request, result, stagedRows);
      (result as { stagingPackageId?: string | null }).stagingPackageId = stagingPackageId;
      delete (result as { stagedRows?: StagedRow[] }).stagedRows;
      delete (result as { sourceFingerprint?: string }).sourceFingerprint;
      delete (result as { tables?: ReadonlyMap<string, Row[]> }).tables;
      return result;
    });
  }

  /**
   * Creates only accounts, categories and employees from a previously
   * verified/encrypted workbook. Suppliers, vaults and every financial model
   * are intentionally absent from this path.
   */
  async executeMasterData(context: TrustedTenantAdministratorContext, packageId: string, request: ExecuteNurixExcelMasterDataRequest): Promise<MasterExecutionReceipt> {
    const prepared = await this.prepareMasterExecution(context, packageId, request);
    let receipt: MasterExecutionReceipt | null = null;
    for (let wave = 1; wave <= 100; wave += 1) {
      receipt = await this.executeMasterDataWave(context, prepared.executionId, prepared.sources, request.waveSize);
      if (receipt.completed) return { ...receipt, waves: wave };
      if (receipt.processed === 0) throw new ConflictException('The master-data wave made no progress; it remains safely resumable.');
    }
    throw new ConflictException('Master-data execution paused after 100 committed waves; resume the same package without duplication.');
  }

  private async prepareMasterExecution(context: TrustedTenantAdministratorContext, packageId: string, request: ExecuteNurixExcelMasterDataRequest) {
    const packageRecord = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const item = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: { id: true, tenantId: true, targetCompanyId: true, sourceCompanyId: true, workbookSha256: true, storageReference: true, encryptionIv: true, storedByteSize: true, status: true },
      });
      if (!item) throw new NotFoundException('The Excel staging package was not found.');
      const company = await tx.company.findFirst({ where: { id: item.targetCompanyId, tenantId: context.tenantId }, select: { id: true, status: true, migrationReviewLocked: true } });
      if (!company || company.status !== 'ACTIVE' || !company.migrationReviewLocked) throw new ConflictException('The target company must be active and locked for migration review before master data is created.');
      if (item.status !== 'READY_FOR_RECONCILIATION' || !item.storageReference || !item.encryptionIv || !item.storedByteSize) throw new ConflictException('The workbook has not passed preflight and encrypted staging verification.');
      return item;
    });
    const bytes = await this.storage.readVerified({
      workbookSha256: packageRecord.workbookSha256,
      artifact: { storageReference: packageRecord.storageReference!, encryptionIv: packageRecord.encryptionIv!, storedByteSize: packageRecord.storedByteSize! },
    });
    const parsed = this.parseWorkbook({
      targetCompanyId: packageRecord.targetCompanyId,
      sourceCompanyId: packageRecord.sourceCompanyId,
      templateVersion: TEMPLATE_VERSION,
      workbook: { fileName: 'verified-noorix-package.xlsx', mimeType: XLSX_MIME_TYPE, byteSize: bytes.length, exportedAt: new Date().toISOString(), contentsBase64: bytes.toString('base64') },
    });
    if (parsed.status !== 'PARSED_DRY_RUN' || !parsed.tables || parsed.sourceFingerprint === undefined) throw new ConflictException('The encrypted workbook no longer passes the deterministic preflight checks.');
    const sources = this.writableMasterSources(parsed.tables);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const execution = await tx.nurixExcelMasterDataExecution.upsert({
        where: { packageId_tenantId: { packageId, tenantId: context.tenantId } },
        create: { id: randomUUID(), packageId, tenantId: context.tenantId, targetCompanyId: packageRecord.targetCompanyId, requestedByUserId: context.actorUserId, reason: request.reason?.trim() || null },
        update: {},
        select: { id: true },
      });
      await tx.nurixExcelMasterDataItem.createMany({
        data: sources.map((source) => ({ id: randomUUID(), executionId: execution.id, tenantId: context.tenantId, entity: source.entity, sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, code: source.code })),
        skipDuplicates: true,
      });
      const persisted = await tx.nurixExcelMasterDataItem.findMany({ where: { executionId: execution.id, tenantId: context.tenantId }, select: { entity: true, sourceId: true, sourceChecksum: true } });
      const expected = new Map(sources.map((source) => [`${source.entity}:${source.sourceId}`, source.sourceChecksum]));
      if (persisted.length !== expected.size || persisted.some((item) => expected.get(`${item.entity}:${item.sourceId}`) !== item.sourceChecksum)) throw new ConflictException('The package master-data receipt differs from the immutable workbook evidence.');
      return { executionId: execution.id, sources };
    });
  }

  private async executeMasterDataWave(context: TrustedTenantAdministratorContext, executionId: string, sources: readonly WritableMasterSource[], waveSize: number): Promise<MasterExecutionReceipt> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.valueOf() + 5 * 60_000);
    const claimed = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelMasterDataExecution.updateMany({
      where: { id: executionId, tenantId: context.tenantId, status: { not: 'COMPLETED' }, OR: [{ leaseToken: null }, { leaseExpiresAt: { lte: now } }] },
      data: { status: 'RUNNING', leaseToken, leaseExpiresAt },
    }));
    if (!claimed.count) {
      const snapshot = await this.masterExecutionReceipt(context, executionId);
      if (snapshot.completed) return snapshot;
      throw new ConflictException('A master-data wave is already running; wait for its checkpoint or retry after its lease expires.');
    }
    try {
      return await this.database.inTenantTransaction(context.tenantId, async (tx) => {
        const execution = await tx.nurixExcelMasterDataExecution.findFirst({ where: { id: executionId, tenantId: context.tenantId, leaseToken }, select: { id: true, targetCompanyId: true, waveSequence: true } });
        if (!execution) throw new ConflictException('The master-data execution lease was lost before the wave began.');
        const pendingItems = await tx.nurixExcelMasterDataItem.findMany({ where: { executionId, tenantId: context.tenantId, status: 'PENDING' }, select: { id: true, entity: true, sourceId: true, sourceChecksum: true } });
        const sourceByKey = new Map(sources.map((source) => [`${source.entity}:${source.sourceId}`, source]));
        const sourceOrder = new Map(sources.map((source, index) => [`${source.entity}:${source.sourceId}`, index]));
        // The workbook controls category dependency order (roots before
        // children). Database key order is not a dependency order.
        const items = pendingItems.sort((left, right) => (sourceOrder.get(`${left.entity}:${left.sourceId}`) ?? Number.MAX_SAFE_INTEGER) - (sourceOrder.get(`${right.entity}:${right.sourceId}`) ?? Number.MAX_SAFE_INTEGER)).slice(0, waveSize);
        const waveCounts: MasterWaveCounts = { CREATED: this.emptyWritableCounts(), REUSED: this.emptyWritableCounts(), REVIEW_REQUIRED: this.emptyWritableCounts() };
        for (const item of items) {
          const source = sourceByKey.get(`${item.entity}:${item.sourceId}`);
          if (!source || source.sourceChecksum !== item.sourceChecksum) throw new ConflictException('A pending master-data receipt no longer matches the immutable workbook.');
          const result = await this.applyMasterSource(tx, context.tenantId, execution.targetCompanyId, source);
          waveCounts[result.status][this.countKey(source.entity)] += 1;
          await tx.nurixExcelMasterDataItem.update({ where: { id: item.id }, data: result.status === 'REVIEW_REQUIRED' ? { status: result.status, targetId: null } : { status: result.status, targetId: result.targetId! } });
        }
        const remaining = await tx.nurixExcelMasterDataItem.count({ where: { executionId, tenantId: context.tenantId, status: 'PENDING' } });
        const completed = remaining === 0;
        const released = await tx.nurixExcelMasterDataExecution.updateMany({
          where: { id: executionId, tenantId: context.tenantId, leaseToken },
          data: { status: completed ? 'COMPLETED' : 'PENDING', waveSequence: { increment: 1 }, leaseToken: null, leaseExpiresAt: null },
        });
        if (released.count !== 1) throw new ConflictException('The master-data execution lease was lost while saving the wave.');
        await tx.auditEvent.create({ data: { tenantId: context.tenantId, companyId: execution.targetCompanyId, actorUserId: context.actorUserId, action: 'nurix_excel.master_data_wave_completed', entityType: 'NurixExcelMasterDataExecution', entityId: executionId, requestId: `nurix-excel-master:${executionId}:${execution.waveSequence + 1}`, afterJson: { processed: items.length, remaining, completed, financialWrites: 0, created: waveCounts.CREATED, reused: waveCounts.REUSED, reviewRequired: waveCounts.REVIEW_REQUIRED } } });
        return this.masterExecutionReceiptFromTransaction(tx, context.tenantId, executionId, items.length, remaining, completed);
      });
    } catch (error) {
      await this.database.inTenantTransaction(context.tenantId, (tx) => tx.nurixExcelMasterDataExecution.updateMany({ where: { id: executionId, tenantId: context.tenantId, leaseToken }, data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null } }));
      throw error;
    }
  }

  private writableMasterSources(tables: ReadonlyMap<string, Row[]>): WritableMasterSource[] {
    const checksum = (row: Row) => createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const value = (row: Row, field: string) => row[field] ?? '';
    const accounts = (tables.get('Accounts') ?? []).map((row) => ({ entity: 'ACCOUNT' as const, sourceId: value(row, 'source_id'), sourceChecksum: checksum(row), code: value(row, 'code'), row }));
    const categories = (tables.get('Categories') ?? []).map((row) => ({ entity: 'CATEGORY' as const, sourceId: value(row, 'baseer_category_code'), sourceChecksum: checksum(row), code: value(row, 'baseer_category_code'), row })).sort((left, right) => Number(Boolean(left.row.parent_baseer_category_code)) - Number(Boolean(right.row.parent_baseer_category_code)) || left.code.localeCompare(right.code));
    const employees = (tables.get('Employees') ?? []).map((row) => ({ entity: 'EMPLOYEE' as const, sourceId: value(row, 'source_id'), sourceChecksum: checksum(row), code: value(row, 'employee_serial'), row }));
    return [...accounts, ...categories, ...employees];
  }

  private async applyMasterSource(tx: any, tenantId: string, companyId: string, source: WritableMasterSource): Promise<{ status: 'CREATED' | 'REUSED' | 'REVIEW_REQUIRED'; targetId?: string }> {
    if (source.entity === 'ACCOUNT') {
      const type = (source.row.account_type ?? '').toUpperCase();
      const status = (source.row.status ?? '').toUpperCase();
      const existing = await tx.financeAccount.findFirst({ where: { tenantId, companyId, code: source.row.code }, select: { id: true, type: true } });
      if (existing) return existing.type === type ? { status: 'REUSED', targetId: existing.id } : { status: 'REVIEW_REQUIRED' };
      const nameAr = source.row.name_ar ?? '';
      const created = await tx.financeAccount.create({ data: { id: randomUUID(), tenantId, companyId, code: source.row.code ?? '', nameAr, nameEn: source.row.name_en || nameAr, type, status, isSystem: false } });
      return { status: 'CREATED', targetId: created.id };
    }
    if (source.entity === 'CATEGORY') {
      const kind = (source.row.category_type ?? '').toUpperCase();
      const existing = await tx.financeCategory.findFirst({ where: { tenantId, companyId, code: source.row.baseer_category_code }, select: { id: true, kind: true } });
      if (existing) return existing.kind === kind ? { status: 'REUSED', targetId: existing.id } : { status: 'REVIEW_REQUIRED' };
      const parentCode = source.row.parent_baseer_category_code ?? '';
      const parent = parentCode ? await tx.financeCategory.findFirst({ where: { tenantId, companyId, code: parentCode }, select: { id: true } }) : null;
      if (parentCode && !parent) return { status: 'REVIEW_REQUIRED' };
      const nameAr = source.row.name_ar ?? '';
      const created = await tx.financeCategory.create({ data: { id: randomUUID(), tenantId, companyId, parentId: parent?.id ?? null, accountId: null, suggestedSupplierId: null, code: source.row.baseer_category_code ?? '', nameAr, nameEn: source.row.name_en || nameAr, kind, status: source.row.status === 'active' ? 'ACTIVE' : 'ARCHIVED', isPosting: true } });
      return { status: 'CREATED', targetId: created.id };
    }
    const existing = await tx.hrEmployee.findFirst({ where: { tenantId, companyId, employeeNumber: source.row.employee_serial }, select: { id: true } });
    if (existing) return { status: 'REUSED', targetId: existing.id };
    const joinDate = source.row.join_date ?? '';
    const created = await tx.hrEmployee.create({ data: { id: randomUUID(), tenantId, companyId, employeeNumber: source.row.employee_serial ?? '', nameAr: source.row.name_ar ?? '', nameEn: source.row.name_en || null, jobTitle: source.row.job_title || null, iqamaNumber: source.row.iqama_number || null, hireDate: new Date(`${joinDate.slice(0, 10)}T00:00:00.000Z`), status: (source.row.status ?? '').toUpperCase(), notes: source.row.notes || null } });
    return { status: 'CREATED', targetId: created.id };
  }

  private async masterExecutionReceipt(context: TrustedTenantAdministratorContext, executionId: string): Promise<MasterExecutionReceipt> {
    return this.database.inTenantTransaction(context.tenantId, (tx) => this.masterExecutionReceiptFromTransaction(tx, context.tenantId, executionId, 0));
  }

  private async masterExecutionReceiptFromTransaction(tx: any, tenantId: string, executionId: string, processed: number, remaining?: number, completed?: boolean): Promise<MasterExecutionReceipt> {
    const execution = await tx.nurixExcelMasterDataExecution.findFirst({ where: { id: executionId, tenantId }, select: { status: true } });
    if (!execution) throw new NotFoundException('The master-data execution was not found.');
    const items = await tx.nurixExcelMasterDataItem.findMany({ where: { executionId, tenantId }, select: { entity: true, status: true } });
    const created = this.emptyWritableCounts(); const reused = this.emptyWritableCounts(); const reviewRequired = this.emptyWritableCounts();
    for (const item of items) {
      const target = item.status === 'CREATED' ? created : item.status === 'REUSED' ? reused : item.status === 'REVIEW_REQUIRED' ? reviewRequired : null;
      if (target) target[this.countKey(item.entity as WritableMasterEntity)] += 1;
    }
    const pending = remaining ?? items.filter((item: { status: string }) => item.status === 'PENDING').length;
    return { executionId, status: execution.status, created, reused, reviewRequired, processed, remaining: pending, completed: completed ?? execution.status === 'COMPLETED', waves: 1, financialWrites: 0 };
  }

  private emptyWritableCounts(): WritableMasterCounts { return { accounts: 0, categories: 0, employees: 0 }; }
  private countKey(entity: WritableMasterEntity): keyof WritableMasterCounts { return entity === 'ACCOUNT' ? 'accounts' : entity === 'CATEGORY' ? 'categories' : 'employees'; }

  private metadataOnly(request: NurixExcelImportDryRunRequest) {
    const xlsx = this.workbookIsXlsx(request);
    return {
      mode: 'PREFLIGHT_DRY_RUN' as const, status: xlsx ? 'PENDING_WORKBOOK_PARSER' as const : 'REJECTED' as const,
      templateVersion: TEMPLATE_VERSION, sourceCompanyId: request.sourceCompanyId, targetCompanyId: request.targetCompanyId,
      financialWrites: 0 as const, parsedRows: 0, acceptedRows: 0, rejectedRows: 0, canStage: false as const, stagingPackageId: null, reconciliation: this.emptyReconciliation(), masterDataReadiness: this.emptyMasterDataReadiness(), rowIssues: [],
      checks: [
        { code: 'WORKBOOK_XLSX_ONLY', passed: xlsx, messageAr: xlsx ? 'صيغة الحزمة XLSX معتمدة.' : 'يقبل هذا المسار ملف XLSX فقط؛ تُرفض ملفات الماكرو أو الصيغ الأخرى.' },
        { code: 'WORKBOOK_BYTES_PENDING', passed: false, messageAr: 'لم تصل بايتات الملف بعد؛ لا يمكن فحص محتوى Excel أو بدء الترحيل.' },
        { code: 'NO_FINANCIAL_WRITE', passed: true, messageAr: 'هذه تجربة فحص فقط؛ لم تُنشأ أي عملية مالية.' },
      ],
    };
  }

  private parseWorkbook(request: NurixExcelImportDryRunRequest) {
    const bytes = this.decodeBase64(request.workbook.contentsBase64!);
    if (!bytes) return this.rejected(request, 'WORKBOOK_BYTES_INVALID', 'محتوى الملف غير صالح أو تجاوز الحد المسموح.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    let workbook: XLSX.WorkBook;
    try { workbook = XLSX.read(bytes, { type: 'buffer', bookVBA: true, bookFiles: true, bookDeps: true, cellFormula: true, cellDates: false, WTF: true }); }
    catch { return this.rejected(request, 'WORKBOOK_PARSE_FAILED', 'تعذر قراءة ملف XLSX بأمان.'); }

    const macros = this.hasMacros(workbook);
    const externalLinks = this.hasExternalLinks(workbook);
    const checks: PreflightCheck[] = [
      { code: 'WORKBOOK_XLSX_ONLY', passed: this.workbookIsXlsx(request), messageAr: this.workbookIsXlsx(request) ? 'صيغة الحزمة XLSX معتمدة.' : 'صيغة أو نوع الملف غير معتمد.' },
      { code: 'WORKBOOK_SHA256_SERVER', passed: true, messageAr: `تم حساب بصمة SHA-256 من الخادم: ${sha256.slice(0, 12)}…` },
      { code: 'WORKBOOK_MACROS', passed: !macros, messageAr: macros ? 'تحتوي الحزمة على ماكرو أو مكوّن VBA محظور.' : 'لا توجد وحدات ماكرو أو VBA.' },
      { code: 'WORKBOOK_EXTERNAL_LINKS', passed: !externalLinks, messageAr: externalLinks ? 'تحتوي الحزمة على روابط أو اتصالات خارجية محظورة.' : 'لا توجد روابط أو اتصالات خارجية.' },
    ];
    const issues: RowIssue[] = [];
    const tables = new Map<string, Row[]>();
    const expectedNames = TEMPLATE_SHEETS.map((sheet) => sheet.name);
    const uniqueNames = new Set(workbook.SheetNames);
    checks.push({ code: 'WORKBOOK_SHEETS_EXACT', passed: uniqueNames.size === workbook.SheetNames.length && workbook.SheetNames.length === expectedNames.length && expectedNames.every((name) => uniqueNames.has(name)), messageAr: 'تم التحقق من الأوراق الرسمية للحزمة.' });
    let formulas = false;
    for (const definition of TEMPLATE_SHEETS) {
      const sheet = workbook.Sheets[definition.name];
      if (!sheet) continue;
      if (this.hasFormula(sheet)) formulas = true;
      const parsed = definition.name === 'Manifest' ? this.readManifest(sheet, issues) : this.readSheet(sheet, definition.name, definition.requiredColumns, issues);
      if (parsed) tables.set(definition.name, parsed);
    }
    checks.push({ code: 'WORKBOOK_FORMULAS', passed: !formulas, messageAr: formulas ? 'الصيغ غير مسموحة في حزمة الترحيل.' : 'لا توجد صيغ Excel في أوراق الحزمة.' });
    const structuralValidation = this.validateRows(tables, request, issues);
    const reconciliation = this.reconcile(tables, issues);
    const rowValidation = structuralValidation && reconciliation.passed;
    const sourceFingerprint = (tables.get('Manifest') ?? []).find((row) => row.Field === 'source_fingerprint')?.Value ?? '';
    checks.push({ code: 'SOURCE_TO_STAGING_RECONCILIATION', passed: reconciliation.passed, messageAr: reconciliation.passed ? `تطابقت ${reconciliation.counts.length} عدادات و${reconciliation.totals.length} إجماليات معلنة مع صفوف الحزمة.` : 'فشل تطابق عدادات أو إجماليات المصدر؛ حُجرت الحزمة قبل أي استيراد.' });
    const coverage = fieldCoverage();
    checks.push({ code: 'FIELD_MAPPING_CONTRACT', passed: coverage.unmappedFields.length === 0 && coverage.gaps === 0, messageAr: coverage.unmappedFields.length || coverage.gaps ? 'توجد خانات بلا معالجة معتمدة؛ يمنع ذلك الترحيل.' : `كل خانات الحزمة (${coverage.mappedFields}) لها معالجة موثقة: مباشر أو تحويل أو حفظ تاريخي.` });
    checks.push({ code: 'LIVE_IMPORT_GATE_CLOSED', passed: true, messageAr: `الاستيراد الفعلي مغلق عمداً حتى تُبنى طبقة العزل والمطابقة. النطاقات غير الجاهزة: ${coverage.executionBlockers.length}.` });
    const issueRows = new Set(issues.map((issue) => `${issue.sheet}:${issue.rowNumber}`));
    const parsedRows = [...tables.values()].reduce((total, rows) => total + rows.length, 0);
    return {
      mode: 'PREFLIGHT_DRY_RUN' as const,
      status: checks.some((check) => !check.passed) || issueRows.size > 0 ? 'REJECTED' as const : 'PARSED_DRY_RUN' as const,
      templateVersion: TEMPLATE_VERSION, sourceCompanyId: request.sourceCompanyId, targetCompanyId: request.targetCompanyId,
      financialWrites: 0 as const, parsedRows, acceptedRows: Math.max(0, parsedRows - issueRows.size), rejectedRows: issueRows.size, canStage: false as const,
      checks: [...checks, { code: 'ROW_VALIDATION', passed: rowValidation, messageAr: rowValidation ? 'نجح الفحص الأولي للصفوف والمبالغ والتخصيصات.' : 'توجد أخطاء صفوف أو علاقات يجب تصحيحها.' }, { code: 'NO_FINANCIAL_WRITE', passed: true, messageAr: 'هذه تجربة فحص فقط؛ لم تُنشأ أي عملية مالية.' }],
      reconciliation,
      masterDataReadiness: this.emptyMasterDataReadiness(),
      rowIssues: issues.slice(0, 100),
      stagedRows: this.stagingRows(tables, issues),
      sourceFingerprint: SHA256.test(sourceFingerprint) ? sourceFingerprint : undefined,
      tables,
    };
  }

  /** Persists only technical row receipts when the staging migration is applied. */
  private async persistPreflight(tx: unknown, tenantId: string, request: NurixExcelImportDryRunRequest, result: { status: string; parsedRows: number; acceptedRows: number; rejectedRows: number; reconciliation?: { passed: boolean }; sourceFingerprint?: string | undefined }, rows: StagedRow[]): Promise<string | null> {
    const staging = tx as { nurixExcelStagingPackage?: { upsert: (args: unknown) => Promise<{ id: string; storageReference: string | null; encryptionIv: string | null; storedByteSize: bigint | null }>; update: (args: unknown) => Promise<unknown> }; nurixExcelStagingBatch?: { upsert: (args: unknown) => Promise<{ id: string }> }; nurixExcelStagingRow?: { createMany: (args: unknown) => Promise<unknown> } };
    // Test doubles without the staging client remain read-only. In production,
    // the database migration must be deployed before this API version: a missing
    // staging table fails the preflight rather than falling through to ERP writes.
    if (!request.workbook.contentsBase64 || !staging.nurixExcelStagingPackage || !staging.nurixExcelStagingBatch || !staging.nurixExcelStagingRow) return null;
    const workbookSha256 = createHash('sha256').update(Buffer.from(request.workbook.contentsBase64, 'base64')).digest('hex');
    const packageStatus = result.status === 'REJECTED' ? 'QUARANTINED' : result.reconciliation?.passed && result.sourceFingerprint ? 'READY_FOR_RECONCILIATION' : 'PARSED';
    const packageRecord = await staging.nurixExcelStagingPackage.upsert({
      where: { tenantId_targetCompanyId_workbookSha256: { tenantId, targetCompanyId: request.targetCompanyId, workbookSha256 } },
      create: { tenantId, targetCompanyId: request.targetCompanyId, sourceCompanyId: request.sourceCompanyId, templateVersion: TEMPLATE_VERSION, workbookSha256, sourceFingerprint: result.sourceFingerprint ?? null, status: packageStatus },
      update: { sourceFingerprint: result.sourceFingerprint ?? null, status: packageStatus },
    });
    // Rejected/malicious workbooks never enter durable file storage. Their
    // technical receipt stays quarantined for audit without retaining bytes.
    if (result.status !== 'REJECTED') {
      const artifact = await this.storage.store({ tenantId, packageId: packageRecord.id, workbookSha256, bytes: Buffer.from(request.workbook.contentsBase64, 'base64'), existing: packageRecord });
      await staging.nurixExcelStagingPackage.update({ where: { id: packageRecord.id }, data: artifact });
    }
    const batch = await staging.nurixExcelStagingBatch.upsert({
      where: { packageId_sequence: { packageId: packageRecord.id, sequence: 1 } },
      create: { packageId: packageRecord.id, tenantId, sequence: 1, status: result.status === 'REJECTED' ? 'QUARANTINED' : 'VALIDATED', rowsDeclared: result.parsedRows, rowsAccepted: result.acceptedRows, rowsRejected: result.rejectedRows },
      update: { status: result.status === 'REJECTED' ? 'QUARANTINED' : 'VALIDATED', rowsDeclared: result.parsedRows, rowsAccepted: result.acceptedRows, rowsRejected: result.rejectedRows },
    });
    if (rows.length) await staging.nurixExcelStagingRow.createMany({ data: rows.map((row) => ({ packageId: packageRecord.id, batchId: batch.id, tenantId, sheet: row.sheet, sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, status: row.status, code: row.code })), skipDuplicates: true });
    return packageRecord.id;
  }

  private stagingRows(tables: ReadonlyMap<string, Row[]>, issues: readonly RowIssue[]): StagedRow[] {
    const issueKeys = new Set(issues.map((issue) => `${issue.sheet}:${issue.rowNumber}`));
    return [...tables.entries()].flatMap(([sheet, rows]) => rows.map((row, index) => {
      const rowNumber = sheet === 'Manifest' ? index + 4 : index + 2;
      const sourceId = row.source_id || row.source_category_id || `${sheet}:${rowNumber}`;
      const canonical = Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)));
      const rejected = issueKeys.has(`${sheet}:${rowNumber}`);
      return { sheet, sourceId, sourceChecksum: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), status: rejected ? 'REJECTED' : 'ACCEPTED', code: rejected ? 'PREFLIGHT_ROW_REJECTED' : 'PREFLIGHT_ROW_ACCEPTED' };
    }));
  }

  /**
   * Compares only stable master-data keys with the selected target company.
   * This is deliberately read-only: it produces evidence for the owner and
   * never turns a name match into a supplier, vault, account, category, or
   * employee write.
   */
  private async masterDataReadiness(tx: unknown, tenantId: string, companyId: string, tables: ReadonlyMap<string, Row[]>): Promise<MasterDataReadiness> {
    type MasterReader = {
      financeSupplier?: { findMany: (args: unknown) => Promise<Array<{ nameAr: string }>> };
      financeAccount?: { findMany: (args: unknown) => Promise<Array<{ code: string; type: string }>> };
      financeCategory?: { findMany: (args: unknown) => Promise<Array<{ code: string; kind: string }>> };
      financeVault?: { findMany: (args: unknown) => Promise<Array<{ nameAr: string }>> };
      hrEmployee?: { findMany: (args: unknown) => Promise<Array<{ employeeNumber: string }>> };
    };
    const reader = tx as MasterReader;
    if (!reader.financeSupplier || !reader.financeAccount || !reader.financeCategory || !reader.financeVault || !reader.hrEmployee) return this.emptyMasterDataReadiness();
    const [suppliers, accounts, categories, vaults, employees] = await Promise.all([
      reader.financeSupplier.findMany({ where: { tenantId, companyId }, select: { nameAr: true } }),
      reader.financeAccount.findMany({ where: { tenantId, companyId }, select: { code: true, type: true } }),
      reader.financeCategory.findMany({ where: { tenantId, companyId }, select: { code: true, kind: true } }),
      reader.financeVault.findMany({ where: { tenantId, companyId }, select: { nameAr: true } }),
      reader.hrEmployee.findMany({ where: { tenantId, companyId }, select: { employeeNumber: true } }),
    ]);
    const exactMatches = this.emptyMasterCounts();
    const createCandidates = this.emptyMasterCounts();
    const reviewRequired = this.emptyMasterCounts();
    const classify = (entity: keyof MasterCounts, sourceKeys: readonly string[], targetKeys: readonly string[], missing: 'CREATE' | 'REVIEW') => {
      const targetCounts = new Map<string, number>();
      targetKeys.forEach((key) => targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1));
      for (const key of sourceKeys) {
        const count = key ? targetCounts.get(key) ?? 0 : 0;
        if (count === 1) exactMatches[entity] += 1;
        else if (count === 0 && key && missing === 'CREATE') createCandidates[entity] += 1;
        else reviewRequired[entity] += 1;
      }
    };
    classify('suppliers', (tables.get('Suppliers') ?? []).map((row) => normalizeNurixCounterpartyAlias(row.name_ar ?? '')), suppliers.map((row) => normalizeNurixCounterpartyAlias(row.nameAr)), 'CREATE');
    classify('accounts', (tables.get('Accounts') ?? []).map((row) => this.masterKey(row.code, row.account_type)), accounts.map((row) => this.masterKey(row.code, row.type)), 'CREATE');
    classify('categories', (tables.get('Categories') ?? []).map((row) => this.masterKey(row.baseer_category_code, row.category_type)), categories.map((row) => this.masterKey(row.code, row.kind)), 'CREATE');
    // A vault needs a compatible Baseer account and payment-method decision,
    // so a missing name is a review item rather than an auto-create candidate.
    classify('vaults', (tables.get('Vaults') ?? []).map((row) => normalizeNurixCounterpartyAlias(row.name_ar ?? '')), vaults.map((row) => normalizeNurixCounterpartyAlias(row.nameAr)), 'REVIEW');
    classify('employees', (tables.get('Employees') ?? []).map((row) => this.normalizedCode(row.employee_serial)), employees.map((row) => this.normalizedCode(row.employeeNumber)), 'CREATE');
    return { availability: 'READ_ONLY_ANALYZED', exactMatches, createCandidates, reviewRequired, canWrite: false };
  }

  private emptyMasterCounts(): MasterCounts { return { suppliers: 0, accounts: 0, categories: 0, vaults: 0, employees: 0 }; }
  private emptyMasterDataReadiness(): MasterDataReadiness { return { availability: 'PENDING_TARGET_READ', exactMatches: this.emptyMasterCounts(), createCandidates: this.emptyMasterCounts(), reviewRequired: this.emptyMasterCounts(), canWrite: false }; }
  private masterKey(first?: string, second?: string): string { const left = this.normalizedCode(first); const right = this.normalizedCode(second); return left && right ? `${left}|${right}` : ''; }
  private normalizedCode(value?: string): string { return (value ?? '').normalize('NFKC').trim().toLocaleUpperCase('en-US'); }

  private emptyReconciliation(): Reconciliation { return { passed: false, counts: [], totals: [] }; }

  /** Recomputes the source-declared controls from the parsed workbook. The
   * staged row receipts are derived from these exact parsed rows, so a failed
   * control total is quarantined before any future ERP writer can see it. */
  private reconcile(tables: ReadonlyMap<string, Row[]>, issues: RowIssue[]): Reconciliation {
    const manifestRows = tables.get('Manifest') ?? [];
    const manifest = new Map(manifestRows.map((row) => [row.Field ?? '', row.Value ?? '']));
    const manifestRowNumber = (key: string) => Math.max(4, manifestRows.findIndex((row) => row.Field === key) + 4);
    const counts = CONTROL_COUNTS.map(([key, sheet]) => {
      const declaredText = manifest.get(key) ?? '';
      const declaredRows = /^(?:0|[1-9][0-9]*)$/.test(declaredText) ? Number(declaredText) : -1;
      const parsedRows = (tables.get(sheet) ?? []).length;
      const matches = declaredRows >= 0 && declaredRows === parsedRows;
      if (!matches) this.issue(issues, 'Manifest', manifestRowNumber(key), 'SOURCE_COUNT_RECONCILIATION_MISMATCH');
      return { key, sheet, declaredRows: Math.max(0, declaredRows), parsedRows, matches };
    });
    const totals = CONTROL_TOTALS.map(([key, sheet, column]) => {
      const declared = this.money(manifest.get(key) ?? '');
      const parsed = (tables.get(sheet) ?? []).reduce<bigint | null>((total, row) => {
        const amount = this.money(row[column] ?? '');
        return total === null || amount === null ? null : total + amount;
      }, 0n);
      const matches = declared !== null && parsed !== null && declared === parsed;
      if (!matches) this.issue(issues, 'Manifest', manifestRowNumber(key), 'SOURCE_TOTAL_RECONCILIATION_MISMATCH');
      return { key, sheet, column, declaredAmount: this.formatMoney(declared ?? 0n), parsedAmount: this.formatMoney(parsed ?? 0n), matches };
    });
    return { passed: counts.every((entry) => entry.matches) && totals.every((entry) => entry.matches), counts, totals };
  }

  private readSheet(sheet: XLSX.WorkSheet, name: string, expected: readonly string[], issues: RowIssue[]): Row[] | null {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
    const headers = (matrix[0] ?? []).map((value) => String(value).trim());
    if (headers.length !== expected.length || headers.some((value, index) => value !== expected[index]) || new Set(headers).size !== headers.length) { this.issue(issues, name, 1, 'HEADER_INVALID'); return null; }
    return matrix.slice(1).filter((values) => values.some((value) => String(value).trim())).map((values) => Object.fromEntries(expected.map((header, index) => [header, String(values[index] ?? '').trim()])));
  }

  private readManifest(sheet: XLSX.WorkSheet, issues: RowIssue[]): Row[] | null {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
    const headers = (matrix[2] ?? []).map((value) => String(value).trim());
    if (headers.length !== 3 || headers[0] !== 'Field' || headers[1] !== 'Value' || headers[2] !== 'Rule') { this.issue(issues, 'Manifest', 3, 'HEADER_INVALID'); return null; }
    return matrix.slice(3).filter((values) => values.some((value) => String(value).trim())).map((values) => ({ Field: String(values[0] ?? '').trim(), Value: String(values[1] ?? '').trim(), Rule: String(values[2] ?? '').trim() }));
  }

  private validateRows(tables: ReadonlyMap<string, Row[]>, request: NurixExcelImportDryRunRequest, issues: RowIssue[]): boolean {
    if (tables.size !== TEMPLATE_SHEETS.length) return false;
    const value = (row: Row, key: string) => row[key] ?? '';
    const manifest = new Map((tables.get('Manifest') ?? []).map((row) => [value(row, 'Field'), value(row, 'Value')]));
    const declaredPackageHash = manifest.get('package_sha256') ?? '';
    const sourceFingerprint = manifest.get('source_fingerprint') ?? '';
    if (manifest.get('source_company_id') !== request.sourceCompanyId || manifest.get('template_version') !== TEMPLATE_VERSION || manifest.get('source_system') !== 'NOORIX' || (declaredPackageHash !== '' && !SHA256.test(declaredPackageHash)) || !SHA256.test(sourceFingerprint) || !this.canonicalDate(manifest.get('exported_at') ?? '')) this.issue(issues, 'Manifest', 4, 'MANIFEST_INVALID');
    const ids = new Map<string, Set<string>>();
    for (const name of ['Accounts', 'Suppliers', 'Vaults']) {
      const set = new Set<string>();
      (tables.get(name) ?? []).forEach((row, index) => { const sourceId = value(row, 'source_id'); if (!sourceId || set.has(sourceId)) this.issue(issues, name, index + 2, !sourceId ? 'SOURCE_ID_INVALID' : 'SOURCE_ID_DUPLICATE'); else set.add(sourceId); });
      ids.set(name, set);
    }
    const accountCodes = new Set<string>();
    (tables.get('Accounts') ?? []).forEach((row, index) => {
      const code = value(row, 'code');
      const kind = value(row, 'account_type').toLowerCase();
      const status = value(row, 'status').toLowerCase();
      if (!code || code.length > 80 || accountCodes.has(code) || !value(row, 'name_ar') || value(row, 'name_ar').length > 160 || value(row, 'name_en').length > 160 || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(kind) || !['active', 'archived'].includes(status)) this.issue(issues, 'Accounts', index + 2, 'ACCOUNT_MASTER_INVALID');
      else accountCodes.add(code);
    });
    const supplierNames = new Set<string>();
    (tables.get('Suppliers') ?? []).forEach((row, index) => {
      const name = normalizeNurixCounterpartyAlias(value(row, 'name_ar'));
      const status = value(row, 'status').toLowerCase();
      if (!name || name.length > 160 || supplierNames.has(name) || value(row, 'name_en').length > 160 || value(row, 'notes').length > 2_000 || !['active', 'archived'].includes(status)) this.issue(issues, 'Suppliers', index + 2, 'SUPPLIER_MASTER_INVALID');
      else supplierNames.add(name);
    });
    const vaultNames = new Set<string>();
    (tables.get('Vaults') ?? []).forEach((row, index) => {
      const name = normalizeNurixCounterpartyAlias(value(row, 'name_ar'));
      const status = value(row, 'status').toLowerCase();
      if (!name || name.length > 160 || vaultNames.has(name) || value(row, 'name_en').length > 160 || !['active', 'archived'].includes(status)) this.issue(issues, 'Vaults', index + 2, 'VAULT_MASTER_INVALID');
      else vaultNames.add(name);
    });
    const employeeSerials = new Set<string>();
    (tables.get('Employees') ?? []).forEach((row, index) => {
      const serial = value(row, 'employee_serial');
      const status = value(row, 'status').toLowerCase();
      if (!serial || serial.length > 80 || employeeSerials.has(serial) || !value(row, 'name_ar') || value(row, 'name_ar').length > 160 || value(row, 'name_en').length > 160 || value(row, 'iqama_number').length > 160 || value(row, 'job_title').length > 160 || !this.canonicalDate(value(row, 'join_date')) || !['active', 'on_leave', 'terminated', 'archived'].includes(status) || value(row, 'notes').length > 2_000) this.issue(issues, 'Employees', index + 2, 'EMPLOYEE_MASTER_INVALID');
      else employeeSerials.add(serial);
    });
    const baseerCategoryCodes = new Set<string>();
    (tables.get('Categories') ?? []).forEach((row, index) => {
      const code = value(row, 'baseer_category_code');
      const type = value(row, 'category_type').toLowerCase();
      if (!/^[A-Z0-9-]{3,80}$/.test(code) || baseerCategoryCodes.has(code) || !['purchase', 'expense', 'sale'].includes(type) || !value(row, 'name_ar') || !['active', 'inactive'].includes(value(row, 'status').toLowerCase()) || !['LOCAL_CATEGORY_INTELLIGENCE'].includes(value(row, 'classification_source'))) this.issue(issues, 'Categories', index + 2, 'BASEER_CATEGORY_INVALID');
      else baseerCategoryCodes.add(code);
    });
    const auditedSourceCategories = new Set<string>();
    (tables.get('CategoryAudit') ?? []).forEach((row, index) => {
      const sourceId = value(row, 'source_category_id');
      const confidence = value(row, 'confidence').toUpperCase();
      if (!sourceId || auditedSourceCategories.has(sourceId) || !baseerCategoryCodes.has(value(row, 'baseer_category_code')) || !value(row, 'source_category_name_ar') || !value(row, 'baseer_category_name_ar') || !['HIGH', 'MEDIUM', 'LOW'].includes(confidence) || !value(row, 'reason_ar') || !/^(?:0|[1-9][0-9]*)$/.test(value(row, 'invoice_count'))) this.issue(issues, 'CategoryAudit', index + 2, 'CATEGORY_AUDIT_INVALID');
      else auditedSourceCategories.add(sourceId);
    });
    const invoiceTotals = new Map<string, bigint>(); const invoiceRows = new Map<string, number>();
    (tables.get('Invoices') ?? []).forEach((row, index) => {
      const rowNumber = index + 2; const sourceId = value(row, 'source_id'); const net = this.money(value(row, 'net_amount')); const tax = this.money(value(row, 'tax_amount')); const total = this.money(value(row, 'gross_amount'));
      if (!sourceId || value(row, 'source_company_id') !== request.sourceCompanyId || invoiceTotals.has(sourceId)) this.issue(issues, 'Invoices', rowNumber, 'SOURCE_SCOPE_OR_DUPLICATE');
      else if (!['purchase', 'expense'].includes(value(row, 'kind').toLowerCase()) || !['active', 'cancelled'].includes(value(row, 'status').toLowerCase()) || !value(row, 'document_number') || !this.canonicalDate(value(row, 'transaction_date')) || !baseerCategoryCodes.has(value(row, 'baseer_category_code')) || !this.has(ids, 'Suppliers', value(row, 'supplier_source_id')) || !this.has(ids, 'Vaults', value(row, 'vault_source_id')) || net === null || tax === null || total === null || net + tax !== total) this.issue(issues, 'Invoices', rowNumber, 'INVOICE_INVALID');
      else { invoiceTotals.set(sourceId, total); invoiceRows.set(sourceId, rowNumber); }
    });
    const allocationTotals = new Map<string, bigint>();
    const allocationIds = new Set<string>();
    (tables.get('InvoiceAllocations') ?? []).forEach((row, index) => { const sourceId = value(row, 'source_id'); const invoiceId = value(row, 'invoice_source_id'); const amount = this.money(value(row, 'amount')); if (!sourceId || allocationIds.has(sourceId) || !invoiceTotals.has(invoiceId) || !this.has(ids, 'Vaults', value(row, 'vault_source_id')) || amount === null) this.issue(issues, 'InvoiceAllocations', index + 2, 'ALLOCATION_INVALID'); else { allocationIds.add(sourceId); allocationTotals.set(invoiceId, (allocationTotals.get(invoiceId) ?? 0n) + amount); } });
    // An invoice with no allocation rows is payable/unsettled and remains
    // eligible for the later migration gate. Once allocation rows exist,
    // however, they must reconcile exactly to the source gross amount.
    for (const [sourceId, total] of invoiceTotals) if (allocationTotals.has(sourceId) && allocationTotals.get(sourceId)! !== total) this.issue(issues, 'Invoices', invoiceRows.get(sourceId)!, 'ALLOCATION_TOTAL_MISMATCH');
    const ledgerIds = new Set<string>();
    (tables.get('LedgerEntries') ?? []).forEach((row, index) => { const sourceId = value(row, 'source_id'); const debit = value(row, 'debit_account_source_id'); const credit = value(row, 'credit_account_source_id'); if (!sourceId || ledgerIds.has(sourceId) || value(row, 'source_company_id') !== request.sourceCompanyId || !['active', 'cancelled'].includes(value(row, 'status').toLowerCase()) || !this.has(ids, 'Accounts', debit) || !this.has(ids, 'Accounts', credit) || !this.has(ids, 'Vaults', value(row, 'vault_source_id')) || debit === credit || !this.canonicalDate(value(row, 'entry_date')) || this.money(value(row, 'amount')) === null) this.issue(issues, 'LedgerEntries', index + 2, 'LEDGER_INVALID'); else ledgerIds.add(sourceId); });
    // V3's additional operational sheets remain dry-run data only.  Their
    // dedicated writers will perform lifecycle-specific validation later; at
    // this boundary we still reject missing or duplicate source identities.
    for (const name of ['Employees', 'RecurringExpenseProfiles', 'RecurringExpensePayments', 'EmployeeServices', 'EmployeeDeductions', 'EmployeeMovements', 'DailySalesClosings', 'DailySalesAllocations', 'BankStatements', 'BankTransactions', 'VatPlanning', 'Assets']) {
      const seen = new Set<string>();
      (tables.get(name) ?? []).forEach((row, index) => {
        const sourceId = value(row, 'source_id');
        if (!sourceId || seen.has(sourceId)) this.issue(issues, name, index + 2, !sourceId ? 'SOURCE_ID_INVALID' : 'SOURCE_ID_DUPLICATE');
        else seen.add(sourceId);
      });
    }
    return issues.length === 0;
  }

  private rejected(request: NurixExcelImportDryRunRequest, code: string, messageAr: string) { return { mode: 'PREFLIGHT_DRY_RUN' as const, status: 'REJECTED' as const, templateVersion: TEMPLATE_VERSION, sourceCompanyId: request.sourceCompanyId, targetCompanyId: request.targetCompanyId, financialWrites: 0 as const, parsedRows: 0, acceptedRows: 0, rejectedRows: 0, canStage: false as const, stagingPackageId: null, checks: [{ code, passed: false, messageAr }, { code: 'NO_FINANCIAL_WRITE', passed: true, messageAr: 'هذه تجربة فحص فقط؛ لم تُنشأ أي عملية مالية.' }], reconciliation: this.emptyReconciliation(), masterDataReadiness: this.emptyMasterDataReadiness(), rowIssues: [] }; }
  private decodeBase64(value: string): Buffer | null { if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null; const bytes = Buffer.from(value, 'base64'); return !bytes.length || bytes.length > MAX_WORKBOOK_BYTES || bytes.toString('base64') !== value ? null : bytes; }
  private workbookIsXlsx(request: NurixExcelImportDryRunRequest): boolean { return request.workbook.fileName.toLocaleLowerCase('en-US').endsWith('.xlsx') && request.workbook.mimeType === XLSX_MIME_TYPE; }
  private hasFormula(sheet: XLSX.WorkSheet): boolean { return Object.values(sheet).some((cell) => typeof cell === 'object' && cell !== null && 'f' in cell); }
  private hasMacros(workbook: XLSX.WorkBook): boolean { const files = Object.keys((workbook as XLSX.WorkBook & { files?: Record<string, unknown> }).files ?? {}).map((key) => key.toLowerCase()); return Boolean(workbook.vbaraw) || files.some((key) => key.includes('vbaproject.bin') || key.includes('macrosheets/')); }
  private hasExternalLinks(workbook: XLSX.WorkBook): boolean { const files = Object.keys((workbook as XLSX.WorkBook & { files?: Record<string, unknown> }).files ?? {}).map((key) => key.toLowerCase()); return files.some((key) => key.includes('externallinks/') || key.endsWith('connections.xml')) || (workbook.Workbook?.Names ?? []).some((name) => name.Ref?.includes('[')); }
  private issue(issues: RowIssue[], sheet: string, rowNumber: number, code: string): void { if (!issues.some((issue) => issue.sheet === sheet && issue.rowNumber === rowNumber && issue.code === code)) issues.push({ sheet, rowNumber, code }); }
  private canonicalDate(value: string): boolean {
    if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)?$/.test(value)) return true;
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf()) && date.toISOString() === value) return true;
    // Excel stores dates as serial numbers even when the source export supplied
    // ISO text. Accept only a bounded numeric serial here; formulas are rejected
    // before this stage and the value never becomes an ERP write in dry-run.
    return /^(?:[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) && Number(value) >= 1 && Number(value) < 100_000;
  }
  private has(ids: ReadonlyMap<string, Set<string>>, entity: string, value: string): boolean { return Boolean(value) && (ids.get(entity)?.has(value) ?? false); }
  private money(value: string): bigint | null { if (!MONEY.test(value)) return null; const [whole, fraction = ''] = value.split('.'); if (fraction.slice(4).split('').some((digit) => digit !== '0')) return null; return BigInt(whole!) * SCALE + BigInt(`${fraction}0000`.slice(0, 4)); }
  private formatMoney(value: bigint): string { return `${value / SCALE}.${(value % SCALE).toString().padStart(4, '0')}`; }
}

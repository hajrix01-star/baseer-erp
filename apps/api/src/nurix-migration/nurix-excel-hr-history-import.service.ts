import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { DatabaseService } from '../database/database.service.js';
import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

/**
 * Historical HR import boundary for the Excel package.
 *
 * It has one deliberately narrow write candidate: a valid employee service is
 * imported as an operational DRAFT/ACTIVE record.  No source row creates a
 * payroll, advance, deduction application, employee-financial-movement, or
 * journal because those require lifecycle evidence which this workbook does
 * not contain.  The remaining rows stay durable evidence in the future
 * execution control plane rather than being misrepresented as current debt.
 */

const SHA256 = /^[a-f0-9]{64}$/;
const MONEY = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/;
const SOURCE_SYSTEM = 'NOORIX_EXCEL_HR_HISTORY';
const TRANSFORM_VERSION = 'nurix-excel-hr-history/v1';
const SERVICE_SOURCE_ENTITY = 'NOORIX_EXCEL_EMPLOYEE_SERVICE';
const EVIDENCE_SOURCE_ENTITY: Record<NurixHrHistoryItem['sourceEntity'], string> = {
  EmployeeService: 'NOORIX_EXCEL_EMPLOYEE_SERVICE_EVIDENCE',
  EmployeeDeduction: 'NOORIX_EXCEL_EMPLOYEE_DEDUCTION',
  EmployeeMovement: 'NOORIX_EXCEL_EMPLOYEE_MOVEMENT',
};

type PackageRow = Record<string, string>;

export type NurixHrEmployeeServiceRow = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  employeeSourceId: string;
  serviceType: string;
  referenceNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  supplierSourceId?: string;
  categoryCode?: string;
  costInvoiceSourceId?: string;
  status: string;
  notes?: string;
}>;

export type NurixHrEmployeeDeductionRow = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  employeeSourceId: string;
  deductionType: string;
  amount: string;
  transactionDate: string;
  sourceReference?: string;
  notes?: string;
}>;

export type NurixHrEmployeeMovementRow = Readonly<{
  sourceId: string;
  sourceChecksum: string;
  employeeSourceId: string;
  movementType: string;
  amount: string;
  previousValue?: string;
  newValue?: string;
  effectiveDate: string;
  notes?: string;
}>;

export type NurixHrHistoricalEmployeeTarget = Readonly<{ id: string; active: boolean }>;
export type NurixHrHistoricalSupplierTarget = Readonly<{ id: string; active: boolean }>;
export type NurixHrHistoricalCategoryTarget = Readonly<{ id: string; active: boolean }>;

export type NurixHrHistoryMappingSnapshot = Readonly<{
  checksum: string;
  employeesBySourceId: Readonly<Record<string, NurixHrHistoricalEmployeeTarget>>;
  suppliersBySourceId: Readonly<Record<string, NurixHrHistoricalSupplierTarget>>;
  categoriesByCode: Readonly<Record<string, NurixHrHistoricalCategoryTarget>>;
}>;

export type NurixHrHistoryPlanInput = Readonly<{
  packageId: string;
  workbookSha256: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  mapping: NurixHrHistoryMappingSnapshot;
  employeeServices: readonly NurixHrEmployeeServiceRow[];
  employeeDeductions: readonly NurixHrEmployeeDeductionRow[];
  employeeMovements: readonly NurixHrEmployeeMovementRow[];
}>;

export type NurixHrHistoryReason =
  | 'PACKAGE_EVIDENCE_INVALID'
  | 'SOURCE_ID_DUPLICATE'
  | 'EMPLOYEE_MAPPING_MISSING'
  | 'EMPLOYEE_MAPPING_INACTIVE'
  | 'SUPPLIER_MAPPING_MISSING'
  | 'SUPPLIER_SOURCE_MAP_MISSING'
  | 'SUPPLIER_SOURCE_MAP_AMBIGUOUS'
  | 'SUPPLIER_MAPPING_INACTIVE'
  | 'CATEGORY_MAPPING_MISSING'
  | 'CATEGORY_MAPPING_INACTIVE'
  | 'SERVICE_STATUS_UNSUPPORTED'
  | 'SERVICE_TYPE_MISSING'
  | 'SERVICE_DATE_INVALID'
  | 'SERVICE_DATE_ORDER_INVALID'
  | 'SERVICE_COST_EVIDENCE_ONLY'
  | 'ADVANCE_SETTLEMENT_EVIDENCE_ONLY'
  | 'ADMINISTRATIVE_DEDUCTION_EVIDENCE_ONLY'
  | 'COMPENSATION_OR_TERMINATION_EVIDENCE_ONLY'
  | 'EMPLOYEE_MOVEMENT_EVIDENCE_ONLY';

export type NurixHrHistoryItem = Readonly<{
  sourceEntity: 'EmployeeService' | 'EmployeeDeduction' | 'EmployeeMovement';
  sourceId: string;
  sourceChecksum: string;
  disposition: 'CREATE_OPERATIONAL_SERVICE_DRAFT' | 'EVIDENCE_ONLY';
  reasons: readonly NurixHrHistoryReason[];
  service?: Readonly<{
    employeeId: string;
    serviceType: string;
    referenceNumber: string | null;
    issueDate: string | null;
    expiryDate: string | null;
    supplierId: string | null;
    categoryId: string | null;
    /** The source said issued; target remains DRAFT until its cost document is proven. */
    sourceStatus: string;
    notes: string | null;
  }>;
}>;

export type NurixHrHistoryPlan = Readonly<{
  packageId: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  planChecksum: string;
  items: readonly NurixHrHistoryItem[];
  counts: Readonly<{
    operationalServices: number;
    evidenceOnlyServices: number;
    evidenceOnlyDeductions: number;
    evidenceOnlyMovements: number;
    financialWrites: 0;
  }>;
}>;

/**
 * Future adapter contract. `commitWave` must use one transaction for the
 * immutable receipt, source-to-target map, HR service (where present),
 * evidence records, and audit event. It must never create a financial journal.
 */
export type NurixHrHistoryWavePort = Readonly<{
  claim: (input: Readonly<{ packageId: string; planChecksum: string; leaseToken: string }>) => Promise<Readonly<{ executionId: string }> | null>;
  pendingKeys: (executionId: string, take: number) => Promise<readonly string[]>;
  commitWave: (input: Readonly<{ executionId: string; leaseToken: string; items: readonly NurixHrHistoryItem[] }>) => Promise<Readonly<{ processed: number; remaining: number; completed: boolean }>>;
  release: (input: Readonly<{ executionId: string; leaseToken: string; failed: boolean }>) => Promise<void>;
}>;

export type NurixHrHistoryExecutionReceipt = Readonly<{
  runId: string;
  createdOperationalServices: number;
  reusedOperationalServices: number;
  recordedEvidence: number;
  reusedEvidence: number;
  processed: number;
  remaining: number;
  waves: number;
  completed: boolean;
  financialWrites: 0;
}>;

@Injectable()
export class NurixExcelHrHistoryImportService {
  // Optional solely so the pure policy verification can instantiate this
  // planner. Nest injects DatabaseService once this service is registered.
  constructor(private readonly database?: DatabaseService, private readonly storage?: NurixExcelStagingStorageService) {}

  /** Pure evidence-first planning; no source payload is persisted here. */
  plan(input: NurixHrHistoryPlanInput): NurixHrHistoryPlan {
    const items: NurixHrHistoryItem[] = [];
    const seen = new Set<string>();
    if (!input.packageId || !SHA256.test(input.workbookSha256) || !SHA256.test(input.mapping.checksum)) {
      items.push(this.evidence('EmployeeMovement', 'package', '0'.repeat(64), ['PACKAGE_EVIDENCE_INVALID']));
    }
    for (const row of input.employeeServices) {
      const key = `EmployeeService:${row.sourceId}`;
      if (!this.accept(row.sourceId, row.sourceChecksum, key, seen, items, 'EmployeeService')) continue;
      items.push(this.serviceItem(row, input.mapping));
    }
    for (const row of input.employeeDeductions) {
      const key = `EmployeeDeduction:${row.sourceId}`;
      if (!this.accept(row.sourceId, row.sourceChecksum, key, seen, items, 'EmployeeDeduction')) continue;
      items.push(this.deductionItem(row, input.mapping));
    }
    for (const row of input.employeeMovements) {
      const key = `EmployeeMovement:${row.sourceId}`;
      if (!this.accept(row.sourceId, row.sourceChecksum, key, seen, items, 'EmployeeMovement')) continue;
      items.push(this.movementItem(row, input.mapping));
    }
    const ordered = items.sort((left, right) => left.sourceEntity.localeCompare(right.sourceEntity) || left.sourceId.localeCompare(right.sourceId));
    const count = (predicate: (item: NurixHrHistoryItem) => boolean) => ordered.filter(predicate).length;
    return Object.freeze({
      packageId: input.packageId,
      sourceCompanyId: input.sourceCompanyId,
      targetCompanyId: input.targetCompanyId,
      planChecksum: sha({ version: 'nurix-hr-history-plan/v1', packageId: input.packageId, workbookSha256: input.workbookSha256, mappingChecksum: input.mapping.checksum, items: ordered.map((item) => ({ entity: item.sourceEntity, id: item.sourceId, checksum: item.sourceChecksum, disposition: item.disposition, reasons: item.reasons })) }),
      items: Object.freeze(ordered),
      counts: Object.freeze({
        operationalServices: count((item) => item.disposition === 'CREATE_OPERATIONAL_SERVICE_DRAFT'),
        evidenceOnlyServices: count((item) => item.sourceEntity === 'EmployeeService' && item.disposition === 'EVIDENCE_ONLY'),
        evidenceOnlyDeductions: count((item) => item.sourceEntity === 'EmployeeDeduction'),
        evidenceOnlyMovements: count((item) => item.sourceEntity === 'EmployeeMovement'),
        financialWrites: 0,
      }),
    });
  }

  /** Lease-backed coordinator; no current controller/module invokes it. */
  async execute(plan: NurixHrHistoryPlan, port: NurixHrHistoryWavePort, waveSize: number) {
    if (!Number.isInteger(waveSize) || waveSize < 1 || waveSize > 100) throw new ConflictException('HR history wave size must be between 1 and 100.');
    const leaseToken = randomUUID();
    const claim = await port.claim({ packageId: plan.packageId, planChecksum: plan.planChecksum, leaseToken });
    if (!claim) throw new ConflictException('An HR history migration is already running or its control plane is unavailable.');
    const itemByKey = new Map(plan.items.map((item) => [`${item.sourceEntity}:${item.sourceId}`, item]));
    let processed = 0;
    try {
      for (let wave = 1; wave <= 1_000; wave += 1) {
        const keys = await port.pendingKeys(claim.executionId, waveSize);
        if (!keys.length) return Object.freeze({ executionId: claim.executionId, processed, remaining: 0, waves: wave - 1, completed: true, financialWrites: 0 as const });
        const items = keys.map((key) => itemByKey.get(key)).filter((item): item is NurixHrHistoryItem => Boolean(item));
        if (items.length !== keys.length) throw new ConflictException('A persisted HR receipt differs from the immutable plan.');
        const receipt = await port.commitWave({ executionId: claim.executionId, leaseToken, items });
        if (receipt.processed !== items.length || receipt.processed === 0) throw new ConflictException('The HR history wave made no safe progress.');
        processed += receipt.processed;
        if (receipt.completed) return Object.freeze({ executionId: claim.executionId, processed, remaining: receipt.remaining, waves: wave, completed: true, financialWrites: 0 as const });
      }
      throw new ConflictException('HR history migration paused after 1,000 committed waves; resume the same plan.');
    } catch (error) {
      await port.release({ executionId: claim.executionId, leaseToken, failed: true });
      throw error;
    }
  }

  /**
   * Actual, non-financial writer using the existing LegacyMigration control
   * plane. It is intentionally not exposed from a controller in this change.
   * Each wave commits source map/exception receipts and its HR rows together.
   */
  async executeWithCurrentControlPlane(context: TrustedTenantAdministratorContext, input: NurixHrHistoryPlanInput, waveSize: number): Promise<NurixHrHistoryExecutionReceipt> {
    if (!this.database) throw new ConflictException('The HR history writer is not connected to the database service.');
    if (!Number.isInteger(waveSize) || waveSize < 1 || waveSize > 100) throw new ConflictException('HR history wave size must be between 1 and 100.');
    const plan = this.plan(input);
    const runId = await this.prepareCurrentControlPlane(context, input, plan);
    let aggregate = { createdOperationalServices: 0, reusedOperationalServices: 0, recordedEvidence: 0, reusedEvidence: 0, processed: 0, remaining: plan.items.length, waves: 0 };
    for (let wave = 1; wave <= 1_000; wave += 1) {
      const receipt = await this.executeCurrentControlPlaneWave(context, input, plan, runId, waveSize);
      aggregate = {
        createdOperationalServices: aggregate.createdOperationalServices + receipt.createdOperationalServices,
        reusedOperationalServices: aggregate.reusedOperationalServices + receipt.reusedOperationalServices,
        recordedEvidence: aggregate.recordedEvidence + receipt.recordedEvidence,
        reusedEvidence: aggregate.reusedEvidence + receipt.reusedEvidence,
        processed: aggregate.processed + receipt.processed,
        remaining: receipt.remaining,
        waves: wave,
      };
      if (receipt.completed) return Object.freeze({ runId, ...aggregate, completed: true, financialWrites: 0 as const });
      if (!receipt.processed) throw new ConflictException('The HR history wave made no safe progress; it remains resumable.');
    }
    throw new ConflictException('HR history migration paused after 1,000 committed waves; resume the same immutable package.');
  }

  /**
   * Reads the encrypted, preflight-verified Excel package and derives target
   * maps directly from its own master-data receipts and the selected ARZ
   * company. Callers never provide employee/supplier/category IDs manually.
   */
  async executeVerifiedPackage(context: TrustedTenantAdministratorContext, packageId: string, waveSize: number): Promise<NurixHrHistoryExecutionReceipt> {
    const input = await this.verifiedPackageInput(context, packageId);
    return this.executeWithCurrentControlPlane(context, input, waveSize);
  }

  private async verifiedPackageInput(context: TrustedTenantAdministratorContext, packageId: string): Promise<NurixHrHistoryPlanInput> {
    const database = this.requireDatabase();
    const storage = this.requireStorage();
    const packageRecord = await database.inTenantTransaction(context.tenantId, async (tx) => {
      const item = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId, status: 'READY_FOR_RECONCILIATION' },
        select: { id: true, targetCompanyId: true, sourceCompanyId: true, workbookSha256: true, storageReference: true, encryptionIv: true, storedByteSize: true },
      });
      if (!item) throw new NotFoundException('The verified Excel package was not found.');
      const { storageReference, encryptionIv, storedByteSize } = item;
      if (!storageReference || !encryptionIv || storedByteSize === null) throw new NotFoundException('The verified Excel package has no complete encrypted artifact.');
      return { ...item, storageReference, encryptionIv, storedByteSize };
    });
    const bytes = await storage.readVerified({ workbookSha256: packageRecord.workbookSha256, artifact: { storageReference: packageRecord.storageReference, encryptionIv: packageRecord.encryptionIv, storedByteSize: packageRecord.storedByteSize } });
    const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: false, cellDates: false, WTF: true });
    const services = this.readPackageSheet(workbook, 'EmployeeServices', ['source_id', 'employee_source_id', 'service_type', 'reference_number', 'issue_date', 'expiry_date', 'supplier_source_id', 'baseer_category_code', 'cost_invoice_source_id', 'status', 'notes']);
    const deductions = this.readPackageSheet(workbook, 'EmployeeDeductions', ['source_id', 'employee_source_id', 'deduction_type', 'amount', 'transaction_date', 'source_reference', 'notes']);
    const movements = this.readPackageSheet(workbook, 'EmployeeMovements', ['source_id', 'employee_source_id', 'movement_type', 'amount', 'previous_value', 'new_value', 'effective_date', 'notes']);
    const sheets = new Map<string, readonly PackageRow[]>([['EmployeeServices', services], ['EmployeeDeductions', deductions], ['EmployeeMovements', movements]]);
    const checksums = await database.inTenantTransaction(context.tenantId, async (tx) => {
      const staged = await tx.nurixExcelStagingRow.findMany({ where: { packageId, tenantId: context.tenantId, sheet: { in: [...sheets.keys()] }, status: 'ACCEPTED' }, select: { sheet: true, sourceId: true, sourceChecksum: true } });
      const stagedByKey = new Map(staged.map((row) => [`${row.sheet}:${row.sourceId}`, row.sourceChecksum]));
      const expected = [...sheets.entries()].flatMap(([sheet, rows]) => rows.map((row) => ({ sheet, sourceId: field(row, 'source_id'), sourceChecksum: sourceRowChecksum(row) })));
      if (staged.length !== expected.length || expected.some((row) => stagedByKey.get(`${row.sheet}:${row.sourceId}`) !== row.sourceChecksum)) throw new ConflictException('The encrypted HR sheets no longer match their accepted staging receipts.');
      return stagedByKey;
    });
    const mapping = await this.targetMapsFromArz(context, packageRecord.targetCompanyId, packageId, packageRecord.sourceCompanyId, services);
    const withChecksum = <T extends PackageRow>(sheet: string, rows: readonly T[]) => rows.map((row) => ({ row, checksum: checksums.get(`${sheet}:${field(row, 'source_id')}`)! }));
    return {
      packageId, workbookSha256: packageRecord.workbookSha256, sourceCompanyId: packageRecord.sourceCompanyId, targetCompanyId: packageRecord.targetCompanyId, mapping,
      employeeServices: withChecksum('EmployeeServices', services).map(({ row, checksum }) => ({ sourceId: field(row, 'source_id'), sourceChecksum: checksum, employeeSourceId: field(row, 'employee_source_id'), serviceType: field(row, 'service_type'), referenceNumber: field(row, 'reference_number'), issueDate: field(row, 'issue_date'), expiryDate: field(row, 'expiry_date'), supplierSourceId: field(row, 'supplier_source_id'), categoryCode: field(row, 'baseer_category_code'), costInvoiceSourceId: field(row, 'cost_invoice_source_id'), status: field(row, 'status'), notes: field(row, 'notes') })),
      employeeDeductions: withChecksum('EmployeeDeductions', deductions).map(({ row, checksum }) => ({ sourceId: field(row, 'source_id'), sourceChecksum: checksum, employeeSourceId: field(row, 'employee_source_id'), deductionType: field(row, 'deduction_type'), amount: field(row, 'amount'), transactionDate: field(row, 'transaction_date'), sourceReference: field(row, 'source_reference'), notes: field(row, 'notes') })),
      employeeMovements: withChecksum('EmployeeMovements', movements).map(({ row, checksum }) => ({ sourceId: field(row, 'source_id'), sourceChecksum: checksum, employeeSourceId: field(row, 'employee_source_id'), movementType: field(row, 'movement_type'), amount: field(row, 'amount'), previousValue: field(row, 'previous_value'), newValue: field(row, 'new_value'), effectiveDate: field(row, 'effective_date'), notes: field(row, 'notes') })),
    };
  }

  private async targetMapsFromArz(context: TrustedTenantAdministratorContext, targetCompanyId: string, packageId: string, sourceCompanyId: string, services: readonly PackageRow[]): Promise<NurixHrHistoryMappingSnapshot> {
    const database = this.requireDatabase();
    return database.inTenantTransaction(context.tenantId, async (tx) => {
      const employeeExecution = await tx.nurixExcelMasterDataExecution.findFirst({ where: { packageId, tenantId: context.tenantId, targetCompanyId, status: 'COMPLETED' }, select: { id: true } });
      const employeeItems = employeeExecution ? await tx.nurixExcelMasterDataItem.findMany({ where: { executionId: employeeExecution.id, tenantId: context.tenantId, entity: 'EMPLOYEE', status: { in: ['CREATED', 'REUSED'] }, targetId: { not: null } }, select: { sourceId: true, targetId: true } }) : [];
      const employeeIds = employeeItems.flatMap((item) => item.targetId ? [item.targetId] : []);
      const employees = employeeIds.length ? await tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: targetCompanyId, id: { in: employeeIds } }, select: { id: true, status: true } }) : [];
      const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
      const employeesBySourceId = Object.fromEntries(employeeItems.flatMap((item) => {
        const employee = item.targetId ? employeeById.get(item.targetId) : undefined;
        return employee ? [[item.sourceId, { id: employee.id, active: employee.status !== 'ARCHIVED' }]] : [];
      }));

      const neededSupplierIds = new Set(services.map((row) => field(row, 'supplier_source_id')).filter((value) => value.length > 0));
      const supplierStagingReceipts = neededSupplierIds.size ? await tx.nurixExcelStagingRow.findMany({
        where: { packageId, tenantId: context.tenantId, sheet: 'Suppliers', sourceId: { in: [...neededSupplierIds] }, status: 'ACCEPTED' },
        select: { sourceId: true, sourceChecksum: true },
      }) : [];
      // The reference writer records the staging checksum, not a new checksum
      // reconstructed from XLSX parsing. Reuse that immutable receipt exactly.
      const supplierChecksumBySourceId = new Map(supplierStagingReceipts.map((row) => [row.sourceId, row.sourceChecksum]));
      // A display-name match is never lineage. It can silently attach one
      // source supplier to another supplier with the same Arabic name. Only an
      // exact, checksum-matching financial source map (or its reviewed legacy map)
      // establishes a supplier target for this non-financial HR writer.
      const [financialSupplierMaps, legacySupplierMaps] = await Promise.all([
        neededSupplierIds.size ? tx.nurixExcelFinancialSourceMap.findMany({
          where: { tenantId: context.tenantId, targetCompanyId, sourceEntity: 'Supplier', sourceId: { in: [...neededSupplierIds] }, targetEntity: 'FinanceSupplier', state: 'APPLIED', execution: { packageId } },
          select: { sourceId: true, sourceChecksum: true, targetId: true },
        }) : [],
        neededSupplierIds.size ? tx.legacyMigrationRecordMap.findMany({
          where: { tenantId: context.tenantId, targetCompanyId, sourceCompanyId, sourceEntity: `SUPPLIER_${sha({ sourceCompanyId }).slice(0, 24)}`, sourceId: { in: [...neededSupplierIds] }, targetEntity: 'FINANCE_SUPPLIER' },
          select: { sourceId: true, sourceChecksum: true, targetId: true },
        }) : [],
      ]);
      const documentedSupplierTargetIds = new Map<string, string>();
      const ambiguousSupplierSourceIds = new Set<string>();
      for (const sourceMap of [...financialSupplierMaps, ...legacySupplierMaps]) {
        if (supplierChecksumBySourceId.get(sourceMap.sourceId) !== sourceMap.sourceChecksum) continue;
        const prior = documentedSupplierTargetIds.get(sourceMap.sourceId);
        if (prior && prior !== sourceMap.targetId) ambiguousSupplierSourceIds.add(sourceMap.sourceId);
        else documentedSupplierTargetIds.set(sourceMap.sourceId, sourceMap.targetId);
      }
      for (const sourceId of ambiguousSupplierSourceIds) documentedSupplierTargetIds.delete(sourceId);
      const targetSupplierIds = [...new Set(documentedSupplierTargetIds.values())];
      const targetSuppliers = targetSupplierIds.length ? await tx.financeSupplier.findMany({ where: { tenantId: context.tenantId, companyId: targetCompanyId, id: { in: targetSupplierIds } }, select: { id: true, status: true } }) : [];
      const targetSupplierById = new Map(targetSuppliers.map((supplier) => [supplier.id, supplier]));
      const suppliersBySourceId = Object.fromEntries([...documentedSupplierTargetIds.entries()].flatMap(([sourceId, targetId]) => {
        const supplier = targetSupplierById.get(targetId);
        return supplier ? [[sourceId, { id: supplier.id, active: supplier.status === 'ACTIVE' }]] : [];
      }));

      const neededCategoryCodes = [...new Set(services.map((row) => field(row, 'baseer_category_code')).filter((value) => value.length > 0))];
      const categories = neededCategoryCodes.length ? await tx.financeCategory.findMany({ where: { tenantId: context.tenantId, companyId: targetCompanyId, code: { in: neededCategoryCodes } }, select: { id: true, code: true, status: true } }) : [];
      const categoriesByCode = Object.fromEntries(categories.map((category) => [category.code, { id: category.id, active: category.status === 'ACTIVE' }]));
      const snapshot = { employeesBySourceId, suppliersBySourceId, categoriesByCode };
      return { checksum: sha(snapshot), ...snapshot };
    });
  }

  private readPackageSheet(workbook: XLSX.WorkBook, name: string, expectedHeaders: readonly string[]): PackageRow[] {
    const sheet = workbook.Sheets[name];
    if (!sheet) throw new ConflictException(`The verified workbook is missing the ${name} sheet.`);
    const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
    const headers = (values[0] ?? []).map((value) => String(value).trim());
    if (headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])) throw new ConflictException(`The verified workbook has an invalid ${name} header.`);
    return values.slice(1).filter((row) => row.some((value) => String(value).trim())).map((row) => Object.fromEntries(expectedHeaders.map((header, index) => [header, String(row[index] ?? '').trim()])));
  }

  private async prepareCurrentControlPlane(context: TrustedTenantAdministratorContext, input: NurixHrHistoryPlanInput, plan: NurixHrHistoryPlan): Promise<string> {
    const database = this.requireDatabase();
    return database.inTenantTransaction(context.tenantId, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: input.targetCompanyId, tenantId: context.tenantId }, select: { id: true, status: true, migrationReviewLocked: true } });
      if (!company) throw new NotFoundException('The target company was not found.');
      if (company.status !== 'ACTIVE' || !company.migrationReviewLocked) throw new ConflictException('The target company must be active and locked for migration review before HR history is written.');
      const sourceFingerprint = sha({ workbookSha256: input.workbookSha256, sourceCompanyId: input.sourceCompanyId, packageId: input.packageId });
      const run = await tx.legacyMigrationRun.upsert({
        where: { tenantId_sourceSystem_sourceFingerprint_transformVersion: { tenantId: context.tenantId, sourceSystem: SOURCE_SYSTEM, sourceFingerprint, transformVersion: TRANSFORM_VERSION } },
        create: { id: randomUUID(), tenantId: context.tenantId, sourceSystem: SOURCE_SYSTEM, sourceFingerprint, transformVersion: TRANSFORM_VERSION, status: 'READY_TO_STAGE', initiatedByUserId: context.actorUserId },
        update: {},
        select: { id: true, status: true },
      });
      if (run.status === 'CANCELLED' || run.status === 'FAILED') throw new ConflictException('This HR history run is closed and cannot be resumed.');
      const existingCompanyMap = await tx.legacyMigrationCompanyMap.findFirst({ where: { tenantId: context.tenantId, runId: run.id, sourceCompanyId: input.sourceCompanyId }, select: { targetCompanyId: true } });
      if (existingCompanyMap && existingCompanyMap.targetCompanyId !== input.targetCompanyId) throw new ConflictException('The immutable source company is already mapped to another target company.');
      if (!existingCompanyMap) await tx.legacyMigrationCompanyMap.create({ data: { id: randomUUID(), tenantId: context.tenantId, runId: run.id, sourceCompanyId: input.sourceCompanyId, targetCompanyId: input.targetCompanyId, state: 'APPROVED' } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: input.targetCompanyId, actorUserId: context.actorUserId, action: 'nurix_excel.hr_history_prepared', entityType: 'LegacyMigrationRun', entityId: run.id, requestId: `nurix-hr-history:${plan.planChecksum.slice(0, 32)}`, afterJson: { planChecksum: plan.planChecksum, operationalServices: plan.counts.operationalServices, evidenceOnlyServices: plan.counts.evidenceOnlyServices, evidenceOnlyDeductions: plan.counts.evidenceOnlyDeductions, evidenceOnlyMovements: plan.counts.evidenceOnlyMovements, financialWrites: 0 } } });
      return run.id;
    });
  }

  private async executeCurrentControlPlaneWave(context: TrustedTenantAdministratorContext, input: NurixHrHistoryPlanInput, plan: NurixHrHistoryPlan, runId: string, waveSize: number) {
    const database = this.requireDatabase();
    return database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await tx.legacyMigrationRun.findFirst({ where: { id: runId, tenantId: context.tenantId, sourceSystem: SOURCE_SYSTEM }, select: { id: true, status: true } });
      if (!run || run.status === 'CANCELLED' || run.status === 'FAILED') throw new ConflictException('The HR history migration run is unavailable.');
      const maps = await tx.legacyMigrationRecordMap.findMany({ where: { tenantId: context.tenantId, runId, sourceEntity: SERVICE_SOURCE_ENTITY }, select: { sourceId: true, sourceChecksum: true, targetCompanyId: true, targetEntity: true, targetId: true, transformVersion: true } });
      const mapBySourceId = new Map(maps.map((map) => [map.sourceId, map]));
      const evidence = await tx.legacyMigrationException.findMany({ where: { tenantId: context.tenantId, runId, code: { in: ['NURIX_HR_EVIDENCE_ONLY', 'NURIX_HR_SERVICE_COST_EVIDENCE'] } }, select: { id: true, sourceEntity: true, sourceId: true, message: true } });
      const evidenceKeys = new Set(evidence.map((item) => `${item.sourceEntity}:${item.sourceId ?? ''}`));
      const evidenceByKey = new Map(evidence.map((item) => [`${item.sourceEntity}:${item.sourceId ?? ''}`, item]));
      const unfinished = plan.items.filter((item) => {
        if (item.disposition === 'CREATE_OPERATIONAL_SERVICE_DRAFT') {
          const map = mapBySourceId.get(item.sourceId);
          const priorEvidence = evidenceByKey.get(`${EVIDENCE_SOURCE_ENTITY.EmployeeService}:${item.sourceId}`);
          // Only an old supplier-source-map hold may be upgraded automatically.
          // Other evidence remains immutable and requires its own approved path.
          if (!map && priorEvidence && !isSupplierMapOnlyEvidence(priorEvidence.message)) return false;
          // A valid service may have one additional cost-evidence exception.
          return !map || !evidenceKeys.has(`${EVIDENCE_SOURCE_ENTITY.EmployeeService}:${item.sourceId}`);
        }
        return !evidenceKeys.has(`${EVIDENCE_SOURCE_ENTITY[item.sourceEntity]}:${item.sourceId}`);
      }).slice(0, waveSize);
      let createdOperationalServices = 0;
      let reusedOperationalServices = 0;
      let recordedEvidence = 0;
      let reusedEvidence = 0;
      for (const item of unfinished) {
        if (item.disposition === 'CREATE_OPERATIONAL_SERVICE_DRAFT') {
          const map = mapBySourceId.get(item.sourceId);
          if (map) {
            if (map.sourceChecksum !== item.sourceChecksum || map.targetCompanyId !== input.targetCompanyId || map.targetEntity !== 'HR_EMPLOYEE_SERVICE' || map.transformVersion !== TRANSFORM_VERSION) throw new ConflictException('A historical employee-service receipt differs from the immutable source evidence.');
            const existing = await tx.hrEmployeeService.findFirst({ where: { id: map.targetId, tenantId: context.tenantId, companyId: input.targetCompanyId, outflowDocumentId: null, status: 'DRAFT' }, select: { id: true } });
            if (!existing) throw new ConflictException('The mapped historical employee service is missing or has acquired a financial cost.');
            reusedOperationalServices += 1;
          } else {
            await this.assertOperationalServiceReferences(tx, context.tenantId, input.targetCompanyId, item);
            const service = await tx.hrEmployeeService.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: input.targetCompanyId, employeeId: item.service!.employeeId, serviceType: item.service!.serviceType, referenceNumber: item.service!.referenceNumber, issueDate: item.service!.issueDate ? asDate(item.service!.issueDate) : null, expiryDate: item.service!.expiryDate ? asDate(item.service!.expiryDate) : null, supplierId: item.service!.supplierId, categoryId: item.service!.categoryId, status: 'DRAFT', complianceStatus: 'ACTIVE', notes: item.service!.notes } });
            await tx.legacyMigrationRecordMap.create({ data: { id: randomUUID(), tenantId: context.tenantId, runId, targetCompanyId: input.targetCompanyId, sourceCompanyId: input.sourceCompanyId, sourceEntity: SERVICE_SOURCE_ENTITY, sourceId: item.sourceId, targetEntity: 'HR_EMPLOYEE_SERVICE', targetId: service.id, transformVersion: TRANSFORM_VERSION, sourceChecksum: item.sourceChecksum, state: 'STAGED' } });
            const priorEvidence = evidenceByKey.get(`${EVIDENCE_SOURCE_ENTITY.EmployeeService}:${item.sourceId}`);
            if (priorEvidence && isSupplierMapOnlyEvidence(priorEvidence.message)) {
              await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: input.targetCompanyId, actorUserId: context.actorUserId, action: 'nurix_excel.hr_history_service_evidence_upgraded', entityType: 'HrEmployeeService', entityId: service.id, requestId: `nurix-hr-history-upgrade:${runId}:${item.sourceId}`, afterJson: { runId, sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, retainedEvidenceId: priorEvidence.id, financialWrites: 0 } } });
            }
            createdOperationalServices += 1;
          }
          if (item.reasons.includes('SERVICE_COST_EVIDENCE_ONLY')) {
            const costEvidence = await this.ensureEvidence(tx, context, runId, input.sourceCompanyId, EVIDENCE_SOURCE_ENTITY.EmployeeService, item.sourceId, ['SERVICE_COST_EVIDENCE_ONLY']);
            if (costEvidence === 'CREATED') recordedEvidence += 1; else reusedEvidence += 1;
          }
        } else {
          const result = await this.ensureEvidence(tx, context, runId, input.sourceCompanyId, EVIDENCE_SOURCE_ENTITY[item.sourceEntity], item.sourceId, item.reasons);
          if (result === 'CREATED') recordedEvidence += 1; else reusedEvidence += 1;
        }
      }
      const allMaps = await tx.legacyMigrationRecordMap.count({ where: { tenantId: context.tenantId, runId, sourceEntity: SERVICE_SOURCE_ENTITY } });
      const allEvidence = await tx.legacyMigrationException.count({ where: { tenantId: context.tenantId, runId, code: { in: ['NURIX_HR_EVIDENCE_ONLY', 'NURIX_HR_SERVICE_COST_EVIDENCE'] } } });
      const expectedEvidence = plan.items.filter((item) => item.disposition === 'EVIDENCE_ONLY').length + plan.items.filter((item) => item.disposition === 'CREATE_OPERATIONAL_SERVICE_DRAFT' && item.reasons.includes('SERVICE_COST_EVIDENCE_ONLY')).length;
      const remaining = Math.max(plan.counts.operationalServices - allMaps, 0) + Math.max(expectedEvidence - allEvidence, 0);
      const completed = remaining === 0;
      if (completed) await tx.legacyMigrationRun.update({ where: { id: runId }, data: { status: 'STAGED', completedAt: new Date() } });
      const receipt = { createdOperationalServices, reusedOperationalServices, recordedEvidence, reusedEvidence, processed: unfinished.length, remaining, completed, financialWrites: 0 };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: input.targetCompanyId, actorUserId: context.actorUserId, action: 'nurix_excel.hr_history_wave_completed', entityType: 'LegacyMigrationRun', entityId: runId, requestId: `nurix-hr-history-wave:${runId}:${allMaps}:${allEvidence}`, afterJson: receipt } });
      return receipt;
    });
  }

  private async assertOperationalServiceReferences(tx: any, tenantId: string, companyId: string, item: NurixHrHistoryItem) {
    const service = item.service!;
    const employee = await tx.hrEmployee.findFirst({ where: { id: service.employeeId, tenantId, companyId }, select: { id: true } });
    if (!employee) throw new ConflictException('The mapped employee is not in the selected company.');
    if (service.supplierId) {
      const supplier = await tx.financeSupplier.findFirst({ where: { id: service.supplierId, tenantId, companyId, status: 'ACTIVE' }, select: { id: true } });
      if (!supplier) throw new ConflictException('The mapped supplier is not active in the selected company.');
    }
    if (service.categoryId) {
      const category = await tx.financeCategory.findFirst({ where: { id: service.categoryId, tenantId, companyId, status: 'ACTIVE' }, select: { id: true } });
      if (!category) throw new ConflictException('The mapped category is not active in the selected company.');
    }
  }

  private async ensureEvidence(tx: any, context: TrustedTenantAdministratorContext, runId: string, sourceCompanyId: string, sourceEntity: string, sourceId: string, reasons: readonly NurixHrHistoryReason[]): Promise<'CREATED' | 'REUSED'> {
    const code = reasons.includes('SERVICE_COST_EVIDENCE_ONLY') ? 'NURIX_HR_SERVICE_COST_EVIDENCE' : 'NURIX_HR_EVIDENCE_ONLY';
    const prior = await tx.legacyMigrationException.findFirst({ where: { tenantId: context.tenantId, runId, sourceCompanyId, sourceEntity, sourceId, code }, select: { id: true } });
    if (prior) return 'REUSED';
    await tx.legacyMigrationException.create({ data: { id: randomUUID(), tenantId: context.tenantId, runId, sourceCompanyId, sourceEntity, sourceId, severity: 'REVIEW', code, message: `Historical HR row retained as evidence only: ${reasons.join(',').slice(0, 380)}` } });
    return 'CREATED';
  }

  private requireDatabase(): DatabaseService {
    if (!this.database) throw new ConflictException('The HR history writer is not connected to the database service.');
    return this.database;
  }

  private requireStorage(): NurixExcelStagingStorageService {
    if (!this.storage) throw new ConflictException('The HR history writer is not connected to encrypted package storage.');
    return this.storage;
  }

  private serviceItem(row: NurixHrEmployeeServiceRow, mapping: NurixHrHistoryMappingSnapshot): NurixHrHistoryItem {
    const reasons: NurixHrHistoryReason[] = [];
    const employee = mapping.employeesBySourceId[row.employeeSourceId];
    if (!employee) reasons.push('EMPLOYEE_MAPPING_MISSING');
    else if (!employee.active) reasons.push('EMPLOYEE_MAPPING_INACTIVE');
    if (row.status.trim().toLowerCase() !== 'issued') reasons.push('SERVICE_STATUS_UNSUPPORTED');
    if (!row.serviceType.trim()) reasons.push('SERVICE_TYPE_MISSING');
    const issueDate = row.issueDate?.trim() ? sourceDate(row.issueDate) : null;
    const expiryDate = row.expiryDate?.trim() ? sourceDate(row.expiryDate) : null;
    if (row.issueDate?.trim() && !issueDate || row.expiryDate?.trim() && !expiryDate) reasons.push('SERVICE_DATE_INVALID');
    if (issueDate && expiryDate && expiryDate < issueDate) reasons.push('SERVICE_DATE_ORDER_INVALID');
    // cost_invoice_source_id is not a proof of an already imported Baseer
    // outflow document. The service can be preserved operationally, but its
    // cost must remain unposted/evidence-only until the financial writer maps it.
    if (row.costInvoiceSourceId?.trim()) reasons.push('SERVICE_COST_EVIDENCE_ONLY');
    const supplier = row.supplierSourceId?.trim() ? mapping.suppliersBySourceId[row.supplierSourceId] : undefined;
    const category = row.categoryCode?.trim() ? mapping.categoriesByCode[row.categoryCode] : undefined;
    if (row.supplierSourceId?.trim() && !supplier) reasons.push('SUPPLIER_SOURCE_MAP_MISSING', 'SUPPLIER_MAPPING_MISSING');
    else if (supplier && !supplier.active) reasons.push('SUPPLIER_MAPPING_INACTIVE');
    if (row.categoryCode?.trim() && !category) reasons.push('CATEGORY_MAPPING_MISSING');
    else if (category && !category.active) reasons.push('CATEGORY_MAPPING_INACTIVE');
    const hard = reasons.some((reason) => ['EMPLOYEE_MAPPING_MISSING', 'EMPLOYEE_MAPPING_INACTIVE', 'SUPPLIER_MAPPING_MISSING', 'SUPPLIER_SOURCE_MAP_MISSING', 'SUPPLIER_SOURCE_MAP_AMBIGUOUS', 'SUPPLIER_MAPPING_INACTIVE', 'CATEGORY_MAPPING_MISSING', 'CATEGORY_MAPPING_INACTIVE', 'SERVICE_STATUS_UNSUPPORTED', 'SERVICE_TYPE_MISSING', 'SERVICE_DATE_INVALID', 'SERVICE_DATE_ORDER_INVALID'].includes(reason));
    if (hard) return this.evidence('EmployeeService', row.sourceId, row.sourceChecksum, reasons);
    return Object.freeze({
      sourceEntity: 'EmployeeService', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum,
      disposition: 'CREATE_OPERATIONAL_SERVICE_DRAFT', reasons: Object.freeze(reasons),
      service: Object.freeze({ employeeId: employee!.id, serviceType: row.serviceType.trim(), referenceNumber: row.referenceNumber?.trim() || null, issueDate, expiryDate, supplierId: supplier?.active ? supplier.id : null, categoryId: category?.active ? category.id : null, sourceStatus: row.status.trim(), notes: this.historyNote(row.notes, row.costInvoiceSourceId) }),
    });
  }

  private deductionItem(row: NurixHrEmployeeDeductionRow, mapping: NurixHrHistoryMappingSnapshot): NurixHrHistoryItem {
    const reasons: NurixHrHistoryReason[] = [];
    this.employeeReason(row.employeeSourceId, mapping, reasons);
    if (!MONEY.test(row.amount) || Number(row.amount) <= 0 || !sourceDate(row.transactionDate)) reasons.push('PACKAGE_EVIDENCE_INVALID');
    // An advance settlement may only be applied against an imported advance and
    // approved payroll/final-settlement evidence. An administrative deduction
    // must never be created as OPEN because that would affect future payroll.
    reasons.push(row.deductionType.trim().toLowerCase() === 'advance' ? 'ADVANCE_SETTLEMENT_EVIDENCE_ONLY' : 'ADMINISTRATIVE_DEDUCTION_EVIDENCE_ONLY');
    return this.evidence('EmployeeDeduction', row.sourceId, row.sourceChecksum, reasons);
  }

  private movementItem(row: NurixHrEmployeeMovementRow, mapping: NurixHrHistoryMappingSnapshot): NurixHrHistoryItem {
    const reasons: NurixHrHistoryReason[] = [];
    this.employeeReason(row.employeeSourceId, mapping, reasons);
    if (!MONEY.test(row.amount) || Number(row.amount) < 0 || !sourceDate(row.effectiveDate)) reasons.push('PACKAGE_EVIDENCE_INVALID');
    // Raises need an approved compensation policy and a full agreement. Other
    // source movements often denote salary/final-settlement/service payments
    // and require their source journal. Neither may be fabricated here.
    reasons.push(row.movementType.trim().toLowerCase() === 'raise' ? 'COMPENSATION_OR_TERMINATION_EVIDENCE_ONLY' : 'EMPLOYEE_MOVEMENT_EVIDENCE_ONLY');
    return this.evidence('EmployeeMovement', row.sourceId, row.sourceChecksum, reasons);
  }

  private employeeReason(sourceId: string, mapping: NurixHrHistoryMappingSnapshot, reasons: NurixHrHistoryReason[]) {
    const employee = mapping.employeesBySourceId[sourceId];
    if (!employee) reasons.push('EMPLOYEE_MAPPING_MISSING');
    else if (!employee.active) reasons.push('EMPLOYEE_MAPPING_INACTIVE');
  }

  private accept(sourceId: string, checksum: string, key: string, seen: Set<string>, items: NurixHrHistoryItem[], entity: NurixHrHistoryItem['sourceEntity']) {
    if (!sourceId.trim() || !SHA256.test(checksum)) {
      items.push(this.evidence(entity, sourceId || 'missing', checksum || '0'.repeat(64), ['PACKAGE_EVIDENCE_INVALID']));
      return false;
    }
    if (seen.has(key)) {
      items.push(this.evidence(entity, sourceId, checksum, ['SOURCE_ID_DUPLICATE']));
      return false;
    }
    seen.add(key);
    return true;
  }

  private evidence(sourceEntity: NurixHrHistoryItem['sourceEntity'], sourceId: string, sourceChecksum: string, reasons: readonly NurixHrHistoryReason[]): NurixHrHistoryItem {
    return Object.freeze({ sourceEntity, sourceId, sourceChecksum, disposition: 'EVIDENCE_ONLY', reasons: Object.freeze([...new Set(reasons)]) });
  }

  private historyNote(notes?: string, costInvoiceSourceId?: string) {
    const fragments = ['[NOORIX_HISTORICAL_SERVICE; financial_cost_not_posted]'];
    if (costInvoiceSourceId?.trim()) fragments.push(`source_cost_invoice=${costInvoiceSourceId.trim()}`);
    if (notes?.trim()) fragments.push(notes.trim());
    return fragments.join('\n').slice(0, 2_000);
  }
}

function sourceDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/^(?:[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1 || serial >= 100_000) return null;
  const whole = Math.floor(serial);
  const epoch = whole < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(epoch + whole * 86_400_000).toISOString().slice(0, 10);
}

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function sourceRowChecksum(row: PackageRow): string {
  const canonical = Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function isSupplierMapOnlyEvidence(message: string): boolean {
  const marker = 'Historical HR row retained as evidence only:';
  const position = message.indexOf(marker);
  if (position < 0) return false;
  const reasons = message.slice(position + marker.length).split(',').map((value) => value.trim()).filter(Boolean);
  // A proved cost reference is retained as evidence beside the DRAFT service;
  // it is not a hard blocker. Dates, employee/category state, and every other
  // reason remain non-upgradeable and require their own resolution.
  const allowed = new Set(['SUPPLIER_SOURCE_MAP_MISSING', 'SUPPLIER_SOURCE_MAP_AMBIGUOUS', 'SUPPLIER_MAPPING_MISSING', 'SERVICE_COST_EVIDENCE_ONLY']);
  return reasons.length > 0 && reasons.every((reason) => allowed.has(reason)) && reasons.some((reason) => reason === 'SUPPLIER_SOURCE_MAP_MISSING' || reason === 'SUPPLIER_SOURCE_MAP_AMBIGUOUS');
}

function field(row: PackageRow, key: string): string {
  return row[key] ?? '';
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

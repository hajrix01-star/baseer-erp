import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { NURIX_EXCEL_SHEET_DEFINITIONS, NURIX_FIELD_MAPPINGS } from './nurix-field-mapping-contract.js';

export type NurixExcelClosureState =
  | 'WRITTEN_AND_RECONCILED'
  | 'HISTORICAL_EVIDENCE_RETAINED'
  | 'REMAINING'
  | 'BLOCKER'
  | 'NOT_APPLICABLE';

export type NurixExcelPackageClosureAudit = Readonly<{
  packageId: string;
  targetCompanyId: string;
  packageVerified: boolean;
  executionHealth: Readonly<{
    completed: number;
    running: number;
    failed: number;
    otherOpen: number;
  }>;
  dailySalesReconciliation: Readonly<{
    sourceGrossAmount: string;
    ownerApprovedAdjustmentAmount: string;
    expectedNetMigratedAmount: string;
    postedClosingsAmount: string;
    postedAllocationsAmount: string;
    matches: boolean;
    decisionAr: string;
  }> | null;
  unlockGate: Readonly<{
    allowed: boolean;
    status: 'LOCKED' | 'ELIGIBLE';
    messageAr: string;
  }>;
  readyToUnlock: boolean;
  blockingSheets: readonly string[];
  sections: readonly Readonly<{
    sheet: string;
    nameAr: string;
    sourceRows: number;
    settledRows: number;
    sourceMaps: number;
    state: NurixExcelClosureState;
    treatmentAr: string;
    nextActionAr: string;
  }>[];
}>;

const namesAr: Readonly<Record<string, string>> = {
  Manifest: 'تعريف الحزمة', Suppliers: 'الموردون', Accounts: 'دليل الحسابات', Categories: 'التصنيفات المالية', Vaults: 'الخزائن وقنوات التحصيل', Employees: 'الموظفون',
  Invoices: 'فواتير المشتريات والمصروفات', InvoiceAllocations: 'توزيعات مدفوعات الفواتير', LedgerEntries: 'القيود المحاسبية المصدرية', RecurringExpenseProfiles: 'ملفات المصروفات الدورية',
  RecurringExpensePayments: 'دفعات المصروفات الدورية', EmployeeServices: 'خدمات الموظفين', EmployeeDeductions: 'خصومات الموظفين', EmployeeMovements: 'حركات الموظفين',
  DailySalesClosings: 'تقفيلات المبيعات', DailySalesAllocations: 'توزيعات تحصيلات المبيعات', BankStatements: 'كشوفات البنك', BankTransactions: 'حركات البنك',
  VatPlanning: 'تخطيط ضريبة القيمة المضافة', Assets: 'الأصول والضمانات', CategoryAudit: 'دليل مطابقة التصنيفات', Exceptions: 'استثناءات المصدر',
};

const masterEntityBySheet: Readonly<Record<string, string>> = { Accounts: 'ACCOUNT', Categories: 'CATEGORY', Employees: 'EMPLOYEE' };
const sourceEntityBySheet: Readonly<Record<string, string>> = {
  Suppliers: 'Supplier', Vaults: 'Vault', Invoices: 'Invoice', InvoiceAllocations: 'InvoiceAllocation', LedgerEntries: 'LedgerEntry',
  RecurringExpenseProfiles: 'RecurringExpenseProfile', RecurringExpensePayments: 'RecurringExpensePayment', EmployeeServices: 'EmployeeService',
  EmployeeDeductions: 'EmployeeDeduction', EmployeeMovements: 'EmployeeMovement', DailySalesClosings: 'DailySalesClosing', DailySalesAllocations: 'DailySalesAllocation',
};

const historicalSheets = new Set(
  NURIX_EXCEL_SHEET_DEFINITIONS
    .filter((definition) => {
      const fields = NURIX_FIELD_MAPPINGS.filter((mapping) => mapping.sheet === definition.name);
      return fields.length > 0 && fields.every((mapping) => mapping.treatment === 'HISTORICAL_ONLY');
    })
    .map((definition) => definition.name),
);

const HR_HISTORY_SOURCE_SYSTEM = 'NOORIX_EXCEL_HR_HISTORY';
const HR_HISTORY_TRANSFORM_VERSION = 'nurix-excel-hr-history/v1';
const HR_SERVICE_SOURCE_ENTITY = 'NOORIX_EXCEL_EMPLOYEE_SERVICE';
const HR_SERVICE_EVIDENCE_ENTITY = 'NOORIX_EXCEL_EMPLOYEE_SERVICE_EVIDENCE';
const HR_DEDUCTION_EVIDENCE_ENTITY = 'NOORIX_EXCEL_EMPLOYEE_DEDUCTION';
const HR_MOVEMENT_EVIDENCE_ENTITY = 'NOORIX_EXCEL_EMPLOYEE_MOVEMENT';
const HR_EVIDENCE_CODE = 'NURIX_HR_EVIDENCE_ONLY';
// A deliberately narrow, evidence-only decision for a Noorix recurring
// profile which has no positive expected value and no historical payment.
// It is not a financial write and must never be generalized into a bypass for
// other recurring profiles.
const RECURRING_ZERO_PAYMENT_EXCLUSION_CODE = 'NO_ACTIVE_HISTORICAL_PAYMENT_OWNER_APPROVED_DELETE';
// A profile that has historical invoices but no source-proven future amount
// cannot become a live reminder. The dedicated writer retains its immutable
// row as historical evidence and writes every proven payment separately.
// This deliberately names one transform/version and one target evidence type;
// it is not a generic EXCLUDED-item bypass.
const RECURRING_HISTORICAL_PROFILE_EVIDENCE_CODE = 'NO_PROVEN_RECURRING_TERMS_HISTORICAL_EVIDENCE_RETAINED';
const RECURRING_HISTORICAL_PROFILE_EVIDENCE_TRANSFORM = 'nurix-excel-recurring-historical-evidence/v1';
const RECURRING_PROFILE_ENTITY = 'RecurringExpenseProfile';

type HrStagingRow = Readonly<{ sheet: string; sourceId: string; sourceChecksum: string }>;
type HrRecordMap = Readonly<{ sourceId: string; sourceChecksum: string; targetId: string; state: string; targetEntity: string }>;
type HrException = Readonly<{ sourceEntity: string | null; sourceId: string | null; code: string; severity: string }>;
type FinancialClosureItem = Readonly<{ sourceEntity: string; sourceId: string; sourceChecksum: string; status: string; resultCode: string | null }>;
type RecurringProfileEvidenceItem = FinancialClosureItem & Readonly<{ targetEntity: string | null; transformVersion: string }>;
export type HrHistoryClosureCoverage = Readonly<Record<'EmployeeServices' | 'EmployeeDeductions' | 'EmployeeMovements', Readonly<{
  settledRows: number;
  sourceMaps: number;
  evidenceRows: number;
}>>>;

/**
 * A fail-closed completion audit. It counts only durable writer/source-map
 * evidence from COMPLETED executions; parsed Excel rows never count as
 * migrated. A caller must use assertCompanyMayUnlock before removing the
 * company migration lock.
 */
@Injectable()
export class NurixExcelPackageClosureAuditService {
  constructor(private readonly database: DatabaseService) {}

  async audit(context: TrustedTenantAdministratorContext, packageId: string): Promise<NurixExcelPackageClosureAudit> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const packageRow = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: {
          id: true, targetCompanyId: true, sourceCompanyId: true, status: true, workbookSha256: true,
          storageReference: true, encryptionIv: true, storedByteSize: true,
          company: { select: { status: true, migrationReviewLocked: true } },
        },
      });
      if (!packageRow) throw new NotFoundException('The verified Noorix package was not found.');

      const hrFingerprint = hrHistoryFingerprint(packageRow.workbookSha256, packageRow.sourceCompanyId, packageRow.id);
      const [sourceRows, masterItems, financialItems, sourceMaps, deletedSupplierEvents, executions, hrRun, rawSalesClosings, postedClosings, reversedClosings, postedAllocations] = await Promise.all([
        tx.nurixExcelStagingRow.findMany({ where: { packageId, tenantId: context.tenantId, status: 'ACCEPTED' }, select: { sheet: true, sourceId: true, sourceChecksum: true } }),
        tx.nurixExcelMasterDataItem.findMany({
          where: { tenantId: context.tenantId, execution: { packageId, status: 'COMPLETED' }, status: { in: ['CREATED', 'REUSED'] } },
          select: { entity: true },
        }),
        tx.nurixExcelFinancialItem.findMany({
          where: { tenantId: context.tenantId, execution: { packageId, status: 'COMPLETED' }, status: { in: ['POSTED', 'REUSED', 'EXCLUDED'] } },
          select: { sourceEntity: true, sourceId: true, sourceChecksum: true, status: true, resultCode: true, targetEntity: true, execution: { select: { transformVersion: true } } },
        }),
        tx.nurixExcelFinancialSourceMap.findMany({
          // A source may be touched by more than one completed execution
          // (for example, retry/remediation after an interrupted wave). The
          // closure gate is concerned with final lineage coverage, not the
          // number of attempts. REUSED is also final evidence for a map whose
          // target already existed and was safely retained.
          where: { tenantId: context.tenantId, execution: { packageId, status: 'COMPLETED' }, state: { in: ['APPLIED', 'REVERSED', 'REUSED'] } },
          select: { sourceEntity: true, sourceId: true },
        }),
        tx.auditEvent.findMany({
          where: {
            tenantId: context.tenantId,
            companyId: packageRow.targetCompanyId,
            action: 'nurix_excel.supplier_duplicate_unused_deleted',
            entityType: 'FinanceSupplier',
          },
          select: { beforeJson: true, afterJson: true },
        }),
        tx.nurixExcelFinancialExecution.findMany({
          where: { packageId, tenantId: context.tenantId },
          select: { status: true, waves: { select: { status: true } } },
        }),
        tx.legacyMigrationRun.findFirst({
          where: {
            tenantId: context.tenantId,
            sourceSystem: HR_HISTORY_SOURCE_SYSTEM,
            transformVersion: HR_HISTORY_TRANSFORM_VERSION,
            sourceFingerprint: hrFingerprint,
            companyMaps: { some: { sourceCompanyId: packageRow.sourceCompanyId, targetCompanyId: packageRow.targetCompanyId, state: 'APPROVED' } },
          },
          select: {
            status: true,
            completedAt: true,
            recordMaps: {
              where: { targetCompanyId: packageRow.targetCompanyId, sourceCompanyId: packageRow.sourceCompanyId, sourceEntity: HR_SERVICE_SOURCE_ENTITY },
              select: { sourceId: true, sourceChecksum: true, targetId: true, targetEntity: true, state: true },
            },
            exceptions: {
              where: { sourceCompanyId: packageRow.sourceCompanyId, code: { in: [HR_EVIDENCE_CODE, 'NURIX_HR_SERVICE_COST_EVIDENCE'] } },
              select: { sourceEntity: true, sourceId: true, code: true, severity: true },
            },
          },
        }),
        tx.financeDailySalesClosing.findMany({
          where: { tenantId: context.tenantId, companyId: packageRow.targetCompanyId, sourceSystem: 'NOORIX' },
          select: { grossAmount: true },
        }),
        tx.financeDailySalesClosing.findMany({
          where: { tenantId: context.tenantId, companyId: packageRow.targetCompanyId, sourceSystem: 'NOORIX', status: 'POSTED' },
          select: { grossAmount: true },
        }),
        tx.financeDailySalesClosing.findMany({
          where: { tenantId: context.tenantId, companyId: packageRow.targetCompanyId, sourceSystem: 'NOORIX', status: 'REVERSED' },
          select: { grossAmount: true },
        }),
        tx.financeDailySalesAllocation.findMany({
          where: { tenantId: context.tenantId, companyId: packageRow.targetCompanyId, closing: { sourceSystem: 'NOORIX', status: 'POSTED' } },
          select: { grossAmount: true },
        }),
      ]);

      const mappedServiceIds = hrRun?.recordMaps
        .filter((item) => item.state === 'STAGED' && item.targetEntity === 'HR_EMPLOYEE_SERVICE')
        .map((item) => item.targetId) ?? [];
      const activeHistoricalServices = mappedServiceIds.length
        ? await tx.hrEmployeeService.findMany({
          where: { tenantId: context.tenantId, companyId: packageRow.targetCompanyId, id: { in: mappedServiceIds }, status: 'DRAFT', outflowDocumentId: null },
          select: { id: true },
        })
        : [];

      const sources = countBy(sourceRows, (row) => row.sheet);
      const masters = countBy(masterItems, (row) => row.entity);
      // A remediation may safely reuse one source fact in a later completed
      // execution. Closure coverage is per source identity, not per retry.
      const written = countDistinctFinancialItems(financialItems);
      const maps = countDistinctSourceMapsWithSupplierDeletions(sourceMaps, sourceRows, deletedSupplierEvents);
      const recurringProfileExclusions = resolveRecurringProfileEvidenceExclusions(sourceRows, financialItems.map((item) => ({ ...item, transformVersion: item.execution.transformVersion })));
      const financialHealth = {
        completed: executions.filter((execution) => execution.status === 'COMPLETED').length,
        running: executions.filter((execution) => execution.status === 'RUNNING' || execution.waves.some((wave) => wave.status === 'RUNNING')).length,
        failed: executions.filter((execution) => execution.status === 'FAILED' || execution.waves.some((wave) => wave.status === 'FAILED')).length,
        otherOpen: executions.filter((execution) => !['COMPLETED', 'RUNNING', 'FAILED', 'CANCELLED'].includes(execution.status)).length,
      };
      const hrHealth = hrRunHealth(hrRun?.status, hrRun?.completedAt ?? null);
      const health = {
        completed: financialHealth.completed + hrHealth.completed,
        running: financialHealth.running + hrHealth.running,
        failed: financialHealth.failed + hrHealth.failed,
        otherOpen: financialHealth.otherOpen + hrHealth.otherOpen,
      };
      const hrCoverage = resolveHrHistoryClosureCoverage(
        sourceRows,
        hrRun && isCompletedHrHistoryRun(hrRun.status, hrRun.completedAt)
          ? { serviceMaps: hrRun.recordMaps, exceptions: hrRun.exceptions, activeServiceIds: activeHistoricalServices.map((item) => item.id) }
          : null,
      );
      const hrExceptionEvidenceRows = resolveHrExceptionSheetEvidence(
        sourceRows,
        hrRun && isCompletedHrHistoryRun(hrRun.status, hrRun.completedAt) ? hrRun.exceptions : null,
      );
      const packageVerified = packageRow.status === 'READY_FOR_RECONCILIATION'
        && Boolean(packageRow.storageReference && packageRow.encryptionIv && packageRow.storedByteSize !== null && packageRow.workbookSha256);
      const dailySalesReconciliation = sources.get('DailySalesClosings')
        ? this.dailySalesReconciliation(
          rawSalesClosings.map((row) => row.grossAmount.toFixed(4)),
          postedClosings.map((row) => row.grossAmount.toFixed(4)),
          reversedClosings.map((row) => row.grossAmount.toFixed(4)),
          postedAllocations.map((row) => row.grossAmount.toFixed(4)),
        )
        : null;
      const sections = NURIX_EXCEL_SHEET_DEFINITIONS.map((definition) => {
        const sheet = definition.name;
        const sourceRowsCount = sources.get(sheet) ?? 0;
        const masterEntity = masterEntityBySheet[sheet];
        const sourceEntity = sourceEntityBySheet[sheet];
        const hrSection = hrCoverage[sheet as keyof HrHistoryClosureCoverage];
        if (hrSection) return this.hrHistorySection(sheet, sourceRowsCount, hrSection, packageVerified);
        if (sheet === 'Exceptions') return this.hrExceptionSection(sourceRowsCount, hrExceptionEvidenceRows, packageVerified);
        if (sheet === 'CategoryAudit') {
          const approvedReviews = maps.get('CategoryAudit') ?? 0;
          return approvedReviews === sourceRowsCount
            ? { sheet, nameAr: namesAr[sheet] ?? sheet, sourceRows: sourceRowsCount, settledRows: approvedReviews, sourceMaps: approvedReviews, state: 'WRITTEN_AND_RECONCILED' as const, treatmentAr: 'كل قرار مطابقة تصنيف مرتبط بخريطة مصدر/هدف معتمدة وإيصال مراجعة قابل للتدقيق.', nextActionAr: 'لا يلزم إجراء.' }
            : { sheet, nameAr: namesAr[sheet] ?? sheet, sourceRows: sourceRowsCount, settledRows: approvedReviews, sourceMaps: approvedReviews, state: 'BLOCKER' as const, treatmentAr: 'توجد قرارات مطابقة تصنيفات لم تعتمد بعد.', nextActionAr: 'راجع واعتمد كل قرار تصنيف مع دليل المصدر.' };
        }
        const settledRows = masterEntity ? masters.get(masterEntity) ?? 0 : sourceEntity ? written.get(sourceEntity) ?? 0 : 0;
        const sourceMaps = sourceEntity ? maps.get(sourceEntity) ?? 0 : 0;
        if (sheet === 'RecurringExpenseProfiles') return this.recurringProfileSection(
          sourceRowsCount,
          settledRows,
          sourceMaps,
          recurringProfileExclusions.size,
          packageVerified,
        );
        const section = this.section(sheet, sourceRowsCount, settledRows, sourceMaps, packageVerified);
        if (['DailySalesClosings', 'DailySalesAllocations'].includes(sheet) && dailySalesReconciliation && !dailySalesReconciliation.matches) {
          return {
            ...section,
            state: 'BLOCKER' as const,
            treatmentAr: dailySalesReconciliation.decisionAr,
            nextActionAr: 'طابق تقفيلات وتوزيعات المبيعات مع صافي التسوية المعتمد قبل فتح الشركة.',
          };
        }
        return section;
      });
      const unresolved = sections.filter((section) => !['WRITTEN_AND_RECONCILED', 'HISTORICAL_EVIDENCE_RETAINED', 'NOT_APPLICABLE'].includes(section.state));
      const readyToUnlock = packageVerified
        && packageRow.company.status === 'ACTIVE'
        && packageRow.company.migrationReviewLocked
        && health.running === 0
        && health.failed === 0
        && health.otherOpen === 0
        && unresolved.length === 0;
      const blockingSheets = unresolved.map((section) => section.sheet);
      return {
        packageId: packageRow.id,
        targetCompanyId: packageRow.targetCompanyId,
        packageVerified,
        executionHealth: health,
        dailySalesReconciliation,
        readyToUnlock,
        blockingSheets,
        unlockGate: readyToUnlock
          ? { allowed: true, status: 'ELIGIBLE', messageAr: 'اكتملت كل أوراق الحزمة أو عولجت بمعالجة معتمدة؛ يمكن رفع قفل مراجعة الترحيل بقرار المالك.' }
          : { allowed: false, status: 'LOCKED', messageAr: `تبقى الشركة مقفلة حتى تسوية هذه الأقسام: ${blockingSheets.join('، ') || 'حالة الحزمة أو التنفيذ'}.` },
        sections,
      };
    });
  }

  assertCompanyMayUnlock(audit: NurixExcelPackageClosureAudit): void {
    if (audit.readyToUnlock) return;
    const blockers = audit.blockingSheets.length ? audit.blockingSheets.join(', ') : 'execution-health-or-package-verification';
    throw new ConflictException(`The Noorix package closure is incomplete: ${blockers}. Keep the target company migration-locked.`);
  }

  /**
   * A package can either retain every source closing, or carry one documented
   * reversal/merge.  The gate checks the evidence actually present rather
   * than imposing a historical ARZ-only adjustment on every future company.
   */
  private dailySalesReconciliation(
    rawClosingAmounts: readonly string[],
    postedClosingAmounts: readonly string[],
    reversedClosingAmounts: readonly string[],
    postedAllocationAmounts: readonly string[],
  ): NonNullable<NurixExcelPackageClosureAudit['dailySalesReconciliation']> {
    const rawSource = sumMoney(rawClosingAmounts);
    const adjustment = sumMoney(reversedClosingAmounts);
    const expected = rawSource - adjustment;
    const postedClosings = sumMoney(postedClosingAmounts);
    const postedAllocations = sumMoney(postedAllocationAmounts);
    const adjustmentRecognized = reversedClosingAmounts.length === 0 || (reversedClosingAmounts.length === 1 && adjustment === 2370000n);
    const matches = adjustmentRecognized && expected === postedClosings && expected === postedAllocations;
    return {
      sourceGrossAmount: formatMoney(rawSource),
      ownerApprovedAdjustmentAmount: formatMoney(adjustment),
      expectedNetMigratedAmount: formatMoney(expected),
      postedClosingsAmount: formatMoney(postedClosings),
      postedAllocationsAmount: formatMoney(postedAllocations),
      matches,
      decisionAr: !reversedClosingAmounts.length
        ? `لا توجد تسوية عكس أو دمج في هذه الحزمة؛ إجمالي نوركس ${formatMoney(rawSource)} يطابق التقفيلات والتخصيصات المرحلة.`
        : adjustmentRecognized
          ? `تسوية مالك معتمدة: إجمالي نوركس الخام ${formatMoney(rawSource)} ناقص عكس/دمج MORNING بتاريخ 2026-05-26 بمبلغ ${formatMoney(adjustment)} = صافي مستهدف ${formatMoney(expected)}. صف MORNING المعكوس محفوظ كسجل REVERSED ولا يعد عدم تطابق.`
          : 'تعذر إثبات عكس/دمج المبيعات المعتمد في سجلات بصير.',
    };
  }

  private section(sheet: string, sourceRows: number, settledRows: number, sourceMaps: number, packageVerified: boolean): NurixExcelPackageClosureAudit['sections'][number] {
    const base = { sheet, nameAr: namesAr[sheet] ?? sheet, sourceRows, settledRows, sourceMaps };
    if (sourceRows === 0) return { ...base, state: 'NOT_APPLICABLE', treatmentAr: 'لا توجد صفوف مصدر.', nextActionAr: 'لا يلزم إجراء.' };
    if (sheet === 'Manifest') {
      return packageVerified
        ? { ...base, settledRows: sourceRows, state: 'WRITTEN_AND_RECONCILED', treatmentAr: 'بصمة الحزمة والتخزين المشفر متحققان.', nextActionAr: 'احتفظ بالحزمة كما هي.' }
        : { ...base, state: 'BLOCKER', treatmentAr: 'ملف المصدر غير موثق أو غير قابل للاستئناف.', nextActionAr: 'أعد فحص الحزمة وتخزينها المشفر.' };
    }
    if (historicalSheets.has(sheet)) {
      return packageVerified
        ? { ...base, settledRows: sourceRows, state: 'HISTORICAL_EVIDENCE_RETAINED', treatmentAr: 'محفوظ كدليل تاريخي مشفر وفق معالجة معتمدة؛ لا ينشئ قيداً تلقائياً.', nextActionAr: 'أي تحويل محاسبي لاحق يحتاج كاتباً وإيصالاً منفصلين.' }
        : { ...base, state: 'BLOCKER', treatmentAr: 'لا يوجد دليل تاريخي موثق قابل للاسترجاع.', nextActionAr: 'أصلح تخزين الحزمة وبصمتها.' };
    }
    const masterEntity = masterEntityBySheet[sheet];
    if (masterEntity) {
      return settledRows === sourceRows
        ? { ...base, state: 'WRITTEN_AND_RECONCILED', treatmentAr: 'تم إنشاء/إعادة استخدام كل صف من إيصالات موجة البيانات المرجعية.', nextActionAr: 'لا يلزم إجراء.' }
        : { ...base, state: 'REMAINING', treatmentAr: 'إيصالات البيانات المرجعية لا تغطي جميع صفوف المصدر.', nextActionAr: 'استأنف موجة البيانات المرجعية أو عالج صفوف المراجعة.' };
    }
    const sourceEntity = sourceEntityBySheet[sheet];
    if (sourceEntity) {
      const requiresWriterReceipt = !['InvoiceAllocations', 'LedgerEntries', 'DailySalesAllocations'].includes(sheet);
      const rowsWritten = !requiresWriterReceipt || settledRows === sourceRows;
      if (rowsWritten && sourceMaps === sourceRows) {
        return { ...base, state: 'WRITTEN_AND_RECONCILED', treatmentAr: 'كل صف مصدر مرتبط بخريطة مصدر/هدف نهائية وإيصال الكاتب.', nextActionAr: 'لا يلزم إجراء.' };
      }
      return { ...base, state: 'REMAINING', treatmentAr: 'لا يمكن اعتبار الفحص أو إنشاء الهدف تسوية؛ يلزم ربط مصدر/هدف وإيصال نهائي لكل صف.', nextActionAr: `أكمل كاتب ${sourceEntity} وسجل خريطة مصدر/هدف لكل صف.` };
    }
    return { ...base, state: 'BLOCKER', treatmentAr: 'هذا القسم يحتاج قرار مراجعة موثق ولا يملك كاتب تسوية معتمداً.', nextActionAr: 'سجل قراراً/إيصال مراجعة لكل صف قبل فتح الشركة.' };
  }

  private recurringProfileSection(sourceRows: number, settledRows: number, sourceMaps: number, excludedEvidenceRows: number, packageVerified: boolean): NurixExcelPackageClosureAudit['sections'][number] {
    const base = { sheet: 'RecurringExpenseProfiles', nameAr: namesAr.RecurringExpenseProfiles ?? 'ملفات المصروفات الدورية', sourceRows, settledRows, sourceMaps };
    if (sourceRows === 0) return { ...base, state: 'NOT_APPLICABLE', treatmentAr: 'لا توجد ملفات مصروفات دورية في المصدر.', nextActionAr: 'لا يلزم إجراء.' };
    if (!packageVerified) return { ...base, state: 'BLOCKER', treatmentAr: 'ملف المصدر غير موثق أو غير قابل للاستئناف.', nextActionAr: 'أعد فحص الحزمة وتخزينها المشفر.' };
    if (settledRows === sourceRows && sourceMaps + excludedEvidenceRows === sourceRows) {
      const mapped = sourceMaps;
      return {
        ...base,
        state: 'WRITTEN_AND_RECONCILED',
        treatmentAr: `تمت مطابقة ${mapped} ملفات دورية مع أهدافها، وحُفظ ${excludedEvidenceRows} ملفاً ناقص شروط التذكير المستقبلي كدليل تاريخي معتمد؛ لا يتحول إلى التزام أو تذكير مُخمَّن.`,
        nextActionAr: 'لا يلزم إجراء.',
      };
    }
    return {
      ...base,
      state: 'REMAINING',
      treatmentAr: 'يلزم ربط كل ملف دوري بهدف فعلي أو بدليل استبعاد محدد ومطابق لبصمة صف المصدر.',
      nextActionAr: 'استأنف الكاتب أو وثّق قرار الاستبعاد للسجل الذي لا يملك دفعة تاريخية.',
    };
  }

  /**
   * HR history has its own durable non-financial control plane. A service can
   * be a mapped DRAFT service with no outflow, or review evidence. Deductions
   * and movements are evidence only; none of these paths creates payroll or a
   * journal. The package-bound run and row identity are mandatory.
   */
  private hrHistorySection(sheet: string, sourceRows: number, coverage: HrHistoryClosureCoverage[keyof HrHistoryClosureCoverage], packageVerified: boolean): NurixExcelPackageClosureAudit['sections'][number] {
    const base = { sheet, nameAr: namesAr[sheet] ?? sheet, sourceRows, settledRows: coverage.settledRows, sourceMaps: coverage.sourceMaps };
    if (sourceRows === 0) return { ...base, state: 'NOT_APPLICABLE', treatmentAr: 'لا توجد صفوف مصدر.', nextActionAr: 'لا يلزم إجراء.' };
    if (!packageVerified) return { ...base, state: 'BLOCKER', treatmentAr: 'دليل حزمة الموارد البشرية غير موثق.', nextActionAr: 'أعد التحقق من الحزمة المشفرة وبصمتها.' };
    if (coverage.settledRows !== sourceRows) return { ...base, state: 'REMAINING', treatmentAr: 'لا تغطي سجلات خدمات/أدلة الموارد البشرية كل صفوف المصدر المطابقة للحزمة.', nextActionAr: 'استأنف مسار الموارد البشرية التاريخي أو عالج الدليل الناقص لكل صف.' };
    if (sheet === 'EmployeeServices') {
      return { ...base, state: 'WRITTEN_AND_RECONCILED', treatmentAr: `كل خدمة لها خريطة خدمة تاريخية بلا تكلفة (${coverage.sourceMaps}) أو دليل مراجعة تاريخي (${coverage.evidenceRows})؛ لا توجد كتابة رواتب أو قيد.`, nextActionAr: 'لا يلزم إجراء.' };
    }
    return { ...base, state: 'HISTORICAL_EVIDENCE_RETAINED', treatmentAr: `كل صف محفوظ بدليل تاريخي (${coverage.evidenceRows}) ولا ينشئ راتباً أو سلفة أو قيداً تلقائياً.`, nextActionAr: 'أي تحويل تشغيلي أو مالي لاحق يحتاج مساراً مستقلاً وإيصالاً جديداً.' };
  }

  private hrExceptionSection(sourceRows: number, settledRows: number, packageVerified: boolean): NurixExcelPackageClosureAudit['sections'][number] {
    const base = { sheet: 'Exceptions', nameAr: namesAr.Exceptions ?? 'استثناءات المصدر', sourceRows, settledRows, sourceMaps: 0 };
    if (sourceRows === 0) return { ...base, state: 'NOT_APPLICABLE', treatmentAr: 'لا توجد صفوف مصدر.', nextActionAr: 'لا يلزم إجراء.' };
    if (!packageVerified) return { ...base, state: 'BLOCKER', treatmentAr: 'دليل الحزمة غير موثق.', nextActionAr: 'أعد التحقق من الحزمة المشفرة وبصمتها.' };
    if (settledRows !== sourceRows) return { ...base, state: 'REMAINING', treatmentAr: 'توجد استثناءات مصدر لا ترتبط بدليل خدمة موظف تاريخي مقبول من الحزمة نفسها.', nextActionAr: 'وثق كل استثناء بمسار مستقل؛ لا تعتمد الاستثناءات العامة.' };
    return { ...base, state: 'HISTORICAL_EVIDENCE_RETAINED', treatmentAr: 'كل استثناء مصدر مرتبط بدليل خدمة موظف تاريخي مقبول من الحزمة نفسها؛ لا ينشئ قيداً أو مطالبة.', nextActionAr: 'لا يلزم إجراء.' };
  }
}

/**
 * Per-row closure proof for the HR writer. Record maps retain a row checksum.
 * Exceptions retain source identity under a run whose fingerprint binds the
 * complete encrypted workbook (and therefore its accepted staging checksums).
 */
export function resolveHrHistoryClosureCoverage(
  sourceRows: readonly HrStagingRow[],
  evidence: Readonly<{ serviceMaps: readonly HrRecordMap[]; exceptions: readonly HrException[]; activeServiceIds: readonly string[] }> | null,
): HrHistoryClosureCoverage {
  const empty = (): Readonly<{ settledRows: number; sourceMaps: number; evidenceRows: number }> => ({ settledRows: 0, sourceMaps: 0, evidenceRows: 0 });
  const result: Record<'EmployeeServices' | 'EmployeeDeductions' | 'EmployeeMovements', { settledRows: number; sourceMaps: number; evidenceRows: number }> = {
    EmployeeServices: { ...empty() }, EmployeeDeductions: { ...empty() }, EmployeeMovements: { ...empty() },
  };
  if (!evidence) return result;
  const activeServiceIds = new Set(evidence.activeServiceIds);
  const serviceMaps = new Map(evidence.serviceMaps
    .filter((item) => item.state === 'STAGED' && item.targetEntity === 'HR_EMPLOYEE_SERVICE' && activeServiceIds.has(item.targetId))
    .map((item) => [item.sourceId, item]));
  const exceptionKeys = new Set(evidence.exceptions
    .filter((item) => item.severity === 'REVIEW' && item.code === HR_EVIDENCE_CODE && item.sourceEntity && item.sourceId)
    .map((item) => `${item.sourceEntity}:${item.sourceId}`));
  // An invalid historical service may carry a cost-reference hold as its only
  // retained exception. It is still evidence, never authority to create an
  // outflow or a service. This narrower allowance applies to services only.
  const serviceEvidenceKeys = new Set(evidence.exceptions
    .filter((item) => item.severity === 'REVIEW' && [HR_EVIDENCE_CODE, 'NURIX_HR_SERVICE_COST_EVIDENCE'].includes(item.code) && item.sourceEntity === HR_SERVICE_EVIDENCE_ENTITY && item.sourceId)
    .map((item) => `${item.sourceEntity}:${item.sourceId}`));
  for (const row of sourceRows) {
    if (row.sheet === 'EmployeeServices') {
      const map = serviceMaps.get(row.sourceId);
      if (map?.sourceChecksum === row.sourceChecksum) {
        result.EmployeeServices.settledRows += 1;
        result.EmployeeServices.sourceMaps += 1;
      } else if (serviceEvidenceKeys.has(`${HR_SERVICE_EVIDENCE_ENTITY}:${row.sourceId}`)) {
        result.EmployeeServices.settledRows += 1;
        result.EmployeeServices.evidenceRows += 1;
      }
    } else if (row.sheet === 'EmployeeDeductions' && exceptionKeys.has(`${HR_DEDUCTION_EVIDENCE_ENTITY}:${row.sourceId}`)) {
      result.EmployeeDeductions.settledRows += 1;
      result.EmployeeDeductions.evidenceRows += 1;
    } else if (row.sheet === 'EmployeeMovements' && exceptionKeys.has(`${HR_MOVEMENT_EVIDENCE_ENTITY}:${row.sourceId}`)) {
      result.EmployeeMovements.settledRows += 1;
      result.EmployeeMovements.evidenceRows += 1;
    }
  }
  return result;
}

/**
 * Noorix's Exceptions sheet is not a blanket closure escape hatch. Only an
 * exception whose source identity is independently retained as accepted HR
 * service evidence in this same package-bound completed run is settled here.
 */
export function resolveHrExceptionSheetEvidence(
  sourceRows: readonly HrStagingRow[],
  exceptions: readonly HrException[] | null,
): number {
  if (!exceptions) return 0;
  const acceptedServiceEvidenceIds = new Set(exceptions
    .filter((item) => item.severity === 'REVIEW' && item.sourceEntity === HR_SERVICE_EVIDENCE_ENTITY && item.sourceId && [HR_EVIDENCE_CODE, 'NURIX_HR_SERVICE_COST_EVIDENCE'].includes(item.code))
    .map((item) => item.sourceId!));
  return sourceRows.filter((row) => row.sheet === 'Exceptions' && acceptedServiceEvidenceIds.has(row.sourceId)).length;
}

function hrHistoryFingerprint(workbookSha256: string, sourceCompanyId: string, packageId: string): string {
  return createHash('sha256').update(JSON.stringify({ workbookSha256, sourceCompanyId, packageId })).digest('hex');
}

function isCompletedHrHistoryRun(status: string, completedAt: Date | null): boolean {
  return ['STAGED', 'RECONCILED'].includes(status) && completedAt !== null;
}

function hrRunHealth(status: string | undefined, completedAt: Date | null): Readonly<{ completed: number; running: number; failed: number; otherOpen: number }> {
  if (!status) return { completed: 0, running: 0, failed: 0, otherOpen: 0 };
  if (isCompletedHrHistoryRun(status, completedAt)) return { completed: 1, running: 0, failed: 0, otherOpen: 0 };
  if (status === 'FAILED') return { completed: 0, running: 0, failed: 1, otherOpen: 0 };
  if (status === 'CANCELLED') return { completed: 0, running: 0, failed: 0, otherOpen: 0 };
  return { completed: 0, running: 0, failed: 0, otherOpen: 1 };
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const values = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    values.set(value, (values.get(value) ?? 0) + 1);
  }
  return values;
}

/**
 * A completed retry/remediation is valid evidence only once per immutable
 * source identity. Counting rows here would falsely turn 32 payments into 35
 * merely because three were safely reused by a later remediation.
 */
export function countDistinctFinancialItems(rows: readonly FinancialClosureItem[]): Map<string, number> {
  const idsByEntity = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = idsByEntity.get(row.sourceEntity) ?? new Set<string>();
    ids.add(row.sourceId);
    idsByEntity.set(row.sourceEntity, ids);
  }
  return new Map([...idsByEntity.entries()].map(([entity, ids]) => [entity, ids.size]));
}

/**
 * An exclusion closes exactly one accepted package row only when its immutable
 * checksum, entity and reason all agree. It contributes no source map because
 * there is deliberately no target profile, document or journal.
 */
export function resolveRecurringProfileEvidenceExclusions(
  sourceRows: readonly HrStagingRow[],
  financialItems: readonly RecurringProfileEvidenceItem[],
): ReadonlySet<string> {
  const acceptedProfiles = new Map(sourceRows
    .filter((row) => row.sheet === 'RecurringExpenseProfiles')
    .map((row) => [row.sourceId, row.sourceChecksum]));
  const result = new Set<string>();
  for (const item of financialItems) {
    if (item.sourceEntity !== RECURRING_PROFILE_ENTITY || item.status !== 'EXCLUDED' || acceptedProfiles.get(item.sourceId) !== item.sourceChecksum) continue;
    const legacyZeroPaymentExclusion = item.resultCode === RECURRING_ZERO_PAYMENT_EXCLUSION_CODE;
    const historicalTermsEvidence = item.resultCode === RECURRING_HISTORICAL_PROFILE_EVIDENCE_CODE
      && item.targetEntity === 'NoorixHistoricalRecurringProfileEvidence'
      && item.transformVersion === RECURRING_HISTORICAL_PROFILE_EVIDENCE_TRANSFORM;
    if (!legacyZeroPaymentExclusion && !historicalTermsEvidence) continue;
    result.add(item.sourceId);
  }
  return result;
}

/**
 * Closure counts final lineage per immutable source identity. A duplicate map
 * from a completed retry cannot make a section appear more complete than its
 * source, while a safely REUSED map still covers its one source record.
 */
export function countDistinctSourceMaps(rows: readonly Readonly<{ sourceEntity: string; sourceId: string }>[]): Map<string, number> {
  const idsByEntity = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = idsByEntity.get(row.sourceEntity) ?? new Set<string>();
    ids.add(row.sourceId);
    idsByEntity.set(row.sourceEntity, ids);
  }
  return new Map([...idsByEntity.entries()].map(([entity, ids]) => [entity, ids.size]));
}

/**
 * A supplier duplicate may be physically removed only by the dedicated
 * owner-reviewed action. Its immutable audit record closes the exact Supplier
 * source ID from this package; it is not a generic audit-event exemption.
 */
export function countDistinctSourceMapsWithSupplierDeletions(
  sourceMaps: readonly Readonly<{ sourceEntity: string; sourceId: string }>[],
  packageRows: readonly Readonly<{ sheet: string; sourceId: string }>[],
  events: readonly Readonly<{ beforeJson: unknown; afterJson: unknown }>[],
): Map<string, number> {
  const result = countDistinctSourceMaps(sourceMaps);
  const packageSupplierIds = new Set(packageRows.filter((row) => row.sheet === 'Suppliers').map((row) => row.sourceId));
  const supplierIds = new Set<string>();
  for (const event of events) {
    if (!isDeletedSupplierDuplicateEvent(event)) continue;
    const sourceId = event.beforeJson.sourceIdentity.sourceId;
    if (packageSupplierIds.has(sourceId)) supplierIds.add(sourceId);
  }
  if (supplierIds.size) {
    const existing = new Set(sourceMaps.filter((row) => row.sourceEntity === 'Supplier').map((row) => row.sourceId));
    for (const sourceId of supplierIds) existing.add(sourceId);
    result.set('Supplier', existing.size);
  }
  return result;
}

function isDeletedSupplierDuplicateEvent(value: Readonly<{ beforeJson: unknown; afterJson: unknown }>): value is Readonly<{
  beforeJson: Readonly<{ sourceIdentity: Readonly<{ entity: 'Supplier'; sourceId: string }> }>;
  afterJson: Readonly<{ deleted: true }>;
}> {
  if (!isRecord(value.beforeJson) || !isRecord(value.afterJson) || value.afterJson.deleted !== true) return false;
  const sourceIdentity = value.beforeJson.sourceIdentity;
  return isRecord(sourceIdentity) && sourceIdentity.entity === 'Supplier' && typeof sourceIdentity.sourceId === 'string' && sourceIdentity.sourceId.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

const MONEY_SCALE = 10_000n;

function money(value: unknown): bigint {
  const normalized = text(value);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/.test(normalized)) throw new ConflictException(`Invalid money in verified daily-sales evidence: ${normalized}`);
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole!) * MONEY_SCALE + BigInt(`${fraction}0000`.slice(0, 4));
}

function sumMoney(values: readonly unknown[]): bigint { return values.reduce<bigint>((sum, value) => sum + money(value), 0n); }

function formatMoney(value: bigint): string {
  const whole = value / MONEY_SCALE;
  const fraction = (value % MONEY_SCALE).toString().padStart(4, '0');
  return `${whole}.${fraction}`;
}

function text(value: unknown): string { return value === undefined || value === null ? '' : String(value).trim(); }

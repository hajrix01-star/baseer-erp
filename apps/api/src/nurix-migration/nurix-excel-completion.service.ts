import { Injectable, NotFoundException } from '@nestjs/common';

import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { DatabaseService } from '../database/database.service.js';

type ChecklistState = 'COMPLETED' | 'PENDING' | 'ARCHIVE_REQUIRED' | 'REVIEW_REQUIRED' | 'NOT_APPLICABLE';

export type NurixExcelCompletionChecklist = Readonly<{
  packageId: string;
  targetCompanyId: string;
  readyToUnlock: boolean;
  completedSections: number;
  outstandingSections: number;
  sections: ReadonlyArray<Readonly<{
    sheet: string;
    nameAr: string;
    sourceRows: number;
    importedRows: number;
    state: ChecklistState;
    writer: string;
    nextActionAr: string;
  }>>;
}>;

const sections = [
  ['Manifest', 'تعريف الحزمة', 'package-intake'],
  ['Accounts', 'دليل الحسابات', 'master-data-writer'],
  ['Categories', 'التصنيفات المالية', 'master-data-writer'],
  ['Suppliers', 'الموردون', 'supplier-writer'],
  ['Vaults', 'الخزائن وقنوات التحصيل', 'vault-writer'],
  ['Employees', 'الموظفون', 'master-data-writer'],
  ['Invoices', 'فواتير المشتريات والمصروفات', 'outflow-writer'],
  ['InvoiceAllocations', 'توزيعات مدفوعات الفواتير', 'outflow-writer'],
  ['LedgerEntries', 'القيود المحاسبية المصدرية', 'outflow-writer'],
  ['RecurringExpenseProfiles', 'ملفات المصروفات الدورية', 'recurring-profile-writer'],
  ['RecurringExpensePayments', 'دفعات المصروفات الدورية', 'recurring-payment-writer'],
  ['EmployeeServices', 'خدمات الموظفين', 'employee-service-writer'],
  ['EmployeeDeductions', 'خصومات الموظفين', 'employee-deduction-writer'],
  ['EmployeeMovements', 'حركات الموظفين', 'employee-movement-writer'],
  ['DailySalesClosings', 'تقفيلات المبيعات', 'daily-sales-writer'],
  ['DailySalesAllocations', 'توزيعات تحصيلات المبيعات', 'daily-sales-writer'],
  ['BankStatements', 'كشوفات البنك', 'evidence-archive'],
  ['BankTransactions', 'حركات البنك', 'evidence-archive'],
  ['VatPlanning', 'تخطيط ضريبة القيمة المضافة', 'vat-evidence-writer'],
  ['Assets', 'الأصول والضمانات', 'asset-evidence-writer'],
  ['CategoryAudit', 'دليل مطابقة التصنيفات', 'migration-audit'],
  ['Exceptions', 'استثناءات المصدر', 'migration-exception-writer'],
] as const;

/**
 * A completion gate, not a preflight report.  It derives each line from the
 * immutable package receipts and actual writer receipts, so an accepted Excel
 * row is never presented as imported merely because validation succeeded.
 */
@Injectable()
export class NurixExcelCompletionService {
  constructor(private readonly database: DatabaseService) {}

  async checklist(context: TrustedTenantAdministratorContext, packageId: string): Promise<NurixExcelCompletionChecklist> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const packageRow = await tx.nurixExcelStagingPackage.findFirst({
        where: { id: packageId, tenantId: context.tenantId },
        select: { id: true, targetCompanyId: true },
      });
      if (!packageRow) throw new NotFoundException('The verified Noorix package was not found.');

      const [sourceRows, masterItems, financialItems, sourceMaps] = await Promise.all([
        tx.nurixExcelStagingRow.findMany({
          where: { packageId, tenantId: context.tenantId, status: 'ACCEPTED' },
          select: { sheet: true },
        }),
        tx.nurixExcelMasterDataItem.findMany({
          where: { tenantId: context.tenantId, execution: { packageId } },
          select: { entity: true, status: true },
        }),
        tx.nurixExcelFinancialItem.findMany({
          where: { tenantId: context.tenantId, execution: { packageId } },
          select: { sourceEntity: true, status: true },
        }),
        tx.nurixExcelFinancialSourceMap.findMany({
          where: { tenantId: context.tenantId, execution: { packageId } },
          select: { sourceEntity: true, state: true },
        }),
      ]);
      const source = countBy(sourceRows, (row) => row.sheet);
      const master = countBy(masterItems.filter((row) => row.status === 'CREATED' || row.status === 'REUSED'), (row) => row.entity);
      const posted = countBy(financialItems.filter((row) => row.status === 'POSTED' || row.status === 'REUSED'), (row) => row.sourceEntity);
      const mapped = countBy(sourceMaps.filter((row) => row.state === 'APPLIED' || row.state === 'REVERSED'), (row) => row.sourceEntity);
      const count = (sheet: string) => source.get(sheet) ?? 0;
      const written = (sheet: string) => {
        if (sheet === 'Accounts') return master.get('ACCOUNT') ?? 0;
        if (sheet === 'Categories') return master.get('CATEGORY') ?? 0;
        if (sheet === 'Employees') return master.get('EMPLOYEE') ?? 0;
        if (sheet === 'Invoices') return Math.max(posted.get('Invoice') ?? 0, mapped.get('Invoice') ?? 0);
        if (sheet === 'LedgerEntries') return mapped.get('LedgerEntry') ?? 0;
        if (sheet === 'DailySalesClosings') return mapped.get('DailySalesClosing') ?? 0;
        if (sheet === 'DailySalesAllocations') return mapped.get('DailySalesAllocation') ?? 0;
        // Allocations are posted atomically with their invoice and must not be
        // reported separately until their own source lineage is written.
        return 0;
      };
      const output = sections.map(([sheet, nameAr, writer]) => {
        const sourceRowsCount = count(sheet);
        const importedRows = sheet === 'Manifest' ? sourceRowsCount : written(sheet);
        const completed = sourceRowsCount === 0 || importedRows >= sourceRowsCount;
        const archiveOnly = ['BankStatements', 'BankTransactions', 'VatPlanning', 'Assets'].includes(sheet);
        const reviewOnly = ['CategoryAudit', 'Exceptions'].includes(sheet);
        const state: ChecklistState = sourceRowsCount === 0 ? 'NOT_APPLICABLE'
          : completed ? 'COMPLETED'
          : archiveOnly ? 'ARCHIVE_REQUIRED'
          : reviewOnly ? 'REVIEW_REQUIRED'
          : 'PENDING';
        const nextActionAr = state === 'COMPLETED' ? 'تمت المطابقة من سجل الكاتب.'
          : state === 'NOT_APPLICABLE' ? 'لا توجد صفوف مصدر لهذا القسم.'
          : state === 'ARCHIVE_REQUIRED' ? 'حفظ الأدلة التاريخية ثم مطابقة إجمالياتها؛ لا تُنشأ قيود تلقائياً.'
          : state === 'REVIEW_REQUIRED' ? 'توثيق نتيجة المراجعة قبل الاعتماد النهائي.'
          : `تشغيل موجة ${writer} ثم مطابقة كل صف مصدر بسجل كتابة.`;
        return { sheet, nameAr, sourceRows: sourceRowsCount, importedRows, state, writer, nextActionAr };
      });
      const outstanding = output.filter((section) => !['COMPLETED', 'NOT_APPLICABLE'].includes(section.state));
      return {
        packageId: packageRow.id,
        targetCompanyId: packageRow.targetCompanyId,
        readyToUnlock: outstanding.length === 0,
        completedSections: output.length - outstanding.length,
        outstandingSections: outstanding.length,
        sections: output,
      };
    });
  }
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const values = new Map<string, number>();
  for (const row of rows) {
    const id = key(row);
    values.set(id, (values.get(id) ?? 0) + 1);
  }
  return values;
}

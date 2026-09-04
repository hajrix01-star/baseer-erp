import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import {
  outputReceiptSchema,
  type OutputReceipt,
  type OutputRequest,
} from '@baseer-erp/contracts';
import {
  renderExcel,
  renderPrintPreviewDocument,
  type ReportSnapshot,
} from '@baseer-erp/output-platform';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BusinessDateService } from '../business-date/business-date.service.js';
import { CompanyContextService } from '../company-context/company-context.service.js';
import { canonicalJson, IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RequestContext } from '../observability/request-context.js';
import { IdempotencyReceiptStatus, Prisma } from '../generated/prisma/client.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { MarketingService } from '../marketing/marketing.service.js';
import { OperationsExecutionService } from '../operations/operations-execution.service.js';

const GENERATE_OPERATION = 'platform.output.generate';
const MAX_INLINE_ARTIFACT_BYTES = 5 * 1024 * 1024;
const OUTPUTABLE_PAYROLL_STATUSES = new Set(['APPROVED', 'PARTIALLY_PAID', 'PAID']);

@Injectable()
export class OutputService {
  constructor(
    private readonly database: DatabaseService,
    private readonly businessDate: BusinessDateService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
    private readonly attendance: AttendanceService,
    private readonly marketing: MarketingService,
    private readonly operations: OperationsExecutionService,
  ) {}

  async generate(input: {
    accessToken: string;
    companyId: string;
    reportCode: string;
    request: OutputRequest;
  }): Promise<OutputReceipt> {
    const capability = input.request.format === 'preview'
      ? 'platform.output.preview'
      : 'platform.output.export';
    const domainCapabilities = input.reportCode.startsWith('hr.payroll') ? ['hr.payroll.read']
      : input.reportCode === 'hr.employee-letter' ? ['hr.employee_letters.read']
        : input.reportCode === 'hr.final-settlement' ? ['hr.final_settlements.read']
          : input.reportCode === 'hr.attendance-weekly-roster' ? ['attendance.manage']
            : input.reportCode === 'operations.purchase-custody-reports' ? ['operations.purchase_request.read', 'operations.custody.read']
              : input.reportCode === 'marketing.performance-calendar' ? ['marketing.insights.read']
              : [];
    const context = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [capability, ...domainCapabilities],
    });
    const trusted: TrustedCompanyActorContext = {
      tenantId: context.principal.tenantId,
      companyId: context.company.id,
      actorUserId: context.principal.userId,
    };
    if (input.reportCode === 'hr.attendance-weekly-roster') await this.attendance.assertManagementAuthority(trusted);

    return this.database.inTenantTransaction(trusted.tenantId, async (transaction) => {
      let begun;
      try {
        begun = await this.idempotency.beginInTransaction(transaction, trusted, {
          operation: GENERATE_OPERATION,
          key: input.request.idempotencyKey,
          request: {
            reportCode: input.reportCode,
            companyId: trusted.companyId,
            format: input.request.format,
            locale: input.request.locale,
            filters: input.request.filters,
          },
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        });
      } catch (error) {
        if (error instanceof IdempotencyPayloadMismatchError) {
          throw new ConflictException('The idempotency key was used with a different output request.');
        }
        throw error;
      }
      if (begun.kind === 'in-progress') {
        throw new ConflictException('An output request with this idempotency key is still in progress.');
      }
      if (begun.kind === 'replay') {
        const replay = outputReceiptSchema.safeParse({ ...(begun.response.body as object), replayed: true });
        if (!replay.success) throw new ConflictException('The stored output receipt is invalid.');
        await this.writeAudit(transaction, trusted, 'output.replayed', replay.data);
        return replay.data;
      }

      await this.writeAudit(transaction, trusted, 'output.requested', {
        reportCode: input.reportCode,
        format: input.request.format,
        idempotencyReceiptId: begun.receiptId,
      });
      const snapshot = await this.createSnapshot(transaction, trusted, input.reportCode, input.request);
      const receipt = await this.renderReceipt(snapshot, input.request, begun.receiptId);
      await this.writeAudit(transaction, trusted, 'output.generated', {
        snapshotId: receipt.snapshotId,
        reportCode: receipt.reportCode,
        format: receipt.format,
        contentSha256: contentHash(receipt.content),
      });
      await this.writeAudit(
        transaction,
        trusted,
        input.request.format === 'xlsx' ? 'output.download_issued' : 'output.preview_issued',
        { snapshotId: receipt.snapshotId, format: receipt.format },
      );
      await this.idempotency.completeInTransaction(transaction, trusted, {
        receiptId: begun.receiptId,
        response: { status: 200, headers: null, body: receipt },
      });
      return receipt;
    });
  }

  async recordPrintIssued(input: {
    accessToken: string;
    companyId: string;
    idempotencyReceiptId: string;
  }): Promise<Readonly<{ readonly issued: true }>> {
    const context = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: ['platform.output.preview'],
    });
    const trusted: TrustedCompanyActorContext = {
      tenantId: context.principal.tenantId,
      companyId: context.company.id,
      actorUserId: context.principal.userId,
    };
    return this.database.inTenantTransaction(trusted.tenantId, async (transaction) => {
      const receipt = await transaction.idempotencyReceipt.findFirst({
        where: {
          id: input.idempotencyReceiptId,
          tenantId: trusted.tenantId,
          companyId: trusted.companyId,
          actorUserId: trusted.actorUserId,
          operation: GENERATE_OPERATION,
          status: IdempotencyReceiptStatus.COMPLETED,
        },
        select: { responseBody: true },
      });
      const output = outputReceiptSchema.safeParse(receipt?.responseBody);
      if (!output.success || output.data.format !== 'preview') {
        throw new NotFoundException('The preview receipt was not found.');
      }
      await this.writeAudit(transaction, trusted, 'output.print_issued', {
        snapshotId: output.data.snapshotId,
        idempotencyReceiptId: input.idempotencyReceiptId,
      });
      return { issued: true };
    });
  }

  private async createSnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    reportCode: string,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    if (reportCode === 'hr.attendance-weekly-roster') return this.createAttendanceWeeklyRosterSnapshot(transaction, context, request);
    if (reportCode === 'hr.payroll-run') {
      return this.createPayrollRunSnapshot(transaction, context, request);
    }
    if (reportCode === 'hr.payroll-signature-slips') {
      if (request.format !== 'preview') throw new BadRequestException('Payroll signature slips are print-only.');
      return this.createPayrollSignatureSlipsSnapshot(transaction, context, request);
    }
    if (reportCode === 'hr.payroll-runs') {
      return this.createPayrollRunsSnapshot(transaction, context, request);
    }
    if (reportCode === 'hr.employee-letter') {
      return this.createEmployeeLetterSnapshot(transaction, context, request);
    }
    if (reportCode === 'hr.final-settlement') {
      return this.createFinalSettlementSnapshot(transaction, context, request);
    }
    if (reportCode === 'operations.purchase-custody-reports') {
      return this.createOperationsPurchaseCustodySnapshot(transaction, context, request);
    }
    if (reportCode === 'marketing.performance-calendar') {
      return this.createMarketingPerformanceCalendarSnapshot(transaction, context, request);
    }
    if (reportCode !== 'platform.company-context') {
      throw new NotFoundException('The requested output definition was not found.');
    }
    if (Object.keys(request.filters).length > 0) {
      throw new BadRequestException('This output definition does not accept filters.');
    }
    const dateResolution = await this.businessDate.resolveInTransaction(transaction, context);
    const company = await transaction.company.findFirst({
      where: { id: context.companyId, tenantId: context.tenantId },
      select: { id: true, nameAr: true, nameEn: true, businessTimezone: true, status: true, branding: { select: { logoFileMetadataId: true } } },
    });
    if (!company) throw new ForbiddenException('Company output scope is not permitted.');

    const arabic = request.locale === 'ar';
    const companyLogoDataUri = await this.readPrintLogo(transaction, context, company.branding?.logoFileMetadataId ?? null);
    return {
      snapshotId: randomUUID(),
      reportCode,
      templateVersion: '2',
      title: arabic ? 'إثبات سياق الشركة' : 'Company Context Proof',
      direction: arabic ? 'rtl' : 'ltr',
      locale: request.locale,
      generatedAtRiyadh: dateResolution.generatedAt,
      companies: [{ id: company.id, name: arabic ? company.nameAr : company.nameEn }],
      companyLogoDataUri,
      periodLabel: arabic ? 'اللقطة الحالية' : 'Current snapshot',
      taxPresentation: 'gross',
      columns: [
        { key: 'name', label: arabic ? 'الشركة' : 'Company', kind: 'text', width: 28 },
        { key: 'timezone', label: arabic ? 'المنطقة الزمنية' : 'Time zone', kind: 'text', width: 22 },
        { key: 'status', label: arabic ? 'الحالة' : 'Status', kind: 'text', width: 16 },
      ],
      rows: [{
        name: arabic ? company.nameAr : company.nameEn,
        timezone: company.businessTimezone,
        status: company.status,
      }],
      sourceLabel: arabic ? 'سجل شركات بصير' : 'Baseer company registry',
    };
  }

  /**
   * A4 output for the read-only operations reports. The snapshot repeats the
   * bounded server reads rather than accepting rows or totals from React.
   */
  private async createOperationsPurchaseCustodySnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    const from = outputBusinessDate(request.filters['from']);
    const to = outputBusinessDate(request.filters['to']);
    if (!from || !to || from > to || Object.keys(request.filters).some((key) => key !== 'from' && key !== 'to')) {
      throw new BadRequestException('Purchase and custody output requires only a valid from and to period.');
    }
    const company = await transaction.company.findFirst({
      where: { id: context.companyId, tenantId: context.tenantId },
      select: { id: true, nameAr: true, nameEn: true, branding: { select: { logoFileMetadataId: true } } },
    });
    if (!company) throw new ForbiddenException('Company output scope is not permitted.');
    const [materials, custody, dateResolution] = await Promise.all([
      this.operations.materialsReceivedReport(context, { from, to, pageSize: 1_000 }),
      this.operations.custodyMonthlyReport(context, { from, to, pageSize: 1_000 }),
      this.businessDate.resolveInTransaction(transaction, context),
    ]);
    const ar = request.locale === 'ar';
    return {
      snapshotId: randomUUID(), reportCode: 'operations.purchase-custody-reports', templateVersion: '1',
      title: ar ? 'تقرير المواد المستلمة والعهدة' : 'Received materials and custody report', direction: ar ? 'rtl' : 'ltr', locale: request.locale,
      generatedAtRiyadh: dateResolution.generatedAt,
      companies: [{ id: company.id, name: ar ? company.nameAr : company.nameEn || company.nameAr }],
      companyLogoDataUri: await this.readPrintLogo(transaction, context, company.branding?.logoFileMetadataId ?? null),
      periodLabel: `${from} — ${to}`, taxPresentation: 'gross',
      columns: [
        { key: 'section', label: ar ? 'القسم' : 'Section', kind: 'text', width: 22 },
        { key: 'item', label: ar ? 'البند' : 'Item', kind: 'text', width: 32 },
        { key: 'unitOrMonth', label: ar ? 'الوحدة / الشهر' : 'Unit / month', kind: 'text', width: 17 },
        { key: 'quantityOrOpening', label: ar ? 'الكمية / الافتتاحي' : 'Quantity / opening', kind: 'amount', width: 18 },
        { key: 'amountOrClosing', label: ar ? 'القيمة / الختامي' : 'Value / closing', kind: 'amount', width: 18 },
      ],
      rows: [
        ...materials.materials.map((row) => ({
          section: ar ? 'المواد المستلمة' : 'Received materials', item: ar ? row.materialNameAr : row.materialNameEn || row.materialNameAr,
          unitOrMonth: ar ? row.unitNameAr : row.unitNameEn || row.unitNameAr,
          quantityOrOpening: row.quantity, amountOrClosing: row.amount,
        })),
        ...custody.months.map((row) => ({
          section: ar ? 'عهدة المندوب' : 'Representative custody', item: custody.representativeName ?? (ar ? 'غير محدد' : 'Not set'),
          unitOrMonth: row.month, quantityOrOpening: row.openingBalance, amountOrClosing: row.closingBalance,
        })),
      ],
      sourceLabel: ar
        ? `مواد مشتراة مثبتة وعهدة تشغيلية مقيدة بالخادم${custody.representativeName ? ` · ${custody.representativeName}` : ''}`
        : `Server-scoped posted purchase materials and operational custody${custody.representativeName ? ` · ${custody.representativeName}` : ''}`,
    };
  }

  /**
   * This output deliberately reuses MarketingService's server-owned calendar
   * read. It keeps the official-sales quality markers and posted-spend values
   * intact rather than recomputing them from browser state or raw documents.
   */
  private async createMarketingPerformanceCalendarSnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    const from = outputBusinessDate(request.filters['from']);
    const to = outputBusinessDate(request.filters['to']);
    if (!from || !to || from > to || Object.keys(request.filters).some((key) => key !== 'from' && key !== 'to')) {
      throw new BadRequestException('Marketing performance output requires only a valid from and to period.');
    }
    const rangeDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
    if (rangeDays > 365) throw new BadRequestException('Marketing performance output cannot exceed 366 days.');
    const company = await transaction.company.findFirst({
      where: { id: context.companyId, tenantId: context.tenantId },
      select: { id: true, nameAr: true, nameEn: true, branding: { select: { logoFileMetadataId: true } } },
    });
    if (!company) throw new ForbiddenException('Company output scope is not permitted.');
    const [calendar, dateResolution] = await Promise.all([
      this.marketing.calendar(context, { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T00:00:00.000Z`) }),
      this.businessDate.resolveInTransaction(transaction, context),
    ]);
    const ar = request.locale === 'ar';
    return {
      snapshotId: randomUUID(), reportCode: 'marketing.performance-calendar', templateVersion: '1',
      title: ar ? 'تقرير أداء التسويق' : 'Marketing performance report', direction: ar ? 'rtl' : 'ltr', locale: request.locale,
      generatedAtRiyadh: dateResolution.generatedAt,
      companies: [{ id: company.id, name: ar ? company.nameAr : company.nameEn || company.nameAr }],
      companyLogoDataUri: await this.readPrintLogo(transaction, context, company.branding?.logoFileMetadataId ?? null),
      periodLabel: `${from} — ${to}`, taxPresentation: 'gross',
      columns: [
        { key: 'businessDate', label: ar ? 'التاريخ' : 'Date', kind: 'date', width: 14 },
        { key: 'salesQuality', label: ar ? 'جودة المبيعات' : 'Sales quality', kind: 'text', width: 15 },
        { key: 'officialGrossSales', label: ar ? 'المبيعات الرسمية (شامل الضريبة)' : 'Official sales (VAT incl.)', kind: 'amount', width: 20 },
        { key: 'linkedActualSpend', label: ar ? 'الإنفاق المرتبط المثبت' : 'Posted linked spend', kind: 'amount', width: 18 },
        { key: 'purchaseOutflows', label: ar ? 'مدفوعات المشتريات' : 'Purchase outflows', kind: 'amount', width: 17 },
        { key: 'financialOutflows', label: ar ? 'إجمالي التدفقات الخارجة' : 'Financial outflows', kind: 'amount', width: 17 },
      ],
      rows: calendar.days.map((day) => ({
        businessDate: day.businessDate,
        salesQuality: day.salesDayQuality,
        officialGrossSales: day.officialGrossSales,
        linkedActualSpend: day.linkedActualSpend,
        purchaseOutflows: day.purchaseOutflows,
        financialOutflows: day.financialOutflows,
      })),
      sourceLabel: ar
        ? 'مبيعات رسمية شاملة الضريبة وتدفقات مالية مثبّتة مرتبطة صراحةً بالحملات؛ القراءة وصفية زمنية وليست إثبات عائد أو سببية.'
        : 'VAT-inclusive official sales and explicitly linked posted financial flows; this is a descriptive temporal read, not ROI or causal proof.',
    };
  }

  private async createAttendanceWeeklyRosterSnapshot(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, request: OutputRequest): Promise<ReportSnapshot> {
    if (request.format !== 'preview') throw new BadRequestException('The weekly attendance roster is print-only.');
    const weekStart = typeof request.filters['weekStart'] === 'string' ? request.filters['weekStart'] : null;
    if (!weekStart || Object.keys(request.filters).length !== 1) throw new BadRequestException('The weekly attendance roster requires exactly one weekStart filter.');
    const company = await transaction.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true, branding: { select: { logoFileMetadataId: true } } } });
    if (!company) throw new ForbiddenException('Company output scope is not permitted.');
    const roster = await this.attendance.weeklyRosterPrintSnapshot(transaction, context, weekStart, request.locale);
    const ar = request.locale === 'ar';
    return {
      snapshotId: randomUUID(), reportCode: 'hr.attendance-weekly-roster', templateVersion: '1', template: 'attendance-weekly-roster',
      title: ar ? 'جدول الدوام الأسبوعي للموظفين' : 'Weekly employee work schedule', direction: ar ? 'rtl' : 'ltr', locale: request.locale,
      generatedAtRiyadh: (await this.businessDate.resolveInTransaction(transaction, context)).generatedAt,
      companies: [{ id: company.id, name: ar ? company.nameAr : company.nameEn || company.nameAr }], companyLogoDataUri: await this.readPrintLogo(transaction, context, company.branding?.logoFileMetadataId ?? null),
      periodLabel: `${roster.days[0]!.date} — ${roster.days.at(-1)!.date}`, taxPresentation: 'gross', columns: [], rows: [],
      sourceLabel: ar ? 'خطط الدوام المعتمدة والإجازات المعتمدة' : 'Approved work schedules and approved leave', attendanceWeeklyRoster: { days: roster.days, rows: roster.rows },
    };
  }

  private async createFinalSettlementSnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    if (request.format !== 'preview') throw new BadRequestException('Final-settlement output is A4 preview only in V1.');
    const settlementId = typeof request.filters['settlementId'] === 'string' ? request.filters['settlementId'] : null;
    if (!settlementId || Object.keys(request.filters).length !== 1) throw new BadRequestException('A final-settlement output requires exactly one settlementId filter.');
    const settlement = await transaction.hrFinalSettlement.findFirst({ where: { id: settlementId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!settlement) throw new NotFoundException('The final settlement was not found.');
    if (!['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(settlement.status)) throw new NotFoundException('The final settlement is not available for output.');
    const canonical = canonicalJson(settlement.snapshotJson);
    if (createHash('sha256').update(canonical).digest('hex') !== settlement.snapshotSha256) throw new ConflictException('The immutable final-settlement snapshot failed verification.');
    const source = settlement.snapshotJson as Record<string, unknown>;
    const employee = source['employee'] as Record<string, unknown> | undefined;
    const company = source['company'] as Record<string, unknown> | undefined;
    if (!employee || !company || typeof source['settlementNumber'] !== 'string') throw new ConflictException('The immutable final-settlement snapshot is invalid.');
    const arabic = request.locale === 'ar';
    const employeeName = arabic ? employee['nameAr'] : (employee['nameEn'] || employee['nameAr']);
    const companyName = arabic ? company['nameAr'] : (company['nameEn'] || company['nameAr']);
    const branding = await transaction.companyBranding.findFirst({ where: { companyId: context.companyId, tenantId: context.tenantId }, select: { logoFileMetadataId: true } });
    const dateResolution = await this.businessDate.resolveInTransaction(transaction, context);
    const fields: Array<Record<string, string | number | null>> = [
      { field: arabic ? 'رقم التسوية' : 'Settlement number', value: String(source['settlementNumber']) },
      { field: arabic ? 'الموظف' : 'Employee', value: String(employeeName ?? '') },
      { field: arabic ? 'رقم الموظف' : 'Employee no.', value: String(employee['employeeNumber'] ?? '') },
      { field: arabic ? 'تاريخ الانتهاء' : 'Termination date', value: String(source['terminationDate'] ?? '') },
      { field: arabic ? 'سبب الانتهاء' : 'Termination reason', value: String(source['terminationReason'] ?? '') },
      { field: arabic ? 'أيام الخدمة' : 'Service days', value: String(source['serviceDays'] ?? '') },
      { field: arabic ? 'الأجر المحتسب' : 'Eligible wage', value: String(source['eosWage'] ?? '') },
      { field: arabic ? 'استحقاق نهاية الخدمة' : 'End-of-service entitlement', value: String(source['eosAmount'] ?? '') },
      { field: arabic ? 'استردادات مرتبطة' : 'Referenced recoveries', value: String(source['recoveryAmount'] ?? '') },
      { field: arabic ? 'صافي المستحق' : 'Net payable', value: String(source['netPayableAmount'] ?? '') },
    ];
    return { snapshotId: randomUUID(), reportCode: 'hr.final-settlement', templateVersion: '1', title: arabic ? 'تسوية نهاية الخدمة' : 'Final settlement', direction: arabic ? 'rtl' : 'ltr', locale: request.locale, generatedAtRiyadh: dateResolution.generatedAt, companies: [{ id: context.companyId, name: String(companyName ?? '') }], companyLogoDataUri: await this.readPrintLogo(transaction, context, branding?.logoFileMetadataId ?? null), periodLabel: `${source['settlementNumber']} · ${source['terminationDate']}`, taxPresentation: 'gross', columns: [{ key: 'field', label: arabic ? 'البيان' : 'Field', kind: 'text', width: 42 }, { key: 'value', label: arabic ? 'القيمة' : 'Value', kind: 'text', width: 58 }], rows: fields, sourceLabel: arabic ? 'تسوية نهاية خدمة معتمدة من بصير' : 'Approved Baseer final settlement' };
  }

  private async createEmployeeLetterSnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    const letterId = typeof request.filters['letterId'] === 'string' ? request.filters['letterId'] : null;
    if (!letterId || Object.keys(request.filters).length !== 1) throw new BadRequestException('An employee-letter output requires exactly one letterId filter.');
    const letter = await transaction.hrEmployeeLetter.findFirst({ where: { id: letterId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!letter) throw new NotFoundException('The issued employee letter was not found.');
    if (letter.status !== 'ISSUED') throw new NotFoundException('The issued employee letter is not available for output.');
    const canonical = canonicalJson(letter.snapshotJson);
    if (createHash('sha256').update(canonical).digest('hex') !== letter.snapshotSha256) throw new ConflictException('The immutable employee-letter snapshot failed verification.');
    const snapshot = letter.snapshotJson as Record<string, unknown>;
    const employee = snapshot['employee'] as Record<string, unknown> | undefined;
    const company = snapshot['company'] as Record<string, unknown> | undefined;
    if (!employee || !company || typeof snapshot['letterNumber'] !== 'string' || typeof snapshot['issuedOn'] !== 'string') throw new ConflictException('The immutable employee-letter snapshot is invalid.');
    const arabic = request.locale === 'ar';
    const employeeName = arabic ? employee['nameAr'] : (employee['nameEn'] || employee['nameAr']);
    const companyName = arabic ? company['nameAr'] : (company['nameEn'] || company['nameAr']);
    const type = letter.letterType === 'SALARY_CERTIFICATE' ? (arabic ? 'تعريف بالراتب' : 'Salary Certificate') : (arabic ? 'شهادة خدمة' : 'Service Certificate');
    const rows: Array<Record<string, string | number | null>> = [
      { field: arabic ? 'رقم الخطاب' : 'Letter number', value: snapshot['letterNumber'] as string },
      { field: arabic ? 'الموظف' : 'Employee', value: String(employeeName ?? '') },
      { field: arabic ? 'رقم الموظف' : 'Employee no.', value: String(employee['employeeNumber'] ?? '') },
      { field: arabic ? 'المسمى الوظيفي' : 'Job title', value: String(employee['jobTitle'] ?? '') },
      { field: arabic ? 'تاريخ التعيين' : 'Hire date', value: String(employee['hireDate'] ?? '') },
      ...(letter.letterType === 'SALARY_CERTIFICATE' ? [{ field: arabic ? 'إجمالي الراتب الشهري' : 'Monthly gross salary', value: typeof snapshot['monthlyGross'] === 'string' ? snapshot['monthlyGross'] : (arabic ? 'غير متاح' : 'Not available') }] : []),
    ];
    const dateResolution = await this.businessDate.resolveInTransaction(transaction, context);
    const branding = await transaction.companyBranding.findFirst({ where: { companyId: context.companyId, tenantId: context.tenantId }, select: { logoFileMetadataId: true } });
    const logo = await this.readPrintLogo(transaction, context, branding?.logoFileMetadataId ?? null);
    return { snapshotId: randomUUID(), reportCode: 'hr.employee-letter', templateVersion: letter.templateVersion, title: type, direction: arabic ? 'rtl' : 'ltr', locale: request.locale, generatedAtRiyadh: dateResolution.generatedAt, companies: [{ id: context.companyId, name: String(companyName ?? '') }], companyLogoDataUri: logo, periodLabel: `${snapshot['letterNumber']} · ${snapshot['issuedOn']}`, taxPresentation: 'gross', columns: [{ key: 'field', label: arabic ? 'البيان' : 'Field', kind: 'text', width: 38 }, { key: 'value', label: arabic ? 'القيمة' : 'Value', kind: 'text', width: 62 }], rows, sourceLabel: arabic ? 'خطاب موظف صادر من بصير' : 'Issued Baseer employee letter' };
  }

  private async createPayrollRunSnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    const payrollRunId = typeof request.filters['payrollRunId'] === 'string' ? request.filters['payrollRunId'] : null;
    if (!payrollRunId || Object.keys(request.filters).length !== 1) throw new BadRequestException('A payroll-run output requires exactly one payrollRunId filter.');
    const run = await transaction.hrPayrollRun.findFirst({
      where: { id: payrollRunId, tenantId: context.tenantId, companyId: context.companyId },
      include: { lines: { orderBy: { employeeNumberSnapshot: 'asc' } } },
    });
    if (!run) throw new NotFoundException('The payroll run was not found.');
    this.assertPayrollRunIsOutputable(run.status);
    return this.payrollSnapshotBase(transaction, context, request, {
      titleAr: `كشف مسير الرواتب ${run.runNumber}`,
      titleEn: `Payroll run ${run.runNumber}`,
      periodAr: `${run.runNumber} · ${date(run.payrollMonth)}`,
      periodEn: `${run.runNumber} · ${date(run.payrollMonth)}`,
      rows: run.lines.map((line) => ({
        employeeNumber: line.employeeNumberSnapshot,
        employee: request.locale === 'ar' ? line.employeeNameArSnapshot : line.employeeNameEnSnapshot ?? line.employeeNameArSnapshot,
        gross: line.grossSalary.toFixed(4), advances: line.advanceSettlementAmount.toFixed(4), deductions: line.administrativeDeductionAmount.toFixed(4), net: line.netPayableAmount.toFixed(4), paid: line.paidAmount.toFixed(4),
      })),
    });
  }

  private async createPayrollRunsSnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    if (Object.keys(request.filters).length > 0) throw new BadRequestException('The payroll register output does not accept filters.');
    const runs = await transaction.hrPayrollRun.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ payrollMonth: 'desc' }, { id: 'desc' }], take: 500 });
    return this.payrollSnapshotBase(transaction, context, request, {
      titleAr: 'سجل مسيرات الرواتب', titleEn: 'Payroll run register', periodAr: 'كل المسيرات المعروضة', periodEn: 'Displayed payroll runs',
      rows: runs.map((run) => ({ number: run.runNumber, month: date(run.payrollMonth), status: run.status, employees: run.employeeCount, gross: run.grossAmount.toFixed(4), advances: run.advanceSettlementAmount.toFixed(4), deductions: run.administrativeDeductionAmount.toFixed(4), net: run.netPayableAmount.toFixed(4), paid: run.paidAmount.toFixed(4) })),
    });
  }

  private async createPayrollSignatureSlipsSnapshot(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
  ): Promise<ReportSnapshot> {
    const payrollRunId = typeof request.filters['payrollRunId'] === 'string' ? request.filters['payrollRunId'] : null;
    if (!payrollRunId || Object.keys(request.filters).length !== 1) throw new BadRequestException('Payroll signature slips require exactly one payrollRunId filter.');
    const run = await transaction.hrPayrollRun.findFirst({
      where: { id: payrollRunId, tenantId: context.tenantId, companyId: context.companyId },
      include: { lines: { orderBy: { employeeNumberSnapshot: 'asc' } } },
    });
    if (!run) throw new NotFoundException('The payroll run was not found.');
    this.assertPayrollRunIsOutputable(run.status);
    const snapshot = await this.payrollSnapshotBase(transaction, context, request, {
      titleAr: `كشوف توقيع مسير الرواتب ${run.runNumber}`,
      titleEn: `Payroll signature slips ${run.runNumber}`,
      periodAr: `${run.runNumber} · ${date(run.payrollMonth)}`,
      periodEn: `${run.runNumber} · ${date(run.payrollMonth)}`,
      rows: [],
    });
    return {
      ...snapshot,
      reportCode: 'hr.payroll-signature-slips',
      templateVersion: '1',
      template: 'payroll-signature-slips',
      payrollSignatureSlips: run.lines.map((line) => ({
        employeeNumber: line.employeeNumberSnapshot,
        employeeName: request.locale === 'ar' ? line.employeeNameArSnapshot : line.employeeNameEnSnapshot ?? line.employeeNameArSnapshot,
        gross: line.grossSalary.toFixed(2),
        advances: line.advanceSettlementAmount.toFixed(2),
        deductions: line.administrativeDeductionAmount.toFixed(2),
        net: line.netPayableAmount.toFixed(2),
        paid: line.paidAmount.toFixed(2),
      })),
    };
  }

  private async payrollSnapshotBase(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: OutputRequest,
    input: { titleAr: string; titleEn: string; periodAr: string; periodEn: string; rows: Array<Record<string, string | number | null>> },
  ): Promise<ReportSnapshot> {
    const company = await transaction.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true, branding: { select: { logoFileMetadataId: true } } } });
    if (!company) throw new ForbiddenException('Company output scope is not permitted.');
    const isDetail = 'employeeNumber' in (input.rows[0] ?? {});
    const arabic = request.locale === 'ar';
    const dateResolution = await this.businessDate.resolveInTransaction(transaction, context);
    return {
      snapshotId: randomUUID(), reportCode: request.filters['payrollRunId'] ? 'hr.payroll-run' : 'hr.payroll-runs', templateVersion: '1', title: arabic ? input.titleAr : input.titleEn, direction: arabic ? 'rtl' : 'ltr', locale: request.locale, generatedAtRiyadh: dateResolution.generatedAt,
      companies: [{ id: company.id, name: arabic ? company.nameAr : company.nameEn }], companyLogoDataUri: await this.readPrintLogo(transaction, context, company.branding?.logoFileMetadataId ?? null), periodLabel: arabic ? input.periodAr : input.periodEn, taxPresentation: 'gross',
      template: isDetail ? 'payroll-run' : 'table', columns: isDetail ? [
        { key: 'employeeNumber', label: arabic ? 'رقم الموظف' : 'Employee no.', kind: 'text', width: 12 }, { key: 'employee', label: arabic ? 'الموظف' : 'Employee', kind: 'text', width: 26 },
        { key: 'gross', label: arabic ? 'إجمالي الراتب' : 'Gross', kind: 'amount' }, { key: 'advances', label: arabic ? 'تسوية السلف' : 'Advances', kind: 'amount' }, { key: 'deductions', label: arabic ? 'الخصم الإداري' : 'Administrative deduction', kind: 'amount' }, { key: 'net', label: arabic ? 'صافي المستحق' : 'Net payable', kind: 'amount' }, { key: 'paid', label: arabic ? 'المدفوع' : 'Paid', kind: 'amount' },
      ] : [
        { key: 'number', label: arabic ? 'رقم المسير' : 'Run no.', kind: 'text', width: 18 }, { key: 'month', label: arabic ? 'الشهر' : 'Month', kind: 'date' }, { key: 'status', label: arabic ? 'الحالة' : 'Status', kind: 'text' }, { key: 'employees', label: arabic ? 'الموظفون' : 'Employees', kind: 'integer' }, { key: 'gross', label: arabic ? 'الإجمالي' : 'Gross', kind: 'amount' }, { key: 'advances', label: arabic ? 'السلف' : 'Advances', kind: 'amount' }, { key: 'deductions', label: arabic ? 'الخصومات' : 'Deductions', kind: 'amount' }, { key: 'net', label: arabic ? 'الصافي' : 'Net', kind: 'amount' }, { key: 'paid', label: arabic ? 'المدفوع' : 'Paid', kind: 'amount' },
      ], rows: input.rows, sourceLabel: arabic ? 'مسيرات الرواتب المعتمدة في بصير' : 'Baseer payroll run records',
    };
  }

  private assertPayrollRunIsOutputable(status: string) {
    if (!OUTPUTABLE_PAYROLL_STATUSES.has(status)) {
      throw new ConflictException('Payroll output is available only for approved, partially paid, or paid runs; draft and reversed runs are excluded.');
    }
  }

  private async readPrintLogo(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    logoFileMetadataId: string | null,
  ): Promise<string | null> {
    if (!logoFileMetadataId) return null;
    const file = await transaction.fileMetadata.findFirst({
      where: { id: logoFileMetadataId, tenantId: context.tenantId, companyId: context.companyId, sourceType: "company.branding", sourceId: context.companyId, purpose: "logo" },
      select: { declaredMimeType: true, storageReference: true },
    });
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.declaredMimeType)) return null;
    if (!/^company-branding\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(png|jpg|webp)$/.test(file.storageReference)) return null;
    const root = resolve(process.env.BASEER_COMPANY_LOGO_STORAGE_ROOT ?? join(process.cwd(), "storage"));
    const target = resolve(root, file.storageReference);
    if (!target.startsWith(`${root}${sep}`)) return null;
    try {
      const bytes = await readFile(target);
      return `data:${file.declaredMimeType};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }
  private async renderReceipt(
    snapshot: ReportSnapshot,
    request: OutputRequest,
    idempotencyReceiptId: string,
  ): Promise<OutputReceipt> {
    if (request.format === 'preview') {
      return outputReceiptSchema.parse({
        idempotencyReceiptId,
        snapshotId: snapshot.snapshotId,
        reportCode: snapshot.reportCode,
        format: 'preview',
        mimeType: 'text/html; charset=utf-8',
        fileName: null,
        contentEncoding: 'utf8',
        content: renderPrintPreviewDocument(snapshot),
        replayed: false,
      });
    }
    const artifact = await renderExcel(snapshot);
    const content = Buffer.from(artifact.bytes).toString('base64');
    if (Buffer.byteLength(content, 'utf8') > MAX_INLINE_ARTIFACT_BYTES) {
      throw new BadRequestException('The generated artifact exceeds the approved inline size limit.');
    }
    return outputReceiptSchema.parse({
      idempotencyReceiptId,
      snapshotId: snapshot.snapshotId,
      reportCode: snapshot.reportCode,
      format: 'xlsx',
      mimeType: artifact.mimeType,
      fileName: artifact.fileName,
      contentEncoding: 'base64',
      content,
      replayed: false,
    });
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    action: string,
    afterJson: Record<string, unknown>,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action,
        entityType: 'OutputArtifact',
        entityId: typeof afterJson['snapshotId'] === 'string' ? afterJson['snapshotId'] : randomUUID(),
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson: afterJson as Prisma.InputJsonValue,
      },
    });
  }
}

function contentHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function date(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function outputBusinessDate(value: string | number | boolean | null | undefined): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

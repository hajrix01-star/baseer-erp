import { createHash, randomUUID } from 'node:crypto';

import type { ReportSnapshot } from '@baseer-erp/output-platform';
import { renderExcel, renderPrintPreviewDocument } from '@baseer-erp/output-platform';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import { LedgerTrialBalanceReportService } from './ledger-trial-balance-report.service.js';
import { InternalVatReportService } from './internal-vat-report.service.js';
import { PersonalCashPerformanceReportService } from './personal-cash-performance-report.service.js';
import { canonicalJson, ReportRunService } from './report-run.service.js';

const MAX_INLINE_ARTIFACT_BYTES = 5 * 1024 * 1024;
type ReportLocale = 'ar' | 'en';
type OutputFormat = 'preview' | 'xlsx';
type ReportCode = 'ledger_trial_balance' | 'personal_cash_performance' | 'internal_vat_report';

/**
 * Owns the optional, user-retained report-document library. It never accepts
 * report rows from the browser: snapshots are rebuilt from the frozen run and
 * then persisted immutably for later rendering.
 */
@Injectable()
export class ReportDocumentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reportRuns: ReportRunService,
    private readonly trialBalance: LedgerTrialBalanceReportService,
    private readonly cashPerformance: PersonalCashPerformanceReportService,
    private readonly internalVat: InternalVatReportService,
  ) {}

  async create(context: TrustedCompanyActorContext, input: { reportRunId: string; locale: ReportLocale }) {
    const existing = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.reportDocument.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, reportRunId: input.reportRunId, createdByUserId: context.actorUserId, locale: input.locale },
    }));
    if (existing) return this.receipt(existing, true, input.locale);

    const snapshot = await this.snapshotForRun(context, input.reportRunId, input.locale);
    const reportCode = reportCodeOf(snapshot.reportCode);
    const id = randomUUID();
    const frozenSnapshot: ReportSnapshot = { ...snapshot, snapshotId: id };
    const snapshotJson = canonicalJson(JSON.parse(JSON.stringify(frozenSnapshot)) as Prisma.InputJsonValue);
    const snapshotChecksum = hash(snapshotJson);
    const titles = reportTitles(reportCode);
    try {
      const document = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
        const created = await transaction.reportDocument.create({ data: {
          id, tenantId: context.tenantId, companyId: context.companyId, reportRunId: input.reportRunId, reportCode,
          locale: input.locale, titleAr: titles.ar, titleEn: titles.en, snapshotJson, snapshotChecksum, createdByUserId: context.actorUserId,
        } });
        await transaction.auditEvent.create({ data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: 'reports.document.created', entityType: 'ReportDocument', entityId: created.id,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          afterJson: { reportRunId: created.reportRunId, reportCode: created.reportCode, locale: created.locale, snapshotChecksum: created.snapshotChecksum } as Prisma.InputJsonValue,
        } });
        return created;
      });
      return this.receipt(document, false, input.locale);
    } catch (error) {
      // The unique key makes an explicit second click safely reuse the same
      // saved document rather than duplicating a reporting artifact.
      const document = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.reportDocument.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, reportRunId: input.reportRunId, createdByUserId: context.actorUserId, locale: input.locale },
      }));
      if (document) return this.receipt(document, true, input.locale);
      throw error;
    }
  }

  async list(context: TrustedCompanyActorContext, locale: ReportLocale) {
    const documents = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.reportDocument.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, createdByUserId: context.actorUserId },
      orderBy: { createdAt: 'desc' }, take: 500,
    }));
    return { documents: documents.map((document) => this.receipt(document, false, locale)) };
  }

  async renderRun(context: TrustedCompanyActorContext, input: { reportRunId: string; locale: ReportLocale; format: OutputFormat }) {
    return this.render(await this.snapshotForRun(context, input.reportRunId, input.locale), input.format);
  }

  async renderDocument(context: TrustedCompanyActorContext, documentId: string, format: OutputFormat) {
    const document = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.reportDocument.findFirst({
      where: { id: documentId, tenantId: context.tenantId, companyId: context.companyId, createdByUserId: context.actorUserId },
    }));
    if (!document) throw new NotFoundException('The saved report document was not found.');
    if (hash(document.snapshotJson) !== document.snapshotChecksum) throw new BadRequestException('The saved report document failed integrity verification.');
    return this.render(asSnapshot(document.snapshotJson), format);
  }

  private async snapshotForRun(context: TrustedCompanyActorContext, reportRunId: string, locale: ReportLocale): Promise<ReportSnapshot> {
    const run = await this.reportRuns.findReady(context, reportRunId);
    switch (reportCodeOf(run.reportCode)) {
      case 'ledger_trial_balance': return this.trialBalance.snapshotForDocument(context, reportRunId, locale);
      case 'personal_cash_performance': return this.cashPerformance.snapshotForDocument(context, reportRunId, locale);
      case 'internal_vat_report': return this.internalVat.snapshotForDocument(context, reportRunId, locale);
    }
  }

  private async render(snapshot: ReportSnapshot, format: OutputFormat) {
    if (format === 'preview') return {
      snapshotId: snapshot.snapshotId, reportCode: reportCodeOf(snapshot.reportCode), format,
      mimeType: 'text/html; charset=utf-8', fileName: null, contentEncoding: 'utf8' as const,
      content: renderPrintPreviewDocument(snapshot),
    };
    const artifact = await renderExcel(snapshot);
    const content = Buffer.from(artifact.bytes).toString('base64');
    if (Buffer.byteLength(content, 'utf8') > MAX_INLINE_ARTIFACT_BYTES) throw new BadRequestException('The generated report document exceeds the approved download size.');
    return {
      snapshotId: snapshot.snapshotId, reportCode: reportCodeOf(snapshot.reportCode), format,
      mimeType: artifact.mimeType, fileName: artifact.fileName, contentEncoding: 'base64' as const, content,
    };
  }

  private receipt(document: { id: string; reportRunId: string; reportCode: string; titleAr: string; titleEn: string; locale: string; createdAt: Date }, reused: boolean, language: ReportLocale) {
    return { id: document.id, reportRunId: document.reportRunId, reportCode: reportCodeOf(document.reportCode), title: language === 'ar' ? document.titleAr : document.titleEn, locale: document.locale as ReportLocale, createdAt: document.createdAt.toISOString(), reused };
  }
}

function reportCodeOf(value: string): ReportCode {
  if (value === 'ledger_trial_balance' || value === 'personal_cash_performance' || value === 'internal_vat_report') return value;
  throw new NotFoundException('The report does not support saved report documents.');
}
function reportTitles(code: ReportCode) { return code === 'ledger_trial_balance' ? { ar: 'ميزان المراجعة', en: 'Trial Balance' } : code === 'personal_cash_performance' ? { ar: 'الربح والخسارة المالي', en: 'Financial profit and loss' } : { ar: 'التقرير الضريبي الداخلي', en: 'Internal VAT report' }; }
function hash(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value !== 'object') throw new BadRequestException('The saved report document snapshot is invalid.');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}
function asSnapshot(value: Prisma.JsonValue): ReportSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('The saved report document snapshot is invalid.');
  const snapshot = value as unknown as ReportSnapshot;
  if (!snapshot.snapshotId || !snapshot.reportCode || !snapshot.title || !snapshot.locale || !Array.isArray(snapshot.columns) || !Array.isArray(snapshot.rows)) throw new BadRequestException('The saved report document snapshot is invalid.');
  return snapshot;
}

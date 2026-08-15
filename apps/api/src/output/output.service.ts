import { createHash, randomUUID } from 'node:crypto';

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
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RequestContext } from '../observability/request-context.js';
import { IdempotencyReceiptStatus, Prisma } from '../generated/prisma/client.js';

const GENERATE_OPERATION = 'platform.output.generate';
const MAX_INLINE_ARTIFACT_BYTES = 5 * 1024 * 1024;

@Injectable()
export class OutputService {
  constructor(
    private readonly database: DatabaseService,
    private readonly businessDate: BusinessDateService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
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
    const context = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [capability],
    });
    const trusted: TrustedCompanyActorContext = {
      tenantId: context.principal.tenantId,
      companyId: context.company.id,
      actorUserId: context.principal.userId,
    };

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
    if (reportCode !== 'platform.company-context') {
      throw new NotFoundException('The requested output definition was not found.');
    }
    if (Object.keys(request.filters).length > 0) {
      throw new BadRequestException('This output definition does not accept filters.');
    }
    const dateResolution = await this.businessDate.resolveInTransaction(transaction, context);
    const company = await transaction.company.findFirst({
      where: { id: context.companyId, tenantId: context.tenantId },
      select: { id: true, nameAr: true, nameEn: true, businessTimezone: true, status: true },
    });
    if (!company) throw new ForbiddenException('Company output scope is not permitted.');

    const arabic = request.locale === 'ar';
    return {
      snapshotId: randomUUID(),
      reportCode,
      templateVersion: '1',
      title: arabic ? 'إثبات سياق الشركة' : 'Company Context Proof',
      direction: arabic ? 'rtl' : 'ltr',
      locale: request.locale,
      generatedAtRiyadh: dateResolution.generatedAt,
      companies: [{ id: company.id, name: arabic ? company.nameAr : company.nameEn }],
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

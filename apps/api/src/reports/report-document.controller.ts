import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { createReportDocumentRequestSchema, renderReportDocumentRequestSchema, renderReportRunRequestSchema, reportDocumentArtifactSchema, reportDocumentListSchema, reportDocumentReceiptSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { REPORTS_READ_CAPABILITY } from './report-catalog.service.js';
import { ReportDocumentService } from './report-document.service.js';

@Controller('reports/documents')
export class ReportDocumentController {
  constructor(private readonly contexts: CompanyContextService, private readonly documents: ReportDocumentService) {}

  @Get()
  async list(@Query('locale') locale: string | undefined, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const language = locale === 'en' ? 'en' : 'ar';
    return reportDocumentListSchema.parse(await this.documents.list(await this.context(authorization, companyId, []), language));
  }

  @Post()
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const input = createReportDocumentRequestSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('Invalid report-document request.');
    return reportDocumentReceiptSchema.parse(await this.documents.create(await this.context(authorization, companyId, []), input.data));
  }

  @Post('render')
  @HttpCode(200)
  async renderRun(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const input = renderReportRunRequestSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('Invalid report rendering request.');
    return reportDocumentArtifactSchema.parse(await this.documents.renderRun(await this.context(authorization, companyId, [outputCapability(input.data.format)]), input.data));
  }

  @Post(':documentId/render')
  @HttpCode(200)
  async renderDocument(@Param('documentId') documentId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const input = renderReportDocumentRequestSchema.safeParse(body);
    if (!input.success || !/^[0-9a-f-]{36}$/i.test(documentId)) throw new BadRequestException('Invalid saved report-document rendering request.');
    return reportDocumentArtifactSchema.parse(await this.documents.renderDocument(await this.context(authorization, companyId, [outputCapability(input.data.format)]), documentId, input.data.format));
  }

  private async context(authorization: string | undefined, companyId: string | undefined, additional: readonly string[]) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [REPORTS_READ_CAPABILITY, ...additional] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}
function outputCapability(format: 'preview' | 'xlsx') { return format === 'preview' ? 'platform.output.preview' : 'platform.output.export'; }

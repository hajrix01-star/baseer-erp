import { BadRequestException, Controller, ForbiddenException, Get, Headers, Param, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { companyIdSchema, internalVatReportEvidenceQuerySchema, internalVatReportEvidenceReceiptSchema, internalVatReportRequestSchema, internalVatReportResultSchema, personalCashPerformanceSourceReceiptSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { REPORTS_READ_CAPABILITY } from './report-catalog.service.js';
import { InternalVatReportService } from './internal-vat-report.service.js';

@Controller('reports/internal-vat')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ authIp: true, authIdentity: true, output: true, fileWrite: true, attendancePin: true })
@Throttle({ report: { limit: 60, ttl: 60_000, blockDuration: 60_000 } })
export class InternalVatReportController {
  constructor(private readonly contexts: CompanyContextService, private readonly report: InternalVatReportService) {}

  @Get()
  async run(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Query('months') months: string | undefined, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = internalVatReportRequestSchema.safeParse({ from, to, ...(months ? { months: months.split(',') } : {}) });
    if (!parsed.success) throw new BadRequestException('Invalid internal VAT report request.');
    return internalVatReportResultSchema.parse(await this.report.run(await this.context(authorization, companyId), { from: businessDate(parsed.data.from), to: businessDate(parsed.data.to), ...(parsed.data.months ? { months: parsed.data.months } : {}) }));
  }

  @Get(':reportRunId/evidence')
  async evidence(@Param('reportRunId') reportRunId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    if (!companyIdSchema.safeParse(reportRunId).success) throw new BadRequestException('Invalid report run.');
    const parsed = internalVatReportEvidenceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid VAT evidence request.');
    return internalVatReportEvidenceReceiptSchema.parse(await this.report.evidence(await this.context(authorization, companyId), reportRunId, parsed.data.rowCode, parsed.data.cursor));
  }

  @Get(':reportRunId/evidence/:lineId/source')
  async source(@Param('reportRunId') reportRunId: string, @Param('lineId') lineId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    if (!companyIdSchema.safeParse(reportRunId).success || !companyIdSchema.safeParse(lineId).success) throw new BadRequestException('Invalid VAT source request.');
    return personalCashPerformanceSourceReceiptSchema.parse(await this.report.sourceJournal(await this.context(authorization, companyId), reportRunId, lineId));
  }

  private async context(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [REPORTS_READ_CAPABILITY] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

function businessDate(value: string) { const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid business date.'); return date; }

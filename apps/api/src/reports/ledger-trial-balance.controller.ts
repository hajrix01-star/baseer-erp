import { BadRequestException, Controller, ForbiddenException, Get, Headers, Param, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { companyIdSchema, ledgerTrialBalanceEvidenceQuerySchema, ledgerTrialBalanceEvidenceReceiptSchema, ledgerTrialBalanceRequestSchema, ledgerTrialBalanceResultSchema, ledgerTrialBalanceSourceReceiptSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { REPORTS_READ_CAPABILITY } from './report-catalog.service.js';
import { LedgerTrialBalanceReportService } from './ledger-trial-balance-report.service.js';

@Controller('reports/ledger-trial-balance')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ authIp: true, authIdentity: true, output: true, fileWrite: true })
@Throttle({ report: { limit: 60, ttl: 60_000, blockDuration: 60_000 } })
export class LedgerTrialBalanceController {
  constructor(private readonly contexts: CompanyContextService, private readonly trialBalance: LedgerTrialBalanceReportService) {}

  @Get()
  async run(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Query('includeZeroRows') includeZeroRows: string | undefined, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = ledgerTrialBalanceRequestSchema.safeParse({ from, to, includeZeroRows: parseBoolean(includeZeroRows, false) });
    if (!parsed.success) throw new BadRequestException('Invalid Ledger Trial Balance request.');
    return ledgerTrialBalanceResultSchema.parse(await this.trialBalance.run(await this.context(authorization, companyId), { from: businessDate(parsed.data.from), to: businessDate(parsed.data.to), includeZeroRows: parsed.data.includeZeroRows }));
  }

  @Get(':reportRunId/evidence')
  async evidence(@Param('reportRunId') reportRunId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    if (!companyIdSchema.safeParse(reportRunId).success) throw new BadRequestException('Invalid report run.');
    const parsed = ledgerTrialBalanceEvidenceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid Ledger Trial Balance evidence request.');
    return ledgerTrialBalanceEvidenceReceiptSchema.parse(await this.trialBalance.evidence(await this.context(authorization, companyId), reportRunId, parsed.data.accountId, parsed.data.scope, parsed.data.cursor));
  }

  @Get(':reportRunId/evidence/:lineId/source')
  async source(@Param('reportRunId') reportRunId: string, @Param('lineId') lineId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    if (!companyIdSchema.safeParse(reportRunId).success || !companyIdSchema.safeParse(lineId).success) throw new BadRequestException('Invalid report source request.');
    const parsed = ledgerTrialBalanceEvidenceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid report source scope.');
    return ledgerTrialBalanceSourceReceiptSchema.parse(await this.trialBalance.source(await this.context(authorization, companyId), reportRunId, lineId, parsed.data.accountId, parsed.data.scope));
  }

  private async context(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [REPORTS_READ_CAPABILITY] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

function businessDate(value: string) { const parsed = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid business date.'); return parsed; }
function parseBoolean(value: string | undefined, fallback: boolean) { if (value === undefined) return fallback; if (value === 'true') return true; if (value === 'false') return false; throw new BadRequestException('includeZeroRows must be true or false.'); }

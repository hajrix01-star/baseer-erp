import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Put, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { vatSimulationDeleteReceiptSchema, vatSimulationIdSchema, vatSimulationListReceiptSchema, vatSimulationQuerySchema, vatSimulationReceiptSchema, vatSimulationSaveSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { REPORTS_READ_CAPABILITY } from './report-catalog.service.js';
import { VatSimulationService } from './vat-simulation.service.js';

@Controller('reports/vat-simulations')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ authIp: true, authIdentity: true, output: true, fileWrite: true, attendancePin: true })
@Throttle({ report: { limit: 60, ttl: 60_000, blockDuration: 60_000 } })
export class VatSimulationController {
  constructor(private readonly contexts: CompanyContextService, private readonly simulations: VatSimulationService) {}

  @Get()
  async list(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = vatSimulationQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException('Invalid VAT simulation period.');
    return vatSimulationListReceiptSchema.parse(await this.simulations.list(await this.context(authorization, companyId), parsed.data.year));
  }

  @Put()
  async save(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = vatSimulationSaveSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid VAT simulation.');
    return vatSimulationReceiptSchema.parse(await this.simulations.save(await this.context(authorization, companyId), parsed.data));
  }

  @Delete(':simulationId')
  async remove(@Param('simulationId') simulationId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = vatSimulationIdSchema.safeParse(simulationId); if (!parsed.success) throw new BadRequestException('Invalid VAT simulation.');
    return vatSimulationDeleteReceiptSchema.parse(await this.simulations.remove(await this.context(authorization, companyId), parsed.data));
  }

  private async context(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [REPORTS_READ_CAPABILITY] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

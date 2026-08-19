import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { companyIdSchema, hrEmployeeLetterReceiptSchema, hrEmployeeLettersReceiptSchema, issueHrEmployeeLetterRequestSchema, revokeHrEmployeeLetterRequestSchema } from '@baseer-erp/contracts';
import { CompanyContextService } from '../company-context/company-context.service.js';
import { HrEmployeeLetterService } from './hr-employee-letter.service.js';

@Controller('hr')
export class HrEmployeeLetterController {
  constructor(private readonly companyContext: CompanyContextService, private readonly letters: HrEmployeeLetterService) {}
  @Get('employees/:employeeId/letters')
  async list(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) { const context = await this.authorize(authorization, companyId, 'hr.employee_letters.read'); return hrEmployeeLettersReceiptSchema.parse({ companyId: context.companyId, ...(await this.letters.list(context, employeeId)) }); }
  @Post('employees/:employeeId/letters/issue') @HttpCode(201)
  async issue(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) { const parsed = issueHrEmployeeLetterRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-letter issue request.'); const context = await this.authorize(authorization, companyId, 'hr.employee_letters.issue'); return hrEmployeeLetterReceiptSchema.parse(await this.letters.issue(context, employeeId, parsed.data)); }
  @Post('employee-letters/:letterId/revoke')
  @HttpCode(200)
  async revoke(@Param('letterId', ParseUUIDPipe) letterId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) { const parsed = revokeHrEmployeeLetterRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-letter revoke request.'); const context = await this.authorize(authorization, companyId, 'hr.employee_letters.revoke'); return hrEmployeeLetterReceiptSchema.parse(await this.letters.revoke(context, letterId, parsed.data)); }
  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) { if (!authorization?.startsWith('Bearer ')) throw new BadRequestException('A bearer access token is required.'); const parsed = companyIdSchema.safeParse(companyId); if (!parsed.success) throw new BadRequestException('A valid company context is required.'); const context = await this.companyContext.authorize({ accessToken: authorization.slice(7), companyId: parsed.data, requiredCapabilities: [capability] }); return { tenantId: context.principal.tenantId, companyId: context.company.id, actorUserId: context.principal.userId }; }
}

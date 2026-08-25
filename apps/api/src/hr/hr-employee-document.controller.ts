import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { RouteConfig } from '@nestjs/platform-fastify';
import { companyIdSchema, createHrEmployeeDocumentRequestSchema, hrEmployeeDocumentReceiptSchema, hrEmployeeDocumentsQuerySchema, hrEmployeeDocumentsReceiptSchema, replaceHrEmployeeDocumentRequestSchema, revokeHrEmployeeDocumentRequestSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { HrEmployeeDocumentService } from './hr-employee-document.service.js';

@Controller('hr')
export class HrEmployeeDocumentController {
  constructor(private readonly companyContext: CompanyContextService, private readonly documents: HrEmployeeDocumentService) {}

  @Get('employees/:employeeId/documents')
  async list(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeDocumentsQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException('Invalid employee-document query.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.read');
    return hrEmployeeDocumentsReceiptSchema.parse({ companyId: context.companyId, ...(await this.documents.list(context, employeeId, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}), ...(parsed.data.documentType ? { documentType: parsed.data.documentType } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.expiry ? { expiry: parsed.data.expiry } : {}) })) });
  }

  @Post('employees/:employeeId/documents') @HttpCode(201)
  @RouteConfig({ bodyLimit: 8 * 1024 * 1024 })
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ authIp: true, authIdentity: true, report: true, output: true })
  @Throttle({ fileWrite: { limit: 12, ttl: 60_000, blockDuration: 60_000 } })
  async create(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrEmployeeDocumentRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-document request.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.write');
    return hrEmployeeDocumentReceiptSchema.parse(await this.documents.create(context, employeeId, parsed.data));
  }

  @Post('employee-documents/:documentId/versions')
  @HttpCode(200)
  @RouteConfig({ bodyLimit: 8 * 1024 * 1024 })
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ authIp: true, authIdentity: true, report: true, output: true })
  @Throttle({ fileWrite: { limit: 12, ttl: 60_000, blockDuration: 60_000 } })
  async replace(@Param('documentId', ParseUUIDPipe) documentId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = replaceHrEmployeeDocumentRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-document replacement request.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.write');
    return hrEmployeeDocumentReceiptSchema.parse(await this.documents.replace(context, documentId, parsed.data));
  }

  @Post('employee-documents/:documentId/revoke')
  @HttpCode(200)
  async revoke(@Param('documentId', ParseUUIDPipe) documentId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = revokeHrEmployeeDocumentRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-document revoke request.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.revoke');
    return hrEmployeeDocumentReceiptSchema.parse(await this.documents.revoke(context, documentId, parsed.data));
  }

  @Get('employee-document-versions/:versionId/download')
  async download(@Param('versionId', ParseUUIDPipe) versionId: string, @Res() reply: FastifyReply, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.download'); const result = await this.documents.download(context, versionId);
    reply.header('content-type', result.mimeType).header('content-disposition', 'attachment; filename="employee-document"').header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store').send(result.bytes);
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]; if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new ForbiddenException('Company HR scope is not permitted.');
    const context = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] }); return { tenantId: context.principal.tenantId, companyId: context.company.id, actorUserId: context.principal.userId };
  }
}

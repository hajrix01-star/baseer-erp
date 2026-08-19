import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { companyIdSchema, createHrEmployeeDocumentRequestSchema, hrEmployeeDocumentReceiptSchema, hrEmployeeDocumentsQuerySchema, hrEmployeeDocumentsReceiptSchema, replaceHrEmployeeDocumentRequestSchema, revokeHrEmployeeDocumentRequestSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { HrEmployeeDocumentService } from './hr-employee-document.service.js';

@Controller('hr')
export class HrEmployeeDocumentController {
  constructor(private readonly companyContext: CompanyContextService, private readonly documents: HrEmployeeDocumentService) {}

  @Get('employees/:employeeId/documents')
  async list(@Param('employeeId') employeeId: string, @Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = hrEmployeeDocumentsQuerySchema.safeParse(query); if (!parsed.success) throw new BadRequestException('Invalid employee-document query.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.read');
    return hrEmployeeDocumentsReceiptSchema.parse({ companyId: context.companyId, ...(await this.documents.list(context, employeeId, { pageSize: parsed.data.pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}), ...(parsed.data.documentType ? { documentType: parsed.data.documentType } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.expiry ? { expiry: parsed.data.expiry } : {}) })) });
  }

  @Post('employees/:employeeId/documents') @HttpCode(201)
  async create(@Param('employeeId') employeeId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = createHrEmployeeDocumentRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-document request.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.write');
    return hrEmployeeDocumentReceiptSchema.parse(await this.documents.create(context, employeeId, parsed.data));
  }

  @Post('employee-documents/:documentId/versions')
  async replace(@Param('documentId') documentId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = replaceHrEmployeeDocumentRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-document replacement request.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.write');
    return hrEmployeeDocumentReceiptSchema.parse(await this.documents.replace(context, documentId, parsed.data));
  }

  @Post('employee-documents/:documentId/revoke')
  async revoke(@Param('documentId') documentId: string, @Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = revokeHrEmployeeDocumentRequestSchema.safeParse(body); if (!parsed.success) throw new BadRequestException('Invalid employee-document revoke request.');
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.revoke');
    return hrEmployeeDocumentReceiptSchema.parse(await this.documents.revoke(context, documentId, parsed.data));
  }

  @Get('employee-document-versions/:versionId/download')
  async download(@Param('versionId') versionId: string, @Res() reply: FastifyReply, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'hr.employee_documents.download'); const result = await this.documents.download(context, versionId);
    reply.header('content-type', result.mimeType).header('content-disposition', 'attachment; filename="employee-document"').header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store').send(result.bytes);
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    if (!authorization?.startsWith('Bearer ')) throw new BadRequestException('A bearer access token is required.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId); if (!parsedCompanyId.success) throw new BadRequestException('A valid company context is required.');
    const context = await this.companyContext.authorize({ accessToken: authorization.slice(7), companyId: parsedCompanyId.data, requiredCapabilities: [capability] }); return { tenantId: context.principal.tenantId, companyId: context.company.id, actorUserId: context.principal.userId };
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { IssueHrEmployeeLetterRequest, RevokeHrEmployeeLetterRequest } from '@baseer-erp/contracts';

import { BusinessDateService } from '../business-date/business-date.service.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { HrEmployeeLetterStatus, Prisma } from '../generated/prisma/client.js';
import { hrReplayReceipt } from './hr-idempotency.util.js';

const TEMPLATE_VERSION = 'employee-letter-v1';

@Injectable()
export class HrEmployeeLetterService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService, private readonly serials: DocumentSerialService, private readonly businessDate: BusinessDateService) {}

  async list(context: TrustedCompanyActorContext, employeeId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const rows = await tx.hrEmployeeLetter.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId }, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], take: 100 });
      return { letters: rows.map(mapLetter) };
    });
  }

  async issue(context: TrustedCompanyActorContext, employeeId: string, input: IssueHrEmployeeLetterRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, 'hr.employee_letter.issue', input.idempotencyKey, { employeeId, letterType: input.letterType, locale: input.locale, recipient: input.recipient ?? null });
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; letterNumber: string; outputReportCode: 'hr.employee-letter'; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The letter request is already being processed.');
      const dateResolution = await this.businessDate.resolveInTransaction(tx, context);
      const businessDateValue = new Date(`${dateResolution.businessDate}T00:00:00.000Z`);
      const [employee, company] = await Promise.all([
        tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true, jobTitle: true, hireDate: true, status: true, compensationProfiles: { where: { effectiveFrom: { lte: businessDateValue }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDateValue } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1, select: { monthlyGross: true } } } }),
        tx.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true } }),
      ]);
      if (!employee || !company) throw new NotFoundException('The employee is not available for this company.');
      if (input.letterType === 'SALARY_CERTIFICATE' && !employee.compensationProfiles[0]) throw new BadRequestException('A salary certificate requires an approved compensation profile covering the business date.');
      const businessDate = dateResolution.businessDate as `${number}-${number}-${number}`;
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'HR-EMPLOYEE-LETTER', businessDate });
      const letterNumber = `HRL-${businessDate.replaceAll('-', '')}-${serial.toString().padStart(5, '0')}`;
      const snapshot = { templateVersion: TEMPLATE_VERSION, letterType: input.letterType, locale: input.locale, recipient: input.recipient?.trim() || null, letterNumber, issuedOn: businessDate, company: { nameAr: company.nameAr, nameEn: company.nameEn }, employee: { employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn, jobTitle: employee.jobTitle, hireDate: employee.hireDate.toISOString().slice(0, 10), status: employee.status }, ...(input.letterType === 'SALARY_CERTIFICATE' ? { monthlyGross: employee.compensationProfiles[0]?.monthlyGross?.toFixed(4) ?? null } : {}) };
      const id = randomUUID(); const snapshotSha256 = createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
      await tx.hrEmployeeLetter.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, employeeId, letterType: input.letterType, letterNumber, templateVersion: TEMPLATE_VERSION, locale: input.locale, recipient: snapshot.recipient, snapshotJson: snapshot as Prisma.InputJsonValue, snapshotSha256, issuedByUserId: context.actorUserId } });
      const receipt = { id, letterNumber, outputReportCode: 'hr.employee-letter' as const, replayed: false };
      await this.audit(tx, context, 'hr.employee_letter.issued', id, { employeeId, letterType: input.letterType, letterNumber, templateVersion: TEMPLATE_VERSION, snapshotSha256 });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } }); return receipt;
    });
  }

  async revoke(context: TrustedCompanyActorContext, letterId: string, input: RevokeHrEmployeeLetterRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, 'hr.employee_letter.revoke', input.idempotencyKey, { letterId, reason: input.reason.trim() });
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; letterNumber: string; outputReportCode: 'hr.employee-letter'; replayed: boolean }>(begun.response.body); if (begun.kind === 'in-progress') throw new ConflictException('The letter request is already being processed.');
      const letter = await tx.hrEmployeeLetter.findFirst({ where: { id: letterId, tenantId: context.tenantId, companyId: context.companyId } }); if (!letter || letter.status !== HrEmployeeLetterStatus.ISSUED) throw new NotFoundException('The issued employee letter is not available.');
      await tx.hrEmployeeLetter.update({ where: { id: letter.id }, data: { status: HrEmployeeLetterStatus.REVOKED, revokedAt: new Date(), revokedReason: input.reason.trim() } });
      const receipt = { id: letter.id, letterNumber: letter.letterNumber, outputReportCode: 'hr.employee-letter' as const, replayed: false }; await this.audit(tx, context, 'hr.employee_letter.revoked', letter.id, { letterNumber: letter.letterNumber, reason: input.reason.trim() }); await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } }); return receipt;
    });
  }

  private async begin(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, operation: string, key: string, request: Record<string, unknown>) { try { return await this.idempotency.beginInTransaction(tx, context, { operation, key, request: request as never, expiresAt: new Date(Date.now() + 86_400_000) }); } catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with a different employee-letter request.'); throw error; } }
  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, after: Record<string, unknown>) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: 'HrEmployeeLetter', entityId, requestId: `${action}:${entityId}`, afterJson: after as Prisma.InputJsonValue } }); }
}
function mapLetter(value: any) { return { id: value.id, employeeId: value.employeeId, letterType: value.letterType, status: value.status, letterNumber: value.letterNumber, locale: value.locale, recipient: value.recipient, issuedAt: value.issuedAt.toISOString(), revokedAt: value.revokedAt?.toISOString() ?? null, revokedReason: value.revokedReason, outputReportCode: 'hr.employee-letter' as const }; }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`; }

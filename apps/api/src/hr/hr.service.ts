import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { CreateHrEmployeeRequest, CreateHrEmployeeServiceRequest, UpdateHrEmployeeRequest } from '@baseer-erp/contracts';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceCategoryStatus, FinanceSupplierStatus, HrEmployeeServiceStatus, HrEmployeeStatus, Prisma } from '../generated/prisma/client.js';

type EmployeeDetailQuery = Readonly<{ cursor?: string; pageSize: number }>;
type EmployeeCreateInput = Omit<CreateHrEmployeeRequest, 'idempotencyKey'>;
type EmployeeUpdateInput = Omit<UpdateHrEmployeeRequest, 'idempotencyKey'>;
type EmployeeServiceCreateInput = Omit<CreateHrEmployeeServiceRequest, 'idempotencyKey'>;

@Injectable()
export class HrService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async listEmployees(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const employees = await tx.hrEmployee.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: [{ status: 'asc' }, { nameAr: 'asc' }, { id: 'asc' }],
      });
      return employees.map(mapEmployee);
    });
  }

  async employeeDetail(context: TrustedCompanyActorContext, employeeId: string, query: EmployeeDetailQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const employee = await tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!employee) throw new NotFoundException('The employee is not available for this company.');
      const cursor = query.cursor ? await tx.hrEmployeeFinancialMovement.findFirst({
        where: { id: query.cursor, employeeId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, businessDate: true },
      }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The employee-ledger cursor is invalid.');
      const [services, movementRows] = await Promise.all([
        tx.hrEmployeeService.findMany({
          where: { employeeId, tenantId: context.tenantId, companyId: context.companyId },
          orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
          include: { supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } } },
        }),
        tx.hrEmployeeFinancialMovement.findMany({
          where: {
            employeeId,
            tenantId: context.tenantId,
            companyId: context.companyId,
            ...(cursor ? { OR: [{ businessDate: { lt: cursor.businessDate } }, { businessDate: cursor.businessDate, id: { lt: cursor.id } }] } : {}),
          },
          orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
          take: query.pageSize + 1,
        }),
      ]);
      const hasMoreMovements = movementRows.length > query.pageSize;
      const movements = hasMoreMovements ? movementRows.slice(0, query.pageSize) : movementRows;
      return {
        employee: mapEmployee(employee),
        services: services.map(mapService),
        movements: movements.map(mapMovement),
        hasMoreMovements,
        nextMovementCursor: hasMoreMovements ? movements.at(-1)?.id ?? null : null,
      };
    });
  }

  async createEmployee(context: TrustedCompanyActorContext, raw: EmployeeCreateInput, idempotencyKey: string) {
    const input = employeeCreateInput(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.employee.create', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee request is already being processed.');
      const duplicate = await tx.hrEmployee.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeNumber: input.employeeNumber }, select: { id: true } });
      if (duplicate) throw new ConflictException('The employee number already exists for this company.');
      const id = randomUUID();
      await tx.hrEmployee.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...input } });
      const receipt = { id, replayed: false };
      await this.audit(tx, context, 'hr.employee.created', 'HrEmployee', id, null, input);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async updateEmployee(context: TrustedCompanyActorContext, raw: EmployeeUpdateInput, idempotencyKey: string) {
    const input = employeeUpdateInput(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.employee.update', key: idempotencyKey, request: jsonPayload({ employeeId: raw.employeeId, ...input }), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee update is already being processed.');
      const prior = await tx.hrEmployee.findFirst({ where: { id: raw.employeeId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!prior) throw new NotFoundException('The employee is not available for this company.');
      if (input.status === HrEmployeeStatus.TERMINATED && !input.terminatedAt) throw new BadRequestException('A termination date is required when an employee is terminated.');
      const updated = await tx.hrEmployee.update({ where: { id: prior.id }, data: input });
      const receipt = { id: updated.id, replayed: false };
      await this.audit(tx, context, 'hr.employee.updated', 'HrEmployee', updated.id, mapEmployee(prior), mapEmployee(updated));
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async createService(context: TrustedCompanyActorContext, raw: EmployeeServiceCreateInput, idempotencyKey: string) {
    const input = serviceCreateInput(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.employee_service.create', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee service request is already being processed.');
      const employee = await tx.hrEmployee.findFirst({ where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { not: HrEmployeeStatus.ARCHIVED } }, select: { id: true } });
      if (!employee) throw new BadRequestException('Choose an active employee from this company.');
      await this.assertServiceReferences(tx, context, input.supplierId, input.categoryId);
      const id = randomUUID();
      await tx.hrEmployeeService.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...input, status: HrEmployeeServiceStatus.DRAFT } });
      const receipt = { id, replayed: false };
      await this.audit(tx, context, 'hr.employee_service.created', 'HrEmployeeService', id, null, input);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  private async assertServiceReferences(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, supplierId: string | null, categoryId: string | null) {
    if (supplierId) {
      const supplier = await tx.financeSupplier.findFirst({ where: { id: supplierId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierStatus.ACTIVE }, select: { id: true } });
      if (!supplier) throw new BadRequestException('The selected service supplier is not active for this company.');
    }
    if (categoryId) {
      const category = await tx.financeCategory.findFirst({ where: { id: categoryId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceCategoryStatus.ACTIVE, isPosting: true, kind: 'EXPENSE' }, select: { id: true } });
      if (!category) throw new BadRequestException('The selected service category is not ready for expense posting.');
    }
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: `${action}:${entityId}`, beforeJson: before === null ? Prisma.JsonNull : before as Prisma.InputJsonValue, afterJson: after as Prisma.InputJsonValue } });
  }
}

function employeeCreateInput(value: EmployeeCreateInput) {
  return { employeeNumber: value.employeeNumber.trim(), nameAr: value.nameAr.trim(), nameEn: nullable(value.nameEn), jobTitle: nullable(value.jobTitle), phone: nullable(value.phone), email: nullable(value.email), hireDate: value.hireDate, notes: nullable(value.notes) };
}
function employeeUpdateInput(value: EmployeeUpdateInput) {
  return { nameAr: value.nameAr.trim(), ...(value.nameEn !== undefined ? { nameEn: nullable(value.nameEn) } : {}), ...(value.jobTitle !== undefined ? { jobTitle: nullable(value.jobTitle) } : {}), ...(value.phone !== undefined ? { phone: nullable(value.phone) } : {}), ...(value.email !== undefined ? { email: nullable(value.email) } : {}), status: value.status, ...(value.terminatedAt !== undefined ? { terminatedAt: value.terminatedAt } : {}), ...(value.notes !== undefined ? { notes: nullable(value.notes) } : {}) };
}
function serviceCreateInput(value: EmployeeServiceCreateInput) {
  return { employeeId: value.employeeId, serviceType: value.serviceType, referenceNumber: nullable(value.referenceNumber), issueDate: value.issueDate ?? null, expiryDate: value.expiryDate ?? null, supplierId: value.supplierId ?? null, categoryId: value.categoryId ?? null, notes: nullable(value.notes) };
}
function nullable(value: string | null | undefined) { const text = value?.trim(); return text || null; }
function day(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }
function mapEmployee(value: { id: string; employeeNumber: string; nameAr: string; nameEn: string | null; jobTitle: string | null; phone: string | null; email: string | null; hireDate: Date; status: HrEmployeeStatus; terminatedAt: Date | null; notes: string | null }) { return { id: value.id, employeeNumber: value.employeeNumber, nameAr: value.nameAr, nameEn: value.nameEn, jobTitle: value.jobTitle, phone: value.phone, email: value.email, hireDate: day(value.hireDate)!, status: value.status, terminatedAt: day(value.terminatedAt), notes: value.notes }; }
function mapService(value: { id: string; employeeId: string; serviceType: string; referenceNumber: string | null; issueDate: Date | null; expiryDate: Date | null; supplier: { id: string; nameAr: string; nameEn: string | null } | null; category: { id: string; nameAr: string; nameEn: string } | null; outflowDocumentId: string | null; status: HrEmployeeServiceStatus; notes: string | null }) { return { id: value.id, employeeId: value.employeeId, serviceType: value.serviceType as CreateHrEmployeeServiceRequest['serviceType'], referenceNumber: value.referenceNumber, issueDate: day(value.issueDate), expiryDate: day(value.expiryDate), supplier: value.supplier, category: value.category, outflowDocumentId: value.outflowDocumentId, status: value.status, notes: value.notes }; }
function mapMovement(value: { id: string; journalEntryId: string; movementType: string; businessDate: Date; amount: Prisma.Decimal; sourceReference: string; description: string | null }) { return { id: value.id, journalEntryId: value.journalEntryId, movementType: value.movementType, businessDate: day(value.businessDate)!, amount: value.amount.toFixed(4), sourceReference: value.sourceReference, description: value.description }; }
function tomorrow() { return new Date(Date.now() + 86_400_000); }
function rethrowIdempotency(error: unknown): never { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different HR data.'); throw error; }
function jsonPayload(value: unknown): never { return JSON.parse(JSON.stringify(value)) as never; }

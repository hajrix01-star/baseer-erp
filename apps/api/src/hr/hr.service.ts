import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { CancelHrEmployeeServiceRequest, CreateHrEmployeePromotionRequest, CreateHrEmployeeRequest, CreateHrEmployeeServiceRequest, RenewHrEmployeeServiceRequest, UpdateHrEmployeeRequest, UpdateHrEmployeeServiceRequest } from '@baseer-erp/contracts';
import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceCategoryStatus, FinanceSupplierStatus, HrEmployeeServiceComplianceStatus, HrEmployeeServiceStatus, HrEmployeeStatus, Prisma } from '../generated/prisma/client.js';

type EmployeeDetailQuery = Readonly<{ cursor?: string; pageSize: number }>;
type EmployeeListQuery = Readonly<{ cursor?: string; pageSize: number; status?: HrEmployeeStatus; search?: string }>;
type EmployeeCreateInput = Omit<CreateHrEmployeeRequest, 'idempotencyKey'>;
type EmployeeUpdateInput = Omit<UpdateHrEmployeeRequest, 'idempotencyKey'>;
type EmployeePromotionCreateInput = Omit<CreateHrEmployeePromotionRequest, 'idempotencyKey'>;
type EmployeePromotionListQuery = Readonly<{ cursor?: string; pageSize: number }>;
type EmployeeServiceCreateInput = Omit<CreateHrEmployeeServiceRequest, 'idempotencyKey'>;
type EmployeeServiceUpdateInput = Omit<UpdateHrEmployeeServiceRequest, 'idempotencyKey'>;
type EmployeeServiceCancelInput = Omit<CancelHrEmployeeServiceRequest, 'idempotencyKey'>;
type EmployeeServiceRenewInput = Omit<RenewHrEmployeeServiceRequest, 'idempotencyKey'>;
type EmployeeServiceListQuery = Readonly<{ employeeId?: string; serviceType?: string; complianceStatus?: HrEmployeeServiceComplianceStatus; expiryBefore?: Date; expiryAfter?: Date; cursor?: string; pageSize: number }>;

@Injectable()
export class HrService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService, private readonly businessDates: BusinessDateService) {}

  async listEmployees(context: TrustedCompanyActorContext, query: EmployeeListQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const cursor = query.cursor ? await tx.hrEmployee.findFirst({ where: { id: query.cursor, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, employeeNumber: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The employee cursor is invalid.');
      const conditions: Prisma.HrEmployeeWhereInput[] = [];
      if (query.search) conditions.push({ OR: [{ employeeNumber: { contains: query.search, mode: 'insensitive' } }, { nameAr: { contains: query.search, mode: 'insensitive' } }, { nameEn: { contains: query.search, mode: 'insensitive' } }] });
      if (cursor) conditions.push({ OR: [{ employeeNumber: { gt: cursor.employeeNumber } }, { employeeNumber: cursor.employeeNumber, id: { gt: cursor.id } }] });
      const [rows, activeEmployees, employeesOnLeave, openAdvances, openAdministrativeDeductions] = await Promise.all([
        tx.hrEmployee.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          ...(query.status ? { status: query.status } : {}),
          ...(conditions.length ? { AND: conditions } : {}),
        },
        orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }],
        take: query.pageSize + 1,
        }),
        tx.hrEmployee.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ACTIVE } }),
        tx.hrEmployee.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ON_LEAVE } }),
        tx.hrEmployeeAdvance.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: { in: ['ISSUED', 'PARTIALLY_SETTLED'] } } }),
        tx.hrEmployeeAdministrativeDeduction.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: { in: ['OPEN', 'PARTIALLY_APPLIED', 'DEFERRED'] } } }),
      ]);
      const hasMore = rows.length > query.pageSize;
      const employees = hasMore ? rows.slice(0, query.pageSize) : rows;
      return {
        employees: employees.map(mapEmployee),
        hasMore,
        nextCursor: hasMore ? employees.at(-1)?.id ?? null : null,
        summary: { activeEmployees, employeesOnLeave, openAdvances, openAdministrativeDeductions },
      };
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
      const [services, movementRows, compensation] = await Promise.all([
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
        tx.hrEmployeeCompensationProfile.findFirst({
          where: { employeeId, tenantId: context.tenantId, companyId: context.companyId, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
          orderBy: { effectiveFrom: 'desc' },
        }),
      ]);
      const hasMoreMovements = movementRows.length > query.pageSize;
      const movements = hasMoreMovements ? movementRows.slice(0, query.pageSize) : movementRows;
      return {
        employee: mapEmployee(employee),
        compensation: compensation ? mapCompensation(compensation) : null,
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
      if (input.terminatedAt && input.terminatedAt.getTime() < prior.hireDate.getTime()) throw new BadRequestException('The termination date cannot be before the hire date.');
      const updated = await tx.hrEmployee.update({ where: { id: prior.id }, data: input });
      const receipt = { id: updated.id, replayed: false };
      await this.audit(tx, context, 'hr.employee.updated', 'HrEmployee', updated.id, mapEmployee(prior), mapEmployee(updated));
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async listPromotions(context: TrustedCompanyActorContext, employeeId: string, query: EmployeePromotionListQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const employee = await tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } });
      if (!employee) throw new NotFoundException('The employee is not available for this company.');
      const cursor = query.cursor ? await tx.hrEmployeePromotion.findFirst({ where: { id: query.cursor, employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, effectiveDate: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The employee-promotion cursor is invalid.');
      const rows = await tx.hrEmployeePromotion.findMany({
        where: { employeeId, tenantId: context.tenantId, companyId: context.companyId, ...(cursor ? { OR: [{ effectiveDate: { lt: cursor.effectiveDate } }, { effectiveDate: cursor.effectiveDate, id: { lt: cursor.id } }] } : {}) },
        orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }], take: query.pageSize + 1,
      });
      const hasMore = rows.length > query.pageSize;
      const promotions = hasMore ? rows.slice(0, query.pageSize) : rows;
      return { promotions: promotions.map(mapPromotion), hasMore, nextCursor: hasMore ? promotions.at(-1)?.id ?? null : null };
    });
  }

  async createPromotion(context: TrustedCompanyActorContext, raw: EmployeePromotionCreateInput, idempotencyKey: string) {
    const input = promotionCreateInput(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.employee.promotion.create', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee-promotion request is already being processed.');
      const [employee, businessDate] = await Promise.all([
        tx.hrEmployee.findFirst({ where: { id: raw.employeeId, tenantId: context.tenantId, companyId: context.companyId } }),
        this.businessDates.resolveInTransaction(tx, context),
      ]);
      if (!employee || (employee.status !== HrEmployeeStatus.ACTIVE && employee.status !== HrEmployeeStatus.ON_LEAVE)) throw new BadRequestException('Choose an active employee from this company.');
      if (input.effectiveDate.getTime() < employee.hireDate.getTime()) throw new BadRequestException('The promotion effective date cannot be before the hire date.');
      if (day(input.effectiveDate)! > businessDate.businessDate) throw new BadRequestException('A future promotion cannot be recorded before its effective date.');
      if (employee.jobTitle === input.newJobTitle) throw new ConflictException('The new job title is already the employee current title.');
      const duplicate = await tx.hrEmployeePromotion.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: employee.id, effectiveDate: input.effectiveDate, decisionReference: input.decisionReference }, select: { id: true } });
      if (duplicate) throw new ConflictException('This promotion decision is already recorded for the employee.');
      const id = randomUUID();
      const promotion = await tx.hrEmployeePromotion.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, employeeId: employee.id, previousJobTitle: employee.jobTitle, newJobTitle: input.newJobTitle, effectiveDate: input.effectiveDate, decisionReference: input.decisionReference, reason: input.reason, createdByUserId: context.actorUserId } });
      await tx.hrEmployee.update({ where: { id: employee.id }, data: { jobTitle: input.newJobTitle } });
      const receipt = { id, replayed: false };
      await this.audit(tx, context, 'hr.employee.promoted', 'HrEmployeePromotion', id, { employeeId: employee.id, jobTitle: employee.jobTitle }, mapPromotion(promotion));
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
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
      const employee = await tx.hrEmployee.findFirst({ where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true } });
      if (!employee) throw new BadRequestException('Choose an active employee from this company.');
        this.assertServiceTiming(input.issueDate, input.expiryDate);
        this.assertServiceTypeRequirements(input.serviceType, input.referenceNumber, input.expiryDate, input.visaDurationMonths);
        const references = await this.resolveServiceReferences(tx, context, input.serviceType, input.supplierId, input.categoryId);
        await this.assertServiceReferences(tx, context, references.supplierId, references.categoryId);
        const id = randomUUID();
        await tx.hrEmployeeService.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...input, ...references, status: HrEmployeeServiceStatus.DRAFT } });
      const receipt = { id, replayed: false };
      await this.audit(tx, context, 'hr.employee_service.created', 'HrEmployeeService', id, null, input);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async listServices(context: TrustedCompanyActorContext, query: EmployeeServiceListQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const cursor = query.cursor ? await tx.hrEmployeeService.findFirst({
        where: { id: query.cursor, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, createdAt: true },
      }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The employee-service cursor is invalid.');
      const rows = await tx.hrEmployeeService.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          ...(query.employeeId ? { employeeId: query.employeeId } : {}),
          ...(query.serviceType ? { serviceType: query.serviceType } : {}),
          ...(query.complianceStatus ? { complianceStatus: query.complianceStatus } : {}),
          ...(query.expiryBefore || query.expiryAfter ? { expiryDate: { ...(query.expiryBefore ? { lte: query.expiryBefore } : {}), ...(query.expiryAfter ? { gte: query.expiryAfter } : {}) } } : {}),
          ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } }, supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } } },
      });
      const hasMore = rows.length > query.pageSize;
      const services = hasMore ? rows.slice(0, query.pageSize) : rows;
      return { services: services.map(mapService), hasMore, nextCursor: hasMore ? services.at(-1)?.id ?? null : null };
    });
  }

  async serviceDetail(context: TrustedCompanyActorContext, serviceId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const service = await tx.hrEmployeeService.findFirst({
        where: { id: serviceId, tenantId: context.tenantId, companyId: context.companyId },
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } }, supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } } },
      });
      if (!service) throw new NotFoundException('The employee service was not found.');
      return { service: mapService(service) };
    });
  }

  async updateService(context: TrustedCompanyActorContext, raw: EmployeeServiceUpdateInput, idempotencyKey: string) {
    const input = serviceUpdateInput(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.employee_service.update', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee service update is already being processed.');
      const prior = await this.serviceForOperationalChange(tx, context, input.serviceId);
      const candidate = {
        serviceType: input.serviceType ?? prior.serviceType,
        referenceNumber: input.referenceNumber === undefined ? prior.referenceNumber : input.referenceNumber,
        issueDate: input.issueDate === undefined ? prior.issueDate : input.issueDate,
        expiryDate: input.expiryDate === undefined ? prior.expiryDate : input.expiryDate,
        visaDurationMonths: input.visaDurationMonths === undefined ? prior.visaDurationMonths : input.visaDurationMonths,
        supplierId: input.supplierId === undefined ? prior.supplierId : input.supplierId,
        categoryId: input.categoryId === undefined ? prior.categoryId : input.categoryId,
      };
      this.assertServiceTiming(candidate.issueDate, candidate.expiryDate);
      this.assertServiceTypeRequirements(candidate.serviceType, candidate.referenceNumber, candidate.expiryDate, candidate.visaDurationMonths);
      await this.assertServiceReferences(tx, context, candidate.supplierId, candidate.categoryId);
      const updated = await tx.hrEmployeeService.update({
        where: { id: prior.id }, data: {
          ...(input.serviceType !== undefined ? { serviceType: input.serviceType } : {}),
          ...(input.referenceNumber !== undefined ? { referenceNumber: input.referenceNumber } : {}),
          ...(input.issueDate !== undefined ? { issueDate: input.issueDate } : {}),
          ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate } : {}),
          ...(input.visaDurationMonths !== undefined ? { visaDurationMonths: input.visaDurationMonths } : {}),
          ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      const receipt = { id: updated.id, replayed: false };
      await this.audit(tx, context, 'hr.employee_service.updated', 'HrEmployeeService', updated.id, mapService(prior), input);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async cancelService(context: TrustedCompanyActorContext, raw: EmployeeServiceCancelInput, idempotencyKey: string) {
    const input = { serviceId: raw.serviceId, reason: raw.reason.trim() };
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.employee_service.cancel', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee service cancellation is already being processed.');
      const prior = await this.serviceForOperationalChange(tx, context, input.serviceId);
      await tx.hrEmployeeService.update({ where: { id: prior.id }, data: { status: HrEmployeeServiceStatus.CANCELLED, complianceStatus: HrEmployeeServiceComplianceStatus.CANCELLED } });
      const receipt = { id: prior.id, replayed: false };
      await this.audit(tx, context, 'hr.employee_service.cancelled', 'HrEmployeeService', prior.id, mapService(prior), { complianceStatus: HrEmployeeServiceComplianceStatus.CANCELLED, reason: input.reason });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async renewService(context: TrustedCompanyActorContext, raw: EmployeeServiceRenewInput, idempotencyKey: string) {
    const input = serviceRenewInput(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.employee_service.renew', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee service renewal is already being processed.');
      const prior = await tx.hrEmployeeService.findFirst({
        where: { id: input.serviceId, tenantId: context.tenantId, companyId: context.companyId, complianceStatus: HrEmployeeServiceComplianceStatus.ACTIVE, status: { not: HrEmployeeServiceStatus.CANCELLED } },
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } }, supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } } },
      });
      if (!prior) throw new NotFoundException('An active employee service was not found.');
      const employee = await tx.hrEmployee.findFirst({ where: { id: prior.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true } });
      if (!employee) throw new BadRequestException('An active employee is required to renew this service.');
      const next = {
        employeeId: prior.employeeId, serviceType: prior.serviceType, referenceNumber: input.referenceNumber === undefined ? prior.referenceNumber : input.referenceNumber,
        issueDate: input.issueDate === undefined ? prior.issueDate : input.issueDate, expiryDate: input.expiryDate === undefined ? prior.expiryDate : input.expiryDate,
        visaDurationMonths: input.visaDurationMonths === undefined ? prior.visaDurationMonths : input.visaDurationMonths,
        supplierId: input.supplierId === undefined ? prior.supplierId : input.supplierId, categoryId: input.categoryId === undefined ? prior.categoryId : input.categoryId,
        notes: input.notes === undefined ? prior.notes : input.notes,
      };
      this.assertServiceTiming(next.issueDate, next.expiryDate);
      this.assertServiceTypeRequirements(next.serviceType, next.referenceNumber, next.expiryDate, next.visaDurationMonths);
      await this.assertServiceReferences(tx, context, next.supplierId, next.categoryId);
      const id = randomUUID();
      await tx.hrEmployeeService.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...next, renewalOfServiceId: prior.id, status: HrEmployeeServiceStatus.DRAFT, complianceStatus: HrEmployeeServiceComplianceStatus.ACTIVE } });
      await tx.hrEmployeeService.update({ where: { id: prior.id }, data: { complianceStatus: HrEmployeeServiceComplianceStatus.RENEWED } });
      const receipt = { id, replayed: false };
      await this.audit(tx, context, 'hr.employee_service.renewed', 'HrEmployeeService', id, mapService(prior), { renewalOfServiceId: prior.id, ...next });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  private async serviceForOperationalChange(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, serviceId: string) {
    const service = await tx.hrEmployeeService.findFirst({
      where: { id: serviceId, tenantId: context.tenantId, companyId: context.companyId },
      include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } }, supplier: { select: { id: true, nameAr: true, nameEn: true } }, category: { select: { id: true, nameAr: true, nameEn: true } } },
    });
    if (!service) throw new NotFoundException('The employee service was not found.');
    if (service.status !== HrEmployeeServiceStatus.DRAFT || service.complianceStatus !== HrEmployeeServiceComplianceStatus.ACTIVE) throw new ConflictException('Only an active service without an issued financial cost can be changed or cancelled.');
    return service;
  }

  private assertServiceTiming(issueDate: Date | null, expiryDate: Date | null) {
    if (issueDate && expiryDate && expiryDate.getTime() < issueDate.getTime()) throw new BadRequestException('The service expiry date cannot be before its issue date.');
  }

  private assertServiceTypeRequirements(serviceType: string, referenceNumber: string | null, expiryDate: Date | null, visaDurationMonths: number | null) {
    if ((serviceType === 'IQAMA_ISSUANCE' || serviceType === 'IQAMA_RENEWAL') && (!referenceNumber || !expiryDate)) {
      throw new BadRequestException('Iqama issuance and renewal require a reference number and an expiry date.');
    }
    if ((serviceType === 'MEDICAL_INSURANCE' || serviceType === 'HEALTH_CERTIFICATE') && !expiryDate) {
      throw new BadRequestException('Medical insurance and health certificates require an expiry date.');
    }
    if (serviceType === 'EXIT_REENTRY_VISA' && (visaDurationMonths === null || visaDurationMonths < 1 || visaDurationMonths > 5)) {
      throw new BadRequestException('Exit and re-entry visas require a duration from one to five months.');
    }
    if (visaDurationMonths !== null && serviceType !== 'EXIT_REENTRY_VISA') throw new BadRequestException('Visa duration is allowed only for exit and re-entry visas.');
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

  /** A service type proposes the company's own category and its suggested supplier.
   * An explicit supplier or category always wins, exactly as the Noorix workflow does. */
  private async resolveServiceReferences(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, serviceType: string, supplierId: string | null, categoryId: string | null) {
    if (supplierId && categoryId) return { supplierId, categoryId };
    const code = defaultCategoryCodeForService(serviceType);
    if (!code) return { supplierId, categoryId };
    const category = await tx.financeCategory.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, code, kind: 'EXPENSE', status: FinanceCategoryStatus.ACTIVE, isPosting: true },
      select: { id: true, suggestedSupplierId: true },
    });
    return { supplierId: supplierId ?? category?.suggestedSupplierId ?? null, categoryId: categoryId ?? category?.id ?? null };
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
function promotionCreateInput(value: EmployeePromotionCreateInput) {
  return { employeeId: value.employeeId, effectiveDate: value.effectiveDate, newJobTitle: value.newJobTitle.trim(), decisionReference: value.decisionReference.trim(), reason: nullable(value.reason) };
}
function serviceCreateInput(value: EmployeeServiceCreateInput) {
  return { employeeId: value.employeeId, serviceType: value.serviceType, referenceNumber: nullable(value.referenceNumber), issueDate: value.issueDate ?? null, expiryDate: value.expiryDate ?? null, visaDurationMonths: value.visaDurationMonths ?? null, supplierId: value.supplierId ?? null, categoryId: value.categoryId ?? null, notes: nullable(value.notes) };
}
function serviceUpdateInput(value: EmployeeServiceUpdateInput) {
  return {
    serviceId: value.serviceId,
    ...(value.serviceType !== undefined ? { serviceType: value.serviceType } : {}),
    ...(value.referenceNumber !== undefined ? { referenceNumber: nullable(value.referenceNumber) } : {}),
    ...(value.issueDate !== undefined ? { issueDate: value.issueDate } : {}),
    ...(value.expiryDate !== undefined ? { expiryDate: value.expiryDate } : {}),
    ...(value.visaDurationMonths !== undefined ? { visaDurationMonths: value.visaDurationMonths } : {}),
    ...(value.supplierId !== undefined ? { supplierId: value.supplierId } : {}),
    ...(value.categoryId !== undefined ? { categoryId: value.categoryId } : {}),
    ...(value.notes !== undefined ? { notes: nullable(value.notes) } : {}),
  };
}
function serviceRenewInput(value: EmployeeServiceRenewInput) {
  return {
    serviceId: value.serviceId,
    ...(value.referenceNumber !== undefined ? { referenceNumber: nullable(value.referenceNumber) } : {}),
    ...(value.issueDate !== undefined ? { issueDate: value.issueDate } : {}),
    ...(value.expiryDate !== undefined ? { expiryDate: value.expiryDate } : {}),
    ...(value.visaDurationMonths !== undefined ? { visaDurationMonths: value.visaDurationMonths } : {}),
    ...(value.supplierId !== undefined ? { supplierId: value.supplierId } : {}),
    ...(value.categoryId !== undefined ? { categoryId: value.categoryId } : {}),
    ...(value.notes !== undefined ? { notes: nullable(value.notes) } : {}),
  };
}
function nullable(value: string | null | undefined) { const text = value?.trim(); return text || null; }
function defaultCategoryCodeForService(serviceType: string) {
  switch (serviceType) {
    case 'IQAMA_ISSUANCE':
    case 'IQAMA_RENEWAL':
    case 'EXIT_REENTRY_VISA': return 'E2-4';
    case 'SPONSORSHIP_TRANSFER': return 'E2-8';
    case 'MEDICAL_INSURANCE': return 'E4-2';
    case 'HEALTH_CERTIFICATE': return 'E2-9';
    default: return null;
  }
}
function day(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }
function mapEmployee(value: { id: string; employeeNumber: string; nameAr: string; nameEn: string | null; jobTitle: string | null; phone: string | null; email: string | null; hireDate: Date; status: HrEmployeeStatus; terminatedAt: Date | null; notes: string | null }) { return { id: value.id, employeeNumber: value.employeeNumber, nameAr: value.nameAr, nameEn: value.nameEn, jobTitle: value.jobTitle, phone: value.phone, email: value.email, hireDate: day(value.hireDate)!, status: value.status, terminatedAt: day(value.terminatedAt), notes: value.notes }; }
function mapPromotion(value: { id: string; employeeId: string; effectiveDate: Date; previousJobTitle: string | null; newJobTitle: string; decisionReference: string; reason: string | null; createdAt: Date }) { return { id: value.id, employeeId: value.employeeId, effectiveDate: day(value.effectiveDate)!, previousJobTitle: value.previousJobTitle, newJobTitle: value.newJobTitle, decisionReference: value.decisionReference, reason: value.reason, createdAt: value.createdAt.toISOString() }; }
function mapCompensation(value: { id: string; employeeId: string; policyVersionId: string | null; effectiveFrom: Date; effectiveTo: Date | null; monthlyGross: Prisma.Decimal; compensationMethod: string; foodAllowance: Prisma.Decimal; otherAllowance: Prisma.Decimal; scheduledHoursPerDay: number | null; scheduledWorkDays: number | null; notes: string | null }) { return { id: value.id, employeeId: value.employeeId, policyVersionId: value.policyVersionId, effectiveFrom: day(value.effectiveFrom)!, effectiveTo: day(value.effectiveTo), monthlyGross: value.monthlyGross.toFixed(4), compensationMethod: value.compensationMethod as 'FIXED_MONTHLY' | 'INCLUSIVE_OVERTIME', foodAllowance: value.foodAllowance.toFixed(4), otherAllowance: value.otherAllowance.toFixed(4), scheduledHoursPerDay: value.scheduledHoursPerDay, scheduledWorkDays: value.scheduledWorkDays, notes: value.notes }; }
function mapService(value: { id: string; employeeId: string; serviceType: string; referenceNumber: string | null; issueDate: Date | null; expiryDate: Date | null; visaDurationMonths: number | null; renewalOfServiceId: string | null; supplier: { id: string; nameAr: string; nameEn: string | null } | null; category: { id: string; nameAr: string; nameEn: string } | null; outflowDocumentId: string | null; status: HrEmployeeServiceStatus; complianceStatus: HrEmployeeServiceComplianceStatus; notes: string | null; employee?: { id: string; employeeNumber: string; nameAr: string; nameEn: string | null } }) { return { id: value.id, employeeId: value.employeeId, serviceType: value.serviceType as CreateHrEmployeeServiceRequest['serviceType'], referenceNumber: value.referenceNumber, issueDate: day(value.issueDate), expiryDate: day(value.expiryDate), visaDurationMonths: value.visaDurationMonths, renewalOfServiceId: value.renewalOfServiceId, supplier: value.supplier, category: value.category, outflowDocumentId: value.outflowDocumentId, status: value.status, complianceStatus: value.complianceStatus, notes: value.notes, ...(value.employee ? { employee: value.employee } : {}) }; }
function mapMovement(value: { id: string; journalEntryId: string; movementType: string; businessDate: Date; amount: Prisma.Decimal; sourceReference: string; description: string | null }) { return { id: value.id, journalEntryId: value.journalEntryId, movementType: value.movementType, businessDate: day(value.businessDate)!, amount: value.amount.toFixed(4), sourceReference: value.sourceReference, description: value.description }; }
function tomorrow() { return new Date(Date.now() + 86_400_000); }
function rethrowIdempotency(error: unknown): never { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different HR data.'); throw error; }
function jsonPayload(value: unknown): never { return JSON.parse(JSON.stringify(value)) as never; }

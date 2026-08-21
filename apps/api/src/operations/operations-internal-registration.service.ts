import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { CreateOperationsInternalRegistrationRequest, OperationsInternalRegistrationReportQuery } from "@baseer-erp/contracts";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DocumentSerialService, IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/index.js";
import { DatabaseService } from "../database/database.service.js";
import { OperationsItemKind, OperationsItemStatus, Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

type EntityReceipt = { id: string; replayed: boolean };

/** Staff-facing service. Its read model deliberately has no price or cost field. */
@Injectable()
export class OperationsInternalRegistrationService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService, private readonly serials: DocumentSerialService) {}

  async workstation(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [sections, products] = await Promise.all([
        tx.operationsSection.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }] }),
        tx.operationsItem.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.MENU_PRODUCT, status: OperationsItemStatus.ACTIVE, section: { is: { isActive: true } } }, orderBy: { nameAr: "asc" }, include: { itemUnits: { where: { isActive: true }, include: { unit: true }, orderBy: [{ isBase: "desc" }, { createdAt: "asc" }] } } }),
      ]);
      return { companyId: context.companyId, sections: sections.map((item) => ({ id: item.id, code: item.code, nameAr: item.nameAr, nameEn: item.nameEn, isActive: item.isActive })), products: products.map((item) => ({ id: item.id, sectionId: item.sectionId, nameAr: item.nameAr, nameEn: item.nameEn, units: item.itemUnits.map((line) => ({ unitId: line.unitId, nameAr: line.unit.nameAr, nameEn: line.unit.nameEn })) })) };
    });
  }

  async create(context: TrustedCompanyActorContext, request: CreateOperationsInternalRegistrationRequest): Promise<EntityReceipt> {
    const payload = { businessDate: request.businessDate, sectionId: request.sectionId, notes: request.notes?.trim() || null, lines: request.lines };
    return this.withIdempotency(context, request.idempotencyKey, payload, async (tx) => {
      if (new Set(payload.lines.map((line) => `${line.menuProductItemId}:${line.unitId}`)).size !== payload.lines.length) throw new BadRequestException("A menu product and unit can appear only once in a registration.");
      const section = await tx.operationsSection.findFirst({ where: { id: payload.sectionId, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true } });
      if (!section) throw new BadRequestException("The operational section is unavailable.");
      const productIds = [...new Set(payload.lines.map((line) => line.menuProductItemId))];
      const products = await tx.operationsItem.findMany({ where: { id: { in: productIds }, tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.MENU_PRODUCT, status: OperationsItemStatus.ACTIVE, sectionId: payload.sectionId }, include: { itemUnits: { where: { isActive: true }, include: { unit: true } } } });
      if (products.length !== productIds.length) throw new BadRequestException("Only active menu products from the selected section can be registered.");
      const byId = new Map(products.map((product) => [product.id, product]));
      const prepared = payload.lines.map((line) => {
        const product = byId.get(line.menuProductItemId); const unit = product?.itemUnits.find((entry) => entry.unitId === line.unitId);
        if (!product || !unit) throw new BadRequestException("The selected menu product unit is unavailable.");
        return { ...line, product, unit };
      });
      const id = randomUUID(); const registrationNumber = await this.documentNumber(tx, context, payload.businessDate);
      await tx.operationsInternalRegistration.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, registrationNumber, sectionId: payload.sectionId, businessDate: new Date(`${payload.businessDate}T00:00:00.000Z`), notes: payload.notes, createdByUserId: context.actorUserId, lines: { create: prepared.map((line, index) => { const menuSaleUnitPriceSnapshot = line.unit.menuSaleUnitPrice; const lineTotalSnapshot = menuSaleUnitPriceSnapshot ? new Prisma.Decimal(line.quantity).mul(menuSaleUnitPriceSnapshot).toDecimalPlaces(4) : null; return { id: randomUUID(), lineNumber: index + 1, menuProductItemId: line.menuProductItemId, unitId: line.unitId, quantity: new Prisma.Decimal(line.quantity), productNameArSnapshot: line.product.nameAr, productNameEnSnapshot: line.product.nameEn, unitNameArSnapshot: line.unit.unit.nameAr, unitNameEnSnapshot: line.unit.unit.nameEn, menuSaleUnitPriceSnapshot, lineTotalSnapshot }; }) } } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "operations.internal_registration.created", entityType: "OperationsInternalRegistration", entityId: id, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: Prisma.JsonNull, afterJson: { registrationNumber, businessDate: payload.businessDate, sectionId: payload.sectionId, lineCount: prepared.length } } });
      return { id, replayed: false };
    });
  }

  /** Financial projection for management. The create/workstation projection stays price-free. */
  async report(context: TrustedCompanyActorContext, query: OperationsInternalRegistrationReportQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const businessDate: { gte?: Date; lte?: Date } = {};
      if (query.from) businessDate.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) businessDate.lte = new Date(`${query.to}T00:00:00.000Z`);
      const registrations = await tx.operationsInternalRegistration.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, ...(Object.keys(businessDate).length ? { businessDate } : {}) }, orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }], include: { section: { select: { nameAr: true, nameEn: true } }, lines: { orderBy: { lineNumber: "asc" } } } });
      const zero = new Prisma.Decimal(0);
      const lineCount = registrations.reduce((sum, registration) => sum + registration.lines.length, 0);
      const quantity = registrations.reduce((sum, registration) => registration.lines.reduce((lineSum, line) => lineSum.plus(line.quantity), sum), zero);
      const amount = registrations.reduce((sum, registration) => registration.lines.reduce((lineSum, line) => lineSum.plus(line.lineTotalSnapshot ?? zero), sum), zero);
      return { pricingVisible: true as const, totals: { registrationCount: registrations.length, lineCount, quantity: quantity.toFixed(8), amount: amount.toFixed(4) }, registrations: registrations.map((registration) => ({ id: registration.id, registrationNumber: registration.registrationNumber, businessDate: registration.businessDate.toISOString().slice(0, 10), sectionNameAr: registration.section.nameAr, sectionNameEn: registration.section.nameEn, notes: registration.notes, lines: registration.lines.map((line) => ({ lineNumber: line.lineNumber, productNameAr: line.productNameArSnapshot, productNameEn: line.productNameEnSnapshot, unitNameAr: line.unitNameArSnapshot, unitNameEn: line.unitNameEnSnapshot, quantity: line.quantity.toString(), menuSaleUnitPrice: line.menuSaleUnitPriceSnapshot?.toFixed(4) ?? null, lineTotal: line.lineTotalSnapshot?.toFixed(4) ?? null })) })) };
    });
  }

  private async documentNumber(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, businessDate: string) { const value = await this.serials.reserveInTransaction(tx, context, { series: "OIR", businessDate: businessDate as `${number}-${number}-${number}` }); return `OIR-${businessDate.replaceAll("-", "")}-${value.toString().padStart(5, "0")}`; }
  private async withIdempotency(context: TrustedCompanyActorContext, key: string, payload: unknown, action: (tx: Prisma.TransactionClient) => Promise<EntityReceipt>) { return this.database.inTenantTransaction(context.tenantId, async (tx) => { let begun; try { begun = await this.idempotency.beginInTransaction(tx, context, { operation: "operations.internal_registration.create", key, request: payload as CanonicalJsonValue, expiresAt: new Date(Date.now() + 86_400_000) }); } catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was already used with different registration data."); throw error; } if (begun.kind === "replay") return { ...(begun.response.body as EntityReceipt), replayed: true }; if (begun.kind === "in-progress") throw new ConflictException("The internal registration is still being saved."); const receipt = await action(tx); await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt as CanonicalJsonValue } }); return receipt; }); }
}

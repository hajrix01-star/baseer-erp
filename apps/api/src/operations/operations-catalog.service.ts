import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { ConfigureOperationsItemUnitsRequest, UpdateOperationsItemRequest, UpdateOperationsSectionRequest, UpdateOperationsUnitRequest } from "@baseer-erp/contracts";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { OperationsConversionVersionStatus, OperationsItemKind, OperationsItemStatus, Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

type CreateUnit = { code: string; nameAr: string; nameEn?: string | undefined; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" };
type CreateSection = { code: string; nameAr: string; nameEn?: string | undefined };
type CreateItem = { code: string; nameAr: string; nameEn?: string | undefined; kind: "RAW_MATERIAL" | "MENU_PRODUCT"; sectionId?: string | undefined; baseUnitId: string; unitPrices: Array<{ unitId: string; lastPurchaseUnitPrice?: string | undefined; menuSaleUnitPrice?: string | undefined }> };
type ConversionEdge = { fromUnitId: string; toUnitId: string; factor: string };
type EntityReceipt = { id: string; replayed: boolean };

@Injectable()
export class OperationsCatalogService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async catalog(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [sections, units, items] = await Promise.all([
        tx.operationsSection.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { nameAr: "asc" }] }),
        tx.operationsUnit.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ isActive: "desc" }, { dimension: "asc" }, { nameAr: "asc" }] }),
        tx.operationsItem.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId },
          orderBy: [{ status: "asc" }, { nameAr: "asc" }],
          include: {
            itemUnits: { orderBy: [{ isBase: "desc" }, { createdAt: "asc" }] },
            conversionVersions: { where: { status: OperationsConversionVersionStatus.PUBLISHED }, orderBy: { version: "desc" }, take: 1, include: { edges: { orderBy: { createdAt: "asc" } } } },
          },
        }),
      ]);
      return {
        companyId: context.companyId,
        sections: sections.map((section) => ({ id: section.id, code: section.code, nameAr: section.nameAr, nameEn: section.nameEn, isActive: section.isActive })),
        units: units.map((unit) => ({ id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn, dimension: unit.dimension, isActive: unit.isActive })),
        items: items.map((item) => {
          const version = item.conversionVersions[0];
          return {
            id: item.id, code: item.code, nameAr: item.nameAr, nameEn: item.nameEn, kind: item.kind, status: item.status, sectionId: item.sectionId, baseUnitId: item.baseUnitId,
            itemUnits: item.itemUnits.map((line) => ({ id: line.id, unitId: line.unitId, isBase: line.isBase, isOrderEnabled: line.isOrderEnabled, isActive: line.isActive, lastPurchaseUnitPrice: line.lastPurchaseUnitPrice?.toString() ?? null, lastPurchasePriceAt: line.lastPurchasePriceAt?.toISOString() ?? null, menuSaleUnitPrice: line.menuSaleUnitPrice?.toString() ?? null })),
            conversionVersion: version ? { id: version.id, version: version.version, status: version.status, publishedAt: version.publishedAt.toISOString(), edges: version.edges.map((edge) => ({ fromUnitId: edge.fromUnitId, toUnitId: edge.toUnitId, factor: edge.factor.toString() })) } : null,
          };
        }),
      };
    });
  }

  async createUnit(context: TrustedCompanyActorContext, request: CreateUnit, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { ...request, code: code(request.code), nameAr: required(request.nameAr, 80), nameEn: optional(request.nameEn, 80) };
    return this.withIdempotency(context, "operations.unit.create", idempotencyKey, payload, async (tx) => {
      if (await tx.operationsUnit.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: payload.code }, select: { id: true } })) throw new ConflictException("An operations unit with this code already exists.");
      const id = randomUUID();
      await tx.operationsUnit.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...payload } });
      await this.audit(tx, context, "operations.unit.created", "OperationsUnit", id, null, payload);
      return { id, replayed: false };
    }, 201);
  }

  async updateUnit(context: TrustedCompanyActorContext, request: UpdateOperationsUnitRequest, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { unitId: request.unitId, code: code(request.code), nameAr: required(request.nameAr, 80), nameEn: optional(request.nameEn, 80), isActive: request.isActive };
    return this.withIdempotency(context, "operations.unit.update", idempotencyKey, payload, async (tx) => {
      const unit = await tx.operationsUnit.findFirst({ where: { id: payload.unitId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!unit) throw new NotFoundException("The operations unit was not found.");
      const duplicate = await tx.operationsUnit.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: payload.code, id: { not: unit.id } }, select: { id: true } });
      if (duplicate) throw new ConflictException("An operations unit with this code already exists.");
      if (!payload.isActive && unit.isActive) {
        const [baseUses, activeUses] = await Promise.all([
          tx.operationsItem.count({ where: { tenantId: context.tenantId, companyId: context.companyId, baseUnitId: unit.id, status: OperationsItemStatus.ACTIVE } }),
          tx.operationsItemUnit.count({ where: { tenantId: context.tenantId, companyId: context.companyId, unitId: unit.id, isActive: true, item: { status: OperationsItemStatus.ACTIVE } } }),
        ]);
        if (baseUses || activeUses) throw new ConflictException("Deactivate this unit on its active items before deactivating the shared unit.");
      }
      await tx.operationsUnit.update({ where: { id: unit.id }, data: { code: payload.code, nameAr: payload.nameAr, nameEn: payload.nameEn, isActive: payload.isActive } });
      await this.audit(tx, context, "operations.unit.updated", "OperationsUnit", unit.id, { code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn, isActive: unit.isActive }, payload);
      return { id: unit.id, replayed: false };
    }, 200);
  }

  async createSection(context: TrustedCompanyActorContext, request: CreateSection, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { ...request, code: code(request.code), nameAr: required(request.nameAr, 160), nameEn: optional(request.nameEn, 160) };
    return this.withIdempotency(context, "operations.section.create", idempotencyKey, payload, async (tx) => {
      if (await tx.operationsSection.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: payload.code }, select: { id: true } })) throw new ConflictException("An operations section with this code already exists.");
      const id = randomUUID();
      const sortOrder = await tx.operationsSection.count({ where: { tenantId: context.tenantId, companyId: context.companyId } });
      await tx.operationsSection.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...payload, sortOrder } });
      await this.audit(tx, context, "operations.section.created", "OperationsSection", id, null, payload);
      return { id, replayed: false };
    }, 201);
  }

  async updateSection(context: TrustedCompanyActorContext, request: UpdateOperationsSectionRequest, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { sectionId: request.sectionId, code: code(request.code), nameAr: required(request.nameAr, 160), nameEn: optional(request.nameEn, 160), isActive: request.isActive };
    return this.withIdempotency(context, "operations.section.update", idempotencyKey, payload, async (tx) => {
      const section = await tx.operationsSection.findFirst({ where: { id: payload.sectionId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!section) throw new NotFoundException("The operations section was not found.");
      const duplicate = await tx.operationsSection.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: payload.code, id: { not: section.id } }, select: { id: true } });
      if (duplicate) throw new ConflictException("An operations section with this code already exists.");
      if (!payload.isActive && section.isActive && await tx.operationsItem.count({ where: { tenantId: context.tenantId, companyId: context.companyId, sectionId: section.id, status: OperationsItemStatus.ACTIVE } })) throw new ConflictException("Archive or move active menu products before deactivating their section.");
      await tx.operationsSection.update({ where: { id: section.id }, data: { code: payload.code, nameAr: payload.nameAr, nameEn: payload.nameEn, isActive: payload.isActive } });
      await this.audit(tx, context, "operations.section.updated", "OperationsSection", section.id, { code: section.code, nameAr: section.nameAr, nameEn: section.nameEn, isActive: section.isActive }, payload);
      return { id: section.id, replayed: false };
    }, 200);
  }

  async createItem(context: TrustedCompanyActorContext, request: CreateItem, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { ...request, code: code(request.code), nameAr: required(request.nameAr, 160), nameEn: optional(request.nameEn, 160), sectionId: request.sectionId ?? null };
    return this.withIdempotency(context, "operations.item.create", idempotencyKey, payload, async (tx) => {
      if (await tx.operationsItem.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: payload.code }, select: { id: true } })) throw new ConflictException("An operations item with this code already exists.");
      const uniqueUnitIds = new Set(payload.unitPrices.map((line) => line.unitId));
      if (uniqueUnitIds.size !== payload.unitPrices.length || !uniqueUnitIds.has(payload.baseUnitId)) throw new BadRequestException("Each unit can appear once and the base unit must be attached to the item.");
      if (payload.kind === "MENU_PRODUCT" && !payload.sectionId) throw new BadRequestException("A menu product must be assigned to an internal section.");
      if (payload.kind === "RAW_MATERIAL" && payload.sectionId) throw new BadRequestException("A raw material cannot be assigned to an internal registration section.");
      if (payload.sectionId) {
        const section = await tx.operationsSection.findFirst({ where: { id: payload.sectionId, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true } });
        if (!section) throw new NotFoundException("The selected active operations section was not found.");
      }
      const units = await tx.operationsUnit.findMany({ where: { id: { in: [...uniqueUnitIds] }, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true, dimension: true } });
      if (units.length !== uniqueUnitIds.size) throw new BadRequestException("One or more selected units are not active in this company.");
      const physicalDimensions = new Set(units.filter((unit) => unit.dimension !== "PACKAGE").map((unit) => unit.dimension));
      if (physicalDimensions.size > 1) throw new BadRequestException("An item can use one physical dimension, plus product-specific package units when needed.");
      for (const line of payload.unitPrices) {
        if (payload.kind === "RAW_MATERIAL" && line.menuSaleUnitPrice) throw new BadRequestException("Raw materials cannot carry a menu sale price.");
        if (payload.kind === "MENU_PRODUCT" && line.lastPurchaseUnitPrice) throw new BadRequestException("Menu products cannot carry a purchase price.");
      }
      const id = randomUUID();
      await tx.operationsItem.create({ data: {
        id, tenantId: context.tenantId, companyId: context.companyId, code: payload.code, nameAr: payload.nameAr, nameEn: payload.nameEn, kind: payload.kind as OperationsItemKind, sectionId: payload.sectionId, baseUnitId: payload.baseUnitId,
        itemUnits: { create: payload.unitPrices.map((line) => ({ id: randomUUID(), unitId: line.unitId, isBase: line.unitId === payload.baseUnitId, isOrderEnabled: payload.kind === "RAW_MATERIAL" ? line.unitId === payload.baseUnitId : true, lastPurchaseUnitPrice: line.lastPurchaseUnitPrice ?? null, menuSaleUnitPrice: line.menuSaleUnitPrice ?? null })) },
      } });
      await this.audit(tx, context, "operations.item.created", "OperationsItem", id, null, payload);
      return { id, replayed: false };
    }, 201);
  }

  async updateItem(context: TrustedCompanyActorContext, request: UpdateOperationsItemRequest, idempotencyKey: string): Promise<EntityReceipt> {
    return this.withIdempotency(context, "operations.item.update", idempotencyKey, request, async (tx) => {
      const item = await tx.operationsItem.findFirst({ where: { id: request.itemId, tenantId: context.tenantId, companyId: context.companyId, status: OperationsItemStatus.ACTIVE } });
      if (!item) throw new NotFoundException("The active operations item was not found.");
      const payload = { code: code(request.code), nameAr: required(request.nameAr, 160), nameEn: optional(request.nameEn, 160), sectionId: request.sectionId === undefined ? item.sectionId : request.sectionId };
      const duplicate = await tx.operationsItem.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: payload.code, id: { not: item.id } }, select: { id: true } });
      if (duplicate) throw new ConflictException("An operations item with this code already exists.");
      if (item.kind === OperationsItemKind.RAW_MATERIAL && payload.sectionId) throw new BadRequestException("A raw material cannot be assigned to an internal registration section.");
      if (item.kind === OperationsItemKind.MENU_PRODUCT) {
        if (!payload.sectionId) throw new BadRequestException("A menu product must be assigned to an internal section.");
        const section = await tx.operationsSection.findFirst({ where: { id: payload.sectionId, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true } });
        if (!section) throw new NotFoundException("The selected active operations section was not found.");
      }
      await tx.operationsItem.update({ where: { id: item.id }, data: payload });
      await this.audit(tx, context, "operations.item.updated", "OperationsItem", item.id, { code: item.code, nameAr: item.nameAr, nameEn: item.nameEn, sectionId: item.sectionId }, payload);
      return { id: item.id, replayed: false };
    }, 200);
  }

  async configureItemUnits(context: TrustedCompanyActorContext, request: ConfigureOperationsItemUnitsRequest, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { itemId: request.itemId, units: request.units };
    return this.withIdempotency(context, "operations.item_units.configure", idempotencyKey, payload, async (tx) => {
      const item = await tx.operationsItem.findFirst({ where: { id: payload.itemId, tenantId: context.tenantId, companyId: context.companyId, status: OperationsItemStatus.ACTIVE }, include: { itemUnits: true, conversionVersions: { where: { status: OperationsConversionVersionStatus.PUBLISHED }, orderBy: { version: "desc" }, take: 1, include: { edges: true } } } });
      if (!item) throw new NotFoundException("The active operations item was not found.");
      const uniqueIds = new Set(payload.units.map((line) => line.unitId));
      if (uniqueIds.size !== payload.units.length || !uniqueIds.has(item.baseUnitId)) throw new BadRequestException("Each item unit is configured once and must include the immutable base unit.");
      const base = payload.units.find((line) => line.unitId === item.baseUnitId)!;
      if (!base.isActive || !base.isOrderEnabled) throw new BadRequestException("The base unit must stay active and available for use.");
      const units = await tx.operationsUnit.findMany({ where: { id: { in: [...uniqueIds] }, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true, dimension: true } });
      if (units.length !== uniqueIds.size) throw new BadRequestException("Every configured item unit must be active in this company.");
      const physicalDimensions = new Set(units.filter((unit) => unit.dimension !== "PACKAGE").map((unit) => unit.dimension));
      if (physicalDimensions.size > 1) throw new BadRequestException("An item can use one physical dimension, plus product-specific package units.");
      const currentByUnit = new Map(item.itemUnits.map((line) => [line.unitId, line]));
      const published = item.conversionVersions[0];
      for (const line of payload.units) {
        if (line.unitId === item.baseUnitId || !line.isOrderEnabled) continue;
        if (!line.isActive) throw new BadRequestException("An unavailable item unit cannot be enabled for purchase.");
        if (item.kind === OperationsItemKind.RAW_MATERIAL && !this.hasPublishedPathToBase(item.baseUnitId, line.unitId, published?.edges ?? [])) throw new BadRequestException("Publish a complete conversion to the base unit before enabling this purchase unit.");
      }
      for (const line of payload.units) {
        const existing = currentByUnit.get(line.unitId);
        if (existing) await tx.operationsItemUnit.update({ where: { id: existing.id }, data: { isActive: line.isActive, isOrderEnabled: line.isOrderEnabled } });
        else if (line.isActive) await tx.operationsItemUnit.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, itemId: item.id, unitId: line.unitId, isBase: false, isActive: true, isOrderEnabled: item.kind === OperationsItemKind.RAW_MATERIAL ? false : line.isOrderEnabled } });
      }
      await this.audit(tx, context, "operations.item_units.configured", "OperationsItem", item.id, item.itemUnits.map((line) => ({ unitId: line.unitId, isActive: line.isActive, isOrderEnabled: line.isOrderEnabled })), payload.units);
      return { id: item.id, replayed: false };
    }, 200);
  }

  async archiveItem(context: TrustedCompanyActorContext, itemId: string, idempotencyKey: string): Promise<EntityReceipt> {
    return this.withIdempotency(context, "operations.item.archive", idempotencyKey, { itemId }, async (tx) => {
      const item = await tx.operationsItem.findFirst({ where: { id: itemId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, status: true } });
      if (!item) throw new NotFoundException("The operations item was not found.");
      if (item.status === OperationsItemStatus.ARCHIVED) return { id: item.id, replayed: false };
      await tx.operationsItem.update({ where: { id: item.id }, data: { status: OperationsItemStatus.ARCHIVED } });
      await this.audit(tx, context, "operations.item.archived", "OperationsItem", item.id, { status: item.status }, { status: OperationsItemStatus.ARCHIVED });
      return { id: item.id, replayed: false };
    }, 200);
  }

  async updateItemUnitPrice(context: TrustedCompanyActorContext, itemId: string, unitId: string, price: string, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { itemId, unitId, price };
    return this.withIdempotency(context, "operations.item_unit.price.update", idempotencyKey, payload, async (tx) => {
      const item = await tx.operationsItem.findFirst({ where: { id: itemId, tenantId: context.tenantId, companyId: context.companyId, status: OperationsItemStatus.ACTIVE }, select: { id: true, kind: true } });
      if (!item) throw new NotFoundException("The active operations item was not found.");
      if (item.kind === OperationsItemKind.RAW_MATERIAL) throw new BadRequestException("A raw material's last purchase price is updated only by a posted receipt.");
      const unit = await tx.operationsItemUnit.findFirst({ where: { itemId, unitId, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true, lastPurchaseUnitPrice: true, menuSaleUnitPrice: true } });
      if (!unit) throw new NotFoundException("The active item unit was not found.");
      await tx.operationsItemUnit.update({ where: { id: unit.id }, data: { menuSaleUnitPrice: price } });
      await this.audit(tx, context, "operations.item_unit.price.updated", "OperationsItemUnit", unit.id, { menuSaleUnitPrice: unit.menuSaleUnitPrice?.toString() ?? null }, { price, kind: item.kind });
      return { id: unit.id, replayed: false };
    }, 200);
  }

  async publishConversions(context: TrustedCompanyActorContext, itemId: string, edges: ConversionEdge[], idempotencyKey: string): Promise<EntityReceipt> {
    return this.withIdempotency(context, "operations.conversions.publish", idempotencyKey, { itemId, edges }, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-conversion:${context.companyId}:${itemId}`}))`;
      const item = await tx.operationsItem.findFirst({ where: { id: itemId, tenantId: context.tenantId, companyId: context.companyId, status: OperationsItemStatus.ACTIVE }, include: { itemUnits: { where: { isActive: true }, select: { unitId: true, unit: { select: { dimension: true } } } }, conversionVersions: { select: { version: true } } } });
      if (!item) throw new NotFoundException("The selected active operations item was not found.");
      this.validateConversionGraph(item.baseUnitId, item.itemUnits.map((unit) => ({ id: unit.unitId, dimension: unit.unit.dimension })), edges);
      await tx.operationsItemConversionVersion.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, itemId, status: OperationsConversionVersionStatus.PUBLISHED }, data: { status: OperationsConversionVersionStatus.SUPERSEDED } });
      const version = Math.max(0, ...item.conversionVersions.map((entry) => entry.version)) + 1;
      const id = randomUUID();
      await tx.operationsItemConversionVersion.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, itemId, version, status: OperationsConversionVersionStatus.PUBLISHED, publishedBy: context.actorUserId, edges: { create: edges.map((edge) => ({ id: randomUUID(), fromUnitId: edge.fromUnitId, toUnitId: edge.toUnitId, factor: edge.factor })) } } });
      await tx.operationsItemUnit.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, itemId, isActive: true }, data: { isOrderEnabled: true } });
      await this.audit(tx, context, "operations.conversions.published", "OperationsItemConversionVersion", id, null, { itemId, version, edges });
      return { id, replayed: false };
    }, 201);
  }

  private validateConversionGraph(baseUnitId: string, itemUnits: Array<{ id: string; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" }>, edges: ConversionEdge[]) {
    const known = new Map(itemUnits.map((unit) => [unit.id, unit.dimension]));
    const outgoing = new Map<string, string>();
    for (const edge of edges) {
      const fromDimension = known.get(edge.fromUnitId); const toDimension = known.get(edge.toUnitId);
      if (!fromDimension || !toDimension || edge.fromUnitId === edge.toUnitId) throw new BadRequestException("A conversion must join two different units attached to the item.");
      if (fromDimension !== toDimension && fromDimension !== "PACKAGE" && toDimension !== "PACKAGE") throw new BadRequestException("A conversion may only cross dimensions through a defined package unit.");
      if (outgoing.has(edge.fromUnitId)) throw new BadRequestException("Each non-base unit may have only one conversion path toward the base unit.");
      outgoing.set(edge.fromUnitId, edge.toUnitId);
    }
    if (outgoing.has(baseUnitId)) throw new BadRequestException("The base unit cannot convert away from itself.");
    for (const unitId of known.keys()) {
      if (unitId === baseUnitId) continue;
      const seen = new Set<string>(); let cursor: string | undefined = unitId;
      while (cursor && cursor !== baseUnitId) { if (seen.has(cursor)) throw new BadRequestException("A conversion path cannot contain a cycle."); seen.add(cursor); cursor = outgoing.get(cursor); }
      if (cursor !== baseUnitId) throw new BadRequestException("Every non-base unit must have one complete path to the base unit.");
    }
  }

  private hasPublishedPathToBase(baseUnitId: string, unitId: string, edges: Array<{ fromUnitId: string; toUnitId: string }>) {
    const paths = new Map(edges.map((edge) => [edge.fromUnitId, edge.toUnitId]));
    const seen = new Set<string>(); let cursor = unitId;
    while (cursor !== baseUnitId) { if (seen.has(cursor)) return false; seen.add(cursor); const next = paths.get(cursor); if (!next) return false; cursor = next; }
    return true;
  }

  private async withIdempotency<T extends EntityReceipt>(context: TrustedCompanyActorContext, operation: string, key: string, request: unknown, action: (tx: Prisma.TransactionClient) => Promise<T>, status: number): Promise<T> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      let begun;
      try { begun = await this.idempotency.beginInTransaction(tx, context, { operation, key, request: request as CanonicalJsonValue, expiresAt: new Date(Date.now() + 86_400_000) }); }
      catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was already used with a different operations request."); throw error; }
      if (begun.kind === "replay") return { ...(begun.response.body as T), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The operations request is still in progress.");
      const receipt = await action(tx);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status, headers: null, body: receipt as CanonicalJsonValue } });
      return receipt;
    });
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, beforeJson: unknown, afterJson: unknown) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson === null ? Prisma.JsonNull : beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } });
  }
}

function code(value: string) { return required(value, 80).toUpperCase().replace(/\s+/g, "_"); }
function required(value: string, max: number) { const normalized = value.trim(); if (!normalized || normalized.length > max) throw new BadRequestException("A required operational value is invalid."); return normalized; }
function optional(value: string | undefined, max: number) { if (!value?.trim()) return null; return required(value, max); }

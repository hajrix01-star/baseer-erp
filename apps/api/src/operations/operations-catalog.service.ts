import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { ConfigureOperationsItemUnitsRequest, OperationsCatalogQuery, UpdateOperationsItemRequest, UpdateOperationsSectionRequest, UpdateOperationsUnitRequest } from "@baseer-erp/contracts";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { OperationsConversionVersionStatus, OperationsItemKind, OperationsItemStatus, OperationsPurchaseRequestStatus, OperationsRecipeVersionStatus, Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

type CreateUnit = { nameAr: string; nameEn?: string | undefined; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" };
type RestaurantUnitPreset = CreateUnit & { code: string };
type CreateSection = { code: string; nameAr: string; nameEn?: string | undefined };
type CreateItem = { code: string; nameAr: string; nameEn?: string | undefined; kind: "RAW_MATERIAL" | "MENU_PRODUCT"; sectionId?: string | undefined; baseUnitId: string; unitPrices: Array<{ unitId: string; lastPurchaseUnitPrice?: string | undefined; menuSaleUnitPrice?: string | undefined }> };
type ConversionEdge = { fromUnitId: string; toUnitId: string; factor: string };
type EntityReceipt = { id: string; replayed: boolean };

const restaurantUnitPresets: ReadonlyArray<RestaurantUnitPreset> = [
  { code: "PCS", nameAr: "حبة", nameEn: "Piece", dimension: "COUNT" },
  { code: "HALF-PCS", nameAr: "نصف حبة", nameEn: "Half piece", dimension: "COUNT" },
  { code: "DOZEN", nameAr: "درزن", nameEn: "Dozen", dimension: "COUNT" },
  { code: "PAIR", nameAr: "زوج", nameEn: "Pair", dimension: "COUNT" },
  { code: "G", nameAr: "جرام", nameEn: "Gram", dimension: "MASS" },
  { code: "KG", nameAr: "كيلوغرام", nameEn: "Kilogram", dimension: "MASS" },
  { code: "MG", nameAr: "ملليجرام", nameEn: "Milligram", dimension: "MASS" },
  { code: "OZ", nameAr: "أونصة", nameEn: "Ounce", dimension: "MASS" },
  { code: "LB", nameAr: "رطل", nameEn: "Pound", dimension: "MASS" },
  { code: "ML", nameAr: "ملليلتر", nameEn: "Millilitre", dimension: "VOLUME" },
  { code: "CL", nameAr: "سنتيلتر", nameEn: "Centilitre", dimension: "VOLUME" },
  { code: "L", nameAr: "لتر", nameEn: "Litre", dimension: "VOLUME" },
  { code: "CARTON", nameAr: "كرتون", nameEn: "Carton", dimension: "PACKAGE" },
  { code: "BOX", nameAr: "صندوق", nameEn: "Box", dimension: "PACKAGE" },
  { code: "CASE", nameAr: "كرتون كبير", nameEn: "Case", dimension: "PACKAGE" },
  { code: "BAG", nameAr: "كيس", nameEn: "Bag", dimension: "PACKAGE" },
  { code: "SACK", nameAr: "شوال", nameEn: "Sack", dimension: "PACKAGE" },
  { code: "PACK", nameAr: "باكيت", nameEn: "Pack", dimension: "PACKAGE" },
  { code: "CAN", nameAr: "علبة", nameEn: "Tin", dimension: "PACKAGE" },
  { code: "BOTTLE", nameAr: "قارورة", nameEn: "Bottle", dimension: "PACKAGE" },
  { code: "JAR", nameAr: "برطمان", nameEn: "Jar", dimension: "PACKAGE" },
  { code: "TRAY", nameAr: "صينية", nameEn: "Tray", dimension: "PACKAGE" },
  { code: "BUNDLE", nameAr: "ربطة", nameEn: "Bundle", dimension: "PACKAGE" },
  { code: "ROLL", nameAr: "رول", nameEn: "Roll", dimension: "PACKAGE" },
  { code: "CUP", nameAr: "كوب", nameEn: "Cup", dimension: "PACKAGE" },
];

@Injectable()
export class OperationsCatalogService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async catalog(context: TrustedCompanyActorContext, query: OperationsCatalogQuery = { pageSize: 50 }) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const pageSize = query.pageSize ?? 50;
      const itemWhere: Prisma.OperationsItemWhereInput = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search ? { OR: [
          { code: { contains: query.search, mode: "insensitive" } },
          { nameAr: { contains: query.search, mode: "insensitive" } },
          { nameEn: { contains: query.search, mode: "insensitive" } },
        ] } : {}),
        ...(query.orderReady || query.missingPurchasePrice ? { AND: [
          ...(query.orderReady ? [{ itemUnits: { some: { isActive: true, isOrderEnabled: true } } }] : []),
          ...(query.missingPurchasePrice ? [{ itemUnits: { none: { isActive: true, isOrderEnabled: true, lastPurchaseUnitPrice: { not: null } } } }] : []),
        ] } : {}),
      };
      if (query.cursor) {
        const cursor = await tx.operationsItem.findFirst({ where: { ...itemWhere, id: query.cursor }, select: { id: true } });
        if (!cursor) throw new BadRequestException("The catalog cursor is outside this company and filter scope.");
      }
      const [sections, units, metricItems, itemCandidates] = await Promise.all([
        tx.operationsSection.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { nameAr: "asc" }] }),
        tx.operationsUnit.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ isActive: "desc" }, { dimension: "asc" }, { nameAr: "asc" }] }),
        tx.operationsItem.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.RAW_MATERIAL, status: OperationsItemStatus.ACTIVE },
          select: {
            itemUnits: { select: { isActive: true, isOrderEnabled: true, lastPurchaseUnitPrice: true } },
            conversionVersions: { where: { status: OperationsConversionVersionStatus.PUBLISHED }, take: 1, select: { id: true } },
          },
        }),
        tx.operationsItem.findMany({
          where: itemWhere,
          orderBy: [{ status: "asc" }, { nameAr: "asc" }, { id: "asc" }],
          take: pageSize + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          include: {
            itemUnits: { orderBy: [{ isBase: "desc" }, { createdAt: "asc" }] },
            conversionVersions: { where: { status: OperationsConversionVersionStatus.PUBLISHED }, orderBy: { version: "desc" }, take: 1, include: { edges: { orderBy: { createdAt: "asc" } } } },
          },
        }),
      ]);
      const hasMore = itemCandidates.length > pageSize;
      const items = hasMore ? itemCandidates.slice(0, pageSize) : itemCandidates;
      const itemIds = items.map((item) => item.id);
      const publishedRecipes = itemIds.length ? await tx.operationsRecipeVersion.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, outputItemId: { in: itemIds }, status: OperationsRecipeVersionStatus.PUBLISHED },
        orderBy: [{ outputItemId: "asc" }, { version: "desc" }],
        include: { lines: { select: { rawMaterialItemId: true, resolvedBaseQuantity: true } } },
      }) : [];
      const recipeMaterialIds = [...new Set(publishedRecipes.flatMap((recipe) => recipe.lines.map((line) => line.rawMaterialItemId)))];
      const inventoryBalances = recipeMaterialIds.length ? await tx.operationsInventoryBalance.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: { in: recipeMaterialIds } },
        select: { rawMaterialItemId: true, weightedUnitCost: true },
      }) : [];
      const weightedCostByMaterialId = new Map(inventoryBalances.map((balance) => [balance.rawMaterialItemId, balance.weightedUnitCost]));
      const latestRecipeByOutputId = new Map<string, (typeof publishedRecipes)[number]>();
      for (const recipe of publishedRecipes) if (!latestRecipeByOutputId.has(recipe.outputItemId)) latestRecipeByOutputId.set(recipe.outputItemId, recipe);
      const activeRawMaterialCount = metricItems.length;
      const needsConversionCount = metricItems.filter((item) => item.itemUnits.filter((line) => line.isActive).length > 1 && !item.conversionVersions.length).length;
      const missingPurchasePriceCount = metricItems.filter((item) => !item.itemUnits.some((line) => line.isActive && line.isOrderEnabled && line.lastPurchaseUnitPrice)).length;
      return {
        companyId: context.companyId,
        sections: sections.map((section) => ({ id: section.id, code: section.code, nameAr: section.nameAr, nameEn: section.nameEn, isActive: section.isActive })),
        units: units.map((unit) => ({ id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn, dimension: unit.dimension, isActive: unit.isActive })),
        metrics: { activeRawMaterialCount, needsConversionCount, missingPurchasePriceCount },
        items: items.map((item) => {
          const version = item.conversionVersions[0];
          const recipe = latestRecipeByOutputId.get(item.id);
          const recipeCostAvailable = Boolean(recipe?.lines.length) && recipe!.lines.every((line) => {
            const weightedUnitCost = weightedCostByMaterialId.get(line.rawMaterialItemId);
            return weightedUnitCost !== undefined && weightedUnitCost.greaterThan(0);
          });
          const liveRecipeUnitCost = recipeCostAvailable && recipe
            ? recipe.lines.reduce((total, line) => total.plus(line.resolvedBaseQuantity.mul(weightedCostByMaterialId.get(line.rawMaterialItemId)!)), new Prisma.Decimal(0)).div(recipe.outputQuantity).toDecimalPlaces(4).toString()
            : null;
          return {
            id: item.id, code: item.code, nameAr: item.nameAr, nameEn: item.nameEn, kind: item.kind, status: item.status, sectionId: item.sectionId, baseUnitId: item.baseUnitId,
            itemUnits: item.itemUnits.map((line) => ({ id: line.id, unitId: line.unitId, isBase: line.isBase, isOrderEnabled: line.isOrderEnabled, isActive: line.isActive, lastPurchaseUnitPrice: line.lastPurchaseUnitPrice?.toString() ?? null, lastPurchasePriceAt: line.lastPurchasePriceAt?.toISOString() ?? null, menuSaleUnitPrice: line.menuSaleUnitPrice?.toString() ?? null })),
            conversionVersion: version ? { id: version.id, version: version.version, status: version.status, publishedAt: version.publishedAt.toISOString(), edges: version.edges.map((edge) => ({ fromUnitId: edge.fromUnitId, toUnitId: edge.toUnitId, factor: edge.factor.toString() })) } : null,
            liveRecipeUnitCost,
            liveRecipeCostStatus: recipe ? recipeCostAvailable ? "AVAILABLE" : "INCOMPLETE" : "NO_RECIPE",
          };
        }),
        nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
        asOf: new Date().toISOString(),
      };
    });
  }

  async createUnit(context: TrustedCompanyActorContext, request: CreateUnit, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { ...request, nameAr: required(request.nameAr, 80), nameEn: optional(request.nameEn, 80) };
    return this.withIdempotency(context, "operations.unit.create", idempotencyKey, payload, async (tx) => {
      // This lock and generated number make the user-facing unit reference
      // sequential even when two managers add a unit at the same time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-unit-code:${context.companyId}`}))`;
      const existingCodes = await tx.operationsUnit.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, code: { startsWith: "UOM-" } }, select: { code: true } });
      const lastSerial = existingCodes.reduce((highest, unit) => Math.max(highest, Number(/^UOM-(\d+)$/.exec(unit.code)?.[1] ?? 0)), 0);
      const generatedCode = `UOM-${String(lastSerial + 1).padStart(4, "0")}`;
      const id = randomUUID();
      await tx.operationsUnit.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...payload, code: generatedCode } });
      await this.audit(tx, context, "operations.unit.created", "OperationsUnit", id, null, { ...payload, code: generatedCode });
      return { id, replayed: false };
    }, 201);
  }

  async installRestaurantUnitPresets(context: TrustedCompanyActorContext, idempotencyKey: string): Promise<EntityReceipt> {
    return this.withIdempotency(context, "operations.unit_presets.install", idempotencyKey, { preset: "restaurant-v1" }, async (tx) => {
      const existing = await tx.operationsUnit.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, code: { in: restaurantUnitPresets.map((unit) => unit.code) } }, select: { id: true, code: true } });
      const present = new Map(existing.map((unit) => [unit.code, unit.id]));
      const missing = restaurantUnitPresets.filter((unit) => !present.has(unit.code));
      if (missing.length) await tx.operationsUnit.createMany({ data: missing.map((unit) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn ?? null, dimension: unit.dimension })) });
      const all = await tx.operationsUnit.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, code: { in: restaurantUnitPresets.map((unit) => unit.code) } }, select: { id: true, code: true } });
      const id = all.find((unit) => unit.code === "CARTON")?.id ?? all[0]?.id;
      if (!id) throw new NotFoundException("Restaurant unit presets could not be installed.");
      await this.audit(tx, context, "operations.unit_presets.installed", "OperationsUnit", id, { existing: existing.map((unit) => unit.code) }, { created: missing.map((unit) => unit.code), preset: "restaurant-v1" });
      return { id, replayed: false };
    }, 201);
  }

  async updateUnit(context: TrustedCompanyActorContext, request: UpdateOperationsUnitRequest, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { unitId: request.unitId, nameAr: required(request.nameAr, 80), nameEn: optional(request.nameEn, 80), isActive: request.isActive };
    return this.withIdempotency(context, "operations.unit.update", idempotencyKey, payload, async (tx) => {
      const unit = await tx.operationsUnit.findFirst({ where: { id: payload.unitId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!unit) throw new NotFoundException("The operations unit was not found.");
      if (!payload.isActive && unit.isActive) {
        const [baseUses, activeUses] = await Promise.all([
          tx.operationsItem.count({ where: { tenantId: context.tenantId, companyId: context.companyId, baseUnitId: unit.id, status: OperationsItemStatus.ACTIVE } }),
          tx.operationsItemUnit.count({ where: { tenantId: context.tenantId, companyId: context.companyId, unitId: unit.id, isActive: true, item: { status: OperationsItemStatus.ACTIVE } } }),
        ]);
        if (baseUses || activeUses) throw new ConflictException("Deactivate this unit on its active items before deactivating the shared unit.");
      }
      await tx.operationsUnit.update({ where: { id: unit.id }, data: { nameAr: payload.nameAr, nameEn: payload.nameEn, isActive: payload.isActive } });
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
      // The conversion graph validates every physical bridge. An item may
      // therefore carry mass and volume units when it explicitly publishes
      // its material-specific bridge (for example litre → gram).
      for (const line of payload.unitPrices) {
        if (payload.kind === "RAW_MATERIAL" && line.menuSaleUnitPrice) throw new BadRequestException("Raw materials cannot carry a menu sale price.");
        if (payload.kind === "MENU_PRODUCT" && line.lastPurchaseUnitPrice) throw new BadRequestException("Menu products cannot carry a purchase price.");
      }
      const id = randomUUID();
      await tx.operationsItem.create({ data: {
        id, tenantId: context.tenantId, companyId: context.companyId, code: payload.code, nameAr: payload.nameAr, nameEn: payload.nameEn, kind: payload.kind as OperationsItemKind, sectionId: payload.sectionId, baseUnitId: payload.baseUnitId,
        // The base may be the smallest consumable unit. Purchasing units are
        // enabled only after the manager chooses the applicable packaging.
        itemUnits: { create: payload.unitPrices.map((line) => ({ id: randomUUID(), unitId: line.unitId, isBase: line.unitId === payload.baseUnitId, isOrderEnabled: payload.kind === "RAW_MATERIAL" ? false : true, lastPurchaseUnitPrice: line.lastPurchaseUnitPrice ?? null, menuSaleUnitPrice: line.menuSaleUnitPrice ?? null })) },
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
      // The inventory base can be the smallest consumable unit (for example,
      // grams) while purchases are intentionally limited to carton and tin.
      // It must remain usable on the item, but it is not required to be a
      // purchasable unit.
      if (!base.isActive) throw new BadRequestException("The base unit must stay active on the material.");
      const units = await tx.operationsUnit.findMany({ where: { id: { in: [...uniqueIds] }, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true, dimension: true } });
      if (units.length !== uniqueIds.size) throw new BadRequestException("Every configured item unit must be active in this company.");
      const physicalDimensions = new Set(units.filter((unit) => unit.dimension !== "PACKAGE").map((unit) => unit.dimension));
      if ([...physicalDimensions].some((dimension) => dimension !== "COUNT" && dimension !== "MASS" && dimension !== "VOLUME")) {
        throw new BadRequestException("An item can use count, mass, volume, and product-specific package units only.");
      }
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

  async publishConversions(context: TrustedCompanyActorContext, itemId: string, edges: ConversionEdge[], requestedBaseUnitId: string | undefined, idempotencyKey: string): Promise<EntityReceipt> {
    return this.withIdempotency(context, "operations.conversions.publish", idempotencyKey, { itemId, edges, baseUnitId: requestedBaseUnitId ?? null }, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-conversion:${context.companyId}:${itemId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-inventory:${context.companyId}:${itemId}`}))`;
      const item = await tx.operationsItem.findFirst({ where: { id: itemId, tenantId: context.tenantId, companyId: context.companyId, status: OperationsItemStatus.ACTIVE }, include: { itemUnits: { where: { isActive: true }, select: { unitId: true, unit: { select: { dimension: true } } } }, conversionVersions: { select: { version: true } } } });
      if (!item) throw new NotFoundException("The selected active operations item was not found.");
      if (item.kind !== OperationsItemKind.RAW_MATERIAL) throw new BadRequestException("Only raw materials can publish inventory conversions.");
      const nextBaseUnitId = requestedBaseUnitId ?? item.baseUnitId;
      this.validateConversionGraph(nextBaseUnitId, item.itemUnits.map((unit) => ({ id: unit.unitId, dimension: unit.unit.dimension })), edges);
      if (nextBaseUnitId !== item.baseUnitId) {
        // Historical documents retain their conversion snapshots. A new base unit
        // is therefore safe after a fully reversed test receipt, but never while a
        // live quantity/value, an open request, or a published recipe would still
        // interpret its stored base quantities using the old unit.
        const [balance, openRequestLineCount, publishedRecipeLineCount] = await Promise.all([
          tx.operationsInventoryBalance.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: item.id }, select: { baseQuantity: true, totalValue: true } }),
          tx.operationsPurchaseRequestLine.count({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: item.id, request: { status: { in: [OperationsPurchaseRequestStatus.PENDING_RECEIPT, OperationsPurchaseRequestStatus.PARTIALLY_RECEIVED] } } } }),
          tx.operationsRecipeLine.count({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: item.id, recipeVersion: { status: OperationsRecipeVersionStatus.PUBLISHED } } }),
        ]);
        if ((balance && (!balance.baseQuantity.isZero() || !balance.totalValue.isZero())) || openRequestLineCount > 0 || publishedRecipeLineCount > 0) {
          throw new ConflictException("The inventory base unit cannot change while the material has an on-hand balance, an open purchase request, or a published recipe.");
        }
        await tx.operationsItem.update({ where: { id: item.id }, data: { baseUnitId: nextBaseUnitId } });
        await tx.operationsItemUnit.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, itemId: item.id }, data: { isBase: false } });
        await tx.operationsItemUnit.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, itemId: item.id, unitId: nextBaseUnitId }, data: { isBase: true, isActive: true } });
      }
      await tx.operationsItemConversionVersion.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, itemId, status: OperationsConversionVersionStatus.PUBLISHED }, data: { status: OperationsConversionVersionStatus.SUPERSEDED } });
      const version = Math.max(0, ...item.conversionVersions.map((entry) => entry.version)) + 1;
      const id = randomUUID();
      await tx.operationsItemConversionVersion.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, itemId, version, status: OperationsConversionVersionStatus.PUBLISHED, publishedBy: context.actorUserId, edges: { create: edges.map((edge) => ({ id: randomUUID(), fromUnitId: edge.fromUnitId, toUnitId: edge.toUnitId, factor: edge.factor })) } } });
      await this.audit(tx, context, "operations.conversions.published", "OperationsItemConversionVersion", id, null, { itemId, version, edges, baseUnitId: nextBaseUnitId });
      return { id, replayed: false };
    }, 201);
  }

  private validateConversionGraph(baseUnitId: string, itemUnits: Array<{ id: string; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" }>, edges: ConversionEdge[]) {
    const known = new Map(itemUnits.map((unit) => [unit.id, unit.dimension]));
    if (!known.has(baseUnitId)) throw new BadRequestException("The inventory base unit must remain attached to the material.");
    if (edges.length !== Math.max(0, known.size - 1)) throw new BadRequestException("Material conversions must form one connected chain without duplicate paths.");
    const adjacent = new Map([...known.keys()].map((unitId) => [unitId, new Set<string>()]));
    const connectedPairs = new Set<string>();
    for (const edge of edges) {
      const fromDimension = known.get(edge.fromUnitId); const toDimension = known.get(edge.toUnitId);
      if (!fromDimension || !toDimension || edge.fromUnitId === edge.toUnitId) throw new BadRequestException("A conversion must join two different units attached to the item.");
      // Any cross-dimension bridge is valid only when a manager explicitly
      // publishes it on this exact material: e.g. 1 kg orange = 5 pieces or
      // 1 piece orange = 200 g. There is no global COUNT/MASS/VOLUME rule.
      // The edge is versioned with the material, so it cannot leak to another
      // item whose average piece weight or density is different.
      const pair = [edge.fromUnitId, edge.toUnitId].sort().join(":");
      if (connectedPairs.has(pair)) throw new BadRequestException("A material conversion can be defined only once for each pair of units.");
      connectedPairs.add(pair);
      adjacent.get(edge.fromUnitId)!.add(edge.toUnitId);
      adjacent.get(edge.toUnitId)!.add(edge.fromUnitId);
    }
    const visited = new Set<string>([baseUnitId]);
    const queue = [baseUnitId];
    while (queue.length) for (const next of adjacent.get(queue.shift()!) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    if (visited.size !== known.size) throw new BadRequestException("Every material unit must connect to the inventory base through one conversion path.");
  }

  private hasPublishedPathToBase(baseUnitId: string, unitId: string, edges: Array<{ fromUnitId: string; toUnitId: string }>) {
    const adjacent = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adjacent.has(edge.fromUnitId)) adjacent.set(edge.fromUnitId, new Set());
      if (!adjacent.has(edge.toUnitId)) adjacent.set(edge.toUnitId, new Set());
      adjacent.get(edge.fromUnitId)!.add(edge.toUnitId);
      adjacent.get(edge.toUnitId)!.add(edge.fromUnitId);
    }
    const seen = new Set<string>([unitId]); const queue = [unitId];
    while (queue.length) {
      const cursor = queue.shift()!;
      if (cursor === baseUnitId) return true;
      for (const next of adjacent.get(cursor) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    return false;
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

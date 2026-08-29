import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { CreateOperationsInternalRegistrationRequest, OperationsInternalRegistrationReportQuery } from "@baseer-erp/contracts";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DocumentSerialService, IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/index.js";
import { DatabaseService } from "../database/database.service.js";
import { OperationsInventoryMovementType, OperationsItemKind, OperationsItemStatus, OperationsRecipeVersionStatus, Prisma } from "../generated/prisma/client.js";
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
      if (new Set(payload.lines.map((line) => line.menuProductItemId)).size !== payload.lines.length) throw new BadRequestException("A menu product can appear only once in a registration.");
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
      const recipes = await tx.operationsRecipeVersion.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, outputItemId: { in: productIds }, status: OperationsRecipeVersionStatus.PUBLISHED }, orderBy: [{ outputItemId: "asc" }, { version: "desc" }], include: { lines: true } });
      const latestRecipeByOutput = new Map<string, typeof recipes[number]>();
      for (const recipe of recipes) if (!latestRecipeByOutput.has(recipe.outputItemId)) latestRecipeByOutput.set(recipe.outputItemId, recipe);
      const plannedConsumptions = [] as Array<{ registrationLineIndex: number; recipe: typeof recipes[number]; recipeLine: typeof recipes[number]["lines"][number]; consumedBaseQuantity: Prisma.Decimal }>;
      for (const [registrationLineIndex, line] of prepared.entries()) {
        const recipe = latestRecipeByOutput.get(line.menuProductItemId);
        if (!recipe) throw new BadRequestException("A published recipe is required before this menu product can be registered.");
        if (recipe.outputUnitId !== line.unitId) throw new BadRequestException("The internal registration unit must match the published recipe output unit.");
        const multiplier = new Prisma.Decimal(line.quantity).div(recipe.outputQuantity);
        for (const recipeLine of recipe.lines) {
          const consumedBaseQuantity = operationalQuantity(recipeLine.resolvedBaseQuantity.mul(multiplier));
          if (consumedBaseQuantity.lte(0)) throw new BadRequestException("The recipe consumption quantity is invalid.");
          plannedConsumptions.push({ registrationLineIndex, recipe, recipeLine, consumedBaseQuantity });
        }
      }
      await this.lockInventoryItems(tx, context, plannedConsumptions.map((line) => line.recipeLine.rawMaterialItemId));
      const requiredByMaterial = new Map<string, Prisma.Decimal>();
      for (const line of plannedConsumptions) requiredByMaterial.set(line.recipeLine.rawMaterialItemId, operationalQuantity((requiredByMaterial.get(line.recipeLine.rawMaterialItemId) ?? zero()).plus(line.consumedBaseQuantity)));
      const balances = await tx.operationsInventoryBalance.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: { in: [...requiredByMaterial.keys()] } }, select: { id: true, rawMaterialItemId: true, baseQuantity: true, totalValue: true, weightedUnitCost: true } });
      const balanceByMaterial = new Map(balances.map((balance) => [balance.rawMaterialItemId, balance]));
      for (const [rawMaterialItemId, requiredQuantity] of requiredByMaterial) {
        const balance = balanceByMaterial.get(rawMaterialItemId);
        if (!balance || balance.baseQuantity.lt(requiredQuantity)) throw new ConflictException("The raw material stock is insufficient for this internal registration.");
      }
      const id = randomUUID(); const registrationNumber = await this.documentNumber(tx, context, payload.businessDate, "OIR");
      await tx.operationsInternalRegistration.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, registrationNumber, sectionId: payload.sectionId, businessDate: new Date(`${payload.businessDate}T00:00:00.000Z`), notes: payload.notes, createdByUserId: context.actorUserId } });
      const runningBalances = new Map(balanceByMaterial);
      for (const [index, line] of prepared.entries()) {
        const recipe = latestRecipeByOutput.get(line.menuProductItemId)!;
        const registrationLineId = randomUUID(); const menuSaleUnitPriceSnapshot = line.unit.menuSaleUnitPrice; const lineTotalSnapshot = menuSaleUnitPriceSnapshot ? money(new Prisma.Decimal(line.quantity).mul(menuSaleUnitPriceSnapshot)) : null;
        await tx.operationsInternalRegistrationLine.create({ data: { id: registrationLineId, tenantId: context.tenantId, companyId: context.companyId, registrationId: id, lineNumber: index + 1, menuProductItemId: line.menuProductItemId, unitId: line.unitId, quantity: new Prisma.Decimal(line.quantity), productNameArSnapshot: line.product.nameAr, productNameEnSnapshot: line.product.nameEn, unitNameArSnapshot: line.unit.unit.nameAr, unitNameEnSnapshot: line.unit.unit.nameEn, menuSaleUnitPriceSnapshot, lineTotalSnapshot, recipeVersionId: recipe.id, recipeOutputQuantitySnapshot: recipe.outputQuantity } });
        for (const planned of plannedConsumptions.filter((entry) => entry.registrationLineIndex === index)) {
          const balance = runningBalances.get(planned.recipeLine.rawMaterialItemId)!;
          const nextQuantity = operationalQuantity(balance.baseQuantity.minus(planned.consumedBaseQuantity));
          const provisionalValue = money(planned.consumedBaseQuantity.mul(balance.weightedUnitCost));
          const candidateNextValue = money(balance.totalValue.minus(provisionalValue));
          const nextValue = nextQuantity.isZero() || candidateNextValue.lt(0) ? zero() : candidateNextValue;
          const consumedValue = money(balance.totalValue.minus(nextValue));
          const consumptionId = randomUUID();
          await tx.operationsInternalRegistrationConsumption.create({ data: { id: consumptionId, tenantId: context.tenantId, companyId: context.companyId, registrationLineId, recipeVersionId: planned.recipe.id, recipeLineId: planned.recipeLine.id, rawMaterialItemId: planned.recipeLine.rawMaterialItemId, unitId: planned.recipeLine.unitId, baseUnitId: planned.recipeLine.baseUnitId, conversionVersionId: planned.recipeLine.conversionVersionId, recipeQuantitySnapshot: planned.recipeLine.quantity, recipeResolvedBaseQuantitySnapshot: planned.recipeLine.resolvedBaseQuantity, consumedBaseQuantity: planned.consumedBaseQuantity, weightedUnitCostSnapshot: balance.weightedUnitCost, consumedValue } });
          const weightedUnitCostAfter = nextQuantity.isZero() ? zero() : balance.weightedUnitCost;
          await tx.operationsInventoryBalance.update({ where: { id: balance.id }, data: { baseQuantity: nextQuantity, totalValue: nextValue, weightedUnitCost: weightedUnitCostAfter } });
          await tx.operationsInventoryMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: planned.recipeLine.rawMaterialItemId, receiptId: null, internalRegistrationConsumptionId: consumptionId, movementNumber: await this.documentNumber(tx, context, payload.businessDate, "OIC"), movementType: OperationsInventoryMovementType.INTERNAL_CONSUMPTION, baseQuantityDelta: planned.consumedBaseQuantity.neg(), valueDelta: consumedValue.neg(), quantityAfter: nextQuantity, valueAfter: nextValue, weightedUnitCostAfter, businessDate: new Date(`${payload.businessDate}T00:00:00.000Z`), createdByUserId: context.actorUserId } });
          runningBalances.set(planned.recipeLine.rawMaterialItemId, { ...balance, baseQuantity: nextQuantity, totalValue: nextValue, weightedUnitCost: weightedUnitCostAfter });
        }
      }
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "operations.internal_registration.created", entityType: "OperationsInternalRegistration", entityId: id, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: Prisma.JsonNull, afterJson: { registrationNumber, businessDate: payload.businessDate, sectionId: payload.sectionId, lineCount: prepared.length, consumptionCount: plannedConsumptions.length, recipeVersions: [...new Set(plannedConsumptions.map((line) => line.recipe.version))] } } });
      return { id, replayed: false };
    });
  }

  /** Financial projection for management. The create/workstation projection stays price-free. */
  async report(context: TrustedCompanyActorContext, query: OperationsInternalRegistrationReportQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const period = resolveInternalRegistrationReportPeriod(query);
      const registrations = await tx.operationsInternalRegistration.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          businessDate: { gte: new Date(`${period.from}T00:00:00.000Z`), lte: new Date(`${period.to}T23:59:59.999Z`) },
        },
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
        include: { section: { select: { nameAr: true, nameEn: true } }, lines: { orderBy: { lineNumber: "asc" } } },
      });
      const zero = new Prisma.Decimal(0);
      const lineCount = registrations.reduce((sum, registration) => sum + registration.lines.length, 0);
      const quantity = registrations.reduce((sum, registration) => registration.lines.reduce((lineSum, line) => lineSum.plus(line.quantity), sum), zero);
      const amount = registrations.reduce((sum, registration) => registration.lines.reduce((lineSum, line) => lineSum.plus(line.lineTotalSnapshot ?? zero), sum), zero);
      return { pricingVisible: true as const, period, totals: { registrationCount: registrations.length, lineCount, quantity: quantity.toFixed(8), amount: amount.toFixed(4) }, registrations: registrations.map((registration) => ({ id: registration.id, registrationNumber: registration.registrationNumber, businessDate: registration.businessDate.toISOString().slice(0, 10), sectionNameAr: registration.section.nameAr, sectionNameEn: registration.section.nameEn, notes: registration.notes, lines: registration.lines.map((line) => ({ lineNumber: line.lineNumber, productNameAr: line.productNameArSnapshot, productNameEn: line.productNameEnSnapshot, unitNameAr: line.unitNameArSnapshot, unitNameEn: line.unitNameEnSnapshot, quantity: line.quantity.toString(), menuSaleUnitPrice: line.menuSaleUnitPriceSnapshot?.toFixed(4) ?? null, lineTotal: line.lineTotalSnapshot?.toFixed(4) ?? null })) })) };
    });
  }

  private async lockInventoryItems(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, itemIds: Iterable<string>) { for (const itemId of [...new Set(itemIds)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-inventory:${context.companyId}:${itemId}`}))`; }
  private async documentNumber(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, businessDate: string, series: "OIR" | "OIC") { const value = await this.serials.reserveInTransaction(tx, context, { series, businessDate: businessDate as `${number}-${number}-${number}` }); return `${series}-${businessDate.replaceAll("-", "")}-${value.toString().padStart(5, "0")}`; }
  private async withIdempotency(context: TrustedCompanyActorContext, key: string, payload: unknown, action: (tx: Prisma.TransactionClient) => Promise<EntityReceipt>) { return this.database.inTenantTransaction(context.tenantId, async (tx) => { let begun; try { begun = await this.idempotency.beginInTransaction(tx, context, { operation: "operations.internal_registration.create", key, request: payload as CanonicalJsonValue, expiresAt: new Date(Date.now() + 86_400_000) }); } catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was already used with different registration data."); throw error; } if (begun.kind === "replay") return { ...(begun.response.body as EntityReceipt), replayed: true }; if (begun.kind === "in-progress") throw new ConflictException("The internal registration is still being saved."); const receipt = await action(tx); await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt as CanonicalJsonValue } }); return receipt; }); }
}

function zero() { return new Prisma.Decimal(0); }
function operationalQuantity(value: Prisma.Decimal) { return value.toDecimalPlaces(8); }
function money(value: Prisma.Decimal) { return value.toDecimalPlaces(4); }

/** A missing date range must never implicitly mean all company history.
 * Partial legacy queries stay usable, but are completed to that supplied
 * calendar month's edge; fully explicit ranges keep their caller intent. */
export function resolveInternalRegistrationReportPeriod(query: OperationsInternalRegistrationReportQuery, now = new Date()) {
  if (query.from && query.to) return { from: query.from, to: query.to, source: "EXPLICIT" as const };
  if (query.from) return { from: query.from, to: endOfMonth(query.from), source: "EXPLICIT" as const };
  if (query.to) return { from: startOfMonth(query.to), to: query.to, source: "EXPLICIT" as const };
  const riyadhDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: "year" | "month") => riyadhDate.find((value) => value.type === type)?.value;
  const currentMonth = `${part("year")}-${part("month")}`;
  return { from: `${currentMonth}-01`, to: endOfMonth(`${currentMonth}-01`), source: "DEFAULT_CURRENT_MONTH" as const };
}

function startOfMonth(date: string) { return `${date.slice(0, 7)}-01`; }
function endOfMonth(date: string) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

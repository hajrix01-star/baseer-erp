import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { CancelOperationsPurchaseRequest, CreateOperationsPurchaseRequest, OperationsReportQuery, PreviewOperationsRecipeRequest, PublishOperationsRecipeRequest, ReceiveOperationsPurchaseRequest, ReverseOperationsPurchaseReceipt } from "@baseer-erp/contracts";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DocumentSerialService, IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/index.js";
import { DatabaseService } from "../database/database.service.js";
import { OperationsConversionVersionStatus, OperationsCustodyEventType, OperationsInventoryMovementType, OperationsItemKind, OperationsItemStatus, OperationsPurchaseExecutionKind, OperationsPurchasePaymentChannel, OperationsPurchaseReceiptStatus, OperationsPurchaseRequestStatus, OperationsRecipeVersionStatus, Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";

type EntityReceipt = { id: string; replayed: boolean };
type ReturnCustody = { requestId?: string | undefined; businessDate: string; amount: string; notes: string };

@Injectable()
export class OperationsExecutionService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService, private readonly serials: DocumentSerialService) {}

  async workspace(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [recipes, inventory, requests, profile, events] = await Promise.all([
        tx.operationsRecipeVersion.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: OperationsRecipeVersionStatus.PUBLISHED }, orderBy: [{ outputItemId: "asc" }, { version: "desc" }], include: { lines: true } }),
        tx.operationsInventoryBalance.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: { updatedAt: "desc" } }),
        tx.operationsPurchaseRequest.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: { requestedAt: "desc" }, take: 100, include: { lines: { orderBy: { lineNumber: "asc" } }, receipts: { orderBy: { receiptSequence: "desc" }, include: { lines: true } } } }),
        tx.operationsCustodyProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId } }),
        tx.operationsCustodyEvent.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: { effectiveAt: "desc" }, take: 100 }),
      ]);
      const costs = new Map(inventory.map((balance) => [balance.rawMaterialItemId, balance.weightedUnitCost]));
      const custodyByRequest = new Map<string, Prisma.Decimal>();
      for (const event of events) if (event.requestId) custodyByRequest.set(event.requestId, (custodyByRequest.get(event.requestId) ?? zero()).plus(event.amountDelta));
      const recipeByOutput = new Map<string, typeof recipes[number]>();
      for (const recipe of recipes) if (!recipeByOutput.has(recipe.outputItemId)) recipeByOutput.set(recipe.outputItemId, recipe);
      return {
        recipes: [...recipeByOutput.values()].map((recipe) => ({ outputItemId: recipe.outputItemId, version: recipe.version, outputQuantity: recipe.outputQuantity.toString(), outputUnitId: recipe.outputUnitId, estimatedCost: recipe.lines.reduce((sum, line) => sum.plus(line.resolvedBaseQuantity.mul(costs.get(line.rawMaterialItemId) ?? zero())), zero()).toFixed(4), lines: recipe.lines.map((line) => ({ rawMaterialItemId: line.rawMaterialItemId, unitId: line.unitId, quantity: line.quantity.toString(), resolvedBaseQuantity: line.resolvedBaseQuantity.toString() })) })),
        inventory: inventory.map((balance) => ({ rawMaterialItemId: balance.rawMaterialItemId, baseQuantity: balance.baseQuantity.toString(), totalValue: balance.totalValue.toString(), weightedUnitCost: balance.weightedUnitCost.toString() })),
        requests: requests.map((request) => {
          const estimatedTotal = request.lines.reduce((sum, line) => sum.plus(line.quotedLineTotal ?? zero()), zero());
          const actualTotal = request.receipts.filter((receipt) => receipt.status === OperationsPurchaseReceiptStatus.POSTED).reduce((sum, receipt) => sum.plus(receipt.lines.reduce((lineSum, line) => lineSum.plus(line.lineTotal), zero())), zero());
          return { id: request.id, requestNumber: request.requestNumber, businessDate: isoDate(request.businessDate), executionKind: request.executionKind, plannedPaymentChannel: request.plannedPaymentChannel, status: request.status, custodyFundingAmount: request.custodyFundingAmount?.toString() ?? null, custodyBalance: request.executionKind === OperationsPurchaseExecutionKind.DELEGATED ? money(custodyByRequest.get(request.id) ?? zero()).toString() : null, representativeName: request.representativeName, notes: request.notes, cancellationReason: request.cancellationReason, estimatedTotal: money(estimatedTotal).toString(), actualTotal: money(actualTotal).toString(), varianceTotal: money(actualTotal.minus(estimatedTotal)).toString(), lines: request.lines.map((line) => ({ id: line.id, rawMaterialItemId: line.rawMaterialItemId, requestedUnitId: line.requestedUnitId, requestedQuantity: line.requestedQuantity.toString(), quotedUnitPrice: line.quotedUnitPrice?.toString() ?? "0", quotedLineTotal: line.quotedLineTotal?.toString() ?? "0" })), receipts: request.receipts.map((receipt) => ({ id: receipt.id, receiptNumber: receipt.receiptNumber, receiptSequence: receipt.receiptSequence, businessDate: isoDate(receipt.businessDate), actualPaymentChannel: receipt.actualPaymentChannel, paymentReference: receipt.paymentReference, status: receipt.status, reversalReason: receipt.reversalReason, lines: receipt.lines.map((line) => ({ requestLineId: line.requestLineId, rawMaterialItemId: line.rawMaterialItemId, receivedUnitId: line.receivedUnitId, receivedQuantity: line.receivedQuantity.toString(), actualUnitPrice: line.actualUnitPrice.toString(), lineTotal: line.lineTotal.toString() })) })) };
        }),
        custody: { representativeName: profile?.representativeName ?? null, balance: events[0]?.balanceAfter.toString() ?? "0", events: events.map((event) => ({ id: event.id, requestId: event.requestId, receiptId: event.receiptId, eventNumber: event.eventNumber, eventType: event.eventType, amountDelta: event.amountDelta.toString(), balanceAfter: event.balanceAfter.toString(), businessDate: isoDate(event.businessDate), notes: event.notes })) },
      };
    });
  }

  /** The purchasing report deliberately excludes plans and reversed postings. */
  async materialsReceivedReport(context: TrustedCompanyActorContext, query: OperationsReportQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const businessDate = dateRange(query);
      const lines = await tx.operationsPurchaseReceiptLine.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, receipt: { status: OperationsPurchaseReceiptStatus.POSTED, ...(businessDate ? { businessDate } : {}) } },
        include: { rawMaterial: { select: { nameAr: true, nameEn: true } }, receivedUnit: { select: { nameAr: true, nameEn: true } } },
      });
      const grouped = new Map<string, { rawMaterialItemId: string; materialNameAr: string; materialNameEn: string | null; unitId: string; unitNameAr: string; unitNameEn: string | null; quantity: Prisma.Decimal; amount: Prisma.Decimal }>();
      for (const line of lines) {
        const key = `${line.rawMaterialItemId}:${line.receivedUnitId}`;
        const current = grouped.get(key) ?? { rawMaterialItemId: line.rawMaterialItemId, materialNameAr: line.rawMaterial.nameAr, materialNameEn: line.rawMaterial.nameEn, unitId: line.receivedUnitId, unitNameAr: line.receivedUnit.nameAr, unitNameEn: line.receivedUnit.nameEn, quantity: zero(), amount: zero() };
        current.quantity = current.quantity.plus(line.receivedQuantity); current.amount = money(current.amount.plus(line.lineTotal)); grouped.set(key, current);
      }
      const materials = [...grouped.values()].sort((left, right) => left.materialNameAr.localeCompare(right.materialNameAr, "ar")).map((line) => ({ ...line, quantity: operationalQuantity(line.quantity).toString(), amount: money(line.amount).toString(), weightedActualUnitPrice: money(line.amount.div(line.quantity)).toString() }));
      return { totals: { materialCount: materials.length, quantity: operationalQuantity(materials.reduce((sum, line) => sum.plus(line.quantity), zero())).toString(), amount: money(materials.reduce((sum, line) => sum.plus(line.amount), zero())).toString() }, materials };
    });
  }

  /** A period report uses the signed custody ledger: funding − purchases − returns + reversals. */
  async custodyMonthlyReport(context: TrustedCompanyActorContext, query: OperationsReportQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const until = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      const events = await tx.operationsCustodyEvent.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, ...(until ? { businessDate: { lte: until } } : {}) }, orderBy: [{ businessDate: "asc" }, { effectiveAt: "asc" }, { id: "asc" }] });
      const profile = await tx.operationsCustodyProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { representativeName: true } });
      const start = query.from ?? "0000-01-01"; let running = zero(); const months = new Map<string, { month: string; openingBalance: Prisma.Decimal; funding: Prisma.Decimal; purchases: Prisma.Decimal; returns: Prisma.Decimal; reversals: Prisma.Decimal; closingBalance: Prisma.Decimal }>();
      for (const event of events) {
        const date = isoDate(event.businessDate); if (date < start) { running = money(running.plus(event.amountDelta)); continue; }
        const month = date.slice(0, 7); const current = months.get(month) ?? { month, openingBalance: running, funding: zero(), purchases: zero(), returns: zero(), reversals: zero(), closingBalance: running };
        const magnitude = money(event.amountDelta.abs());
        if (event.eventType === OperationsCustodyEventType.FUNDING) current.funding = money(current.funding.plus(magnitude));
        if (event.eventType === OperationsCustodyEventType.PURCHASE) current.purchases = money(current.purchases.plus(magnitude));
        if (event.eventType === OperationsCustodyEventType.RETURN) current.returns = money(current.returns.plus(magnitude));
        if (event.eventType === OperationsCustodyEventType.REVERSAL) current.reversals = money(current.reversals.plus(magnitude));
        running = money(running.plus(event.amountDelta)); current.closingBalance = running; months.set(month, current);
      }
      return { representativeName: profile?.representativeName ?? null, months: [...months.values()].map((month) => ({ month: month.month, openingBalance: month.openingBalance.toString(), funding: month.funding.toString(), purchases: month.purchases.toString(), returns: month.returns.toString(), reversals: month.reversals.toString(), closingBalance: month.closingBalance.toString() })) };
    });
  }

  async recipeWorkspace(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [units, menuProducts, rawMaterials, balances, recipes] = await Promise.all([
        tx.operationsUnit.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, isActive: true }, orderBy: [{ dimension: "asc" }, { nameAr: "asc" }] }),
        tx.operationsItem.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.MENU_PRODUCT, status: OperationsItemStatus.ACTIVE }, orderBy: { nameAr: "asc" }, include: { itemUnits: { where: { isActive: true }, select: { unitId: true, isActive: true } } } }),
        tx.operationsItem.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.RAW_MATERIAL, status: OperationsItemStatus.ACTIVE }, orderBy: { nameAr: "asc" }, include: { itemUnits: { where: { isActive: true }, select: { unitId: true, isActive: true } }, conversionVersions: { where: { status: OperationsConversionVersionStatus.PUBLISHED }, orderBy: { version: "desc" }, take: 1, include: { edges: { orderBy: { createdAt: "asc" } } } } } }),
        tx.operationsInventoryBalance.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { rawMaterialItemId: true, weightedUnitCost: true } }),
        tx.operationsRecipeVersion.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: OperationsRecipeVersionStatus.PUBLISHED }, orderBy: [{ outputItemId: "asc" }, { version: "desc" }], include: { lines: true } }),
      ]);
      const costByMaterial = new Map(balances.map((balance) => [balance.rawMaterialItemId, balance.weightedUnitCost]));
      const latestRecipe = new Map<string, typeof recipes[number]>(); for (const recipe of recipes) if (!latestRecipe.has(recipe.outputItemId)) latestRecipe.set(recipe.outputItemId, recipe);
      return {
        units: units.map((unit) => ({ id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn, dimension: unit.dimension, isActive: unit.isActive })),
        menuProducts: menuProducts.map((item) => ({ id: item.id, nameAr: item.nameAr, nameEn: item.nameEn, itemUnits: item.itemUnits })),
        rawMaterials: rawMaterials.map((item) => { const version = item.conversionVersions[0]; return { id: item.id, nameAr: item.nameAr, nameEn: item.nameEn, baseUnitId: item.baseUnitId, itemUnits: item.itemUnits, conversionVersion: version ? { id: version.id, version: version.version, status: version.status, publishedAt: version.publishedAt.toISOString(), edges: version.edges.map((edge) => ({ fromUnitId: edge.fromUnitId, toUnitId: edge.toUnitId, factor: edge.factor.toString() })) } : null, weightedUnitCost: costByMaterial.get(item.id)?.toString() ?? "0" }; }),
        recipes: [...latestRecipe.values()].map((recipe) => ({ outputItemId: recipe.outputItemId, version: recipe.version, outputQuantity: recipe.outputQuantity.toString(), outputUnitId: recipe.outputUnitId, estimatedCost: recipe.lines.reduce((sum, line) => sum.plus(line.resolvedBaseQuantity.mul(costByMaterial.get(line.rawMaterialItemId) ?? zero())), zero()).toFixed(4), lines: recipe.lines.map((line) => ({ rawMaterialItemId: line.rawMaterialItemId, unitId: line.unitId, quantity: line.quantity.toString(), resolvedBaseQuantity: line.resolvedBaseQuantity.toString() })) })),
      };
    });
  }

  async previewRecipe(context: TrustedCompanyActorContext, request: PreviewOperationsRecipeRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const output = await tx.operationsItem.findFirst({ where: { id: request.outputItemId, tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.MENU_PRODUCT, status: OperationsItemStatus.ACTIVE }, include: { itemUnits: { where: { unitId: request.outputUnitId, isActive: true }, select: { id: true } } } });
      if (!output || !output.itemUnits.length) throw new NotFoundException("The selected active menu product and output unit were not found.");
      if (new Set(request.lines.map((line) => line.rawMaterialItemId)).size !== request.lines.length) throw new BadRequestException("A material can appear only once in a recipe version.");
      const lines = [] as Array<{ rawMaterialItemId: string; unitId: string; quantity: string; resolvedBaseQuantity: Prisma.Decimal; weightedUnitCost: Prisma.Decimal | null; estimatedLineCost: Prisma.Decimal | null }>;
      for (const line of request.lines) {
        const material = await this.rawMaterialForConversion(tx, context, line.rawMaterialItemId, line.unitId);
        const conversion = this.toBase(material, line.unitId, decimal(line.quantity));
        const balance = await tx.operationsInventoryBalance.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: line.rawMaterialItemId }, select: { weightedUnitCost: true } });
        const weightedUnitCost = balance?.weightedUnitCost && balance.weightedUnitCost.gt(0) ? balance.weightedUnitCost : null;
        lines.push({ rawMaterialItemId: line.rawMaterialItemId, unitId: line.unitId, quantity: line.quantity, resolvedBaseQuantity: conversion.resolvedBaseQuantity, weightedUnitCost, estimatedLineCost: weightedUnitCost ? money(conversion.resolvedBaseQuantity.mul(weightedUnitCost)) : null });
      }
      const missingMaterialIds = lines.filter((line) => !line.weightedUnitCost).map((line) => line.rawMaterialItemId);
      const estimatedCost = missingMaterialIds.length ? null : money(lines.reduce((sum, line) => sum.plus(line.estimatedLineCost!), zero()));
      return { estimatedCost: estimatedCost?.toString() ?? null, costPerOutputUnit: estimatedCost ? weightedCost(estimatedCost.div(decimal(request.outputQuantity))).toString() : null, missingMaterialIds, lines: lines.map((line) => ({ rawMaterialItemId: line.rawMaterialItemId, unitId: line.unitId, quantity: line.quantity, resolvedBaseQuantity: line.resolvedBaseQuantity.toString(), weightedUnitCost: line.weightedUnitCost?.toString() ?? null, estimatedLineCost: line.estimatedLineCost?.toString() ?? null })) };
    });
  }

  async publishRecipe(context: TrustedCompanyActorContext, request: PublishOperationsRecipeRequest): Promise<EntityReceipt> {
    const payload = { outputItemId: request.outputItemId, outputUnitId: request.outputUnitId, outputQuantity: request.outputQuantity, lines: request.lines };
    return this.withIdempotency(context, "operations.recipe.publish", request.idempotencyKey, payload, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-recipe:${context.companyId}:${payload.outputItemId}`}))`;
      const output = await tx.operationsItem.findFirst({ where: { id: payload.outputItemId, tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.MENU_PRODUCT, status: OperationsItemStatus.ACTIVE }, include: { itemUnits: { where: { unitId: payload.outputUnitId, isActive: true }, select: { id: true } }, recipeOutputs: { select: { version: true } } } });
      if (!output || !output.itemUnits.length) throw new NotFoundException("The selected active menu product and output unit were not found.");
      const uniqueMaterials = new Set(payload.lines.map((line) => line.rawMaterialItemId));
      if (uniqueMaterials.size !== payload.lines.length) throw new BadRequestException("A material can appear only once in a recipe version.");
      await this.lockInventoryItems(tx, context, [...uniqueMaterials]);
      const resolved = [] as Array<{ rawMaterialItemId: string; unitId: string; quantity: string; baseUnitId: string; conversionVersionId: string | null; resolvedBaseQuantity: Prisma.Decimal }>;
      for (const line of payload.lines) {
        const item = await this.rawMaterialForConversion(tx, context, line.rawMaterialItemId, line.unitId);
        const conversion = this.toBase(item, line.unitId, decimal(line.quantity));
        resolved.push({ rawMaterialItemId: line.rawMaterialItemId, unitId: line.unitId, quantity: line.quantity, ...conversion });
      }
      await tx.operationsRecipeVersion.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, outputItemId: output.id, status: OperationsRecipeVersionStatus.PUBLISHED }, data: { status: OperationsRecipeVersionStatus.SUPERSEDED } });
      const version = Math.max(0, ...output.recipeOutputs.map((entry) => entry.version)) + 1;
      const id = randomUUID();
      await tx.operationsRecipeVersion.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, outputItemId: output.id, outputUnitId: payload.outputUnitId, outputQuantity: payload.outputQuantity, version, status: OperationsRecipeVersionStatus.PUBLISHED, publishedBy: context.actorUserId, lines: { create: resolved.map((line, index) => ({ id: randomUUID(), rawMaterialItemId: line.rawMaterialItemId, unitId: line.unitId, baseUnitId: line.baseUnitId, conversionVersionId: line.conversionVersionId, quantity: line.quantity, resolvedBaseQuantity: line.resolvedBaseQuantity, sortOrder: index + 1 })) } } });
      await this.audit(tx, context, "operations.recipe.published", "OperationsRecipeVersion", id, null, { outputItemId: output.id, version, outputQuantity: payload.outputQuantity, lines: resolved.map((line) => ({ ...line, resolvedBaseQuantity: line.resolvedBaseQuantity.toString() })) });
      return { id, replayed: false };
    }, 201);
  }

  async createPurchaseRequest(context: TrustedCompanyActorContext, request: CreateOperationsPurchaseRequest): Promise<EntityReceipt> {
    const payload = { businessDate: request.businessDate, paymentChannel: request.paymentChannel, executionKind: request.paymentChannel === "CUSTODY" ? OperationsPurchaseExecutionKind.DELEGATED : OperationsPurchaseExecutionKind.LOCAL, custodyFundingAmount: request.custodyFundingAmount ?? null, representativeName: trimOptional(request.representativeName, 160), notes: trimOptional(request.notes, 1000), lines: request.lines };
    return this.withIdempotency(context, "operations.purchase_request.create", request.idempotencyKey, payload, async (tx) => {
      if (new Set(payload.lines.map((line) => line.rawMaterialItemId)).size !== payload.lines.length) throw new BadRequestException("A raw material can appear only once in a purchase request.");
      await this.lockInventoryItems(tx, context, payload.lines.map((line) => line.rawMaterialItemId));
      const prepared = [] as Array<CreateOperationsPurchaseRequest["lines"][number] & { baseUnitId: string; conversionVersionId: string | null; requestedBaseQuantity: Prisma.Decimal; quotedLineTotal: Prisma.Decimal | null }>;
      for (const line of payload.lines) {
        const item = await this.rawMaterialForConversion(tx, context, line.rawMaterialItemId, line.requestedUnitId, true);
        const conversion = this.toBase(item, line.requestedUnitId, decimal(line.requestedQuantity));
        prepared.push({ ...line, ...conversion, requestedBaseQuantity: conversion.resolvedBaseQuantity, quotedLineTotal: line.quotedUnitPrice ? money(decimal(line.quotedUnitPrice).mul(decimal(line.requestedQuantity))) : null });
      }
      const id = randomUUID(); const requestNumber = await this.documentNumber(tx, context, "OPR", payload.businessDate);
      if (payload.executionKind === "DELEGATED") await this.assertSingleRepresentative(tx, context, payload.representativeName);
      await tx.operationsPurchaseRequest.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, requestNumber, executionKind: payload.executionKind as OperationsPurchaseExecutionKind, plannedPaymentChannel: payload.paymentChannel, status: OperationsPurchaseRequestStatus.PENDING_RECEIPT, businessDate: asDate(payload.businessDate), custodyFundingAmount: payload.custodyFundingAmount, representativeName: payload.representativeName, notes: payload.notes, requestedByUserId: context.actorUserId, lines: { create: prepared.map((line, index) => ({ id: randomUUID(), lineNumber: index + 1, rawMaterialItemId: line.rawMaterialItemId, requestedUnitId: line.requestedUnitId, requestedQuantity: line.requestedQuantity, baseUnitId: line.baseUnitId, conversionVersionId: line.conversionVersionId, requestedBaseQuantity: line.requestedBaseQuantity, quotedUnitPrice: line.quotedUnitPrice ?? null, quotedLineTotal: line.quotedLineTotal })) } } });
      if (payload.executionKind === "DELEGATED") await this.appendCustodyEvent(tx, context, { eventType: OperationsCustodyEventType.FUNDING, amountDelta: decimal(payload.custodyFundingAmount!), businessDate: payload.businessDate, requestId: id, notes: `Funding for ${requestNumber}` });
      await this.audit(tx, context, "operations.purchase_request.created", "OperationsPurchaseRequest", id, null, { requestNumber, ...payload });
      return { id, replayed: false };
    }, 201);
  }

  async receivePurchaseRequest(context: TrustedCompanyActorContext, request: ReceiveOperationsPurchaseRequest): Promise<EntityReceipt> {
    const payload = { requestId: request.requestId, businessDate: request.businessDate, notes: trimOptional(request.notes, 1000), paymentReference: trimOptional(request.paymentReference, 160), lines: request.lines };
    return this.withIdempotency(context, "operations.purchase_request.receive", request.idempotencyKey, payload, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-purchase-request:${context.companyId}:${payload.requestId}`}))`;
      const purchase = await tx.operationsPurchaseRequest.findFirst({ where: { id: payload.requestId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [OperationsPurchaseRequestStatus.PENDING_RECEIPT, OperationsPurchaseRequestStatus.PARTIALLY_RECEIVED] } }, include: { lines: true, receipts: { select: { receiptSequence: true } } } });
      if (!purchase) throw new NotFoundException("The pending purchase request was not found.");
      if (purchase.plannedPaymentChannel === OperationsPurchasePaymentChannel.BANK_TRANSFER && !payload.paymentReference) throw new BadRequestException("A bank transfer reference is required when completing a bank-transfer purchase request.");
      if (purchase.plannedPaymentChannel !== OperationsPurchasePaymentChannel.BANK_TRANSFER && payload.paymentReference) throw new BadRequestException("A payment reference is only allowed for a bank-transfer purchase request.");
      const linkedRequestLineIds = payload.lines.flatMap((line) => line.requestLineId ? [line.requestLineId] : []);
      if (new Set(linkedRequestLineIds).size !== linkedRequestLineIds.length) throw new BadRequestException("A request line can appear only once in one receipt.");
      const requestLines = new Map(purchase.lines.map((line) => [line.id, line]));
      const plannedMaterialIds = new Set(purchase.lines.map((line) => line.rawMaterialItemId));
      const unplannedMaterialIds = new Set<string>();
      await this.lockInventoryItems(tx, context, payload.lines.map((line) => line.rawMaterialItemId));
      const prepared = [] as Array<{ requestLine: typeof purchase.lines[number] | null; rawMaterialItemId: string; receivedQuantity: Prisma.Decimal; receivedUnitId: string; actualUnitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; baseUnitId: string; conversionVersionId: string | null; baseQuantity: Prisma.Decimal; baseUnitCost: Prisma.Decimal }>;
      for (const line of payload.lines) {
        const requestLine = line.requestLineId ? requestLines.get(line.requestLineId) ?? null : null;
        if (line.requestLineId && !requestLine) throw new BadRequestException("A receipt line does not belong to this purchase request.");
        if (requestLine && requestLine.rawMaterialItemId !== line.rawMaterialItemId) throw new BadRequestException("A linked receipt line must use the same material as its purchase request line.");
        if (!requestLine) {
          if (plannedMaterialIds.has(line.rawMaterialItemId)) throw new BadRequestException("A planned material must remain linked to its purchase request line.");
          if (unplannedMaterialIds.has(line.rawMaterialItemId)) throw new BadRequestException("An unplanned material can appear only once in one receipt.");
          unplannedMaterialIds.add(line.rawMaterialItemId);
        }
        const item = await this.rawMaterialForConversion(tx, context, line.rawMaterialItemId, line.receivedUnitId, true);
        const receivedQuantity = decimal(line.receivedQuantity); const actualUnitPrice = decimal(line.actualUnitPrice); const conversion = this.toBase(item, line.receivedUnitId, receivedQuantity);
        const lineTotal = money(receivedQuantity.mul(actualUnitPrice));
        if (lineTotal.lte(0)) throw new BadRequestException("The received quantity and price are too small to produce a valid monetary line total.");
        prepared.push({ requestLine, rawMaterialItemId: line.rawMaterialItemId, receivedQuantity, receivedUnitId: line.receivedUnitId, actualUnitPrice, lineTotal, baseUnitId: conversion.baseUnitId, conversionVersionId: conversion.conversionVersionId, baseQuantity: conversion.resolvedBaseQuantity, baseUnitCost: weightedCost(lineTotal.div(conversion.resolvedBaseQuantity)) });
      }
      const hasMaterialVariance = prepared.some((line) => !line.requestLine || line.receivedUnitId !== line.requestLine.requestedUnitId || !line.receivedQuantity.eq(line.requestLine.requestedQuantity) || !line.actualUnitPrice.eq(line.requestLine.quotedUnitPrice ?? zero()));
      if (hasMaterialVariance && !payload.notes) throw new BadRequestException("A receipt note is required when actual quantity, unit, or price differs from the purchase request.");
      const id = randomUUID(); const receiptNumber = await this.documentNumber(tx, context, "ORC", payload.businessDate); const receiptSequence = Math.max(0, ...purchase.receipts.map((receipt) => receipt.receiptSequence)) + 1;
      await tx.operationsPurchaseReceipt.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, requestId: purchase.id, receiptNumber, receiptSequence, businessDate: asDate(payload.businessDate), status: OperationsPurchaseReceiptStatus.POSTED, actualPaymentChannel: purchase.plannedPaymentChannel, paymentReference: payload.paymentReference, notes: payload.notes, receivedByUserId: context.actorUserId } });
      let receiptTotal = zero();
      for (const line of prepared.sort((a, b) => a.rawMaterialItemId.localeCompare(b.rawMaterialItemId))) {
        await this.lockInventoryItem(tx, context, line.rawMaterialItemId);
        const balance = await tx.operationsInventoryBalance.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: line.rawMaterialItemId } });
        const oldQuantity = balance?.baseQuantity ?? zero(); const oldValue = balance?.totalValue ?? zero(); const nextQuantity = operationalQuantity(oldQuantity.plus(line.baseQuantity)); const nextValue = money(oldValue.plus(line.lineTotal)); const nextCost = nextQuantity.gt(0) ? weightedCost(nextValue.div(nextQuantity)) : zero();
        if (balance) await tx.operationsInventoryBalance.update({ where: { id: balance.id }, data: { baseQuantity: nextQuantity, totalValue: nextValue, weightedUnitCost: nextCost } });
        else await tx.operationsInventoryBalance.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: line.rawMaterialItemId, baseQuantity: nextQuantity, totalValue: nextValue, weightedUnitCost: nextCost } });
        await tx.operationsPurchaseReceiptLine.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, receiptId: id, requestLineId: line.requestLine?.id ?? null, rawMaterialItemId: line.rawMaterialItemId, receivedUnitId: line.receivedUnitId, receivedQuantity: line.receivedQuantity, actualUnitPrice: line.actualUnitPrice, lineTotal: line.lineTotal, baseUnitId: line.baseUnitId, conversionVersionId: line.conversionVersionId, baseQuantity: line.baseQuantity, baseUnitCost: line.baseUnitCost } });
        await tx.operationsInventoryMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: line.rawMaterialItemId, receiptId: id, movementNumber: await this.documentNumber(tx, context, "OIN", payload.businessDate), movementType: OperationsInventoryMovementType.RECEIPT, baseQuantityDelta: line.baseQuantity, valueDelta: line.lineTotal, quantityAfter: nextQuantity, valueAfter: nextValue, weightedUnitCostAfter: nextCost, businessDate: asDate(payload.businessDate), createdByUserId: context.actorUserId } });
        await tx.operationsItemUnit.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, itemId: line.rawMaterialItemId, unitId: line.receivedUnitId }, data: { lastPurchaseUnitPrice: line.actualUnitPrice, lastPurchasePriceAt: new Date() } });
        receiptTotal = receiptTotal.plus(line.lineTotal);
      }
      if (purchase.executionKind === OperationsPurchaseExecutionKind.DELEGATED) await this.appendCustodyEvent(tx, context, { eventType: OperationsCustodyEventType.PURCHASE, amountDelta: receiptTotal.neg(), businessDate: payload.businessDate, requestId: purchase.id, receiptId: id, notes: `Purchase receipt ${receiptNumber}` });
      const status = await this.reconcilePurchaseRequestStatus(tx, context, purchase.id, purchase.lines);
      await this.audit(tx, context, "operations.purchase_request.received", "OperationsPurchaseReceipt", id, null, { requestId: purchase.id, receiptNumber, receiptTotal: receiptTotal.toString(), status });
      return { id, replayed: false };
    }, 201);
  }

  async returnCustody(context: TrustedCompanyActorContext, request: ReturnCustody, idempotencyKey: string): Promise<EntityReceipt> {
    const payload = { requestId: request.requestId ?? null, businessDate: request.businessDate, amount: request.amount, notes: required(request.notes, 1000) };
    return this.withIdempotency(context, "operations.custody.return", idempotencyKey, payload, async (tx) => {
      const profile = await tx.operationsCustodyProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId } });
      if (!profile) throw new BadRequestException("Configure the single purchasing representative through a delegated request before recording a return.");
      if (payload.requestId) {
        const purchase = await tx.operationsPurchaseRequest.findFirst({ where: { id: payload.requestId, tenantId: context.tenantId, companyId: context.companyId, executionKind: OperationsPurchaseExecutionKind.DELEGATED } });
        if (!purchase) throw new NotFoundException("The delegated purchase request for this custody return was not found.");
      }
      const id = await this.appendCustodyEvent(tx, context, { eventType: OperationsCustodyEventType.RETURN, amountDelta: decimal(payload.amount).neg(), businessDate: payload.businessDate, ...(payload.requestId ? { requestId: payload.requestId } : {}), notes: payload.notes });
      await this.audit(tx, context, "operations.custody.returned", "OperationsCustodyEvent", id, null, payload);
      return { id, replayed: false };
    }, 201);
  }

  async cancelPurchaseRequest(context: TrustedCompanyActorContext, request: CancelOperationsPurchaseRequest): Promise<EntityReceipt> {
    const payload = { requestId: request.requestId, reason: required(request.reason, 1000) };
    return this.withIdempotency(context, "operations.purchase_request.cancel", request.idempotencyKey, payload, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-purchase-request:${context.companyId}:${payload.requestId}`}))`;
      const purchase = await tx.operationsPurchaseRequest.findFirst({ where: { id: payload.requestId, tenantId: context.tenantId, companyId: context.companyId, status: OperationsPurchaseRequestStatus.PENDING_RECEIPT }, include: { receipts: { where: { status: OperationsPurchaseReceiptStatus.POSTED }, select: { id: true } } } });
      if (!purchase) throw new NotFoundException("The pending purchase request was not found.");
      if (purchase.receipts.length) throw new ConflictException("A request with posted receipt history cannot be cancelled; reverse or continue its receipts instead.");
      if (purchase.executionKind === OperationsPurchaseExecutionKind.DELEGATED) {
        const custody = await tx.operationsCustodyEvent.aggregate({ where: { tenantId: context.tenantId, companyId: context.companyId, requestId: purchase.id }, _sum: { amountDelta: true } });
        if (!money(custody._sum.amountDelta ?? zero()).isZero()) throw new ConflictException("Return the remaining request custody before cancelling this delegated request.");
      }
      await tx.operationsPurchaseRequest.update({ where: { id: purchase.id }, data: { status: OperationsPurchaseRequestStatus.CANCELLED, cancelledAt: new Date(), cancelledByUserId: context.actorUserId, cancellationReason: payload.reason } });
      await this.audit(tx, context, "operations.purchase_request.cancelled", "OperationsPurchaseRequest", purchase.id, { status: OperationsPurchaseRequestStatus.PENDING_RECEIPT }, { status: OperationsPurchaseRequestStatus.CANCELLED, reason: payload.reason });
      return { id: purchase.id, replayed: false };
    }, 201);
  }

  async reversePurchaseReceipt(context: TrustedCompanyActorContext, request: ReverseOperationsPurchaseReceipt): Promise<EntityReceipt> {
    const payload = { receiptId: request.receiptId, businessDate: request.businessDate, reason: request.reason?.trim() || "Owner reopened the purchase for correction." };
    return this.withIdempotency(context, "operations.purchase_receipt.reverse", request.idempotencyKey, payload, async (tx) => {
      const target = await tx.operationsPurchaseReceipt.findFirst({ where: { id: payload.receiptId, tenantId: context.tenantId, companyId: context.companyId }, select: { requestId: true } });
      if (!target) throw new NotFoundException("The purchase receipt was not found.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-purchase-request:${context.companyId}:${target.requestId}`}))`;
      const receipt = await tx.operationsPurchaseReceipt.findFirst({ where: { id: payload.receiptId, tenantId: context.tenantId, companyId: context.companyId, status: OperationsPurchaseReceiptStatus.POSTED }, include: { request: { include: { lines: true } }, lines: true } });
      if (!receipt) throw new ConflictException("This purchase receipt was already reversed or is unavailable.");
      await tx.operationsPurchaseReceipt.update({ where: { id: receipt.id }, data: { status: OperationsPurchaseReceiptStatus.REVERSED, reversedAt: new Date(), reversedByUserId: context.actorUserId, reversalReason: payload.reason } });
      let receiptTotal = zero();
      for (const line of [...receipt.lines].sort((a, b) => a.rawMaterialItemId.localeCompare(b.rawMaterialItemId))) {
        await this.lockInventoryItem(tx, context, line.rawMaterialItemId);
        const balance = await tx.operationsInventoryBalance.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: line.rawMaterialItemId } });
        if (!balance) throw new ConflictException("The inventory balance needed to reverse this receipt no longer exists.");
        const nextQuantity = operationalQuantity(balance.baseQuantity.minus(line.baseQuantity));
        const nextValue = money(balance.totalValue.minus(line.lineTotal));
        if (nextQuantity.lt(0) || nextValue.lt(0)) throw new ConflictException("This receipt cannot be reversed because a later operational movement consumed its inventory value.");
        const nextCost = nextQuantity.gt(0) ? weightedCost(nextValue.div(nextQuantity)) : zero();
        await tx.operationsInventoryBalance.update({ where: { id: balance.id }, data: { baseQuantity: nextQuantity, totalValue: nextValue, weightedUnitCost: nextCost } });
        await tx.operationsInventoryMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: line.rawMaterialItemId, receiptId: receipt.id, movementNumber: await this.documentNumber(tx, context, "OIN", payload.businessDate), movementType: OperationsInventoryMovementType.REVERSAL, baseQuantityDelta: line.baseQuantity.neg(), valueDelta: line.lineTotal.neg(), quantityAfter: nextQuantity, valueAfter: nextValue, weightedUnitCostAfter: nextCost, businessDate: asDate(payload.businessDate), createdByUserId: context.actorUserId } });
        const latest = await tx.operationsPurchaseReceiptLine.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, rawMaterialItemId: line.rawMaterialItemId, receivedUnitId: line.receivedUnitId, receipt: { status: OperationsPurchaseReceiptStatus.POSTED } }, orderBy: { receipt: { receivedAt: "desc" } }, select: { actualUnitPrice: true, receipt: { select: { receivedAt: true } } } });
        await tx.operationsItemUnit.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, itemId: line.rawMaterialItemId, unitId: line.receivedUnitId }, data: { lastPurchaseUnitPrice: latest?.actualUnitPrice ?? null, lastPurchasePriceAt: latest?.receipt.receivedAt ?? null } });
        receiptTotal = money(receiptTotal.plus(line.lineTotal));
      }
      if (receipt.request.executionKind === OperationsPurchaseExecutionKind.DELEGATED) await this.appendCustodyEvent(tx, context, { eventType: OperationsCustodyEventType.REVERSAL, amountDelta: receiptTotal, businessDate: payload.businessDate, requestId: receipt.requestId, receiptId: receipt.id, notes: `Reversal of purchase receipt ${receipt.receiptNumber}: ${payload.reason}` });
      const status = await this.reconcilePurchaseRequestStatus(tx, context, receipt.requestId, receipt.request.lines);
      await this.audit(tx, context, "operations.purchase_receipt.reversed", "OperationsPurchaseReceipt", receipt.id, { status: OperationsPurchaseReceiptStatus.POSTED }, { status: OperationsPurchaseReceiptStatus.REVERSED, reason: payload.reason, requestStatus: status, receiptTotal: receiptTotal.toString() });
      return { id: receipt.id, replayed: false };
    }, 201);
  }

  private async rawMaterialForConversion(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, itemId: string, unitId: string, requireOrderEnabled = false) {
    const item = await tx.operationsItem.findFirst({ where: { id: itemId, tenantId: context.tenantId, companyId: context.companyId, kind: OperationsItemKind.RAW_MATERIAL, status: OperationsItemStatus.ACTIVE }, include: { itemUnits: { where: { unitId, isActive: true }, select: { unitId: true, isOrderEnabled: true } }, conversionVersions: { where: { status: OperationsConversionVersionStatus.PUBLISHED }, orderBy: { version: "desc" }, take: 1, include: { edges: true } } } });
    if (!item || !item.itemUnits.length || (requireOrderEnabled && !item.itemUnits[0]?.isOrderEnabled)) throw new NotFoundException("The raw material or enabled unit was not found.");
    return item;
  }

  private toBase(item: { baseUnitId: string; conversionVersions: Array<{ id: string; edges: Array<{ fromUnitId: string; toUnitId: string; factor: Prisma.Decimal }> }> }, unitId: string, quantity: Prisma.Decimal) {
    if (unitId === item.baseUnitId) return { baseUnitId: item.baseUnitId, conversionVersionId: null, resolvedBaseQuantity: operationalQuantity(quantity) };
    const version = item.conversionVersions[0]; if (!version) throw new BadRequestException("A published unit conversion is required for this raw material unit.");
    // Relations are entered once, normally from the larger package to the
    // smaller unit. Costing and stock can traverse the same material relation
    // in either direction: moving backwards divides by the saved factor.
    const adjacent = new Map<string, Array<{ unitId: string; multiplier: Prisma.Decimal }>>();
    for (const edge of version.edges) {
      adjacent.set(edge.fromUnitId, [...(adjacent.get(edge.fromUnitId) ?? []), { unitId: edge.toUnitId, multiplier: edge.factor }]);
      adjacent.set(edge.toUnitId, [...(adjacent.get(edge.toUnitId) ?? []), { unitId: edge.fromUnitId, multiplier: new Prisma.Decimal(1).div(edge.factor) }]);
    }
    const factors = new Map<string, Prisma.Decimal>([[unitId, new Prisma.Decimal(1)]]);
    const queue = [unitId];
    while (queue.length) {
      const cursor = queue.shift()!;
      if (cursor === item.baseUnitId) break;
      const currentFactor = factors.get(cursor)!;
      for (const next of adjacent.get(cursor) ?? []) if (!factors.has(next.unitId)) {
        factors.set(next.unitId, currentFactor.mul(next.multiplier));
        queue.push(next.unitId);
      }
    }
    const multiplier = factors.get(item.baseUnitId);
    if (!multiplier) throw new BadRequestException("This unit does not connect to the material inventory base.");
    const resolvedBaseQuantity = operationalQuantity(quantity.mul(multiplier));
    if (resolvedBaseQuantity.lte(0)) throw new BadRequestException("The converted base quantity is below the supported operational precision.");
    return { baseUnitId: item.baseUnitId, conversionVersionId: version.id, resolvedBaseQuantity };
  }

  private async assertSingleRepresentative(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, name: string | null) {
    const representativeName = required(name ?? "", 160); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-custody:${context.companyId}`}))`;
    const profile = await tx.operationsCustodyProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId } });
    if (profile && profile.representativeName !== representativeName) throw new BadRequestException("This company has one purchasing representative. Use the configured representative name.");
    if (!profile) await tx.operationsCustodyProfile.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, representativeName } });
  }

  private async appendCustodyEvent(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, input: { eventType: OperationsCustodyEventType; amountDelta: Prisma.Decimal; businessDate: string; requestId?: string; receiptId?: string; notes?: string }): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-custody:${context.companyId}`}))`;
    const previous = await tx.operationsCustodyEvent.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ effectiveAt: "desc" }, { id: "desc" }], select: { balanceAfter: true } });
    const id = randomUUID(); const balanceAfter = money((previous?.balanceAfter ?? zero()).plus(input.amountDelta));
    if (input.eventType === OperationsCustodyEventType.RETURN && balanceAfter.lt(0)) throw new ConflictException("A custody return cannot exceed the representative's current balance.");
    await tx.operationsCustodyEvent.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, eventNumber: await this.documentNumber(tx, context, "OCU", input.businessDate), eventType: input.eventType, amountDelta: input.amountDelta, balanceAfter, businessDate: asDate(input.businessDate), requestId: input.requestId ?? null, receiptId: input.receiptId ?? null, notes: input.notes ?? null, createdByUserId: context.actorUserId } });
    return id;
  }

  private async reconcilePurchaseRequestStatus(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, requestId: string, lines: Array<{ id: string; requestedBaseQuantity: Prisma.Decimal }>): Promise<OperationsPurchaseRequestStatus> {
    const posted = await tx.operationsPurchaseReceiptLine.groupBy({ by: ["requestLineId"], where: { tenantId: context.tenantId, companyId: context.companyId, receipt: { requestId, status: OperationsPurchaseReceiptStatus.POSTED } }, _sum: { baseQuantity: true } });
    const receivedByLine = new Map(posted.flatMap((entry) => entry.requestLineId ? [[entry.requestLineId, entry._sum.baseQuantity ?? zero()] as const] : []));
    const status = posted.length === 0
      ? OperationsPurchaseRequestStatus.PENDING_RECEIPT
      : lines.every((line) => (receivedByLine.get(line.id) ?? zero()).gte(line.requestedBaseQuantity))
        ? OperationsPurchaseRequestStatus.RECEIVED
        : OperationsPurchaseRequestStatus.PARTIALLY_RECEIVED;
    await tx.operationsPurchaseRequest.update({ where: { id: requestId }, data: { status, receivedAt: status === OperationsPurchaseRequestStatus.RECEIVED ? new Date() : null } });
    return status;
  }

  private async lockInventoryItems(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, itemIds: Iterable<string>) { for (const itemId of [...new Set(itemIds)].sort()) await this.lockInventoryItem(tx, context, itemId); }
  private async lockInventoryItem(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, itemId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations-inventory:${context.companyId}:${itemId}`}))`; }
  private async documentNumber(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, series: string, businessDate: string) { const value = await this.serials.reserveInTransaction(tx, context, { series, businessDate: businessDate as `${number}-${number}-${number}` }); return `${series}-${businessDate.replaceAll("-", "")}-${value.toString().padStart(5, "0")}`; }
  private async withIdempotency<T extends EntityReceipt>(context: TrustedCompanyActorContext, operation: string, key: string, payload: unknown, action: (tx: Prisma.TransactionClient) => Promise<T>, status: number): Promise<T> { return this.database.inTenantTransaction(context.tenantId, async (tx) => { let begun; try { begun = await this.idempotency.beginInTransaction(tx, context, { operation, key, request: payload as CanonicalJsonValue, expiresAt: new Date(Date.now() + 86_400_000) }); } catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was already used with a different operations request."); throw error; } if (begun.kind === "replay") return { ...(begun.response.body as T), replayed: true }; if (begun.kind === "in-progress") throw new ConflictException("The operations request is still in progress."); const receipt = await action(tx); await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status, headers: null, body: receipt as CanonicalJsonValue } }); return receipt; }); }
  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, beforeJson: unknown, afterJson: unknown) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson === null ? Prisma.JsonNull : beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } }); }
}

function decimal(value: string | number | Prisma.Decimal) { return new Prisma.Decimal(value); }
function zero() { return new Prisma.Decimal(0); }
const MAX_QUANTITY = new Prisma.Decimal("10000000000000000");
const MAX_MONEY = new Prisma.Decimal("100000000000000");
const MAX_WEIGHTED_COST = new Prisma.Decimal("100000000000000");
function operationalQuantity(value: Prisma.Decimal) { const rounded = value.toDecimalPlaces(8); if (rounded.abs().gte(MAX_QUANTITY)) throw new BadRequestException("The operational quantity exceeds supported precision."); return rounded; }
function money(value: Prisma.Decimal) { const rounded = value.toDecimalPlaces(4); if (rounded.abs().gte(MAX_MONEY)) throw new BadRequestException("The monetary value exceeds supported precision."); return rounded; }
function weightedCost(value: Prisma.Decimal) { const rounded = value.toDecimalPlaces(12); if (rounded.abs().gte(MAX_WEIGHTED_COST)) throw new BadRequestException("The weighted unit cost exceeds supported precision."); return rounded; }
function asDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function dateRange(query: OperationsReportQuery) {
  if (!query.from && !query.to) return undefined;
  return { ...(query.from ? { gte: asDate(query.from) } : {}), ...(query.to ? { lte: asDate(query.to) } : {}) };
}
function trimOptional(value: string | undefined, max: number) { if (!value?.trim()) return null; return required(value, max); }
function required(value: string, max: number) { const normalized = value.trim(); if (!normalized || normalized.length > max) throw new BadRequestException("An operations value is invalid."); return normalized; }

import { Injectable } from "@nestjs/common";

import type { OperationsInventoryBalanceQuery, OperationsInventoryLedgerQuery } from "@baseer-erp/contracts";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";

@Injectable()
export class OperationsInventoryReportingService {
  constructor(private readonly database: DatabaseService) {}

  async balances(context: TrustedCompanyActorContext, query: OperationsInventoryBalanceQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const where: Prisma.OperationsInventoryBalanceWhereInput = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        ...(query.search ? { rawMaterial: { is: { OR: [
          { code: { contains: query.search, mode: "insensitive" } },
          { nameAr: { contains: query.search, mode: "insensitive" } },
          { nameEn: { contains: query.search, mode: "insensitive" } },
        ] } } } : {}),
      };
      const rows = await tx.operationsInventoryBalance.findMany({
        where,
        take: query.pageSize + 1,
        orderBy: [{ rawMaterial: { nameAr: "asc" } }, { id: "asc" }],
        include: { rawMaterial: { select: { id: true, code: true, nameAr: true, nameEn: true, baseUnitId: true, baseUnit: { select: { nameAr: true, nameEn: true } } } } },
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasNext = rows.length > query.pageSize;
      const balances = (hasNext ? rows.slice(0, -1) : rows).map((row) => ({
        id: row.id,
        rawMaterialItemId: row.rawMaterialItemId,
        materialCode: row.rawMaterial.code,
        materialNameAr: row.rawMaterial.nameAr,
        materialNameEn: row.rawMaterial.nameEn,
        baseUnitId: row.rawMaterial.baseUnitId,
        baseUnitNameAr: row.rawMaterial.baseUnit.nameAr,
        baseUnitNameEn: row.rawMaterial.baseUnit.nameEn,
        baseQuantity: row.baseQuantity.toString(),
        totalValue: row.totalValue.toString(),
        weightedUnitCost: row.weightedUnitCost.toString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
      return { balances, nextCursor: hasNext ? balances.at(-1)?.id ?? null : null, asOf: new Date().toISOString() };
    });
  }

  async ledger(context: TrustedCompanyActorContext, query: OperationsInventoryLedgerQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const where: Prisma.OperationsInventoryMovementWhereInput = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        ...(query.rawMaterialItemId ? { rawMaterialItemId: query.rawMaterialItemId } : {}),
        ...(query.movementType ? { movementType: query.movementType } : {}),
        ...(query.from || query.to ? { businessDate: { ...(query.from ? { gte: asStartDate(query.from) } : {}), ...(query.to ? { lte: asEndDate(query.to) } : {}) } } : {}),
        ...(query.search ? { rawMaterial: { is: { OR: [
          { code: { contains: query.search, mode: "insensitive" } },
          { nameAr: { contains: query.search, mode: "insensitive" } },
          { nameEn: { contains: query.search, mode: "insensitive" } },
        ] } } } : {}),
      };
      const rows = await tx.operationsInventoryMovement.findMany({
        where,
        take: query.pageSize + 1,
        orderBy: [{ businessDate: "desc" }, { effectiveAt: "desc" }, { id: "desc" }],
        include: {
          rawMaterial: { select: { code: true, nameAr: true, nameEn: true } },
          receipt: { select: { id: true, receiptNumber: true } },
          internalRegistrationConsumption: { select: { registrationLine: { select: {
            productNameArSnapshot: true, productNameEnSnapshot: true,
            registration: { select: { id: true, registrationNumber: true, section: { select: { nameAr: true, nameEn: true } } } },
          } } } },
        },
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasNext = rows.length > query.pageSize;
      const movements = (hasNext ? rows.slice(0, -1) : rows).map((row) => {
        const consumption = row.internalRegistrationConsumption;
        const registration = consumption?.registrationLine.registration;
        const source = row.receipt
          ? { kind: "PURCHASE_RECEIPT" as const, id: row.receipt.id, number: row.receipt.receiptNumber, sectionNameAr: null, sectionNameEn: null, menuProductNameAr: null, menuProductNameEn: null }
          : registration
            ? { kind: "INTERNAL_REGISTRATION" as const, id: registration.id, number: registration.registrationNumber, sectionNameAr: registration.section.nameAr, sectionNameEn: registration.section.nameEn, menuProductNameAr: consumption?.registrationLine.productNameArSnapshot ?? null, menuProductNameEn: consumption?.registrationLine.productNameEnSnapshot ?? null }
            : null;
        return {
          id: row.id,
          movementNumber: row.movementNumber,
          movementType: row.movementType,
          businessDate: row.businessDate.toISOString().slice(0, 10),
          effectiveAt: row.effectiveAt.toISOString(),
          rawMaterialItemId: row.rawMaterialItemId,
          materialCode: row.rawMaterial.code,
          materialNameAr: row.rawMaterial.nameAr,
          materialNameEn: row.rawMaterial.nameEn,
          baseQuantityDelta: row.baseQuantityDelta.toString(),
          valueDelta: row.valueDelta.toString(),
          quantityAfter: row.quantityAfter.toString(),
          valueAfter: row.valueAfter.toString(),
          weightedUnitCostAfter: row.weightedUnitCostAfter.toString(),
          source,
        };
      });
      return { movements, nextCursor: hasNext ? movements.at(-1)?.id ?? null : null, asOf: new Date().toISOString() };
    });
  }
}

function asStartDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function asEndDate(value: string) { return new Date(`${value}T23:59:59.999Z`); }

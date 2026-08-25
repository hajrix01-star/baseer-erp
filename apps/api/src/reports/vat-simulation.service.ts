import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { VatSimulationSave } from '@baseer-erp/contracts';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';

/**
 * Stores a quarterly what-if only. This service must never call journal,
 * invoice, vault, settlement, or external-submission services.
 */
@Injectable()
export class VatSimulationService {
  constructor(private readonly database: DatabaseService) {}

  async list(context: TrustedCompanyActorContext, year: number) {
    const [profile, simulations] = await this.database.inTenantTransaction(context.tenantId, (transaction) => Promise.all([
      transaction.companyFinanceProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { vatRateBasisPoints: true } }),
      transaction.vatSimulation.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, year }, orderBy: { quarter: 'asc' } }),
    ]));
    return { vatRateBasisPoints: profile?.vatRateBasisPoints ?? 1500, simulations: simulations.map(receipt) };
  }

  async save(context: TrustedCompanyActorContext, input: VatSimulationSave) {
    const values = amounts(input);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const profile = await transaction.companyFinanceProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { vatRateBasisPoints: true } });
      const vatRateBasisPoints = profile?.vatRateBasisPoints ?? 1500;
      if (vatRateBasisPoints < 0 || vatRateBasisPoints > 10_000) throw new BadRequestException('The company VAT rate is invalid.');
      const prior = await transaction.vatSimulation.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, year: input.year, quarter: input.quarter } });
      const data = {
        vatRateBasisPoints, ...values, notes: input.notes?.trim() || null,
        sourceLedgerRevision: input.sourceLedgerRevision == null ? null : BigInt(input.sourceLedgerRevision),
        sourceImportedAt: input.sourceLedgerRevision == null ? null : new Date(), updatedByUserId: context.actorUserId,
      };
      const simulation = prior
        ? await transaction.vatSimulation.update({ where: { id: prior.id }, data })
        : await transaction.vatSimulation.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, year: input.year, quarter: input.quarter, createdByUserId: context.actorUserId, ...data } });
      await transaction.auditEvent.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
        action: prior ? 'reports.vat_simulation.updated' : 'reports.vat_simulation.created', entityType: 'VatSimulation', entityId: simulation.id,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        ...(prior ? { beforeJson: auditSnapshot(prior) } : {}), afterJson: auditSnapshot(simulation),
      } });
      return receipt(simulation);
    });
  }

  async remove(context: TrustedCompanyActorContext, simulationId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const simulation = await transaction.vatSimulation.findFirst({ where: { id: simulationId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!simulation) throw new NotFoundException('VAT simulation was not found.');
      await transaction.vatSimulation.delete({ where: { id: simulation.id } });
      await transaction.auditEvent.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
        action: 'reports.vat_simulation.deleted', entityType: 'VatSimulation', entityId: simulation.id,
        requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: auditSnapshot(simulation), afterJson: { deleted: true },
      } });
      return { id: simulation.id };
    });
  }
}

function amounts(input: VatSimulationSave) {
  return {
    salesTaxableAmount: decimal(input.salesTaxableAmount), outputVatAmount: decimal(input.outputVatAmount),
    purchasesTaxableAmount: decimal(input.purchasesTaxableAmount), inputVatAmount: decimal(input.inputVatAmount),
    priorAdjustments: decimal(input.priorAdjustments), balanceCarried: decimal(input.balanceCarried),
    paymentTarget: input.paymentTarget == null ? null : decimal(input.paymentTarget),
  };
}
function decimal(value: string) {
  const result = new Prisma.Decimal(value);
  if (!result.isFinite() || result.abs().gt(new Prisma.Decimal('99999999999999.9999'))) throw new BadRequestException('The VAT simulation amount is outside the supported range.');
  return result;
}
function receipt(row: { id: string; year: number; quarter: number; vatRateBasisPoints: number; salesTaxableAmount: Prisma.Decimal; outputVatAmount: Prisma.Decimal; purchasesTaxableAmount: Prisma.Decimal; inputVatAmount: Prisma.Decimal; priorAdjustments: Prisma.Decimal; balanceCarried: Prisma.Decimal; paymentTarget: Prisma.Decimal | null; notes: string | null; sourceLedgerRevision: bigint | null; sourceImportedAt: Date | null; updatedAt: Date }) {
  return { id: row.id, year: row.year, quarter: row.quarter, vatRateBasisPoints: row.vatRateBasisPoints,
    salesTaxableAmount: row.salesTaxableAmount.toFixed(4), outputVatAmount: row.outputVatAmount.toFixed(4), purchasesTaxableAmount: row.purchasesTaxableAmount.toFixed(4), inputVatAmount: row.inputVatAmount.toFixed(4), priorAdjustments: row.priorAdjustments.toFixed(4), balanceCarried: row.balanceCarried.toFixed(4), paymentTarget: row.paymentTarget?.toFixed(4) ?? null, notes: row.notes, sourceLedgerRevision: row.sourceLedgerRevision?.toString() ?? null, sourceImportedAt: row.sourceImportedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
}
function auditSnapshot(row: Parameters<typeof receipt>[0]) { const value = receipt(row); return { ...value, notes: value.notes ? '[present]' : null }; }

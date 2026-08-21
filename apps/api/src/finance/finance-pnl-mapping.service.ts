import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinancePnlMappingVersionStatus,
  FinancePnlPresentationNature,
  FinancePnlPresentationSign,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';

/**
 * R0-A policy version retained with every future P&L report run. It is not a
 * report implementation and intentionally has no HTTP controller yet.
 */
export const REPORTING_R0_A_POLICY_VERSION = 'REPORTING_R0_A_2026_08_20';

export type PnlStatementLineDraft = Readonly<{
  code: string;
  nameAr: string;
  nameEn: string;
  presentationNature: FinancePnlPresentationNature;
  sortOrder: number;
  isSubtotal?: boolean;
}>;

export type PnlAccountMappingDraft = Readonly<{
  accountId: string;
  statementLineCode: string;
  presentationSign: FinancePnlPresentationSign;
}>;

export type CreatePnlMappingDraftInput = Readonly<{
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  lines: readonly PnlStatementLineDraft[];
  accountMappings: readonly PnlAccountMappingDraft[];
}>;

export type PnlMappingDraftReceipt = Readonly<{ id: string; versionNumber: number }>;

type AccountForPolicy = Readonly<{ id: string; type: FinanceAccountType; status: FinanceAccountStatus }>;

/** Pure validation is deliberately reusable by the executable R0-A policy test. */
export function validatePnlMappingDraft(
  lines: readonly PnlStatementLineDraft[],
  mappings: readonly PnlAccountMappingDraft[],
  accounts: readonly AccountForPolicy[],
): void {
  if (!lines.length) throw new BadRequestException('A P&L mapping version requires statement lines.');
  const linesByCode = new Map<string, PnlStatementLineDraft>();
  const sortOrders = new Set<number>();
  for (const line of lines) {
    const code = text(line.code, 80, 'Every P&L statement line needs a code.');
    text(line.nameAr, 160, 'Every P&L statement line needs an Arabic name.');
    text(line.nameEn, 160, 'Every P&L statement line needs an English name.');
    if (linesByCode.has(code)) throw new BadRequestException('P&L statement-line codes must be unique within a version.');
    if (!Number.isInteger(line.sortOrder) || line.sortOrder < 0) throw new BadRequestException('P&L statement-line sort orders must be non-negative integers.');
    if (sortOrders.has(line.sortOrder)) throw new BadRequestException('P&L statement-line sort orders must be unique within a version.');
    linesByCode.set(code, line);
    sortOrders.add(line.sortOrder);
  }

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const mappedAccounts = new Set<string>();
  for (const mapping of mappings) {
    if (!isUuid(mapping.accountId)) throw new BadRequestException('Every P&L account mapping needs a valid account identifier.');
    const line = linesByCode.get(text(mapping.statementLineCode, 80, 'Every P&L account mapping needs a statement line.'));
    if (!line) throw new BadRequestException('Every P&L account mapping must reference a statement line in the same version.');
    if (line.isSubtotal) throw new BadRequestException('A subtotal line cannot receive a direct account mapping.');
    if (mappedAccounts.has(mapping.accountId)) throw new BadRequestException('An account can map only once in a P&L mapping version.');
    const account = accountsById.get(mapping.accountId);
    if (!account) throw new BadRequestException('A P&L account mapping may reference only an account in the selected company.');
    if (account.type !== FinanceAccountType.REVENUE && account.type !== FinanceAccountType.EXPENSE) {
      throw new BadRequestException('Only revenue and expense accounts may enter a P&L mapping.');
    }
    if (account.type === FinanceAccountType.REVENUE && mapping.presentationSign !== FinancePnlPresentationSign.CREDIT_NATURE) {
      throw new BadRequestException('A revenue account must use credit-nature presentation.');
    }
    if (account.type === FinanceAccountType.EXPENSE && mapping.presentationSign !== FinancePnlPresentationSign.DEBIT_NATURE) {
      throw new BadRequestException('An expense account must use debit-nature presentation.');
    }
    if (!isNatureCompatible(account.type, line.presentationNature)) {
      throw new BadRequestException('The selected account type is not compatible with the P&L presentation nature.');
    }
    mappedAccounts.add(mapping.accountId);
  }

  const unmappedActivePnlAccounts = accounts.filter((account) =>
    account.status === FinanceAccountStatus.ACTIVE
    && (account.type === FinanceAccountType.REVENUE || account.type === FinanceAccountType.EXPENSE)
    && !mappedAccounts.has(account.id),
  );
  if (unmappedActivePnlAccounts.length) {
    throw new BadRequestException('Every active revenue and expense account must be mapped before a P&L policy version is approved.');
  }
}

@Injectable()
export class FinancePnlMappingService {
  constructor(private readonly database: DatabaseService) {}

  async createDraft(context: TrustedCompanyActorContext, input: CreatePnlMappingDraftInput): Promise<PnlMappingDraftReceipt> {
    this.assertDates(input.effectiveFrom, input.effectiveTo ?? null);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:pnl-mapping-policy`}, 0))
      `;
      const accounts = await transaction.financeAccount.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, type: true, status: true },
      });
      validatePnlMappingDraft(input.lines, input.accountMappings, accounts);
      const latest = await transaction.financePnlMappingVersion.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const id = randomUUID();
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      await transaction.financePnlMappingVersion.create({
        data: {
          id,
          tenantId: context.tenantId,
          companyId: context.companyId,
          versionNumber,
          policyVersion: REPORTING_R0_A_POLICY_VERSION,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          createdByUserId: context.actorUserId,
        },
      });
      const linesByCode = new Map<string, string>();
      for (const line of input.lines) {
        const lineId = randomUUID();
        linesByCode.set(line.code.trim(), lineId);
        await transaction.financePnlStatementLine.create({
          data: {
            id: lineId,
            tenantId: context.tenantId,
            companyId: context.companyId,
            mappingVersionId: id,
            code: line.code.trim(),
            nameAr: line.nameAr.trim(),
            nameEn: line.nameEn.trim(),
            presentationNature: line.presentationNature,
            sortOrder: line.sortOrder,
            isSubtotal: line.isSubtotal ?? false,
          },
        });
      }
      await transaction.financePnlAccountMapping.createMany({
        data: input.accountMappings.map((mapping) => ({
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
          mappingVersionId: id, statementLineId: linesByCode.get(mapping.statementLineCode.trim())!,
          accountId: mapping.accountId, presentationSign: mapping.presentationSign,
        })),
      });
      const receipt = { id, versionNumber };
      await this.audit(transaction, context, 'finance.pnl_mapping.drafted', id, receipt);
      return receipt;
    });
  }

  async approveDraft(context: TrustedCompanyActorContext, mappingVersionId: string, supersedeVersionId?: string): Promise<void> {
    if (!isUuid(mappingVersionId) || (supersedeVersionId !== undefined && !isUuid(supersedeVersionId))) {
      throw new BadRequestException('A valid P&L mapping version identifier is required.');
    }
    await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:pnl-mapping-policy`}, 0))
      `;
      const draft = await transaction.financePnlMappingVersion.findFirst({
        where: { id: mappingVersionId, tenantId: context.tenantId, companyId: context.companyId, status: FinancePnlMappingVersionStatus.DRAFT },
        include: { statementLines: true, accountMappings: true },
      });
      if (!draft) throw new NotFoundException('The draft P&L mapping version was not found.');
      const accounts = await transaction.financeAccount.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, type: true, status: true },
      });
      validatePnlMappingDraft(
        draft.statementLines.map((line) => ({ ...line })),
        draft.accountMappings.map((mapping) => ({
          accountId: mapping.accountId,
          statementLineCode: draft.statementLines.find((line) => line.id === mapping.statementLineId)?.code ?? '',
          presentationSign: mapping.presentationSign,
        })),
        accounts,
      );

      const approved = await transaction.financePnlMappingVersion.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, status: FinancePnlMappingVersionStatus.APPROVED },
        select: { id: true, effectiveFrom: true, effectiveTo: true },
      });
      if (supersedeVersionId) {
        const prior = approved.find((version) => version.id === supersedeVersionId);
        if (!prior) throw new BadRequestException('The selected P&L mapping version is not an approved version in this company.');
        if (prior.effectiveTo) throw new BadRequestException('Only an open-ended approved P&L mapping version may be superseded.');
        if (draft.effectiveFrom <= prior.effectiveFrom) throw new BadRequestException('A successor P&L mapping version must start after the version it supersedes.');
        await transaction.financePnlMappingVersion.update({
          where: { id: prior.id },
          data: { status: FinancePnlMappingVersionStatus.SUPERSEDED, effectiveTo: previousDate(draft.effectiveFrom) },
        });
      }
      const remainingApproved = approved.filter((version) => version.id !== supersedeVersionId);
      if (remainingApproved.some((version) => rangesOverlap(draft.effectiveFrom, draft.effectiveTo, version.effectiveFrom, version.effectiveTo))) {
        throw new ConflictException('An approved P&L mapping version already covers this effective date range.');
      }
      const checksum = mappingChecksum(draft);
      await transaction.financePnlMappingVersion.update({
        where: { id: draft.id },
        data: { status: FinancePnlMappingVersionStatus.APPROVED, approvedAt: new Date(), approvedByUserId: context.actorUserId, checksum },
      });
      await this.audit(transaction, context, 'finance.pnl_mapping.approved', draft.id, { versionNumber: draft.versionNumber, checksum, supersedeVersionId: supersedeVersionId ?? null });
    });
  }

  private assertDates(effectiveFrom: Date, effectiveTo: Date | null): void {
    if (!(effectiveFrom instanceof Date) || Number.isNaN(effectiveFrom.valueOf()) || (effectiveTo && (!(effectiveTo instanceof Date) || Number.isNaN(effectiveTo.valueOf())))) {
      throw new BadRequestException('P&L mapping effective dates must be valid dates.');
    }
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException('A P&L mapping effective end date cannot precede its start date.');
  }

  private async audit(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, afterJson: Prisma.InputJsonValue): Promise<void> {
    await transaction.auditEvent.create({
      data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: 'FinancePnlMappingVersion', entityId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson },
    });
  }
}

function isNatureCompatible(type: FinanceAccountType, nature: FinancePnlPresentationNature): boolean {
  if (type === FinanceAccountType.REVENUE) {
    return nature === FinancePnlPresentationNature.REVENUE || nature === FinancePnlPresentationNature.OPERATING_INCOME || nature === FinancePnlPresentationNature.INVESTING || nature === FinancePnlPresentationNature.FINANCING || nature === FinancePnlPresentationNature.DISCONTINUED_OPERATIONS;
  }
  return nature === FinancePnlPresentationNature.COST_OF_SALES || nature === FinancePnlPresentationNature.OPERATING_EXPENSE || nature === FinancePnlPresentationNature.INVESTING || nature === FinancePnlPresentationNature.FINANCING || nature === FinancePnlPresentationNature.INCOME_TAX || nature === FinancePnlPresentationNature.DISCONTINUED_OPERATIONS;
}

function rangesOverlap(from: Date, to: Date | null, otherFrom: Date, otherTo: Date | null): boolean {
  return from <= (otherTo ?? new Date('9999-12-31T00:00:00.000Z')) && otherFrom <= (to ?? new Date('9999-12-31T00:00:00.000Z'));
}

function previousDate(date: Date): Date {
  const previous = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous;
}

function mappingChecksum(value: { versionNumber: number; effectiveFrom: Date; effectiveTo: Date | null; statementLines: readonly { code: string; nameAr: string; nameEn: string; presentationNature: string; sortOrder: number; isSubtotal: boolean }[]; accountMappings: readonly { accountId: string; statementLineId: string; presentationSign: string }[] }): string {
  return createHash('sha256').update(JSON.stringify({
    policyVersion: REPORTING_R0_A_POLICY_VERSION, versionNumber: value.versionNumber,
    effectiveFrom: value.effectiveFrom.toISOString().slice(0, 10), effectiveTo: value.effectiveTo?.toISOString().slice(0, 10) ?? null,
    statementLines: [...value.statementLines].sort((a, b) => a.code.localeCompare(b.code)),
    accountMappings: [...value.accountMappings].sort((a, b) => a.accountId.localeCompare(b.accountId)),
  })).digest('hex');
}

function text(value: string, maximum: number, message: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new BadRequestException(message);
  return normalized;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

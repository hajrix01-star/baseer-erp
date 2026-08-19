import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApproveHrFinalSettlementRequest, CreateHrFinalSettlementRequest, PayHrFinalSettlementRequest, PreviewHrFinalSettlementRequest, ReverseHrFinalSettlementRequest, VerifyHrFinalSettlementReasonRequest } from '@baseer-erp/contracts';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { canonicalJson, IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceVaultService } from '../finance/finance-vault.service.js';
import { FinanceFoundationService } from '../finance/finance-foundation.service.js';
import { JournalPostingService } from '../finance/journal/journal-posting.service.js';
import { FinanceAccountStatus, HrCompensationMethod, HrEmployeeAdministrativeDeductionActionType, HrEmployeeAdministrativeDeductionStatus, HrEmployeeAdvanceSettlementSource, HrEmployeeAdvanceStatus, HrEmployeeFinancialMovementType, HrEmployeeStatus, HrFinalSettlementReason, HrFinalSettlementStatus, Prisma } from '../generated/prisma/client.js';
import { isHrDateOnOrAfter, latestHrBusinessDate } from './hr-financial-date.util.js';
import { hrAdministrativeDeductionLockKey, hrEmployeeAdvanceLockKey } from './hr-financial-lock.util.js';
import { hrReplayReceipt } from './hr-idempotency.util.js';

const EOS_EXPENSE = 'EOS_EXPENSE'; const EOS_PAYABLE = 'EOS_PAYABLE'; const ADVANCES = 'EMPLOYEE_ADVANCES'; const ADMIN_DEDUCTION = 'EMPLOYEE_ADMIN_DEDUCTION_RECOVERY'; const POLICY = 'SA-EOS-V1';
type Recovery = { recoveryType: 'ADVANCE' | 'ADMINISTRATIVE_DEDUCTION'; sourceId: string; amount: string };
type SettlementRequest = Omit<PreviewHrFinalSettlementRequest, 'recoveries'> & { recoveries: readonly Recovery[] };

@Injectable()
export class HrFinalSettlementService {
  constructor(private readonly database: DatabaseService, private readonly dates: BusinessDateService, private readonly serials: DocumentSerialService, private readonly idempotency: IdempotencyService, private readonly vaults: FinanceVaultService, private readonly journals: JournalPostingService, private readonly foundation: FinanceFoundationService) {}

  async preview(context: TrustedCompanyActorContext, input: SettlementRequest) { return this.database.inTenantTransaction(context.tenantId, (tx) => this.calculate(tx, context, input)); }

  async create(context: TrustedCompanyActorContext, input: CreateHrFinalSettlementRequest) {
    const { idempotencyKey, ...request } = input;
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, 'hr.final_settlement.create', idempotencyKey, request);
      if (begun.kind === 'replay') return hrReplayReceipt<Receipt>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The final settlement is already being processed.');
      await this.lock(tx, context, request.employeeId);
      const prior = await tx.hrFinalSettlement.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: request.employeeId, status: { in: [HrFinalSettlementStatus.DRAFT, HrFinalSettlementStatus.APPROVED, HrFinalSettlementStatus.PARTIALLY_PAID, HrFinalSettlementStatus.PAID] } }, select: { id: true } });
      if (prior) throw new ConflictException('This employee already has an active final settlement.');
      const calculation = await this.calculate(tx, context, request);
      const current = await this.dates.resolveInTransaction(tx, context, { kind: 'current' });
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'HR_FINAL_SETTLEMENT', businessDate: current.businessDate as `${number}-${number}-${number}` });
      const id = randomUUID(); const settlementNumber = `EOS-${current.businessDate.replaceAll('-', '')}-${serial.toString().padStart(6, '0')}`;
      const employeeSnapshot = await tx.hrEmployee.findFirst({ where: { id: request.employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { employeeNumber: true, nameAr: true, nameEn: true, jobTitle: true, hireDate: true, terminatedAt: true } });
      const companySnapshot = await tx.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { nameAr: true, nameEn: true } });
      if (!employeeSnapshot || !companySnapshot) throw new ConflictException('Final-settlement source data changed.');
      const snapshot = { ...calculation, settlementNumber, createdBusinessDate: current.businessDate, wageBasis: 'CURRENT_COMPENSATION_MONTHLY_GROSS_FIXED_COMPONENTS_EXCLUDING_OVERTIME', recoveries: request.recoveries, employee: { ...employeeSnapshot, hireDate: ymd(employeeSnapshot.hireDate), terminatedAt: employeeSnapshot.terminatedAt ? ymd(employeeSnapshot.terminatedAt) : null }, company: companySnapshot };
      await tx.hrFinalSettlement.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, employeeId: request.employeeId, settlementNumber, terminationDate: request.terminationDate, terminationReason: request.terminationReason, reasonEvidenceReference: request.reasonEvidenceReference, reasonEvidenceNote: request.reasonEvidenceNote ?? null, calculationPolicyVersion: POLICY, serviceDays: calculation.serviceDays, eosWage: dec(calculation.eosWage), fullAwardAmount: dec(calculation.fullAwardAmount), entitlementFactor: dec(calculation.entitlementFactor), eosAmount: dec(calculation.eosAmount), otherCreditsAmount: dec(calculation.otherCreditsAmount), recoveryAmount: dec(calculation.recoveryAmount), netPayableAmount: dec(calculation.netPayableAmount), snapshotJson: json(snapshot), snapshotSha256: hash(snapshot), createdByUserId: context.actorUserId } });
      if (request.recoveries.length) await tx.hrFinalSettlementRecovery.createMany({ data: request.recoveries.map((recovery) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, settlementId: id, recoveryType: recovery.recoveryType, sourceId: recovery.sourceId, amount: dec(recovery.amount) })) });
      const receipt = { id, settlementNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, 201, receipt); await this.audit(tx, context, 'hr.final_settlement.created', id, receipt); return receipt;
    });
  }

  async verifyReason(context: TrustedCompanyActorContext, input: Omit<VerifyHrFinalSettlementReasonRequest, 'idempotencyKey'>, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, 'hr.final_settlement.reason.verify', idempotencyKey, input);
      if (begun.kind === 'replay') return hrReplayReceipt<Receipt>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The final-settlement reason verification is already being processed.');
      await this.lock(tx, context, input.settlementId);
      const settlement = await this.requireSettlement(tx, context, input.settlementId, false);
      if (settlement.status !== HrFinalSettlementStatus.DRAFT) throw new ConflictException('Only a draft final settlement can have its reason verified.');
      if (!settlement.reasonEvidenceReference.trim()) throw new ConflictException('A final-settlement reason requires a saved evidence reference.');
      await tx.hrFinalSettlement.update({ where: { id: settlement.id }, data: { reasonVerificationStatus: 'VERIFIED', reasonVerifiedAt: new Date(), reasonVerifiedByUserId: context.actorUserId, reasonVerificationNote: input.verificationNote } });
      const receipt = { id: settlement.id, settlementNumber: settlement.settlementNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, 200, receipt); await this.audit(tx, context, 'hr.final_settlement.reason_verified', settlement.id, { ...receipt, evidenceReference: settlement.reasonEvidenceReference });
      return receipt;
    });
  }

  async approve(context: TrustedCompanyActorContext, input: Omit<ApproveHrFinalSettlementRequest, 'idempotencyKey'>, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, 'hr.final_settlement.approve', idempotencyKey, input);
      if (begun.kind === 'replay') return hrReplayReceipt<Receipt>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The final-settlement approval is already being processed.');
      await this.lock(tx, context, input.settlementId);
      const settlement = await this.requireSettlement(tx, context, input.settlementId, true);
      if (settlement.status !== HrFinalSettlementStatus.DRAFT) throw new ConflictException('Only a draft final settlement can be approved.');
      if (!isHrDateOnOrAfter(input.businessDate, settlement.terminationDate)) throw new BadRequestException('The final-settlement approval date cannot be before the termination date.');
      if (settlement.createdByUserId === context.actorUserId) throw new ConflictException('A final settlement must be approved by a different user than its creator.');
      if (requiresReasonVerification(settlement.terminationReason) && settlement.reasonVerificationStatus !== 'VERIFIED') throw new ConflictException('This final-settlement reason requires verified evidence before approval.');
      await this.lockRecoverySources(tx, context, settlement.recoveries);
      await this.verifyRecoveries(tx, context, settlement.employeeId, settlement.recoveries);
      // Existing companies can predate EOS accounts. This idempotent foundation
      // upgrade runs under the same transaction/lock before a posting is made.
      await this.foundation.initializeInTransaction(tx, context);
      const accounts = await this.accounts(tx, context, [EOS_EXPENSE, EOS_PAYABLE, ADVANCES, ADMIN_DEDUCTION]);
      const isZeroSettlement = settlement.eosAmount.eq(0) && settlement.recoveries.length === 0 && settlement.netPayableAmount.eq(0);
      const journal = isZeroSettlement ? null : await this.journals.postInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `hr-final-settlement-accrual:${settlement.id}`, sourceType: 'hr_final_settlement_accrual', sourceReference: settlement.id, businessDate: input.businessDate, description: `Final settlement ${settlement.settlementNumber}`, lines: [{ accountId: accounts.get(EOS_EXPENSE)!, debitAmount: settlement.eosAmount.toFixed(4), description: settlement.settlementNumber }, ...settlement.recoveries.map((r) => ({ accountId: accounts.get(r.recoveryType === 'ADVANCE' ? ADVANCES : ADMIN_DEDUCTION)!, creditAmount: r.amount.toFixed(4), description: `Final settlement recovery ${r.recoveryType}` })), ...(settlement.netPayableAmount.gt(0) ? [{ accountId: accounts.get(EOS_PAYABLE)!, creditAmount: settlement.netPayableAmount.toFixed(4), description: settlement.settlementNumber }] : [])] });
      if (journal) await this.applyRecoveries(tx, context, settlement, input.businessDate, journal.journalEntryId);
      await tx.hrFinalSettlement.update({ where: { id: settlement.id }, data: { status: HrFinalSettlementStatus.APPROVED, accrualJournalEntryId: journal?.journalEntryId ?? null, approvedAt: new Date(), approvedByUserId: context.actorUserId } });
      if (journal && settlement.netPayableAmount.gt(0)) await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: settlement.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.FINAL_SETTLEMENT_ACCRUAL, businessDate: input.businessDate, amount: settlement.netPayableAmount, sourceReference: settlement.settlementNumber, description: 'Final settlement accrued' } });
      const receipt = { id: settlement.id, settlementNumber: settlement.settlementNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, 200, receipt); await this.audit(tx, context, 'hr.final_settlement.approved', settlement.id, { ...receipt, businessDate: ymd(input.businessDate), journalEntryId: journal?.journalEntryId ?? null, zeroSettlement: isZeroSettlement }); return receipt;
    });
  }

  async pay(context: TrustedCompanyActorContext, input: Omit<PayHrFinalSettlementRequest, 'idempotencyKey'>, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, 'hr.final_settlement.pay', idempotencyKey, input);
      if (begun.kind === 'replay') return hrReplayReceipt<Receipt>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The final-settlement payment is already being processed.');
      await this.lock(tx, context, input.settlementId);
      const settlement = await this.requireSettlement(tx, context, input.settlementId, false);
      if (!(new Set<HrFinalSettlementStatus>([HrFinalSettlementStatus.APPROVED, HrFinalSettlementStatus.PARTIALLY_PAID])).has(settlement.status)) throw new ConflictException('Only an approved final settlement can be paid.');
      const paymentFloor = latestHrBusinessDate(settlement.terminationDate, settlement.accrualJournal?.businessDate, settlement.payments[0]?.businessDate);
      if (!settlement.accrualJournal || !paymentFloor) throw new ConflictException('The final-settlement accrual is missing.');
      if (!isHrDateOnOrAfter(input.businessDate, paymentFloor)) throw new BadRequestException('The final-settlement payment date cannot be before its approval or latest payment date.');
      if (settlement.createdByUserId === context.actorUserId || settlement.approvedByUserId === context.actorUserId) throw new ConflictException('The final-settlement creator or approver cannot make its payment.');
      const allocations = await this.resolveAllocations(tx, context, input.allocations); const amount = allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
      if (amount.lte(0) || amount.gt(settlement.netPayableAmount.minus(settlement.paidAmount))) throw new BadRequestException('The payment cannot exceed the final-settlement payable balance.');
      const accounts = await this.accounts(tx, context, [EOS_PAYABLE]); const businessDate = ymd(input.businessDate); const serial = await this.serials.reserveInTransaction(tx, context, { series: 'HR_FINAL_SETTLEMENT_PAYMENT', businessDate }); const paymentNumber = `EOP-${businessDate.replaceAll('-', '')}-${serial.toString().padStart(6, '0')}`;
      const journal = await this.journals.postInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `hr-final-settlement-payment:${paymentNumber}`, sourceType: 'hr_final_settlement_payment', sourceReference: paymentNumber, businessDate: input.businessDate, description: `Final settlement payment ${settlement.settlementNumber}`, lines: [{ accountId: accounts.get(EOS_PAYABLE)!, debitAmount: amount.toFixed(4), description: paymentNumber }, ...allocations.map((a) => ({ accountId: a.accountId, creditAmount: a.amount.toFixed(4), description: paymentNumber }))] });
      const paymentId = randomUUID();
      await tx.hrFinalSettlementPayment.create({ data: { id: paymentId, tenantId: context.tenantId, companyId: context.companyId, settlementId: settlement.id, paymentNumber, businessDate: input.businessDate, amount, journalEntryId: journal.journalEntryId, createdByUserId: context.actorUserId } });
      await tx.hrFinalSettlementPaymentAllocation.createMany({ data: allocations.map((a) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, paymentId, vaultId: a.vaultId, paymentMethod: a.paymentMethod, amount: a.amount })) });
      const paidAmount = settlement.paidAmount.plus(amount);
      await tx.hrFinalSettlement.update({ where: { id: settlement.id }, data: { paidAmount, status: paidAmount.eq(settlement.netPayableAmount) ? HrFinalSettlementStatus.PAID : HrFinalSettlementStatus.PARTIALLY_PAID } });
      await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: settlement.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.FINAL_SETTLEMENT_PAYMENT, businessDate: input.businessDate, amount, sourceReference: paymentNumber, description: 'Final settlement payment' } });
      const receipt = { id: settlement.id, settlementNumber: settlement.settlementNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, 200, receipt); await this.audit(tx, context, 'hr.final_settlement.paid', settlement.id, { ...receipt, paymentNumber, journalEntryId: journal.journalEntryId }); return receipt;
    });
  }

  async reverse(context: TrustedCompanyActorContext, input: Omit<ReverseHrFinalSettlementRequest, 'idempotencyKey'>, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, 'hr.final_settlement.reverse', idempotencyKey, input);
      if (begun.kind === 'replay') return hrReplayReceipt<Receipt>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The final-settlement reversal is already being processed.');
      await this.lock(tx, context, input.settlementId);
      const settlement = await this.requireSettlement(tx, context, input.settlementId, true);
      if (settlement.status !== HrFinalSettlementStatus.APPROVED) throw new ConflictException('Only an unpaid approved final settlement can be reversed.');
      if (settlement.payments.length) throw new ConflictException('A final settlement with payment history cannot be reversed as unpaid.');
      const approvalBusinessDate = settlement.accrualJournal?.businessDate ?? await this.approvalBusinessDate(tx, context, settlement.id);
      if (!approvalBusinessDate) throw new ConflictException('The final-settlement approval business date is unavailable, so it cannot be reversed safely.');
      const reversalFloor = latestHrBusinessDate(settlement.terminationDate, approvalBusinessDate)!;
      if (!isHrDateOnOrAfter(input.businessDate, reversalFloor)) throw new BadRequestException('The final-settlement reversal date cannot be before its termination or approval date.');
      if (settlement.createdByUserId === context.actorUserId || settlement.approvedByUserId === context.actorUserId) throw new ConflictException('The final-settlement creator or approver cannot reverse it.');
      await this.lockRecoverySources(tx, context, settlement.recoveries);
      const reversalJournal = settlement.accrualJournalEntryId ? await this.journals.reverseInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `hr-final-settlement-reversal:${settlement.id}`, journalEntryId: settlement.accrualJournalEntryId, businessDate: input.businessDate, reason: input.reason }) : null;
      await this.reverseRecoveries(tx, context, settlement, input.businessDate, reversalJournal?.journalEntryId ?? null);
      if (reversalJournal && settlement.netPayableAmount.gt(0)) await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: settlement.employeeId, journalEntryId: reversalJournal.journalEntryId, movementType: HrEmployeeFinancialMovementType.FINAL_SETTLEMENT_ACCRUAL, businessDate: input.businessDate, amount: settlement.netPayableAmount.negated(), sourceReference: `${settlement.settlementNumber}-REV`, description: `Final settlement accrual reversed: ${input.reason}` } });
      await tx.hrFinalSettlement.update({ where: { id: settlement.id }, data: { status: HrFinalSettlementStatus.REVERSED, reversedAt: new Date(), reversedByUserId: context.actorUserId, reversalReason: input.reason } });
      const receipt = { id: settlement.id, settlementNumber: settlement.settlementNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, 200, receipt); await this.audit(tx, context, 'hr.final_settlement.reversed', settlement.id, { ...receipt, businessDate: ymd(input.businessDate), reversalJournalEntryId: reversalJournal?.journalEntryId ?? null, reason: input.reason }); return receipt;
    });
  }

  async list(context: TrustedCompanyActorContext, query: { cursor?: string; pageSize: number; employeeId?: string; status?: HrFinalSettlementStatus }) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const scope = { tenantId: context.tenantId, companyId: context.companyId, ...(query.employeeId ? { employeeId: query.employeeId } : {}), ...(query.status ? { status: query.status } : {}) };
      const cursor = query.cursor ? await tx.hrFinalSettlement.findFirst({ where: { id: query.cursor, ...scope }, select: { id: true, createdAt: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The final-settlement cursor is invalid for this company and filter.');
      const rows = await tx.hrFinalSettlement.findMany({ where: { ...scope, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.pageSize + 1 });
      const hasMore = rows.length > query.pageSize; const settlements = hasMore ? rows.slice(0, query.pageSize) : rows;
      return { settlements: settlements.map(map), hasMore, nextCursor: hasMore ? settlements.at(-1)?.id ?? null : null };
    });
  }

  private async calculate(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, input: SettlementRequest) {
    const business = await this.dates.resolveInTransaction(tx, context, { kind: 'current' });
    if (ymd(input.terminationDate) > business.businessDate) throw new BadRequestException('The termination date cannot be after the company business date.');
    const employee = await tx.hrEmployee.findFirst({ where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId }, include: { compensationProfiles: { where: { effectiveFrom: { lte: input.terminationDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.terminationDate } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
    if (!employee || employee.status !== HrEmployeeStatus.TERMINATED || !employee.terminatedAt || ymd(employee.terminatedAt) !== ymd(input.terminationDate)) throw new BadRequestException('The employee must first be terminated with the same termination date.');
    if (employee.hireDate >= input.terminationDate) throw new BadRequestException('A positive employee service period is required.');
    const profile = employee.compensationProfiles[0]; if (!profile) throw new BadRequestException('An effective compensation agreement must cover the termination date.');
    const wage = eosEligibleWage(profile);
    const formula = calculateEosFormula(employee.hireDate, input.terminationDate, wage, input.terminationReason);
    const recovery = await this.verifyRecoveries(tx, context, employee.id, input.recoveries);
    if (recovery.gt(formula.eosAmount)) throw new BadRequestException('Referenced recoveries cannot exceed the end-of-service entitlement in V1.');
    return { employeeId: employee.id, terminationDate: ymd(input.terminationDate), terminationReason: input.terminationReason, reasonEvidenceReference: input.reasonEvidenceReference, reasonVerificationStatus: 'PENDING' as const, serviceDays: formula.serviceDays, eosWage: wage.toFixed(4), fullAwardAmount: formula.fullAwardAmount.toFixed(4), entitlementFactor: formula.entitlementFactor.toFixed(8), eosAmount: formula.eosAmount.toFixed(4), otherCreditsAmount: '0.0000', recoveryAmount: recovery.toFixed(4), netPayableAmount: Prisma.Decimal.max(formula.eosAmount.minus(recovery), 0).toFixed(4), calculationPolicyVersion: POLICY };
  }

  private async verifyRecoveries(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, recoveries: readonly (Recovery | { recoveryType: 'ADVANCE' | 'ADMINISTRATIVE_DEDUCTION'; sourceId: string; amount: Prisma.Decimal })[]) {
    const seen = new Set<string>(); let total = new Prisma.Decimal(0);
    for (const recovery of recoveries) { const key = `${recovery.recoveryType}:${recovery.sourceId}`; if (seen.has(key)) throw new BadRequestException('A recovery source can appear only once.'); seen.add(key); const amount = dec(recovery.amount); if (amount.lte(0)) throw new BadRequestException('Recovery amounts must be positive.');
      if (recovery.recoveryType === 'ADVANCE') { const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: recovery.sourceId, tenantId: context.tenantId, companyId: context.companyId, employeeId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] } }, select: { remainingAmount: true } }); if (!advance || amount.gt(advance.remainingAmount)) throw new BadRequestException('An advance recovery must reference an open remaining balance.'); }
      else { const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: recovery.sourceId, tenantId: context.tenantId, companyId: context.companyId, employeeId, status: { in: [HrEmployeeAdministrativeDeductionStatus.OPEN, HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED, HrEmployeeAdministrativeDeductionStatus.DEFERRED] } }, select: { remainingAmount: true } }); if (!deduction || amount.gt(deduction.remainingAmount)) throw new BadRequestException('An administrative-deduction recovery must reference an open remaining balance.'); }
      total = total.plus(amount); }
    return total;
  }

  private async applyRecoveries(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, settlement: any, businessDate: Date, journalEntryId: string) {
    for (const recovery of settlement.recoveries) { if (recovery.recoveryType === 'ADVANCE') { const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: recovery.sourceId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, businessDate: true, settledAmount: true, remainingAmount: true } }); if (!advance || recovery.amount.gt(advance.remainingAmount)) throw new ConflictException('The employee-advance balance changed. Refresh and try again.'); if (!isHrDateOnOrAfter(businessDate, advance.businessDate)) throw new BadRequestException('A final-settlement advance recovery cannot predate the employee-advance issue.'); const remainingAmount = advance.remainingAmount.minus(recovery.amount); await tx.hrEmployeeAdvance.update({ where: { id: advance.id }, data: { remainingAmount, settledAmount: advance.settledAmount.plus(recovery.amount), status: remainingAmount.eq(0) ? HrEmployeeAdvanceStatus.SETTLED : HrEmployeeAdvanceStatus.PARTIALLY_SETTLED } }); await tx.hrEmployeeAdvanceSettlement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, advanceId: advance.id, source: HrEmployeeAdvanceSettlementSource.FINAL_SETTLEMENT, businessDate, amount: recovery.amount, journalEntryId } }); }
      else { const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: recovery.sourceId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, appliedAmount: true, remainingAmount: true } }); if (!deduction || recovery.amount.gt(deduction.remainingAmount)) throw new ConflictException('The administrative-deduction balance changed. Refresh and try again.'); const remainingAmount = deduction.remainingAmount.minus(recovery.amount); await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: deduction.id }, data: { remainingAmount, appliedAmount: deduction.appliedAmount.plus(recovery.amount), status: remainingAmount.eq(0) ? HrEmployeeAdministrativeDeductionStatus.APPLIED : HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED } }); await tx.hrEmployeeAdministrativeDeductionAction.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, deductionId: deduction.id, actionType: HrEmployeeAdministrativeDeductionActionType.APPLIED, businessDate, amount: recovery.amount, reason: `Final settlement ${settlement.settlementNumber}`, createdByUserId: context.actorUserId } }); } }
  }
  private async reverseRecoveries(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, settlement: any, businessDate: Date, journalEntryId: string | null) {
    for (const recovery of settlement.recoveries) { if (recovery.recoveryType === 'ADVANCE') { const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: recovery.sourceId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, settledAmount: true, remainingAmount: true } }); if (!advance || advance.settledAmount.lt(recovery.amount)) throw new ConflictException('The employee advance cannot be restored safely.'); const settledAmount = advance.settledAmount.minus(recovery.amount); await tx.hrEmployeeAdvance.update({ where: { id: advance.id }, data: { settledAmount, remainingAmount: advance.remainingAmount.plus(recovery.amount), status: settledAmount.eq(0) ? HrEmployeeAdvanceStatus.ISSUED : HrEmployeeAdvanceStatus.PARTIALLY_SETTLED } }); await tx.hrEmployeeAdvanceSettlement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, advanceId: advance.id, source: HrEmployeeAdvanceSettlementSource.FINAL_SETTLEMENT, businessDate, amount: recovery.amount.negated(), journalEntryId } }); }
      else { const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: recovery.sourceId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, appliedAmount: true, remainingAmount: true } }); if (!deduction || deduction.appliedAmount.lt(recovery.amount)) throw new ConflictException('The administrative deduction cannot be restored safely.'); const appliedAmount = deduction.appliedAmount.minus(recovery.amount); await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: deduction.id }, data: { appliedAmount, remainingAmount: deduction.remainingAmount.plus(recovery.amount), status: appliedAmount.eq(0) ? HrEmployeeAdministrativeDeductionStatus.OPEN : HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED } }); await tx.hrEmployeeAdministrativeDeductionAction.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, deductionId: deduction.id, actionType: HrEmployeeAdministrativeDeductionActionType.REVERSED, businessDate, amount: recovery.amount, reason: `Final settlement ${settlement.settlementNumber} reversed`, createdByUserId: context.actorUserId } }); } }
  }
  private async resolveAllocations(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, allocations: Omit<PayHrFinalSettlementRequest, 'idempotencyKey' | 'settlementId' | 'businessDate'>['allocations']) { const output: Array<{ vaultId: string; accountId: string; paymentMethod: (typeof allocations)[number]['paymentMethod']; amount: Prisma.Decimal }> = []; for (const allocation of allocations) { const vault = await this.vaults.assertActivePaymentDestination(tx, { tenantId: context.tenantId, companyId: context.companyId, vaultId: allocation.vaultId }); if (!vault.paymentMethods.includes(allocation.paymentMethod)) throw new BadRequestException('The selected payment method is not enabled for this vault.'); output.push({ vaultId: vault.id, accountId: vault.accountId, paymentMethod: allocation.paymentMethod, amount: dec(allocation.amount) }); } return output; }
  private async requireSettlement(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, id: string, recoveries: boolean) { const settlement = await tx.hrFinalSettlement.findFirst({ where: { id, tenantId: context.tenantId, companyId: context.companyId }, include: { recoveries, accrualJournal: { select: { businessDate: true } }, payments: { orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: 1, select: { businessDate: true } } } }); if (!settlement) throw new NotFoundException('The final settlement was not found.'); return settlement; }
  private async approvalBusinessDate(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, settlementId: string) { const audit = await tx.auditEvent.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, action: 'hr.final_settlement.approved', entityType: 'HrFinalSettlement', entityId: settlementId, requestId: `hr.final_settlement.approved:${settlementId}` }, orderBy: { createdAt: 'desc' }, select: { afterJson: true } }); return auditDate(audit?.afterJson); }
  private async accounts(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, keys: string[]) { const rows = await tx.financeAccount.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: { in: keys }, status: FinanceAccountStatus.ACTIVE }, select: { id: true, systemKey: true } }); const accounts = new Map(rows.map((row) => [row.systemKey!, row.id])); if (keys.some((key) => !accounts.has(key))) throw new ConflictException('The company finance setup is missing final-settlement accounts.'); return accounts; }
  private async lock(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, id: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:hr-final-settlement:${id}`}, 0))`; }
  private async lockRecoverySources(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, recoveries: readonly { recoveryType: 'ADVANCE' | 'ADMINISTRATIVE_DEDUCTION'; sourceId: string }[]) { const keys = recoveries.map((recovery) => recovery.recoveryType === 'ADVANCE' ? hrEmployeeAdvanceLockKey(context.tenantId, context.companyId, recovery.sourceId) : hrAdministrativeDeductionLockKey(context.tenantId, context.companyId, recovery.sourceId)).sort(); for (const key of keys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; }
  private async begin(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, operation: string, key: string, request: unknown) { try { return await this.idempotency.beginInTransaction(tx, context, { operation, key, request: json(request), expiresAt: new Date(Date.now() + 86_400_000) }); } catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with a different request.'); throw error; } }
  private async complete(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, receiptId: string, status: number, body: unknown) { await this.idempotency.completeInTransaction(tx, context, { receiptId, response: { status, headers: null, body: json(body) } }); }
  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, id: string, after: unknown) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: 'HrFinalSettlement', entityId: id, requestId: `${action}:${id}`, afterJson: json(after) } }); }
}
type Receipt = { id: string; settlementNumber: string; replayed: boolean };
export function eosEntitlementFactor(reason: HrFinalSettlementReason, years: Prisma.Decimal) { if (reason === HrFinalSettlementReason.ARTICLE_80) return new Prisma.Decimal(0); if (reason !== HrFinalSettlementReason.RESIGNATION) return new Prisma.Decimal(1); return years.lt(2) ? new Prisma.Decimal(0) : years.lte(5) ? new Prisma.Decimal(1).div(3) : years.lt(10) ? new Prisma.Decimal(2).div(3) : new Prisma.Decimal(1); }
/** Pure, server-owned EOS V1 computation. Dates are date-only UTC values. */
export function calculateEosFormula(serviceStart: Date, terminationDate: Date, wage: Prisma.Decimal, reason: HrFinalSettlementReason) {
  const serviceDays = days(serviceStart, terminationDate);
  const years = new Prisma.Decimal(serviceDays).div(365);
  const fullAwardAmount = wage.mul(Prisma.Decimal.min(years, 5)).mul(0.5)
    .plus(wage.mul(Prisma.Decimal.max(years.minus(5), 0)));
  const entitlementFactor = eosEntitlementFactor(reason, years);
  return { serviceDays, fullAwardAmount, entitlementFactor, eosAmount: fullAwardAmount.mul(entitlementFactor) };
}
function requiresReasonVerification(reason: HrFinalSettlementReason) { return ([
  HrFinalSettlementReason.ARTICLE_80,
  HrFinalSettlementReason.ARTICLE_81,
  HrFinalSettlementReason.FORCE_MAJEURE,
  HrFinalSettlementReason.MATERNITY,
  HrFinalSettlementReason.OTHER_LEGAL_REVIEW,
] as readonly HrFinalSettlementReason[]).includes(reason); }
function auditDate(value: unknown) { if (!value || Array.isArray(value) || typeof value !== 'object') return null; const date = (value as Record<string, unknown>).businessDate; if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null; const parsed = new Date(`${date}T00:00:00.000Z`); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function eosEligibleWage(profile: { monthlyGross: Prisma.Decimal; compensationMethod: HrCompensationMethod; foodAllowance: Prisma.Decimal; housingAllowance: Prisma.Decimal; transportAllowance: Prisma.Decimal; otherAllowance: Prisma.Decimal; scheduledHoursPerDay: number | null; scheduledWorkDays: number | null }) { if (profile.compensationMethod === HrCompensationMethod.FIXED_MONTHLY) return profile.monthlyGross; const hours = profile.scheduledHoursPerDay; const workDays = profile.scheduledWorkDays; if (!hours || !workDays || hours <= 8) throw new ConflictException('The inclusive compensation agreement has no valid overtime schedule.'); const overtimeHours = new Prisma.Decimal(hours - 8).times(Math.min(workDays, 26)).plus(new Prisma.Decimal(Math.max(workDays - 26, 0)).times(hours)); const coefficient = overtimeHours.div(208); const allowances = profile.foodAllowance.plus(profile.housingAllowance).plus(profile.transportAllowance).plus(profile.otherAllowance); const basic = profile.monthlyGross.minus(allowances.times(new Prisma.Decimal(1).plus(coefficient))).div(new Prisma.Decimal(1).plus(coefficient.times(1.5))).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP); if (basic.lte(0)) throw new ConflictException('The inclusive compensation agreement has no valid fixed-wage component.'); return basic.plus(allowances).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP); }
function days(start: Date, end: Date) { return Math.floor((Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / 86_400_000); }
function dec(value: string | Prisma.Decimal) { try { const amount = new Prisma.Decimal(value); if (!amount.isFinite() || amount.decimalPlaces()! > 4) throw new Error(); return amount; } catch { throw new BadRequestException('A final-settlement amount is invalid.'); } }
function ymd(value: Date) { return value.toISOString().slice(0, 10) as `${number}-${number}-${number}`; } function json(value: unknown): never { const plain = JSON.parse(JSON.stringify(value)) as unknown; return JSON.parse(canonicalJson(plain)) as never; } function hash(value: unknown) { return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex'); }
function map(value: any) { return { id: value.id, employeeId: value.employeeId, terminationDate: ymd(value.terminationDate), terminationReason: value.terminationReason, reasonEvidenceReference: value.reasonEvidenceReference, reasonVerificationStatus: value.reasonVerificationStatus, serviceDays: value.serviceDays, eosWage: value.eosWage.toFixed(4), fullAwardAmount: value.fullAwardAmount.toFixed(4), entitlementFactor: value.entitlementFactor.toFixed(8), eosAmount: value.eosAmount.toFixed(4), otherCreditsAmount: value.otherCreditsAmount.toFixed(4), recoveryAmount: value.recoveryAmount.toFixed(4), netPayableAmount: value.netPayableAmount.toFixed(4), calculationPolicyVersion: POLICY, settlementNumber: value.settlementNumber, status: value.status, paidAmount: value.paidAmount.toFixed(4), createdAt: value.createdAt.toISOString(), approvedAt: value.approvedAt?.toISOString() ?? null, approvedByUserId: value.approvedByUserId ?? null, reversedByUserId: value.reversedByUserId ?? null, outputReportCode: 'hr.final-settlement' as const }; }

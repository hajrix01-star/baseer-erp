import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RequestContext } from '../observability/request-context.js';

export const CASH_PERFORMANCE_COVERAGE_POLICY_VERSION = 'PERSONAL_CASH_PERFORMANCE_COVERAGE_2026_08_20';

/**
 * Owns the immutable declaration that source events are complete from a
 * business date forward. It deliberately does not backfill old sources.
 */
@Injectable()
export class CashPerformanceCoverageService {
  constructor(private readonly database: DatabaseService) {}

  async activate(context: TrustedCompanyActorContext, coverageStartBusinessDate: Date) {
    assertBusinessDate(coverageStartBusinessDate);
    if (coverageStartBusinessDate > todayUtc()) {
      throw new BadRequestException('Cash-performance coverage cannot start in the future.');
    }
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:cash-performance-coverage`}, 0))`;
      const existing = await transaction.financeCashPerformanceCoverage.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, coverageStartBusinessDate: true, policyVersion: true, activatedAt: true },
      });
      if (existing) {
        if (sameBusinessDate(existing.coverageStartBusinessDate, coverageStartBusinessDate)) {
          return { ...existing, replayed: true };
        }
        throw new ConflictException('Cash-performance report coverage has already been activated and cannot be changed.');
      }
      const id = randomUUID();
      const activatedAt = new Date();
      await transaction.financeCashPerformanceCoverage.create({
        data: {
          id,
          tenantId: context.tenantId,
          companyId: context.companyId,
          coverageStartBusinessDate,
          policyVersion: CASH_PERFORMANCE_COVERAGE_POLICY_VERSION,
          activatedByUserId: context.actorUserId,
          activatedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: 'reports.cash_performance.coverage_activated', entityType: 'FinanceCashPerformanceCoverage', entityId: id,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          afterJson: {
            coverageStartBusinessDate: dateText(coverageStartBusinessDate),
            policyVersion: CASH_PERFORMANCE_COVERAGE_POLICY_VERSION,
          },
        },
      });
      return { id, coverageStartBusinessDate, policyVersion: CASH_PERFORMANCE_COVERAGE_POLICY_VERSION, activatedAt, replayed: false };
    });
  }
}

function assertBusinessDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf()) || value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 || value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0) {
    throw new BadRequestException('A valid business date is required.');
  }
}
function todayUtc(): Date { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
function sameBusinessDate(left: Date, right: Date): boolean { return dateText(left) === dateText(right); }
function dateText(value: Date): string { return value.toISOString().slice(0, 10); }

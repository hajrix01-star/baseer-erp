import {
  businessDateResolutionSchema,
  type BusinessDateIntent,
  type BusinessDateResolution,
} from '@baseer-erp/contracts';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';

export interface BusinessDateClock {
  now(): Date;
}

export const BUSINESS_DATE_CLOCK = Symbol('BUSINESS_DATE_CLOCK');
const RIYADH_TIMEZONE = 'Asia/Riyadh' as const;

@Injectable()
export class BusinessDateService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    @Inject(BUSINESS_DATE_CLOCK) private readonly clock: BusinessDateClock,
  ) {}

  async resolve(input: {
    accessToken: string;
    companyId: string;
    intent: BusinessDateIntent;
  }): Promise<BusinessDateResolution> {
    const context = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: ['platform.business-date.read'],
    });
    const trusted: TrustedCompanyActorContext = {
      tenantId: context.principal.tenantId,
      companyId: context.company.id,
      actorUserId: context.principal.userId,
    };
    return this.database.inTenantTransaction(trusted.tenantId, (transaction) =>
      this.resolveInTransaction(transaction, trusted, input.intent),
    );
  }

  async currentForTrustedContext(
    context: TrustedCompanyActorContext,
  ): Promise<BusinessDateResolution> {
    return this.database.inTenantTransaction(context.tenantId, (transaction) =>
      this.resolveInTransaction(transaction, context, { kind: 'current' }),
    );
  }

  async assertNotFutureInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    businessDate: Date,
    message = 'A financial record cannot use a future business date.',
  ): Promise<BusinessDateResolution> {
    const current = await this.resolveInTransaction(transaction, context, { kind: 'current' });
    if (businessDate.toISOString().slice(0, 10) > current.businessDate) {
      throw new BadRequestException(message);
    }
    return current;
  }

  async resolveInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    intent: BusinessDateIntent = { kind: 'current' },
  ): Promise<BusinessDateResolution> {
    const company = await transaction.company.findFirst({
      where: { id: context.companyId, tenantId: context.tenantId },
      select: { businessTimezone: true },
    });
    if (company?.businessTimezone !== RIYADH_TIMEZONE) {
      throw new ConflictException('The company business timezone is not approved for this kernel.');
    }
    return resolveBusinessDateIntent(intent, this.clock.now());
  }
}

/** Pure, clock-injectable resolver. It deliberately has no browser or DB dependency. */
export function resolveBusinessDateIntent(intent: BusinessDateIntent, now: Date): BusinessDateResolution {
  const generatedAt = riyadhInstant(now);
  const current = riyadhYmd(now);
  let range: { startDate: string; endDate: string };
  let businessDate: string;
  switch (intent.kind) {
    case 'current':
      businessDate = current;
      range = { startDate: current, endDate: current };
      break;
    case 'date':
      businessDate = intent.businessDate;
      range = { startDate: businessDate, endDate: businessDate };
      break;
    case 'month': {
      const year = Number(intent.month.slice(0, 4));
      const month = Number(intent.month.slice(5, 7));
      businessDate = `${intent.month}-01`;
      range = { startDate: businessDate, endDate: `${intent.month}-${String(daysInMonth(year, month)).padStart(2, '0')}` };
      break;
    }
    case 'range':
      if (intent.startDate > intent.endDate) {
        throw new ConflictException('Business date range must be ordered.');
      }
      businessDate = intent.endDate;
      range = { startDate: intent.startDate, endDate: intent.endDate };
      break;
  }
  return businessDateResolutionSchema.parse({
    timezone: RIYADH_TIMEZONE,
    businessDate,
    generatedAt,
    range,
  });
}

function riyadhInstant(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const fields = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const offset = fields.get('timeZoneName')?.replace('GMT', '') ?? '+03:00';
  return `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}T${fields.get('hour')}:${fields.get('minute')}:${fields.get('second')}${offset}`;
}
function riyadhYmd(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const fields = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

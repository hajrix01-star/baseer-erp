import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { TrustedCompanyActorContext } from './trusted-context.js';

const MAX_SERIES_LENGTH = 80;

/** A PostgreSQL DATE literal validated by DocumentSerialService at runtime. */
export type SqlDate = `${number}-${number}-${number}`;

export interface DocumentSerialReservationInput {
  readonly series: string;
  readonly businessDate: SqlDate;
}

export class DocumentSerialInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentSerialInputError';
  }
}

interface DocumentSerialRow {
  lastValue: bigint;
}

/**
 * Tenant-scoped document-number reservation only. It does not decide which
 * documents need a number or attach any financial meaning to that number.
 */
@Injectable()
export class DocumentSerialService {
  constructor(private readonly database: DatabaseService) {}

  async reserve(
    context: TrustedCompanyActorContext,
    input: DocumentSerialReservationInput,
  ): Promise<bigint> {
    return this.database.inTenantTransaction(context.tenantId, (transaction) =>
      this.reserveInTransaction(transaction, context, input),
    );
  }

  async reserveInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: DocumentSerialReservationInput,
  ): Promise<bigint> {
    this.validate(input);
    const rows = await transaction.$queryRaw<DocumentSerialRow[]>`
      INSERT INTO "DocumentSerialCounter" (
        "tenantId", "companyId", "series", "businessDate", "lastValue", "createdAt", "updatedAt"
      ) VALUES (
        ${context.tenantId}::uuid, ${context.companyId}::uuid, ${input.series},
        ${input.businessDate}::date, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId", "companyId", "series", "businessDate")
      DO UPDATE SET
        "lastValue" = "DocumentSerialCounter"."lastValue" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "lastValue"
    `;
    const reservation = rows[0];
    if (!reservation || typeof reservation.lastValue !== 'bigint') {
      throw new DocumentSerialInputError('Document serial reservation did not return a valid counter value.');
    }
    return reservation.lastValue;
  }

  /**
   * Controlled migration primitive. It raises a counter to the largest proven
   * imported legacy suffix without ever moving an existing counter backwards.
   */
  async seedAtLeast(
    context: TrustedCompanyActorContext,
    input: DocumentSerialReservationInput,
    lastValue: bigint,
  ): Promise<bigint> {
    return this.database.inTenantTransaction(context.tenantId, (transaction) =>
      this.seedAtLeastInTransaction(transaction, context, input, lastValue),
    );
  }

  async seedAtLeastInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: DocumentSerialReservationInput,
    lastValue: bigint,
  ): Promise<bigint> {
    this.validate(input);
    if (typeof lastValue !== 'bigint' || lastValue < 0n) {
      throw new DocumentSerialInputError('Seed value must be a non-negative bigint.');
    }

    const rows = await transaction.$queryRaw<DocumentSerialRow[]>`
      INSERT INTO "DocumentSerialCounter" (
        "tenantId", "companyId", "series", "businessDate", "lastValue", "createdAt", "updatedAt"
      ) VALUES (
        ${context.tenantId}::uuid, ${context.companyId}::uuid, ${input.series},
        ${input.businessDate}::date, ${lastValue}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId", "companyId", "series", "businessDate")
      DO UPDATE SET
        "lastValue" = GREATEST("DocumentSerialCounter"."lastValue", EXCLUDED."lastValue"),
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "lastValue"
    `;
    const seeded = rows[0];
    if (!seeded || typeof seeded.lastValue !== 'bigint') {
      throw new DocumentSerialInputError('Document serial seed did not return a valid counter value.');
    }
    return seeded.lastValue;
  }
  private validate(input: DocumentSerialReservationInput): void {
    if (
      !input ||
      typeof input.series !== 'string' ||
      input.series.length > MAX_SERIES_LENGTH ||
      input.series.trim().length === 0
    ) {
      throw new DocumentSerialInputError('Series must be a non-blank string up to 80 characters.');
    }
    if (typeof input.businessDate !== 'string' || !isSqlDate(input.businessDate)) {
      throw new DocumentSerialInputError('Business date must be a valid SQL DATE (YYYY-MM-DD).');
    }
  }
}

function isSqlDate(value: string): value is SqlDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import {
  IdempotencyReceiptStatus,
  Prisma,
} from '../generated/prisma/client.js';
import type { IdempotencyReceipt } from '../generated/prisma/client.js';
import type { TrustedCompanyActorContext } from './trusted-context.js';

const MAX_OPERATION_LENGTH = 160;
const MAX_KEY_LENGTH = 255;

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export interface IdempotencyBeginInput {
  readonly operation: string;
  readonly key: string;
  readonly request: CanonicalJsonValue;
  /** Must be after the current time. Receipt retention is owned by callers/jobs. */
  readonly expiresAt: Date;
}

export interface IdempotencyResponse {
  readonly status: number;
  readonly headers: CanonicalJsonValue | null;
  readonly body: CanonicalJsonValue | null;
}

export interface IdempotencyCompletionInput {
  readonly receiptId: string;
  readonly response: IdempotencyResponse;
}

export type IdempotencyBeginResult =
  | { readonly kind: 'started'; readonly receiptId: string }
  | { readonly kind: 'in-progress'; readonly receiptId: string }
  | {
      readonly kind: 'replay';
      readonly receiptId: string;
      readonly response: IdempotencyResponse;
    };

export type IdempotencyCompletionResult =
  | {
      readonly kind: 'completed';
      readonly receiptId: string;
      readonly response: IdempotencyResponse;
    }
  | {
      readonly kind: 'already-completed';
      readonly receiptId: string;
      readonly response: IdempotencyResponse;
    };

/** Raised without including request contents, idempotency keys, or hashes. */
export class IdempotencyPayloadMismatchError extends Error {
  constructor() {
    super('The idempotency key was already used with a different request payload.');
    this.name = 'IdempotencyPayloadMismatchError';
  }
}

export class IdempotencyReceiptNotFoundError extends Error {
  constructor() {
    super('The idempotency receipt does not exist in the trusted company context.');
    this.name = 'IdempotencyReceiptNotFoundError';
  }
}

export class IdempotencyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyInputError';
  }
}

interface ReceiptRow {
  id: string;
  requestHash: string;
  status: IdempotencyReceiptStatus;
  responseStatus: number | null;
  responseHeaders: unknown;
  responseBody: unknown;
}

/**
 * Stores idempotency state only. It neither performs business work nor makes
 * authorization decisions. The non-transaction helpers establish the RLS
 * tenant setting through DatabaseService; callers already in a tenant
 * transaction should use the corresponding *InTransaction methods.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly database: DatabaseService) {}

  async begin(
    context: TrustedCompanyActorContext,
    input: IdempotencyBeginInput,
  ): Promise<IdempotencyBeginResult> {
    return this.database.inTenantTransaction(context.tenantId, (transaction) =>
      this.beginInTransaction(transaction, context, input),
    );
  }

  async beginInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: IdempotencyBeginInput,
  ): Promise<IdempotencyBeginResult> {
    this.validateBeginInput(input);
    const requestHash = hashCanonicalJson(input.request);
    const candidateId = randomUUID();

    // A single parameterized statement both acquires a new receipt and reads
    // the existing receipt on conflict. Comparing ids identifies the creator
    // without exposing either the key or payload in an error/log message.
    const rows = await transaction.$queryRaw<ReceiptRow[]>`
      INSERT INTO "IdempotencyReceipt" (
        "id", "tenantId", "companyId", "actorUserId", "operation",
        "idempotencyKey", "requestHash", "status", "expiresAt"
      ) VALUES (
        ${candidateId}::uuid, ${context.tenantId}::uuid, ${context.companyId}::uuid,
        ${context.actorUserId}::uuid, ${input.operation}, ${input.key},
        ${requestHash}, 'IN_PROGRESS'::"IdempotencyReceiptStatus", ${input.expiresAt}
      )
      ON CONFLICT ("tenantId", "companyId", "actorUserId", "operation", "idempotencyKey")
      DO UPDATE SET "requestHash" = "IdempotencyReceipt"."requestHash"
      RETURNING
        "id", "requestHash", "status", "responseStatus", "responseHeaders", "responseBody"
    `;
    const receipt = rows[0];
    if (!receipt) {
      throw new IdempotencyReceiptNotFoundError();
    }

    if (receipt.requestHash !== requestHash) {
      throw new IdempotencyPayloadMismatchError();
    }

    if (receipt.id === candidateId) {
      return { kind: 'started', receiptId: receipt.id };
    }

    return this.beginResultFromReceipt(receipt);
  }

  async complete(
    context: TrustedCompanyActorContext,
    input: IdempotencyCompletionInput,
  ): Promise<IdempotencyCompletionResult> {
    return this.database.inTenantTransaction(context.tenantId, (transaction) =>
      this.completeInTransaction(transaction, context, input),
    );
  }

  async completeInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: IdempotencyCompletionInput,
  ): Promise<IdempotencyCompletionResult> {
    this.validateCompletionInput(input);
    const response = this.canonicalResponse(input.response);
    const updated = await transaction.idempotencyReceipt.updateMany({
      where: {
        id: input.receiptId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        status: IdempotencyReceiptStatus.IN_PROGRESS,
      },
      data: {
        status: IdempotencyReceiptStatus.COMPLETED,
        responseStatus: response.status,
        responseHeaders:
          response.headers === null ? Prisma.JsonNull : response.headers,
        responseBody: response.body === null ? Prisma.JsonNull : response.body,
      },
    });

    if (updated.count === 1) {
      return { kind: 'completed', receiptId: input.receiptId, response };
    }

    const receipt = await transaction.idempotencyReceipt.findFirst({
      where: {
        id: input.receiptId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
      },
      select: {
        id: true,
        status: true,
        responseStatus: true,
        responseHeaders: true,
        responseBody: true,
      },
    });
    if (!receipt) {
      throw new IdempotencyReceiptNotFoundError();
    }
    if (receipt.status !== IdempotencyReceiptStatus.COMPLETED) {
      throw new IdempotencyInputError('The idempotency receipt cannot be completed.');
    }

    return {
      kind: 'already-completed',
      receiptId: receipt.id,
      response: responseFromReceipt(receipt),
    };
  }

  private beginResultFromReceipt(receipt: ReceiptRow): IdempotencyBeginResult {
    if (receipt.status === IdempotencyReceiptStatus.IN_PROGRESS) {
      return { kind: 'in-progress', receiptId: receipt.id };
    }

    return {
      kind: 'replay',
      receiptId: receipt.id,
      response: responseFromReceipt(receipt),
    };
  }

  private validateBeginInput(input: IdempotencyBeginInput): void {
    if (!input || !isNonBlankString(input.operation, MAX_OPERATION_LENGTH)) {
      throw new IdempotencyInputError('Operation must be a non-blank string up to 160 characters.');
    }
    if (!isNonBlankString(input.key, MAX_KEY_LENGTH)) {
      throw new IdempotencyInputError('Idempotency key must be a non-blank string up to 255 characters.');
    }
    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.valueOf())) {
      throw new IdempotencyInputError('Expiry must be a valid Date.');
    }
    if (input.expiresAt <= new Date()) {
      throw new IdempotencyInputError('Expiry must be in the future.');
    }
    canonicalJson(input.request);
  }

  private validateCompletionInput(input: IdempotencyCompletionInput): void {
    if (!input || !isNonBlankString(input.receiptId, 36)) {
      throw new IdempotencyInputError('Receipt id is required.');
    }
    if (!input.response || !Number.isInteger(input.response.status) || input.response.status < 100 || input.response.status > 599) {
      throw new IdempotencyInputError('Response status must be an integer from 100 through 599.');
    }
  }

  private canonicalResponse(response: IdempotencyResponse): IdempotencyResponse {
    return {
      status: response.status,
      headers: response.headers === null ? null : parseCanonicalJson(response.headers),
      body: response.body === null ? null : parseCanonicalJson(response.body),
    };
  }
}

/** Deterministic JSON serializer used as the SHA-256 input for requests. */
export function canonicalJson(value: unknown): string {
  return serializeCanonicalJson(value, new Set<object>());
}

export function hashCanonicalJson(value: CanonicalJsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function responseFromReceipt(
  receipt: Pick<IdempotencyReceipt, 'responseStatus' | 'responseHeaders' | 'responseBody'> | ReceiptRow,
): IdempotencyResponse {
  if (receipt.responseStatus === null) {
    throw new IdempotencyInputError('A completed receipt is missing its response status.');
  }
  return {
    status: receipt.responseStatus,
    headers: receipt.responseHeaders === null ? null : parseCanonicalJson(receipt.responseHeaders),
    body: receipt.responseBody === null ? null : parseCanonicalJson(receipt.responseBody),
  };
}

function parseCanonicalJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(canonicalJson(value)) as CanonicalJsonValue;
}

function serializeCanonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new IdempotencyInputError('Request JSON cannot contain non-finite numbers.');
      }
      return JSON.stringify(value);
    case 'object':
      if (ancestors.has(value)) {
        throw new IdempotencyInputError('Request JSON cannot contain circular references.');
      }
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map((item) => serializeCanonicalJson(item, ancestors)).join(',')}]`;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
          throw new IdempotencyInputError('Request JSON must contain only plain objects and arrays.');
        }
        const objectValue = value as Record<string, unknown>;
        return `{${Object.keys(objectValue)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${serializeCanonicalJson(objectValue[key], ancestors)}`)
          .join(',')}}`;
      } finally {
        ancestors.delete(value);
      }
    default:
      throw new IdempotencyInputError('Request JSON contains an unsupported value.');
  }
}

function isNonBlankString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && value.trim().length > 0;
}

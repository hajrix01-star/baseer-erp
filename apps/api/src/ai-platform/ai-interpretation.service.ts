import { randomUUID } from "node:crypto";

import { ConflictException, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { hashCanonicalJson, type CanonicalJsonValue } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AiInterpretationRunStatus, Prisma } from "../generated/prisma/client.js";
import { AiCredentialVault } from "./ai-credential-vault.js";

const RUN_LEASE_MS = 2 * 60 * 1_000;

const reusableInterpretationSelect = {
  id: true,
  sourceExecutionReceiptId: true,
  encryptedOutput: true,
  outputIv: true,
  outputTag: true,
  outputKeyVersion: true,
  outputChecksum: true,
  createdAt: true,
  expiresAt: true,
} satisfies Prisma.AiInterpretationSelect;

type ReusableInterpretationRecord = Prisma.AiInterpretationGetPayload<{
  select: typeof reusableInterpretationSelect;
}>;

export type ReusableInterpretation<T> = Readonly<{
  id: string;
  sourceExecutionReceiptId: string;
  output: T;
  outputChecksum: string;
  createdAt: Date;
  expiresAt: Date | null;
}>;

export type InterpretationClaim<T> =
  | Readonly<{ kind: "reused"; interpretation: ReusableInterpretation<T> }>
  | Readonly<{ kind: "claimed"; runId: string }>
  | Readonly<{ kind: "in-progress" }>;

/**
 * Coordinates exact reuse and concurrent provider requests. It deliberately
 * does not know a prompt, a domain model, or an adapter: callers must still
 * build server-owned evidence and pass strict output schemas.
 */
@Injectable()
export class AiInterpretationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly vault: AiCredentialVault,
  ) {}

  async claim<T>(
    context: TrustedCompanyActorContext,
    reuseKey: string,
  ): Promise<InterpretationClaim<T>> {
    const now = new Date();
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      // Serialise claimers for one exact company/input key. The partial
      // PENDING index protects the common race; this lock also closes the
      // narrow gap where one caller completes between another caller's first
      // reusable lookup and PENDING insert.
      await this.lockReuseKeyInTransaction(transaction, context, reuseKey);

      const reusable = await this.findReusableInTransaction<T>(transaction, context, reuseKey, now);
      if (reusable) return { kind: "reused" as const, interpretation: reusable };

      // A process that dies after provider dispatch must not leave this exact
      // input blocked forever. The old lease is marked failed before a new
      // claimant can create its PENDING row.
      await transaction.aiInterpretationRun.updateMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          reuseKey,
          status: AiInterpretationRunStatus.PENDING,
          leaseExpiresAt: { lte: now },
        },
        data: {
          status: AiInterpretationRunStatus.FAILED,
          safeFailureCode: "LEASE_EXPIRED",
          completedAt: now,
        },
      });

      try {
        const run = await transaction.aiInterpretationRun.create({
          data: {
            id: randomUUID(),
            tenantId: context.tenantId,
            companyId: context.companyId,
            reuseKey,
            status: AiInterpretationRunStatus.PENDING,
            leaseExpiresAt: new Date(now.valueOf() + RUN_LEASE_MS),
            claimedByUserId: context.actorUserId,
          },
          select: { id: true },
        });
        return { kind: "claimed" as const, runId: run.id };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        // The partial unique index permits only one unexpired PENDING row.
        // A completed row cannot collide, so any P2002 here means another
        // request is already responsible for exactly this provider call.
        const current = await transaction.aiInterpretationRun.findFirst({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            reuseKey,
            status: AiInterpretationRunStatus.PENDING,
            leaseExpiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (current) return { kind: "in-progress" as const };
        throw new ConflictException("The interpretation request changed while it was being claimed. Try again.");
      }
    });
  }

  async findReusable<T>(
    context: TrustedCompanyActorContext,
    reuseKey: string,
    now = new Date(),
  ): Promise<ReusableInterpretation<T> | null> {
    return this.database.inTenantTransaction(context.tenantId, (transaction) =>
      this.findReusableInTransaction<T>(transaction, context, reuseKey, now),
    );
  }

  /** The same transaction-scoped lock is acquired by both claim and success
   * persistence. Without it a caller could observe no reusable result while
   * another caller commits its result, then create a fresh PENDING row after
   * the original row becomes COMPLETED. */
  async lockReuseKeyInTransaction(
    transaction: Prisma.TransactionClient,
    context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
    reuseKey: string,
  ): Promise<void> {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.claimLockKey(context, reuseKey)}, 0))`,
    );
  }

  private async findReusableInTransaction<T>(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    reuseKey: string,
    now: Date,
  ): Promise<ReusableInterpretation<T> | null> {
    const interpretation = await transaction.aiInterpretation.findFirst({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        reuseKey,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
      select: reusableInterpretationSelect,
    });
    if (!interpretation) return null;
    return this.decodeReusable<T>(context, reuseKey, interpretation);
  }

  private decodeReusable<T>(
    context: TrustedCompanyActorContext,
    reuseKey: string,
    interpretation: ReusableInterpretationRecord,
  ): ReusableInterpretation<T> {
    const output = this.vault.decryptOutput<T>(
      interpretation,
      interpretationAad(context, reuseKey, interpretation.outputChecksum),
    );
    if (hashCanonicalJson(output as CanonicalJsonValue) !== interpretation.outputChecksum) {
      throw new ConflictException("The stored Basira interpretation checksum is invalid.");
    }
    return {
      id: interpretation.id,
      sourceExecutionReceiptId: interpretation.sourceExecutionReceiptId,
      output,
      outputChecksum: interpretation.outputChecksum,
      createdAt: interpretation.createdAt,
      expiresAt: interpretation.expiresAt,
    };
  }

  private claimLockKey(
    context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
    reuseKey: string,
  ): string {
    return `${context.tenantId}:${context.companyId}:${reuseKey}`;
  }

  /** Read path for a future Command Center/report placement. It never invokes
   * a provider and remains company-scoped under the caller's live RBAC gate. */
  async findById<T>(
    context: TrustedCompanyActorContext,
    interpretationId: string,
  ): Promise<(ReusableInterpretation<T> & Readonly<{
    subjectKind: "DECISION_ALERT" | "MARKETING_CAMPAIGN";
    subjectId: string;
    evidenceSnapshotId: string;
    skillKey: string;
    language: string;
    modelSnapshot: string;
  }>) | null> {
    const interpretation = await this.database.inTenantTransaction(context.tenantId, (transaction) =>
      transaction.aiInterpretation.findFirst({
        where: { id: interpretationId, tenantId: context.tenantId, companyId: context.companyId },
        select: {
          id: true, sourceExecutionReceiptId: true, subjectKind: true, subjectId: true,
          evidenceSnapshotId: true, skillKey: true, language: true, modelSnapshot: true,
          reuseKey: true, encryptedOutput: true, outputIv: true, outputTag: true,
          outputKeyVersion: true, outputChecksum: true, createdAt: true, expiresAt: true,
        },
      }),
    );
    if (!interpretation) return null;
    const output = this.vault.decryptOutput<T>(
      interpretation,
      interpretationAad(context, interpretation.reuseKey, interpretation.outputChecksum),
    );
    if (hashCanonicalJson(output as CanonicalJsonValue) !== interpretation.outputChecksum) {
      throw new ConflictException("The stored Basira interpretation checksum is invalid.");
    }
    return {
      id: interpretation.id,
      sourceExecutionReceiptId: interpretation.sourceExecutionReceiptId,
      subjectKind: interpretation.subjectKind,
      subjectId: interpretation.subjectId,
      evidenceSnapshotId: interpretation.evidenceSnapshotId,
      skillKey: interpretation.skillKey,
      language: interpretation.language,
      modelSnapshot: interpretation.modelSnapshot,
      output,
      outputChecksum: interpretation.outputChecksum,
      createdAt: interpretation.createdAt,
      expiresAt: interpretation.expiresAt,
    };
  }

  async markRunCompleted(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: Readonly<{ runId: string; interpretationId: string }>,
  ): Promise<void> {
    const completed = await transaction.aiInterpretationRun.updateMany({
      where: {
        id: input.runId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: AiInterpretationRunStatus.PENDING,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: AiInterpretationRunStatus.COMPLETED,
        interpretationId: input.interpretationId,
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) {
      throw new ConflictException("The interpretation lease is no longer active.");
    }
  }

  async markRunFailed(
    context: TrustedCompanyActorContext,
    input: Readonly<{ runId: string; safeFailureCode: string }>,
  ): Promise<void> {
    await this.database.inTenantTransaction(context.tenantId, (transaction) =>
      transaction.aiInterpretationRun.updateMany({
        where: {
          id: input.runId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: AiInterpretationRunStatus.PENDING,
        },
        data: {
          status: AiInterpretationRunStatus.FAILED,
          safeFailureCode: input.safeFailureCode,
          completedAt: new Date(),
        },
      }),
    );
  }
}

export function interpretationAad(
  context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
  reuseKey: string,
  outputChecksum: string,
): string {
  return `baseer-ai-interpretation:v1:${context.tenantId}:${context.companyId}:${reuseKey}:${outputChecksum}`;
}

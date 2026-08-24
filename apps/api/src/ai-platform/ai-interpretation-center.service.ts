import { randomUUID } from "node:crypto";

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  aiInterpretationDetailSchema,
  aiInterpretationListItemSchema,
  aiStoredInterpretationOutputSchema,
  type AiInterpretationListQuery,
  type ApproveAiHumanInsightRequest,
  type CreateAiHumanInsightRequest,
  type RevokeAiHumanInsightRequest,
} from "@baseer-erp/contracts";

import { hashCanonicalJson, type CanonicalJsonValue, IdempotencyService } from "../core-controls/idempotency.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { AiHumanInsightStatus, Prisma } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { AiCredentialVault } from "./ai-credential-vault.js";

export type InterpretationSubjectAccess = Readonly<{
  context: TrustedCompanyActorContext;
  allowedSubjects: readonly ("DECISION_ALERT" | "MARKETING_CAMPAIGN")[];
}>;

const HUMAN_INSIGHT_CREATE_OPERATION = "platform.ai.human_insight.create";
const HUMAN_INSIGHT_APPROVE_OPERATION = "platform.ai.human_insight.approve";
const HUMAN_INSIGHT_REVOKE_OPERATION = "platform.ai.human_insight.revoke";

@Injectable()
export class AiInterpretationCenterService {
  constructor(
    private readonly database: DatabaseService,
    private readonly vault: AiCredentialVault,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** A read-only query. It never reads a provider, creates a receipt, or
   * records a placement merely because someone opened the centre. */
  async list(access: InterpretationSubjectAccess, query: AiInterpretationListQuery) {
    const now = new Date();
    if (query.subjectKind && !this.allowed(access, query.subjectKind)) return [];
    const rows = await this.database.inTenantTransaction(access.context.tenantId, (transaction) =>
      transaction.aiInterpretation.findMany({
        where: {
          tenantId: access.context.tenantId,
          companyId: access.context.companyId,
          subjectKind: query.subjectKind ?? { in: [...access.allowedSubjects] },
        },
        orderBy: { createdAt: "desc" },
        take: query.pageSize,
        select: interpretationListSelect,
      }),
    );
    return rows.map((row) => aiInterpretationListItemSchema.parse(this.toListItem(access.context, row as unknown as InterpretationListRow, now)));
  }

  async detail(access: InterpretationSubjectAccess, interpretationId: string) {
    const row = await this.database.inTenantTransaction(access.context.tenantId, (transaction) =>
      transaction.aiInterpretation.findFirst({
        where: { id: interpretationId, tenantId: access.context.tenantId, companyId: access.context.companyId },
        select: interpretationDetailSelect,
      }),
    );
    if (!row || !this.allowed(access, row.subjectKind)) throw new NotFoundException("The Basira interpretation was not found.");
    const output = this.decodeOutput(access.context, row);
    const humanInsights = row.humanInsights.map((insight) => this.toHumanInsight(access.context, insight));
    return aiInterpretationDetailSchema.parse({
      ...this.toListItem(access.context, row as unknown as InterpretationListRow, new Date(), output),
      sourceExecutionReceiptId: row.sourceExecutionReceiptId,
      evidenceChecksum: row.evidenceChecksum,
      outputChecksum: row.outputChecksum,
      output,
      placements: row.placements.map((placement) => ({
        id: placement.id,
        kind: placement.kind,
        subjectId: placement.subjectId,
        moduleKey: placement.moduleKey,
        createdAt: placement.createdAt,
      })),
      humanInsights,
    });
  }

  async createHumanInsight(
    access: InterpretationSubjectAccess,
    interpretationId: string,
    input: CreateAiHumanInsightRequest,
  ) {
    const context = access.context;
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const interpretation = await this.requireInterpretation(transaction, access, interpretationId);
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: HUMAN_INSIGHT_CREATE_OPERATION,
        key: input.idempotencyKey,
        request: { interpretationId, kind: input.kind, statement: input.statement, supersedesInsightId: input.supersedesInsightId ?? null },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return begun.response.body as { id: string; status: "DRAFT" };
      if (begun.kind === "in-progress") throw new ConflictException("The human-insight request is still in progress.");
      if (input.supersedesInsightId) {
        const previous = await transaction.aiHumanInsight.findFirst({
          where: { id: input.supersedesInsightId, tenantId: context.tenantId, companyId: context.companyId, interpretationId },
          select: { id: true },
        });
        if (!previous) throw new NotFoundException("The previous human insight was not found.");
      }
      const id = randomUUID();
      const statementChecksum = hashCanonicalJson({ statement: input.statement } satisfies CanonicalJsonValue);
      const envelope = this.vault.encryptOutput(
        { statement: input.statement },
        humanInsightAad(context, id, interpretation.id, statementChecksum),
      );
      await transaction.aiHumanInsight.create({
        data: {
          id,
          tenantId: context.tenantId,
          companyId: context.companyId,
          interpretationId: interpretation.id,
          kind: input.kind,
          status: AiHumanInsightStatus.DRAFT,
          encryptedStatement: envelope.encryptedOutput,
          statementIv: envelope.outputIv,
          statementTag: envelope.outputTag,
          statementKeyVersion: envelope.outputKeyVersion,
          statementChecksum,
          supersedesInsightId: input.supersedesInsightId ?? null,
          createdByUserId: context.actorUserId,
        },
      });
      await this.audit(transaction, context, "platform.ai.human_insight_drafted", id, {
        interpretationId: interpretation.id,
        kind: input.kind,
        statementChecksum,
      });
      const response = { id, status: "DRAFT" as const };
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: begun.receiptId,
        response: { status: 201, headers: null, body: response },
      });
      return response;
    });
  }

  async approveHumanInsight(
    access: InterpretationSubjectAccess,
    insightId: string,
    input: ApproveAiHumanInsightRequest,
  ) {
    return this.transitionHumanInsight(access, insightId, input.idempotencyKey, "APPROVED", null);
  }

  async revokeHumanInsight(
    access: InterpretationSubjectAccess,
    insightId: string,
    input: RevokeAiHumanInsightRequest,
  ) {
    return this.transitionHumanInsight(access, insightId, input.idempotencyKey, "REVOKED", input.reason);
  }

  private async transitionHumanInsight(
    access: InterpretationSubjectAccess,
    insightId: string,
    idempotencyKey: string,
    target: "APPROVED" | "REVOKED",
    reason: string | null,
  ) {
    const context = access.context;
    const operation = target === "APPROVED" ? HUMAN_INSIGHT_APPROVE_OPERATION : HUMAN_INSIGHT_REVOKE_OPERATION;
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const insight = await transaction.aiHumanInsight.findFirst({
        where: { id: insightId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, interpretation: { select: { subjectKind: true } }, status: true },
      });
      if (!insight || !this.allowed(access, insight.interpretation.subjectKind)) throw new NotFoundException("The human insight was not found.");
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation,
        key: idempotencyKey,
        request: { insightId, reason },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === "replay") return begun.response.body as { id: string; status: "APPROVED" | "REVOKED" };
      if (begun.kind === "in-progress") throw new ConflictException("The human-insight request is still in progress.");
      if (target === "APPROVED" && insight.status !== AiHumanInsightStatus.DRAFT) throw new ConflictException("Only a draft human insight can be approved.");
      if (target === "REVOKED" && insight.status === AiHumanInsightStatus.REVOKED) throw new ConflictException("The human insight is already revoked.");
      const now = new Date();
      await transaction.aiHumanInsight.update({
        where: { id: insight.id },
        data: target === "APPROVED"
          ? { status: AiHumanInsightStatus.APPROVED, approvedByUserId: context.actorUserId, approvedAt: now }
          : { status: AiHumanInsightStatus.REVOKED, revokedByUserId: context.actorUserId, revokedAt: now, revocationReason: reason },
      });
      await this.audit(transaction, context, target === "APPROVED" ? "platform.ai.human_insight_approved" : "platform.ai.human_insight_revoked", insight.id, { reason });
      const response = { id: insight.id, status: target };
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: begun.receiptId,
        response: { status: 200, headers: null, body: response },
      });
      return response;
    });
  }

  private async requireInterpretation(transaction: Prisma.TransactionClient, access: InterpretationSubjectAccess, interpretationId: string) {
    const value = await transaction.aiInterpretation.findFirst({
      where: { id: interpretationId, tenantId: access.context.tenantId, companyId: access.context.companyId },
      select: { id: true, subjectKind: true },
    });
    if (!value || !this.allowed(access, value.subjectKind)) throw new NotFoundException("The Basira interpretation was not found.");
    return value;
  }

  private allowed(access: InterpretationSubjectAccess, subjectKind: string): subjectKind is "DECISION_ALERT" | "MARKETING_CAMPAIGN" {
    return (subjectKind === "DECISION_ALERT" || subjectKind === "MARKETING_CAMPAIGN") && access.allowedSubjects.includes(subjectKind);
  }

  private decodeOutput(context: TrustedCompanyActorContext, row: InterpretationEncryptedRow) {
    const output = this.vault.decryptOutput<unknown>(row, interpretationOutputAad(context, row.reuseKey, row.outputChecksum));
    const parsed = aiStoredInterpretationOutputSchema.parse(output);
    if (hashCanonicalJson(parsed as CanonicalJsonValue) !== row.outputChecksum) {
      throw new ConflictException("The stored Basira interpretation checksum is invalid.");
    }
    return parsed;
  }

  private toHumanInsight(context: TrustedCompanyActorContext, row: HumanInsightEncryptedRow) {
    const decoded = this.vault.decryptOutput<{ statement: string }>(
      { encryptedOutput: row.encryptedStatement, outputIv: row.statementIv, outputTag: row.statementTag, outputKeyVersion: row.statementKeyVersion },
      humanInsightAad(context, row.id, row.interpretationId, row.statementChecksum),
    );
    const statement = typeof decoded?.statement === "string" ? decoded.statement : "";
    if (hashCanonicalJson({ statement } satisfies CanonicalJsonValue) !== row.statementChecksum) {
      throw new ConflictException("The stored human insight checksum is invalid.");
    }
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      statement,
      supersedesInsightId: row.supersedesInsightId,
      createdAt: row.createdAt,
      approvedAt: row.approvedAt,
      revokedAt: row.revokedAt,
      revocationReason: row.revocationReason,
    };
  }

  private toListItem(context: TrustedCompanyActorContext, row: InterpretationListRow, now: Date, decodedOutput?: ReturnType<typeof aiStoredInterpretationOutputSchema.parse>) {
    const output = decodedOutput ?? this.decodeOutput(context, row);
    const humanInsightCounts = row.humanInsights.reduce((counts, insight) => ({
      draft: counts.draft + (insight.status === AiHumanInsightStatus.DRAFT ? 1 : 0),
      approved: counts.approved + (insight.status === AiHumanInsightStatus.APPROVED ? 1 : 0),
    }), { draft: 0, approved: 0 });
    return {
      id: row.id,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      moduleKey: row.subjectKind === "DECISION_ALERT" ? "decision_intelligence" : "marketing",
      skillKey: row.skillKey,
      language: row.language,
      evidenceSnapshotId: row.evidenceSnapshotId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      isExpired: row.expiresAt !== null && row.expiresAt <= now,
      placementCount: row.placements.length,
      humanInsightCounts,
      summary: output.summary,
    };
  }

  private async audit(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, afterJson: Prisma.InputJsonValue) {
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
        actorUserId: context.actorUserId, action, entityType: "AiHumanInsight", entityId,
        requestId: RequestContext.correlationId() ?? randomUUID(), afterJson,
      },
    });
  }
}

const interpretationListSelect = {
  id: true, subjectKind: true, subjectId: true, evidenceSnapshotId: true, skillKey: true,
  language: true, reuseKey: true, encryptedOutput: true, outputIv: true, outputTag: true,
  outputKeyVersion: true, outputChecksum: true, createdAt: true, expiresAt: true,
  placements: { select: { id: true } },
  humanInsights: { select: { status: true } },
} satisfies Prisma.AiInterpretationSelect;

const interpretationDetailSelect = {
  ...interpretationListSelect,
  sourceExecutionReceiptId: true,
  evidenceChecksum: true,
  placements: { select: { id: true, kind: true, subjectId: true, moduleKey: true, createdAt: true } },
  humanInsights: { select: {
    id: true, interpretationId: true, kind: true, status: true, encryptedStatement: true,
    statementIv: true, statementTag: true, statementKeyVersion: true, statementChecksum: true,
    supersedesInsightId: true, createdAt: true, approvedAt: true, revokedAt: true, revocationReason: true,
  }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.AiInterpretationSelect;

type InterpretationListRow = Prisma.AiInterpretationGetPayload<{ select: typeof interpretationListSelect }>;
type InterpretationEncryptedRow = Pick<InterpretationListRow, "reuseKey" | "encryptedOutput" | "outputIv" | "outputTag" | "outputKeyVersion" | "outputChecksum">;
type HumanInsightEncryptedRow = Prisma.AiHumanInsightGetPayload<{ select: typeof interpretationDetailSelect.humanInsights.select }>;

export function interpretationOutputAad(
  context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
  reuseKey: string,
  outputChecksum: string,
): string {
  return `baseer-ai-interpretation:v1:${context.tenantId}:${context.companyId}:${reuseKey}:${outputChecksum}`;
}

export function humanInsightAad(
  context: Pick<TrustedCompanyActorContext, "tenantId" | "companyId">,
  insightId: string,
  interpretationId: string,
  checksum: string,
): string {
  return `baseer-ai-human-insight:v1:${context.tenantId}:${context.companyId}:${interpretationId}:${insightId}:${checksum}`;
}

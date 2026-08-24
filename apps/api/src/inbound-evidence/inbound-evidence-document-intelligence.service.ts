import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { inboundEvidenceDocumentAnalysisSchema, type AnalyzeInboundEvidenceAttachmentRequest, type InboundEvidenceDocumentAnalysis } from "@baseer-erp/contracts";

import { AiProviderConfigurationStatus, AiCompanyIdentityStatus, Prisma } from "../generated/prisma/client.js";
import { DatabaseService } from "../database/database.service.js";
import { RequestContext } from "../observability/request-context.js";
import type { TrustedTenantAdministratorContext } from "../administration/tenant-administration-context.service.js";
import { AiCredentialVault } from "../ai-platform/ai-credential-vault.js";
import { AiProviderAdapterRegistry } from "../ai-platform/ai-provider-adapter-registry.js";
import { selectAiSkill } from "../ai-platform/ai-skills.js";
import { InboundEvidenceGmailService } from "./inbound-evidence-gmail.service.js";

const money = z.string().regex(/^-?\d{1,15}(?:\.\d{1,4})?$/).nullable();
const rawResultSchema = z.object({
  documentKind: z.enum(["INVOICE", "TRANSFER_CONFIRMATION", "TAX_NOTICE", "PLATFORM_NOTICE", "STATEMENT", "OTHER", "UNKNOWN"]),
  summaryAr: z.string().trim().min(1).max(1400),
  direction: z.enum(["INCOMING", "OUTGOING", "UNKNOWN"]),
  supplierOrPlatform: z.string().trim().max(240).nullable(),
  reference: z.string().trim().max(240).nullable(),
  documentDate: z.string().date().nullable(), dueDate: z.string().date().nullable(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  netAmount: money, taxAmount: money, grossAmount: money,
  overallConfidence: z.number().min(0).max(1), warnings: z.array(z.string().max(300)).max(12), suspectedPromptInjection: z.boolean(),
  fields: z.array(z.object({ key: z.string().min(1).max(80), value: z.string().max(500).nullable(), confidence: z.number().min(0).max(1), page: z.number().int().min(1).max(500).nullable(), evidenceExcerpt: z.string().max(300).nullable() }).strict()).max(24),
}).strict();
type RawResult = z.infer<typeof rawResultSchema>;

/**
 * A narrow S3 evidence extractor: safe attachment -> one visual model call ->
 * strict JSON -> deterministic validation -> immutable review evidence.
 * It deliberately contains no financial service, matching logic, or command.
 */
@Injectable()
export class InboundEvidenceDocumentIntelligenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly gmail: InboundEvidenceGmailService,
    private readonly adapters: AiProviderAdapterRegistry,
    private readonly vault: AiCredentialVault,
  ) {}

  async analyze(context: TrustedTenantAdministratorContext, attachmentId: string, request: AnalyzeInboundEvidenceAttachmentRequest): Promise<InboundEvidenceDocumentAnalysis> {
    this.ownerOnly(context);
    const skill = selectAiSkill("inbound-evidence", "inbound.document_intelligence");
    if (!skill || (skill.status !== "PILOT" && skill.status !== "ACTIVE")) throw new ForbiddenException("The document-intelligence skill is not active.");
    if (process.env.BASEER_INBOUND_DOCUMENT_INTELLIGENCE_ENABLED !== "true") throw new ForbiddenException("Document intelligence is not enabled in this deployment.");

    const existing = await this.findReplay(context, attachmentId, request.idempotencyKey);
    if (existing) return existing;
    const attachment = await this.gmail.readAttachmentForAnalysis(context, attachmentId);
    const setup = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [provider, identity] = await Promise.all([
        tx.aiProviderConfiguration.findFirst({ where: { tenantId: context.tenantId, status: AiProviderConfigurationStatus.ACTIVE, isDefault: true }, select: { id: true, provider: true, model: true, configurationVersion: true, encryptedCredential: true, credentialIv: true, credentialTag: true, credentialKeyVersion: true } }),
        tx.aiSystemIdentity.findFirst({ where: { tenantId: context.tenantId, status: AiCompanyIdentityStatus.ACTIVE }, select: { safetyInstructions: true } }),
      ]);
      if (!provider || provider.provider !== "OPENAI_COMPATIBLE") throw new ConflictException("An active OpenAI-compatible provider is required for document intelligence.");
      return { provider, identity };
    });

    let raw: RawResult;
    try {
      raw = rawResultSchema.parse(await this.adapters.analyzeDocument({
        apiKey: this.vault.decryptApiKey(setup.provider), model: setup.provider.model,
        bytes: attachment.bytes, mimeType: attachment.mimeType, fileName: attachment.fileName,
        actorFingerprint: `${context.tenantId}:${context.actorUserId}:inbound-document`, safetyInstructions: setup.identity?.safetyInstructions ?? "",
      }));
    } catch (error) {
      throw error instanceof ServiceUnavailableException ? error : new ServiceUnavailableException("The document analysis provider is temporarily unavailable.", { cause: error });
    }
    const validationWarnings = validateAmounts(raw);
    const status = validationWarnings.length || raw.suspectedPromptInjection || raw.overallConfidence < 0.75 ? "NEEDS_REVIEW" as const : "ANALYZED" as const;
    const now = new Date();
    const resultChecksum = sha({ raw, validationWarnings, sourceSha256: attachment.sha256, schemaVersion: 1 });
    const created = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const prior = await tx.inboundEvidenceDocumentAnalysis.findFirst({ where: { tenantId: context.tenantId, attachmentId }, orderBy: { createdAt: "desc" }, select: { id: true } });
      const id = randomUUID();
      const requestId = RequestContext.correlationId() ?? randomUUID();
      const row = await tx.inboundEvidenceDocumentAnalysis.create({ data: {
        id, tenantId: context.tenantId, attachmentId, supersedesId: prior?.id ?? null, status, sourceSha256: attachment.sha256,
        skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, provider: setup.provider.provider, model: setup.provider.model, configurationVersion: setup.provider.configurationVersion,
        promptVersion: 1, schemaVersion: 1, resultJson: raw, validationJson: { validationWarnings, status }, resultChecksum, requestId, createdByUserId: context.actorUserId, createdAt: now,
      } });
      await tx.inboundEvidenceCommandReceipt.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, operation: "inbound_evidence.attachment.analyze", idempotencyKey: request.idempotencyKey, requestHash: sha({ attachmentId }), responseJson: { id: row.id }, expiresAt: new Date(Date.now() + 86_400_000) } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, action: "inbound_evidence.attachment.analyzed", entityType: "InboundEvidenceDocumentAnalysis", entityId: row.id, requestId, afterJson: { attachmentId, status, documentKind: raw.documentKind, skillKey: skill.key, skillVersion: skill.version, model: setup.provider.model, resultChecksum, validationWarningCount: validationWarnings.length } } });
      return row;
    });
    return this.public(created, false);
  }

  async list(context: TrustedTenantAdministratorContext, attachmentId: string): Promise<InboundEvidenceDocumentAnalysis[]> {
    this.ownerOnly(context);
    const rows = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.inboundEvidenceDocumentAnalysis.findMany({ where: { tenantId: context.tenantId, attachmentId }, orderBy: { createdAt: "desc" }, take: 20 }));
    return rows.map((row) => this.public(row, false));
  }

  private async findReplay(context: TrustedTenantAdministratorContext, attachmentId: string, key: string): Promise<InboundEvidenceDocumentAnalysis | null> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const receipt = await tx.inboundEvidenceCommandReceipt.findFirst({ where: { tenantId: context.tenantId, actorUserId: context.actorUserId, operation: "inbound_evidence.attachment.analyze", idempotencyKey: key } });
      if (!receipt) return null;
      if (receipt.requestHash !== sha({ attachmentId })) throw new ConflictException("This idempotency key was already used for another attachment.");
      const id = (receipt.responseJson as { id?: unknown }).id;
      if (typeof id !== "string") throw new ConflictException("The previous analysis receipt is invalid.");
      const row = await tx.inboundEvidenceDocumentAnalysis.findFirst({ where: { id, tenantId: context.tenantId, attachmentId } });
      if (!row) throw new ConflictException("The previous analysis is unavailable.");
      return this.public(row, true);
    });
  }

  private public(row: { id: string; attachmentId: string; status: "ANALYZED" | "NEEDS_REVIEW" | "FAILED"; resultJson: unknown; validationJson: unknown; skillKey: string; skillVersion: number; model: string; createdAt: Date }, replayed: boolean): InboundEvidenceDocumentAnalysis {
    const raw = rawResultSchema.parse(row.resultJson);
    const validation = row.validationJson as { validationWarnings?: unknown };
    return inboundEvidenceDocumentAnalysisSchema.parse({ id: row.id, attachmentId: row.attachmentId, status: row.status, ...raw, validationWarnings: Array.isArray(validation.validationWarnings) ? validation.validationWarnings : [], skillKey: row.skillKey, skillVersion: row.skillVersion, model: row.model, createdAt: row.createdAt.toISOString(), replayed });
  }

  private ownerOnly(context: TrustedTenantAdministratorContext) { if (!context.isOwner) throw new ForbiddenException("Tenant-owner access is required."); }
}

function validateAmounts(raw: RawResult) {
  const warnings: string[] = [];
  if (raw.netAmount && raw.taxAmount && raw.grossAmount) {
    const expected = new Prisma.Decimal(raw.netAmount).plus(raw.taxAmount);
    if (expected.minus(new Prisma.Decimal(raw.grossAmount)).abs().greaterThan(new Prisma.Decimal("0.02"))) warnings.push("إجمالي المستند لا يطابق صافي المبلغ والضريبة؛ راجعه قبل أي إجراء.");
  }
  if (raw.suspectedPromptInjection) warnings.push("يحتوي المستند على نص قد يحاول توجيه النظام؛ عومل كمحتوى غير موثوق.");
  if (raw.overallConfidence < 0.75) warnings.push("ثقة الاستخراج منخفضة؛ راجع المستند الأصلي والحقول الظاهرة.");
  return warnings;
}
function sha(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

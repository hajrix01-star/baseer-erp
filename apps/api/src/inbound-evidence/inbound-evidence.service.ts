import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import type {
  CreateInboundEvidenceLabelRequest,
  CreateInboundEvidenceRuleRequest,
  UpdateInboundEvidenceLabelRequest,
  UpdateInboundEvidenceRuleRequest,
} from "@baseer-erp/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { DatabaseService } from "../database/database.service.js";
import { RequestContext } from "../observability/request-context.js";
import type { TrustedTenantAdministratorContext } from "../administration/tenant-administration-context.service.js";

type Receipt = { id: string; replayed: boolean };
type LabelPayload = Omit<CreateInboundEvidenceLabelRequest, "idempotencyKey">;
type RulePayload = Omit<CreateInboundEvidenceRuleRequest, "idempotencyKey">;

const DEFAULT_LABELS = [
  { systemKey: "NEEDS_REVIEW", nameAr: "يحتاج مراجعتي", nameEn: "Needs review", colorHex: "#D89124", sortOrder: 10 },
  { systemKey: "INVOICES", nameAr: "فواتير ومصروفات", nameEn: "Invoices & expenses", colorHex: "#6B5AD4", sortOrder: 20 },
  { systemKey: "TRANSFERS", nameAr: "تحويلات واردة", nameEn: "Incoming transfers", colorHex: "#0E8C72", sortOrder: 30 },
  { systemKey: "ALERTS", nameAr: "تنبيهات مهمة", nameEn: "Important alerts", colorHex: "#B95050", sortOrder: 40 },
  { systemKey: "COMPLETE", nameAr: "مكتمل", nameEn: "Complete", colorHex: "#64748B", sortOrder: 50 },
] as const;

@Injectable()
export class InboundEvidenceService {
  constructor(private readonly database: DatabaseService) {}

  async workspace(context: TrustedTenantAdministratorContext) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.ensureDefaultLabels(tx, context);
      const [labels, rules, gmail] = await Promise.all([
        tx.inboundEvidenceLabel.findMany({
          where: { tenantId: context.tenantId }, orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
          include: { _count: { select: { rules: true } } },
        }),
        tx.inboundEvidenceRule.findMany({ where: { tenantId: context.tenantId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }),
        tx.inboundEvidenceGmailConnection.findFirst({ where: { tenantId: context.tenantId }, select: { status: true } }),
      ]);
      const status = gmail?.status ?? "NOT_CONNECTED";
      return {
        labels: labels.map((label) => this.publicLabel(label)),
        rules: rules.map((rule) => this.publicRule(rule)),
        connector: {
          status,
          messageAr: status === "CONNECTED" ? "Gmail متصل للقراءة فقط. تُطبّق Labels وقواعد Baseer داخلياً ولا تتغير رسائل Gmail نفسها." : status === "AUTHORIZING" ? "بانتظار إكمال موافقة Gmail في نافذة Google." : status === "REAUTH_REQUIRED" ? "يلزم إعادة تفويض Gmail قبل استمرار المزامنة." : "لم يُربط Gmail بعد. جهّز Labels وقواعد الفرز أولاً؛ لن تُستورد أو تُعدّل أي رسالة قبل اعتماد موصل Gmail المنفصل.",
          messageEn: status === "CONNECTED" ? "Gmail is connected read-only. Baseer Labels and rules apply internally; Gmail messages are not changed." : status === "AUTHORIZING" ? "Complete Gmail consent in the Google window." : status === "REAUTH_REQUIRED" ? "Reconnect Gmail before synchronization can continue." : "Gmail is not connected yet. Prepare Labels and rules first; no message is imported or changed before the separate Gmail connector is approved.",
        },
      };
    });
  }

  async createLabel(context: TrustedTenantAdministratorContext, request: CreateInboundEvidenceLabelRequest): Promise<Receipt> {
    this.ownerOnly(context);
    return this.command(context, "inbound_evidence.label.create", request.idempotencyKey, request, async (tx) => {
      const data = this.labelData(request);
      const existing = await tx.inboundEvidenceLabel.findFirst({ where: { tenantId: context.tenantId, nameKey: data.nameKey } });
      if (existing) throw new ConflictException("A Label with the same name already exists.");
      const label = await tx.inboundEvidenceLabel.create({ data: { id: randomUUID(), tenantId: context.tenantId, createdByUserId: context.actorUserId, ...data } });
      await this.audit(tx, context, "inbound_evidence.label.created", "InboundEvidenceLabel", label.id, null, this.publicLabel({ ...label, _count: { rules: 0 } }));
      return { id: label.id, replayed: false };
    });
  }

  async updateLabel(context: TrustedTenantAdministratorContext, labelId: string, request: UpdateInboundEvidenceLabelRequest): Promise<Receipt> {
    this.ownerOnly(context);
    return this.command(context, "inbound_evidence.label.update", request.idempotencyKey, { labelId, ...request }, async (tx) => {
      const current = await tx.inboundEvidenceLabel.findFirst({ where: { id: labelId, tenantId: context.tenantId }, include: { _count: { select: { rules: true } } } });
      if (!current) throw new NotFoundException("Inbound evidence Label was not found.");
      const data = this.labelData(request);
      const duplicate = await tx.inboundEvidenceLabel.findFirst({ where: { tenantId: context.tenantId, nameKey: data.nameKey, NOT: { id: labelId } }, select: { id: true } });
      if (duplicate) throw new ConflictException("A Label with the same name already exists.");
      const label = await tx.inboundEvidenceLabel.update({ where: { id: labelId }, data });
      await this.audit(tx, context, "inbound_evidence.label.updated", "InboundEvidenceLabel", label.id, this.publicLabel(current), this.publicLabel({ ...label, _count: current._count }));
      return { id: label.id, replayed: false };
    });
  }

  async deleteLabel(context: TrustedTenantAdministratorContext, labelId: string, idempotencyKey: string): Promise<Receipt> {
    this.ownerOnly(context);
    return this.command(context, "inbound_evidence.label.delete", idempotencyKey, { labelId }, async (tx) => {
      const current = await tx.inboundEvidenceLabel.findFirst({ where: { id: labelId, tenantId: context.tenantId }, include: { _count: { select: { rules: true } } } });
      if (!current) throw new NotFoundException("Inbound evidence Label was not found.");
      if (current.systemKey) throw new ForbiddenException("System Labels cannot be deleted.");
      if (current._count.rules > 0) throw new ConflictException("Delete or move this Label's rules before deleting it.");
      await tx.inboundEvidenceLabel.delete({ where: { id: current.id } });
      await this.audit(tx, context, "inbound_evidence.label.deleted", "InboundEvidenceLabel", current.id, this.publicLabel(current), null);
      return { id: current.id, replayed: false };
    });
  }

  async createRule(context: TrustedTenantAdministratorContext, request: CreateInboundEvidenceRuleRequest): Promise<Receipt> {
    this.ownerOnly(context);
    return this.command(context, "inbound_evidence.rule.create", request.idempotencyKey, request, async (tx) => {
      await this.labelFor(tx, context.tenantId, request.labelId);
      const rule = await tx.inboundEvidenceRule.create({ data: { id: randomUUID(), tenantId: context.tenantId, createdByUserId: context.actorUserId, ...this.ruleData(request) } });
      await this.audit(tx, context, "inbound_evidence.rule.created", "InboundEvidenceRule", rule.id, null, this.publicRule(rule));
      return { id: rule.id, replayed: false };
    });
  }

  async updateRule(context: TrustedTenantAdministratorContext, ruleId: string, request: UpdateInboundEvidenceRuleRequest): Promise<Receipt> {
    this.ownerOnly(context);
    return this.command(context, "inbound_evidence.rule.update", request.idempotencyKey, { ruleId, ...request }, async (tx) => {
      const current = await tx.inboundEvidenceRule.findFirst({ where: { id: ruleId, tenantId: context.tenantId } });
      if (!current) throw new NotFoundException("Inbound evidence rule was not found.");
      await this.labelFor(tx, context.tenantId, request.labelId);
      const rule = await tx.inboundEvidenceRule.update({ where: { id: current.id }, data: this.ruleData(request) });
      await this.audit(tx, context, "inbound_evidence.rule.updated", "InboundEvidenceRule", rule.id, this.publicRule(current), this.publicRule(rule));
      return { id: rule.id, replayed: false };
    });
  }

  async deleteRule(context: TrustedTenantAdministratorContext, ruleId: string, idempotencyKey: string): Promise<Receipt> {
    this.ownerOnly(context);
    return this.command(context, "inbound_evidence.rule.delete", idempotencyKey, { ruleId }, async (tx) => {
      const current = await tx.inboundEvidenceRule.findFirst({ where: { id: ruleId, tenantId: context.tenantId } });
      if (!current) throw new NotFoundException("Inbound evidence rule was not found.");
      await tx.inboundEvidenceRule.delete({ where: { id: current.id } });
      await this.audit(tx, context, "inbound_evidence.rule.deleted", "InboundEvidenceRule", current.id, this.publicRule(current), null);
      return { id: current.id, replayed: false };
    });
  }

  private async ensureDefaultLabels(tx: Prisma.TransactionClient, context: TrustedTenantAdministratorContext): Promise<void> {
    for (const label of DEFAULT_LABELS) {
      await tx.inboundEvidenceLabel.upsert({
        where: { tenantId_systemKey: { tenantId: context.tenantId, systemKey: label.systemKey } },
        create: { id: randomUUID(), tenantId: context.tenantId, createdByUserId: context.actorUserId, nameKey: this.nameKey(label.nameAr), ...label },
        update: {},
      });
    }
  }

  private async command(context: TrustedTenantAdministratorContext, operation: string, key: string, request: unknown, action: (tx: Prisma.TransactionClient) => Promise<Receipt>): Promise<Receipt> {
    const requestHash = this.hash(request);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const previous = await tx.inboundEvidenceCommandReceipt.findFirst({ where: { tenantId: context.tenantId, actorUserId: context.actorUserId, operation, idempotencyKey: key } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException("This idempotency key was already used with a different request.");
        const receipt = previous.responseJson as { id?: unknown };
        if (typeof receipt.id !== "string") throw new ConflictException("The prior command receipt is invalid.");
        return { id: receipt.id, replayed: true };
      }
      const receipt = await action(tx);
      await tx.inboundEvidenceCommandReceipt.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, operation, idempotencyKey: key, requestHash, responseJson: { id: receipt.id }, expiresAt: new Date(Date.now() + 86_400_000) } });
      return receipt;
    });
  }

  private async labelFor(tx: Prisma.TransactionClient, tenantId: string, labelId: string) {
    const label = await tx.inboundEvidenceLabel.findFirst({ where: { id: labelId, tenantId }, select: { id: true } });
    if (!label) throw new NotFoundException("Choose a valid Label.");
    return label;
  }

  private labelData(request: LabelPayload) {
    return { nameAr: request.nameAr.trim(), nameEn: this.blank(request.nameEn), nameKey: this.nameKey(request.nameAr), colorHex: request.colorHex.toUpperCase(), sortOrder: request.sortOrder };
  }

  private ruleData(request: RulePayload) {
    return { name: request.name.trim(), enabled: request.enabled, priority: request.priority, labelId: request.labelId, senderContains: this.blank(request.senderContains)?.toLowerCase() ?? null, subjectContains: this.blank(request.subjectContains)?.toLowerCase() ?? null, attachmentCondition: request.attachmentCondition };
  }

  private publicLabel(label: { id: string; nameAr: string; nameEn: string | null; colorHex: string; sortOrder: number; systemKey: string | null; _count: { rules: number } }) {
    return { id: label.id, nameAr: label.nameAr, nameEn: label.nameEn, colorHex: label.colorHex, sortOrder: label.sortOrder, systemKey: label.systemKey, ruleCount: label._count.rules };
  }

  private publicRule(rule: { id: string; name: string; enabled: boolean; priority: number; labelId: string; senderContains: string | null; subjectContains: string | null; attachmentCondition: string }) {
    return { id: rule.id, name: rule.name, enabled: rule.enabled, priority: rule.priority, labelId: rule.labelId, senderContains: rule.senderContains, subjectContains: rule.subjectContains, attachmentCondition: rule.attachmentCondition as "ANY" | "REQUIRED" | "ABSENT" };
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedTenantAdministratorContext, action: string, entityType: string, entityId: string, beforeJson: unknown, afterJson: unknown) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson === null ? Prisma.JsonNull : beforeJson as Prisma.InputJsonValue, afterJson: afterJson === null ? Prisma.JsonNull : afterJson as Prisma.InputJsonValue } });
  }

  private nameKey(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar"); }
  private blank(value: string | undefined) { const next = value?.trim(); return next ? next : null; }
  private hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
  private ownerOnly(context: TrustedTenantAdministratorContext) { if (!context.isOwner) throw new ForbiddenException("Tenant-owner access is required."); }
}

import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type {
  ConfigureWhatsappInvoiceConnectionRequest,
  CreateWhatsappInvoiceGroupBindingRequest,
  DeleteWhatsappInvoiceGroupBindingRequest,
  UpdateWhatsappInvoiceGroupBindingRequest,
} from "@baseer-erp/contracts";
import { Prisma, WhatsappInvoiceConnectionStatus } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { RequestContext } from "../observability/request-context.js";
import { randomUUID } from "node:crypto";

export type WhatsappInvoiceConnectionControlScope = Readonly<{
  tenantId: string;
  connectionId: string;
}>;

type GroupBindingProjection = Readonly<{
  id: string;
  groupJid: string;
  displayName: string;
  active: boolean;
  bindingRevision: number;
}>;

/**
 * Configuration ownership for the personal WhatsApp invoice pilot. This
 * service intentionally does not know Baileys, QR strings, session material,
 * media bytes, or conversation content. Those belong to the in-memory
 * connector and encrypted foundation respectively.
 */
@Injectable()
export class WhatsappInvoiceMonitoringSettingsService {
  constructor(private readonly database: DatabaseService) {}

  async configureConnection(context: TrustedCompanyActorContext, input: ConfigureWhatsappInvoiceConnectionRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.whatsappInvoiceConnection.findFirst({
        where: { tenantId: context.tenantId },
        orderBy: { createdAt: "asc" },
      });
      if (!existing) {
        const connection = await tx.whatsappInvoiceConnection.create({
          data: {
            tenantId: context.tenantId,
            connectionKey: input.connectionKey,
            phoneNumberHint: input.phoneNumberHint ?? null,
            status: WhatsappInvoiceConnectionStatus.DISCONNECTED,
          },
        });
        await this.audit(tx, context, "operations.whatsapp_invoice_monitoring.connection_configured", "WhatsappInvoiceConnection", connection.id, null, this.connectionAuditProjection(connection));
        return this.connectionProjection(connection);
      }

      if (existing.connectionKey !== input.connectionKey) {
        const [bindingCount, messageCount] = await Promise.all([
          tx.whatsappInvoiceGroupBinding.count({ where: { tenantId: context.tenantId, connectionId: existing.id } }),
          tx.whatsappInboundMessage.count({ where: { tenantId: context.tenantId, connectionId: existing.id } }),
        ]);
        if (bindingCount > 0 || messageCount > 0) {
          throw new ConflictException("The personal WhatsApp connection key cannot change after groups or receipts exist.");
        }
      }

      const updated = await tx.whatsappInvoiceConnection.update({
        where: { id_tenantId: { id: existing.id, tenantId: context.tenantId } },
        data: {
          connectionKey: input.connectionKey,
          phoneNumberHint: input.phoneNumberHint === undefined ? existing.phoneNumberHint : input.phoneNumberHint,
          status: existing.status === WhatsappInvoiceConnectionStatus.NOT_CONFIGURED || existing.status === WhatsappInvoiceConnectionStatus.PLANNED
            ? WhatsappInvoiceConnectionStatus.DISCONNECTED
            : existing.status,
        },
      });
      await this.audit(tx, context, "operations.whatsapp_invoice_monitoring.connection_configured", "WhatsappInvoiceConnection", updated.id, this.connectionAuditProjection(existing), this.connectionAuditProjection(updated));
      return this.connectionProjection(updated);
    });
  }

  async createGroupBinding(context: TrustedCompanyActorContext, input: CreateWhatsappInvoiceGroupBindingRequest): Promise<GroupBindingProjection> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const connection = await this.requireConnection(tx, context.tenantId);
      const conflict = await tx.whatsappInvoiceGroupBinding.findFirst({
        where: { tenantId: context.tenantId, connectionId: connection.id, groupJid: input.groupJid },
        select: { id: true },
      });
      if (conflict) throw new ConflictException("This WhatsApp group is already bound to a company.");
      const binding = await tx.whatsappInvoiceGroupBinding.create({
        data: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          connectionId: connection.id,
          groupJid: input.groupJid,
          displayName: input.displayName,
          active: input.active,
          createdByUserId: context.actorUserId,
        },
      });
      const projection = this.bindingProjection(binding);
      await this.audit(tx, context, "operations.whatsapp_invoice_monitoring.group_binding_created", "WhatsappInvoiceGroupBinding", binding.id, null, projection);
      return projection;
    });
  }

  async updateGroupBinding(context: TrustedCompanyActorContext, bindingId: string, input: UpdateWhatsappInvoiceGroupBindingRequest): Promise<GroupBindingProjection> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.whatsappInvoiceGroupBinding.findFirst({
        where: { id: bindingId, tenantId: context.tenantId, companyId: context.companyId },
      });
      if (!existing) throw new NotFoundException("The WhatsApp group binding was not found.");
      if (existing.bindingRevision !== input.expectedBindingRevision) throw new ConflictException("This WhatsApp group binding changed. Refresh it before saving.");
      const changed = await tx.whatsappInvoiceGroupBinding.updateMany({
        where: { id: existing.id, tenantId: context.tenantId, companyId: context.companyId, bindingRevision: input.expectedBindingRevision },
        data: {
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.active === undefined ? {} : { active: input.active }),
          bindingRevision: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictException("This WhatsApp group binding changed. Refresh it before saving.");
      const updated = await tx.whatsappInvoiceGroupBinding.findFirstOrThrow({
        where: { id: existing.id, tenantId: context.tenantId, companyId: context.companyId },
      });
      const projection = this.bindingProjection(updated);
      await this.audit(tx, context, "operations.whatsapp_invoice_monitoring.group_binding_updated", "WhatsappInvoiceGroupBinding", updated.id, this.bindingProjection(existing), projection);
      return projection;
    });
  }

  /** Deletion is a durable deactivation: historical receipts must retain their binding. */
  async deleteGroupBinding(context: TrustedCompanyActorContext, bindingId: string, input: DeleteWhatsappInvoiceGroupBindingRequest): Promise<GroupBindingProjection> {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.whatsappInvoiceGroupBinding.findFirst({
        where: { id: bindingId, tenantId: context.tenantId, companyId: context.companyId },
      });
      if (!existing) throw new NotFoundException("The WhatsApp group binding was not found.");
      if (existing.bindingRevision !== input.expectedBindingRevision) throw new ConflictException("This WhatsApp group binding changed. Refresh it before removing.");
      const changed = await tx.whatsappInvoiceGroupBinding.updateMany({
        where: { id: existing.id, tenantId: context.tenantId, companyId: context.companyId, bindingRevision: input.expectedBindingRevision },
        data: { active: false, bindingRevision: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException("This WhatsApp group binding changed. Refresh it before removing.");
      const updated = await tx.whatsappInvoiceGroupBinding.findFirstOrThrow({
        where: { id: existing.id, tenantId: context.tenantId, companyId: context.companyId },
      });
      const projection = this.bindingProjection(updated);
      await this.audit(tx, context, "operations.whatsapp_invoice_monitoring.group_binding_deactivated", "WhatsappInvoiceGroupBinding", updated.id, this.bindingProjection(existing), projection);
      return projection;
    });
  }

  async connectionControlScope(context: TrustedCompanyActorContext): Promise<WhatsappInvoiceConnectionControlScope> {
    this.assertPilotEnabled();
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const connection = await this.requireConnection(tx, context.tenantId);
      return { tenantId: context.tenantId, connectionId: connection.id };
    });
  }

  async auditConnectionControl(context: TrustedCompanyActorContext, scope: WhatsappInvoiceConnectionControlScope, action: "start_requested" | "stop_requested"): Promise<void> {
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const connection = await tx.whatsappInvoiceConnection.findFirst({ where: { id: scope.connectionId, tenantId: context.tenantId } });
      if (!connection) throw new NotFoundException("The WhatsApp connection was not found.");
      await this.audit(tx, context, `operations.whatsapp_invoice_monitoring.connection_${action}`, "WhatsappInvoiceConnection", connection.id, null, { id: connection.id, status: connection.status });
    });
  }

  private async requireConnection(tx: Prisma.TransactionClient, tenantId: string) {
    const connection = await tx.whatsappInvoiceConnection.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    if (!connection) throw new NotFoundException("Configure the personal WhatsApp connection before managing groups.");
    return connection;
  }

  private assertPilotEnabled(): void {
    if (process.env.BASEER_WAI_BAILEYS_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
      throw new ServiceUnavailableException("The personal WhatsApp pilot is disabled on this server. Configure its server environment before pairing.");
    }
  }

  private connectionProjection(connection: { id: string; status: WhatsappInvoiceConnectionStatus; phoneNumberHint: string | null; lastSyncedAt: Date | null }) {
    return {
      id: connection.id,
      status: this.browserConnectionStatus(connection.status),
      phoneNumberHint: connection.phoneNumberHint,
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    };
  }

  private connectionAuditProjection(connection: { id: string; connectionKey: string; status: WhatsappInvoiceConnectionStatus; phoneNumberHint: string | null }) {
    return { id: connection.id, connectionKey: connection.connectionKey, status: connection.status, phoneNumberHint: connection.phoneNumberHint };
  }

  private browserConnectionStatus(status: WhatsappInvoiceConnectionStatus): "NOT_CONFIGURED" | "DISCONNECTED" | "CONNECTED" | "GAP_DETECTED" | "BLOCKED" {
    if (status === WhatsappInvoiceConnectionStatus.CONNECTED) return "CONNECTED";
    if (status === WhatsappInvoiceConnectionStatus.GAP_DETECTED) return "GAP_DETECTED";
    if (status === WhatsappInvoiceConnectionStatus.BLOCKED || status === WhatsappInvoiceConnectionStatus.REAUTH_REQUIRED) return "BLOCKED";
    if (status === WhatsappInvoiceConnectionStatus.DISCONNECTED) return "DISCONNECTED";
    return "NOT_CONFIGURED";
  }

  private bindingProjection(binding: { id: string; groupJid: string; displayName: string; active: boolean; bindingRevision: number }): GroupBindingProjection {
    return { id: binding.id, groupJid: binding.groupJid, displayName: binding.displayName, active: binding.active, bindingRevision: binding.bindingRevision };
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, beforeJson: Prisma.InputJsonValue | null, afterJson: Prisma.InputJsonValue): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
        actorUserId: context.actorUserId, action, entityType, entityId,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        ...(beforeJson === null ? { beforeJson: Prisma.JsonNull } : { beforeJson }), afterJson,
      },
    });
  }
}

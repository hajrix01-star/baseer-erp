import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { UpdateWhatsappInvoiceMonitoringRecordRequest, WhatsappInvoiceMonitoringQuery } from "@baseer-erp/contracts";
import { FinanceSupplierStatus, Prisma } from "../generated/prisma/client.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { RequestContext } from "../observability/request-context.js";
import { randomUUID } from "node:crypto";

@Injectable()
export class WhatsappInvoiceMonitoringService {
  constructor(private readonly database: DatabaseService) {}

  async workspace(context: TrustedCompanyActorContext, query: WhatsappInvoiceMonitoringQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const pageSize = query.limit ?? query.pageSize;
      const baseWhere = this.recordWhere(context, query);
      const archiveWhere = { ...this.recordWhere(context, query), archiveState: "ARCHIVED" as const };
      await this.assertCursor(tx, baseWhere, query.cursor);
      const [connection, groupBindings, records, allVisible, assets, archived, suppliers] = await Promise.all([
        tx.whatsappInvoiceConnection.findFirst({ where: { tenantId: context.tenantId }, orderBy: { createdAt: "asc" } }),
        tx.whatsappInvoiceGroupBinding.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ active: "desc" }, { displayName: "asc" }] }),
        tx.whatsappInvoiceRecord.findMany({
          where: baseWhere,
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          take: pageSize + 1,
        }),
        tx.whatsappInvoiceRecord.findMany({ where: baseWhere, select: { id: true, duplicateState: true, archiveState: true, qualityState: true, approvalState: true, extractionState: true, grossAmount: true, currencyCode: true } }),
        tx.whatsappInvoiceAsset.findMany({
          where: this.assetWhere(context, query),
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: 100,
          select: {
            id: true,
            originalFileName: true,
            mimeType: true,
            receivedAt: true,
            storageState: true,
            scanStatus: true,
            pages: { include: { assignments: { where: { active: true }, include: { record: { select: { id: true, extractionState: true } } } } } },
          },
        }),
        tx.whatsappInvoiceRecord.findMany({ where: archiveWhere, orderBy: [{ archivedAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, supplierName: true, invoiceNumber: true, archivedAt: true } }),
        tx.financeSupplier.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierStatus.ACTIVE },
          orderBy: [{ isFavorite: "desc" }, { nameAr: "asc" }, { id: "asc" }],
          take: 1_000,
          select: { id: true, nameAr: true, nameEn: true, taxNumber: true },
        }),
      ]);
      const shown = records.slice(0, pageSize);
      const currencies = [...new Set(allVisible.map((row) => row.currencyCode).filter((value): value is string => Boolean(value)))].sort();
      return {
        asOf: new Date().toISOString(),
        connection: this.connection(connection),
        summary: this.summaryProjection(allVisible),
        assets: assets.map((asset) => this.asset(asset)),
        invoices: { rows: shown.map((record) => this.invoiceRow(record)), nextCursor: records.length > pageSize ? shown.at(-1)?.id ?? null : null },
        notes: this.notes(allVisible),
        archive: archived.map((record) => ({ id: record.id, supplierName: record.supplierName, invoiceNumber: record.invoiceNumber, archivedAt: (record.archivedAt ?? new Date(0)).toISOString() })),
        settings: {
          connection: { id: connection?.id ?? null, status: this.connectionStatus(connection?.status), phoneNumberHint: connection?.phoneNumberHint ?? null, lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null },
          groupBindings: groupBindings.map((binding) => ({ id: binding.id, groupJid: binding.groupJid, displayName: binding.displayName, active: binding.active, bindingRevision: binding.bindingRevision })),
        },
        filterOptions: {
          groupBindings: groupBindings.map((binding) => ({ id: binding.id, groupJid: binding.groupJid, displayName: binding.displayName, active: binding.active, bindingRevision: binding.bindingRevision })),
          currencies,
          suppliers: suppliers.map((supplier) => ({ id: supplier.id, nameAr: supplier.nameAr, nameEn: supplier.nameEn, taxNumber: supplier.taxNumber })),
        },
      };
    });
  }

  async summary(context: TrustedCompanyActorContext, query: WhatsappInvoiceMonitoringQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => this.summaryProjection(await tx.whatsappInvoiceRecord.findMany({ where: this.recordWhere(context, query), select: { id: true, duplicateState: true, archiveState: true, qualityState: true, approvalState: true, extractionState: true, grossAmount: true, currencyCode: true } })));
  }

  async records(context: TrustedCompanyActorContext, query: WhatsappInvoiceMonitoringQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const pageSize = query.limit ?? query.pageSize;
      const where = this.recordWhere(context, query);
      await this.assertCursor(tx, where, query.cursor);
      const rows = await tx.whatsappInvoiceRecord.findMany({ where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: pageSize + 1 });
      const shown = rows.slice(0, pageSize);
      return { records: shown.map((record) => this.record(record)), nextCursor: rows.length > pageSize ? shown.at(-1)?.id ?? null : null };
    });
  }

  async detail(context: TrustedCompanyActorContext, recordId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const record = await tx.whatsappInvoiceRecord.findFirst({
        where: { id: recordId, tenantId: context.tenantId, companyId: context.companyId },
        include: {
          pageAssignments: {
            include: {
              assetPage: {
                include: {
                  asset: {
                    select: {
                      id: true,
                      originalFileName: true,
                      mimeType: true,
                      receivedAt: true,
                      storageState: true,
                      scanStatus: true,
                    },
                  },
                },
              },
            },
          },
          revisions: { orderBy: { revision: "desc" }, take: 200 },
          reviews: { orderBy: { createdAt: "desc" }, take: 200 },
        },
      });
      if (!record) throw new NotFoundException("WhatsApp invoice monitoring record was not found.");
      const assets = new Map<string, { id: string; originalFileName: string; mimeType: string; receivedAt: Date; pages: number; extracted: boolean; storageState: "PENDING" | "READY" | "QUARANTINED" | "FAILED"; scanStatus: "NOT_REQUESTED" | "PENDING" | "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED" }>();
      for (const assignment of record.pageAssignments) {
        const asset = assignment.assetPage.asset;
        const existing = assets.get(asset.id) ?? { id: asset.id, originalFileName: asset.originalFileName, mimeType: asset.mimeType, receivedAt: asset.receivedAt, pages: 0, extracted: record.extractionState === "SUCCEEDED", storageState: asset.storageState, scanStatus: asset.scanStatus };
        existing.pages += 1;
        assets.set(asset.id, existing);
      }
      return {
        record: this.record(record),
        assets: [...assets.values()].map((asset) => ({ id: asset.id, displayName: asset.originalFileName, receivedAt: asset.receivedAt.toISOString(), mediaKind: asset.mimeType === "application/pdf" ? "PDF" : "IMAGE", invoiceRecordCount: 1, extractionStatus: asset.extracted ? "SUCCEEDED" : "NOT_REQUESTED", storageState: asset.storageState, scanStatus: asset.scanStatus })),
        revisions: record.revisions.map((revision) => ({ id: revision.id, revision: revision.revision, source: revision.source, createdAt: revision.createdAt.toISOString() })),
        reviews: record.reviews.map((review) => ({ id: review.id, reason: review.reason, createdAt: review.createdAt.toISOString() })),
      };
    });
  }

  async settings(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [connection, groupBindings] = await Promise.all([
        tx.whatsappInvoiceConnection.findFirst({ where: { tenantId: context.tenantId }, orderBy: { createdAt: "asc" } }),
        tx.whatsappInvoiceGroupBinding.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ active: "desc" }, { displayName: "asc" }] }),
      ]);
      return { connection: { id: connection?.id ?? null, status: this.connectionStatus(connection?.status), phoneNumberHint: connection?.phoneNumberHint ?? null, lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null }, groupBindings: groupBindings.map((binding) => ({ id: binding.id, groupJid: binding.groupJid, displayName: binding.displayName, active: binding.active, bindingRevision: binding.bindingRevision })) };
    });
  }

  async updateRecord(context: TrustedCompanyActorContext, recordId: string, request: UpdateWhatsappInvoiceMonitoringRecordRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const current = await tx.whatsappInvoiceRecord.findFirst({ where: { id: recordId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!current) throw new NotFoundException("WhatsApp invoice monitoring record was not found.");
      if (current.rowVersion !== request.expectedRowVersion) throw new ConflictException("This monitoring record changed. Refresh it before applying a correction.");
      if (Object.prototype.hasOwnProperty.call(request, "supplierId") && request.supplierId) {
        const supplier = await tx.financeSupplier.findFirst({ where: { id: request.supplierId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } });
        if (!supplier) throw new NotFoundException("Choose a supplier that belongs to this company.");
      }
      const data = this.patchData(current, request);
      const changed = await tx.whatsappInvoiceRecord.updateMany({ where: { id: current.id, tenantId: context.tenantId, companyId: context.companyId, rowVersion: request.expectedRowVersion }, data: { ...data, rowVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("This monitoring record changed. Refresh it before applying a correction.");
      const updated = await tx.whatsappInvoiceRecord.findFirstOrThrow({ where: { id: current.id, tenantId: context.tenantId, companyId: context.companyId } });
      const last = await tx.whatsappInvoiceExtractionRevision.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, recordId }, orderBy: { revision: "desc" }, select: { revision: true } });
      const before = this.snapshot(current);
      const after = this.snapshot(updated);
      await Promise.all([
        tx.whatsappInvoiceReview.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, recordId, reason: request.reason.trim(), beforeJson: before as Prisma.InputJsonValue, afterJson: after as Prisma.InputJsonValue, createdByUserId: context.actorUserId } }),
        tx.whatsappInvoiceExtractionRevision.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, recordId, revision: (last?.revision ?? 0) + 1, source: "MANUAL_CORRECTION", valuesJson: after as Prisma.InputJsonValue, createdByUserId: context.actorUserId } }),
        tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: "operations.whatsapp_invoice_monitoring.record_reviewed", entityType: "WhatsappInvoiceRecord", entityId: recordId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: before as Prisma.InputJsonValue, afterJson: after as Prisma.InputJsonValue } }),
      ]);
      await this.reassessExactDuplicate(tx, context, updated);
      return this.record((await tx.whatsappInvoiceRecord.findFirstOrThrow({ where: { id: recordId, tenantId: context.tenantId, companyId: context.companyId } })));
    });
  }

  private recordWhere(context: TrustedCompanyActorContext, query: WhatsappInvoiceMonitoringQuery): Prisma.WhatsappInvoiceRecordWhereInput {
    const dateField = query.dateBasis === "INVOICE_DATE" ? "invoiceDate" : "receivedAt";
    const range = query.from || query.to ? { [dateField]: { ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}), ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) } } : {};
    const search = query.search ?? query.supplier;
    return {
      tenantId: context.tenantId, companyId: context.companyId,
      ...(query.tab === "archive" ? { archiveState: "ARCHIVED" } : query.archiveState ? { archiveState: query.archiveState } : { archiveState: "ACTIVE" }),
      ...(query.duplicateState ? { duplicateState: query.duplicateState } : {}),
      ...(query.groupBindingId ? { groupBindingId: query.groupBindingId } : {}),
      ...range,
      ...(search ? { OR: [{ supplierName: { contains: search, mode: "insensitive" } }, { invoiceNumber: { contains: search, mode: "insensitive" } }] } : {}),
    };
  }

  /** Settings are intentionally exempt; every evidence-facing workspace panel
   * receives the same date/group/search filters, including the asset gallery. */
  private assetWhere(context: TrustedCompanyActorContext, query: WhatsappInvoiceMonitoringQuery): Prisma.WhatsappInvoiceAssetWhereInput {
    const search = query.search ?? query.supplier;
    const dateWindow = query.from || query.to ? { ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}), ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) } : null;
    const assetDateRange = query.dateBasis === "RECEIVED_AT" && dateWindow ? { receivedAt: dateWindow } : {};
    const recordFilter: Prisma.WhatsappInvoiceRecordWhereInput = {
      ...(query.duplicateState ? { duplicateState: query.duplicateState } : {}),
      ...(query.archiveState ? { archiveState: query.archiveState } : query.tab === "archive" ? { archiveState: "ARCHIVED" } : { archiveState: "ACTIVE" }),
      ...(search ? { OR: [{ supplierName: { contains: search, mode: "insensitive" } }, { invoiceNumber: { contains: search, mode: "insensitive" } }] } : {}),
      ...(query.dateBasis === "INVOICE_DATE" && dateWindow ? { invoiceDate: dateWindow } : {}),
    };
    const hasRecordFilter = Boolean(query.duplicateState || query.archiveState || query.tab === "archive" || search || (query.dateBasis === "INVOICE_DATE" && dateWindow));
    return {
      tenantId: context.tenantId,
      companyId: context.companyId,
      ...assetDateRange,
      ...(query.groupBindingId ? { inboundMessage: { groupBindingId: query.groupBindingId } } : {}),
      ...(hasRecordFilter ? { pages: { some: { assignments: { some: { active: true, record: recordFilter } } } } } : {}),
    };
  }

  private patchData(current: Prisma.WhatsappInvoiceRecordGetPayload<Record<string, never>>, request: UpdateWhatsappInvoiceMonitoringRecordRequest): Prisma.WhatsappInvoiceRecordUpdateManyMutationInput {
    const has = (key: string) => Object.prototype.hasOwnProperty.call(request, key);
    const supplierName = has("supplierName") ? request.supplierName ?? null : current.supplierName;
    const invoiceNumber = has("invoiceNumber") ? request.invoiceNumber ?? null : current.invoiceNumber;
    const archiveState = has("archiveState") ? request.archiveState! : current.archiveState;
    const values: Prisma.WhatsappInvoiceRecordUpdateManyMutationInput = {
      ...(has("supplierId") ? { supplierId: request.supplierId ?? null } : {}),
      ...(has("supplierName") ? { supplierName, supplierNameKey: this.key(supplierName) } : {}),
      ...(has("supplierTaxNumber") ? { supplierTaxNumber: request.supplierTaxNumber ?? null } : {}),
      ...(has("invoiceNumber") ? { invoiceNumber, invoiceNumberKey: this.key(invoiceNumber) } : {}),
      ...(has("invoiceDate") ? { invoiceDate: request.invoiceDate ? new Date(`${request.invoiceDate}T00:00:00.000Z`) : null } : {}),
      ...(has("currencyCode") ? { currencyCode: request.currencyCode ?? null } : {}),
      ...(has("netAmount") ? { netAmount: request.netAmount ?? null } : {}),
      ...(has("vatAmount") ? { vatAmount: request.vatAmount ?? null } : {}),
      ...(has("grossAmount") ? { grossAmount: request.grossAmount ?? null } : {}),
      ...(has("archiveState") ? { archiveState, archivedAt: archiveState === "ARCHIVED" ? new Date() : null } : {}),
    };
    if (has("approvalState")) values.approvalState = request.approvalState!;
    const changedCore = has("supplierId") || has("supplierName") || has("supplierTaxNumber") || has("invoiceNumber") || has("invoiceDate") || has("currencyCode") || has("netAmount") || has("vatAmount") || has("grossAmount");
    if (changedCore) {
      values.duplicateState = "UNCHECKED";
      values.qualityState = supplierName && invoiceNumber && (has("currencyCode") ? request.currencyCode : current.currencyCode) && (has("grossAmount") ? request.grossAmount : current.grossAmount) ? "VALID" : "INCOMPLETE";
    }
    return values;
  }

  private async reassessExactDuplicate(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, record: Prisma.WhatsappInvoiceRecordGetPayload<Record<string, never>>) {
    if (!record.invoiceNumberKey) return;
    const identity = record.supplierId ? { supplierId: record.supplierId } : record.supplierTaxNumber ? { supplierTaxNumber: record.supplierTaxNumber } : record.supplierNameKey ? { supplierNameKey: record.supplierNameKey } : null;
    const candidate = identity ? await tx.whatsappInvoiceRecord.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, id: { not: record.id }, invoiceNumberKey: record.invoiceNumberKey, ...identity }, orderBy: { receivedAt: "asc" }, select: { id: true } }) : null;
    const nextState = candidate ? "CONFIRMED" : "CLEAR";
    await tx.whatsappInvoiceRecord.update({ where: { id: record.id }, data: { duplicateState: nextState } });
    await tx.whatsappInvoiceDuplicateAssessment.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, recordId: record.id, candidateRecordId: candidate?.id ?? null, state: nextState, evidenceJson: { method: record.supplierId ? "EXACT_SELECTED_SUPPLIER_AND_INVOICE" : record.supplierTaxNumber ? "EXACT_TAX_NUMBER_AND_INVOICE" : record.supplierNameKey ? "EXACT_NORMALIZED_SUPPLIER_AND_INVOICE" : "NO_STRONG_SUPPLIER_IDENTITY", candidateRecordId: candidate?.id ?? null, source: "P1_MONITORING_SCOPE_ONLY" } } });
  }

  private async assertCursor(tx: Prisma.TransactionClient, where: Prisma.WhatsappInvoiceRecordWhereInput, cursor: string | undefined) {
    if (!cursor) return;
    const visible = await tx.whatsappInvoiceRecord.findFirst({ where: { ...where, id: cursor }, select: { id: true } });
    if (!visible) throw new NotFoundException("The requested invoice page cursor is not valid for this company and filter.");
  }

  private summaryProjection(rows: Array<{ duplicateState: string; archiveState: string; qualityState: string; approvalState: string; extractionState: string; grossAmount: Prisma.Decimal | null; currencyCode: string | null }>) {
    // A monitoring card is deliberately stricter than a row: it represents
    // only a sound, active, explicitly-clear/dismissed monitoring record.
    const counted = rows.filter((row) => row.archiveState === "ACTIVE" && row.qualityState === "VALID" && row.approvalState === "APPROVED_MONITORING" && ["CLEAR", "DISMISSED"].includes(row.duplicateState));
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of counted) if (row.currencyCode && row.grossAmount) totals.set(row.currencyCode, (totals.get(row.currencyCode) ?? new Prisma.Decimal(0)).add(row.grossAmount));
    return {
      countedInvoiceCount: String(counted.length),
      duplicateInvoiceCount: String(rows.filter((row) => ["SUSPECTED", "CONFIRMED"].includes(row.duplicateState)).length),
      needsAttentionCount: String(rows.filter((row) => row.qualityState !== "VALID" || row.approvalState !== "APPROVED_MONITORING" || row.extractionState === "FAILED" || ["SUSPECTED", "CONFIRMED", "UNCHECKED"].includes(row.duplicateState)).length),
      grossTotals: [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currencyCode, grossAmount]) => ({ currencyCode, grossAmount: grossAmount.toFixed(2) })),
    };
  }

  private notes(rows: Array<{ id: string; duplicateState: string; qualityState: string; extractionState: string }>) {
    return rows.filter((row) => row.duplicateState === "CONFIRMED" || row.qualityState !== "VALID" || row.extractionState === "FAILED").slice(0, 100).map((row) => {
      if (row.duplicateState === "CONFIRMED") return { id: row.id, severity: "WARNING" as const, titleAr: "فاتورة مكررة", titleEn: "Duplicate invoice", detailAr: "استُقبلت الفاتورة وحُجبت من إجمالي المراقبة حتى المراجعة.", detailEn: "The invoice was received and excluded from monitoring totals pending review." };
      if (row.extractionState === "FAILED") return { id: row.id, severity: "DANGER" as const, titleAr: "تعذر الاستخراج", titleEn: "Extraction failed", detailAr: "لم تكتمل قراءة الفاتورة. لا يُفترض أي مبلغ صفري.", detailEn: "Invoice reading did not complete; no missing amount is treated as zero." };
      return { id: row.id, severity: "WARNING" as const, titleAr: "بيانات غير مكتملة", titleEn: "Incomplete data", detailAr: "تحتاج الفاتورة إلى استكمال أو تصحيح قبل أن تظهر كسجل رقابي سليم.", detailEn: "Complete or correct this invoice before it is considered a sound monitoring record." };
    });
  }

  private asset(asset: { id: string; originalFileName: string; mimeType: string; receivedAt: Date; storageState: "PENDING" | "READY" | "QUARANTINED" | "FAILED"; scanStatus: "NOT_REQUESTED" | "PENDING" | "CLEAN" | "MALICIOUS" | "UNAVAILABLE" | "FAILED"; pages: Array<{ assignments: Array<{ record: { id: string; extractionState: string } }> }> }) {
    const assignments = asset.pages.flatMap((page) => page.assignments);
    const states = assignments.map((assignment) => assignment.record.extractionState);
    const extractionStatus = states.includes("FAILED") ? "FAILED" : states.includes("RUNNING") ? "RUNNING" : states.includes("QUEUED") ? "QUEUED" : states.includes("SUCCEEDED") ? "SUCCEEDED" : "NOT_REQUESTED";
    return { id: asset.id, displayName: asset.originalFileName, receivedAt: asset.receivedAt.toISOString(), mediaKind: asset.mimeType === "application/pdf" ? "PDF" as const : "IMAGE" as const, invoiceRecordCount: new Set(assignments.map((assignment) => assignment.record.id)).size, extractionStatus, storageState: asset.storageState, scanStatus: asset.scanStatus };
  }

  private invoiceRow(record: Prisma.WhatsappInvoiceRecordGetPayload<Record<string, never>>) {
    return { id: record.id, supplierName: record.supplierName, invoiceNumber: record.invoiceNumber, invoiceDate: record.invoiceDate?.toISOString().slice(0, 10) ?? null, currencyCode: record.currencyCode, netAmount: record.netAmount?.toFixed(2) ?? null, vatAmount: record.vatAmount?.toFixed(2) ?? null, grossAmount: record.grossAmount?.toFixed(2) ?? null, approvalStatus: record.approvalState, duplicateStatus: record.duplicateState, extractionStatus: record.extractionState };
  }

  private record(record: Prisma.WhatsappInvoiceRecordGetPayload<Record<string, never>>) {
    return { ...this.invoiceRow(record), groupBindingId: record.groupBindingId, supplierId: record.supplierId, supplierTaxNumber: record.supplierTaxNumber, receivedAt: record.receivedAt.toISOString(), extractionState: record.extractionState, qualityState: record.qualityState, approvalState: record.approvalState, duplicateState: record.duplicateState, archiveState: record.archiveState, purchaseState: record.purchaseState, rowVersion: record.rowVersion, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
  }

  private snapshot(record: Prisma.WhatsappInvoiceRecordGetPayload<Record<string, never>>) {
    return { supplierId: record.supplierId, supplierName: record.supplierName, supplierTaxNumber: record.supplierTaxNumber, invoiceNumber: record.invoiceNumber, invoiceDate: record.invoiceDate?.toISOString().slice(0, 10) ?? null, currencyCode: record.currencyCode, netAmount: record.netAmount?.toFixed(2) ?? null, vatAmount: record.vatAmount?.toFixed(2) ?? null, grossAmount: record.grossAmount?.toFixed(2) ?? null, qualityState: record.qualityState, approvalState: record.approvalState, duplicateState: record.duplicateState, archiveState: record.archiveState, rowVersion: record.rowVersion };
  }

  private connection(connection: { status: string; lastSyncedAt: Date | null } | null) {
    const status = this.connectionStatus(connection?.status);
    const message = status === "NOT_CONFIGURED" ? ["لم يُربط واتساب بعد. هذه واجهة مراقبة داخلية فقط.", "WhatsApp is not connected yet. This is an internal monitoring workspace only."] : status === "GAP_DETECTED" ? ["هناك فجوة مزامنة تحتاج مراجعة قبل الاعتماد على الاكتمال.", "A synchronization gap needs review before relying on completeness."] : status === "BLOCKED" ? ["الربط محظور ويحتاج تدخلاً إدارياً.", "The connection is blocked and needs administrative action."] : ["حالة الربط محفوظة؛ التشغيل الفعلي يتطلب بوابة الموصل المنفصلة.", "Connection state is stored; live operation requires the separate connector gate."];
    return { status, messageAr: message[0], messageEn: message[1], lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null };
  }

  private connectionStatus(status: string | undefined) { return status === "CONNECTED" || status === "GAP_DETECTED" || status === "BLOCKED" ? status : status === "NOT_CONFIGURED" || !status ? "NOT_CONFIGURED" : "DISCONNECTED"; }
  private key(value: string | null) { return value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar") || null; }
}

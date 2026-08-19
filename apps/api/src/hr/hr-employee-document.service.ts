import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { CreateHrEmployeeDocumentRequest, ReplaceHrEmployeeDocumentRequest, RevokeHrEmployeeDocumentRequest } from '@baseer-erp/contracts';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { HrDocumentBlobStatus, HrEmployeeDocumentStatus, Prisma } from '../generated/prisma/client.js';
import { hrReplayReceipt } from './hr-idempotency.util.js';

const MAX_BYTES = 5 * 1024 * 1024;
const STORAGE_NAMESPACE = 'employee-documents';
type DocumentQuery = Readonly<{ cursor?: string; pageSize: number; documentType?: string; status?: HrEmployeeDocumentStatus; expiry?: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NONE' }>;
type Upload = Readonly<{ fileName: string; contentBase64: string }>;

@Injectable()
export class HrEmployeeDocumentService {
  private readonly root = resolve(process.env.BASEER_EMPLOYEE_DOCUMENT_STORAGE_ROOT ?? 'storage/employee-documents');
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async list(context: TrustedCompanyActorContext, employeeId: string, query: DocumentQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.requireEmployee(tx, context, employeeId);
      const today = day(new Date()); const soon = new Date(today); soon.setUTCDate(soon.getUTCDate() + 30);
      const documentScope: Prisma.HrEmployeeDocumentWhereInput = {
        tenantId: context.tenantId, companyId: context.companyId, employeeId,
        ...(query.documentType ? { documentType: query.documentType as never } : {}), ...(query.status ? { status: query.status } : {}),
        ...(query.expiry === 'NONE' ? { expiryDate: null } : query.expiry === 'EXPIRED' ? { expiryDate: { lt: today } } : query.expiry === 'EXPIRING' ? { expiryDate: { gte: today, lte: soon } } : query.expiry === 'VALID' ? { expiryDate: { gt: soon } } : {}),
      };
      const cursor = query.cursor ? await tx.hrEmployeeDocument.findFirst({ where: { id: query.cursor, ...documentScope }, select: { id: true, createdAt: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The document cursor is invalid.');
      const where: Prisma.HrEmployeeDocumentWhereInput = { ...documentScope, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) };
      const rows = await tx.hrEmployeeDocument.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.pageSize + 1, include: { currentVersion: { include: { blob: true } } } });
      const hasMore = rows.length > query.pageSize; const documents = (hasMore ? rows.slice(0, query.pageSize) : rows).map((row) => mapDocument(row, today));
      return { documents, hasMore, nextCursor: hasMore ? documents.at(-1)?.id ?? null : null };
    });
  }

  async create(context: TrustedCompanyActorContext, employeeId: string, raw: CreateHrEmployeeDocumentRequest) {
    const { upload, idempotencyKey, ...input } = raw; const prepared = upload ? this.prepare(upload) : null;
    const ids = { documentId: randomUUID(), blobId: randomUUID(), versionId: randomUUID(), metadataId: randomUUID() };
    const storageReference = `${STORAGE_NAMESPACE}/${context.tenantId}/${context.companyId}/${ids.blobId}.bin`;
    const encrypted = prepared ? this.encrypt(prepared.bytes) : null;
    let stored: string | null = null;
    try {
      const result = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
        const begun = await this.begin(tx, context, 'hr.employee_document.create', idempotencyKey, { employeeId, ...input, fileName: prepared?.fileName ?? null, mimeType: prepared?.mimeType ?? null, sha256: prepared?.sha256 ?? null });
        if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; versionId: string; replayed: boolean }>(begun.response.body);
        if (begun.kind === 'in-progress') throw new ConflictException('The document request is already being processed.');
        await this.requireEmployee(tx, context, employeeId); await this.requireService(tx, context, employeeId, input.linkedServiceId);
        const scan = prepared ? await this.scan(prepared.bytes) : null;
        if (prepared && scan) {
          stored = await this.writeStorage(storageReference, encrypted!.bytes);
          await tx.fileMetadata.create({ data: { id: ids.metadataId, tenantId: context.tenantId, companyId: context.companyId, sourceType: 'hr.employee_document_blob', sourceId: ids.blobId, purpose: 'attachment', version: 1, displayName: prepared.fileName, declaredMimeType: prepared.mimeType, declaredByteSize: BigInt(prepared.bytes.length), declaredSha256: prepared.sha256, storageReference, createdByUserId: context.actorUserId } });
          await tx.hrEmployeeDocumentBlob.create({ data: { id: ids.blobId, tenantId: context.tenantId, companyId: context.companyId, fileMetadataId: ids.metadataId, status: scan.status, storageReference, encryptionIv: encrypted!.iv, mimeType: prepared.mimeType, byteSize: BigInt(prepared.bytes.length), sha256: prepared.sha256, scannerName: scan.name, scannerResult: scan.result, scannedAt: scan.scannedAt, createdByUserId: context.actorUserId } });
        }
        await tx.hrEmployeeDocument.create({ data: { id: ids.documentId, tenantId: context.tenantId, companyId: context.companyId, employeeId, documentType: input.documentType, title: input.title, referenceNumber: empty(input.referenceNumber), issueDate: input.issueDate ?? null, expiryDate: input.expiryDate ?? null, notes: empty(input.notes), linkedServiceId: input.linkedServiceId ?? null, retentionUntil: input.retentionUntil ?? null, legalHold: input.legalHold ?? false, createdByUserId: context.actorUserId } });
        if (prepared) { await tx.hrEmployeeDocumentVersion.create({ data: { id: ids.versionId, tenantId: context.tenantId, companyId: context.companyId, documentId: ids.documentId, blobId: ids.blobId, version: 1, createdByUserId: context.actorUserId } }); await tx.hrEmployeeDocument.update({ where: { id: ids.documentId }, data: { currentVersionId: ids.versionId } }); }
        const receipt = { id: ids.documentId, versionId: prepared ? ids.versionId : ids.documentId, replayed: false };
        await this.audit(tx, context, 'hr.employee_document.created', 'HrEmployeeDocument', ids.documentId, null, { employeeId, documentType: input.documentType, blobStatus: scan?.status ?? null });
        await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } }); return receipt;
      });
      return result;
    } catch (error) { if (stored) await unlink(stored).catch(() => undefined); throw error; }
  }

  async replace(context: TrustedCompanyActorContext, documentId: string, raw: ReplaceHrEmployeeDocumentRequest) {
    const prepared = this.prepare(raw.upload); const encrypted = this.encrypt(prepared.bytes); const blobId = randomUUID(), versionId = randomUUID(), metadataId = randomUUID(); const storageReference = `${STORAGE_NAMESPACE}/${context.tenantId}/${context.companyId}/${blobId}.bin`; let stored: string | null = null;
    try { const result = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, 'hr.employee_document.replace', raw.idempotencyKey, { documentId, fileName: prepared.fileName, mimeType: prepared.mimeType, sha256: prepared.sha256 });
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; versionId: string; replayed: boolean }>(begun.response.body); if (begun.kind === 'in-progress') throw new ConflictException('The document request is already being processed.');
      const document = await tx.hrEmployeeDocument.findFirst({ where: { id: documentId, tenantId: context.tenantId, companyId: context.companyId } }); if (!document || document.status !== HrEmployeeDocumentStatus.ACTIVE) throw new NotFoundException('The active employee document is not available.');
      const latest = await tx.hrEmployeeDocumentVersion.aggregate({ where: { documentId, tenantId: context.tenantId, companyId: context.companyId }, _max: { version: true } }); const scan = await this.scan(prepared.bytes);
      stored = await this.writeStorage(storageReference, encrypted.bytes);
      await tx.fileMetadata.create({ data: { id: metadataId, tenantId: context.tenantId, companyId: context.companyId, sourceType: 'hr.employee_document_blob', sourceId: blobId, purpose: 'attachment', version: (latest._max.version ?? 0) + 1, displayName: prepared.fileName, declaredMimeType: prepared.mimeType, declaredByteSize: BigInt(prepared.bytes.length), declaredSha256: prepared.sha256, storageReference, createdByUserId: context.actorUserId } });
      await tx.hrEmployeeDocumentBlob.create({ data: { id: blobId, tenantId: context.tenantId, companyId: context.companyId, fileMetadataId: metadataId, status: scan.status, storageReference, encryptionIv: encrypted.iv, mimeType: prepared.mimeType, byteSize: BigInt(prepared.bytes.length), sha256: prepared.sha256, scannerName: scan.name, scannerResult: scan.result, scannedAt: scan.scannedAt, createdByUserId: context.actorUserId } });
      await tx.hrEmployeeDocumentVersion.create({ data: { id: versionId, tenantId: context.tenantId, companyId: context.companyId, documentId, blobId, version: (latest._max.version ?? 0) + 1, createdByUserId: context.actorUserId } });
      await tx.hrEmployeeDocument.update({ where: { id: documentId }, data: { currentVersionId: versionId } }); const receipt = { id: documentId, versionId, replayed: false };
      await this.audit(tx, context, 'hr.employee_document.replaced', 'HrEmployeeDocument', documentId, { currentVersionId: document.currentVersionId }, { currentVersionId: versionId, blobStatus: scan.status }); await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } }); return receipt;
    }); return result; } catch (error) { if (stored) await unlink(stored).catch(() => undefined); throw error; }
  }

  async revoke(context: TrustedCompanyActorContext, documentId: string, raw: RevokeHrEmployeeDocumentRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, 'hr.employee_document.revoke', raw.idempotencyKey, { documentId, reason: raw.reason }); if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; versionId: string; replayed: boolean }>(begun.response.body); if (begun.kind === 'in-progress') throw new ConflictException('The document request is already being processed.');
      const document = await tx.hrEmployeeDocument.findFirst({ where: { id: documentId, tenantId: context.tenantId, companyId: context.companyId }, include: { currentVersion: true } }); if (!document || document.status !== HrEmployeeDocumentStatus.ACTIVE) throw new NotFoundException('The active employee document is not available.');
      await tx.hrEmployeeDocument.update({ where: { id: documentId }, data: { status: HrEmployeeDocumentStatus.REVOKED, revokedAt: new Date(), revokedReason: raw.reason.trim() } }); if (document.currentVersion) await tx.hrEmployeeDocumentBlob.update({ where: { id: document.currentVersion.blobId }, data: { status: HrDocumentBlobStatus.REVOKED, revokedAt: new Date() } });
      const receipt = { id: documentId, versionId: document.currentVersionId ?? documentId, replayed: false }; await this.audit(tx, context, 'hr.employee_document.revoked', 'HrEmployeeDocument', documentId, { status: document.status }, { status: 'REVOKED', reason: raw.reason.trim() }); await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } }); return receipt;
    });
  }

  async download(context: TrustedCompanyActorContext, versionId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const version = await tx.hrEmployeeDocumentVersion.findFirst({ where: { id: versionId, tenantId: context.tenantId, companyId: context.companyId, document: { status: HrEmployeeDocumentStatus.ACTIVE } }, include: { blob: true } }); if (!version || version.blob.status !== HrDocumentBlobStatus.READY) throw new NotFoundException('A downloadable employee document is not available.');
      const bytes = this.decrypt(await readFile(this.storagePath(version.blob.storageReference)), version.blob.encryptionIv); await this.audit(tx, context, 'hr.employee_document.downloaded', 'HrEmployeeDocumentVersion', versionId, null, { blobId: version.blobId }); return { bytes, mimeType: version.blob.mimeType };
    });
  }

  private prepare(upload: Upload) { const bytes = Buffer.from(upload.contentBase64, 'base64'); if (!bytes.length || bytes.length > MAX_BYTES) throw new BadRequestException('Employee document files must be 5 MiB or smaller.'); const mimeType = magicMime(bytes); if (!mimeType) throw new BadRequestException('Only PDF, JPEG, and PNG employee documents are allowed.'); return { bytes, mimeType, sha256: createHash('sha256').update(bytes).digest('hex'), fileName: upload.fileName.trim() }; }
  private encryptionKey() { const raw = process.env.BASEER_EMPLOYEE_DOCUMENT_ENCRYPTION_KEY; if (!raw) throw new ServiceUnavailableException('Employee-document encryption is not configured.'); const key = Buffer.from(raw, 'base64'); if (key.length !== 32 || key.toString('base64') !== raw) throw new ServiceUnavailableException('Employee-document encryption configuration is invalid.'); return key; }
  private encrypt(plaintext: Buffer) { const iv = randomBytes(16); const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv); const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]); return { bytes: ciphertext, iv: iv.toString('base64') }; }
  private decrypt(ciphertextAndTag: Buffer, ivValue: string) { const iv = Buffer.from(ivValue, 'base64'); if (iv.length !== 16) throw new ServiceUnavailableException('Employee-document encryption metadata is invalid.'); if (ciphertextAndTag.length < 17) throw new NotFoundException('The encrypted employee document is invalid.'); const key = this.encryptionKey(); const tag = ciphertextAndTag.subarray(-16); const ciphertext = ciphertextAndTag.subarray(0, -16); try { const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(ciphertext), decipher.final()]); } catch { throw new NotFoundException('The encrypted employee document cannot be read.'); } }
  private async scan(bytes: Buffer) {
    if (process.env.NODE_ENV !== 'production' && process.env.BASEER_DOCUMENT_DEV_SCANNER === 'deterministic-content-validator') return { status: HrDocumentBlobStatus.READY, name: 'deterministic-development-content-validator', result: 'FORMAT_VALIDATED_NOT_ANTIVIRUS', scannedAt: new Date() };
    const endpoint = process.env.BASEER_DOCUMENT_SCANNER_ENDPOINT;
    if (!endpoint) return { status: HrDocumentBlobStatus.QUARANTINED, name: 'scanner-unavailable', result: 'NO_ANTIVIRUS_SCANNER_CONFIGURED', scannedAt: new Date() };
    try { const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(10_000) }); const result = await response.json() as { status?: string; scannerName?: string; result?: string }; if (!response.ok || (result.status !== 'READY' && result.status !== 'QUARANTINED')) throw new Error('invalid scanner response'); return { status: result.status === 'READY' ? HrDocumentBlobStatus.READY : HrDocumentBlobStatus.QUARANTINED, name: (result.scannerName?.slice(0, 80) || 'configured-external-scanner'), result: (result.result?.slice(0, 160) || result.status), scannedAt: new Date() }; } catch { return { status: HrDocumentBlobStatus.QUARANTINED, name: 'configured-scanner-unavailable', result: 'SCANNER_UNAVAILABLE_OR_INVALID_RESPONSE', scannedAt: new Date() }; }
  }
  private async writeStorage(reference: string, bytes: Buffer) { const path = this.storagePath(reference); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes, { flag: 'wx' }); return path; }
  private storagePath(reference: string) { if (!new RegExp(`^${STORAGE_NAMESPACE}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.bin$`).test(reference)) throw new BadRequestException('Unsafe document storage reference.'); const path = resolve(this.root, ...reference.split('/')); if (!path.startsWith(`${this.root}${sep}`)) throw new BadRequestException('Unsafe document storage path.'); return path; }
  private async requireEmployee(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string) { const found = await tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } }); if (!found) throw new NotFoundException('The employee is not available for this company.'); }
  private async requireService(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, serviceId: string | undefined) { if (!serviceId) return; const found = await tx.hrEmployeeService.findFirst({ where: { id: serviceId, employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } }); if (!found) throw new BadRequestException('The linked employee service is not available.'); }
  private async begin(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, operation: string, key: string, request: Record<string, unknown>) { try { return await this.idempotency.beginInTransaction(tx, context, { operation, key, request: request as never, expiresAt: new Date(Date.now() + 86_400_000) }); } catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with a different employee-document request.'); throw error; } }
  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, before: unknown, after: unknown) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: `${action}:${entityId}`, beforeJson: before === null ? Prisma.JsonNull : before as Prisma.InputJsonValue, afterJson: after as Prisma.InputJsonValue } }); }
}

function magicMime(bytes: Buffer) { if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'; if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'; if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'; return null; }
function day(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); }
function empty(value: string | undefined) { const trimmed = value?.trim(); return trimmed ? trimmed : null; }
function mapDocument(row: any, today: Date) { const expiry = row.expiryDate ? day(row.expiryDate) : null; const soon = new Date(today); soon.setUTCDate(soon.getUTCDate() + 30); return { id: row.id, employeeId: row.employeeId, documentType: row.documentType, status: row.status, title: row.title, referenceNumber: row.referenceNumber, issueDate: row.issueDate?.toISOString().slice(0, 10) ?? null, expiryDate: expiry?.toISOString().slice(0, 10) ?? null, notes: row.notes, linkedServiceId: row.linkedServiceId, retentionUntil: row.retentionUntil?.toISOString().slice(0, 10) ?? null, legalHold: row.legalHold, complianceStatus: !expiry ? 'NOT_APPLICABLE' : expiry < today ? 'EXPIRED' : expiry <= soon ? 'EXPIRING' : 'VALID', currentVersion: row.currentVersion ? { id: row.currentVersion.id, version: row.currentVersion.version, blobStatus: row.currentVersion.blob.status, mimeType: row.currentVersion.blob.mimeType, byteSize: row.currentVersion.blob.byteSize.toString(), sha256: row.currentVersion.blob.sha256, createdAt: row.currentVersion.createdAt.toISOString() } : null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, revokedReason: row.revokedReason }; }

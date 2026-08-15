import { randomUUID } from 'node:crypto';

import {
  fileMetadataReceiptSchema,
  type CreateFileMetadataRequest,
  type FileMetadataReceipt,
} from '@baseer-erp/contracts';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyService,
} from '../core-controls/idempotency.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RequestContext } from '../observability/request-context.js';
import {
  FileMetadataStatus,
  Prisma,
  type FileMetadata,
} from '../generated/prisma/client.js';

const CREATE_OPERATION = 'platform.file-metadata.create';
const ADVISORY_LOCK_SEED = 0;

@Injectable()
export class FileMetadataService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(input: {
    accessToken: string;
    companyId: string;
    request: CreateFileMetadataRequest;
  }): Promise<FileMetadataReceipt> {
    const context = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: ['platform.files.write'],
    });
    const trusted: TrustedCompanyActorContext = {
      tenantId: context.principal.tenantId,
      companyId: context.company.id,
      actorUserId: context.principal.userId,
    };

    return this.database.inTenantTransaction(trusted.tenantId, async (transaction) => {
      let begun;
      try {
        begun = await this.idempotency.beginInTransaction(transaction, trusted, {
          operation: CREATE_OPERATION,
          key: input.request.idempotencyKey,
          request: {
            sourceType: input.request.sourceType,
            sourceId: input.request.sourceId,
            purpose: input.request.purpose,
            displayName: input.request.displayName,
            declaredMimeType: input.request.declaredMimeType,
            declaredByteSize: input.request.declaredByteSize,
            declaredSha256: input.request.declaredSha256,
            replacesFileMetadataId: input.request.replacesFileMetadataId ?? null,
          },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        });
      } catch (error) {
        if (error instanceof IdempotencyPayloadMismatchError) {
          throw new ConflictException('The idempotency key was used with a different file metadata request.');
        }
        throw error;
      }

      if (begun.kind === 'in-progress') {
        throw new ConflictException('A file metadata request with this idempotency key is still in progress.');
      }
      if (begun.kind === 'replay') {
        const replay = fileMetadataReceiptSchema.safeParse({ ...(begun.response.body as object), replayed: true });
        if (!replay.success) throw new ConflictException('The stored file metadata receipt is invalid.');
        await this.writeAudit(transaction, trusted, 'file_metadata.replayed', replay.data);
        return replay.data;
      }

      await this.lockSource(transaction, trusted, input.request);
      const created = await this.createReservedReference(transaction, trusted, input.request);
      const receipt = this.toReceipt(created, false);
      await this.writeAudit(transaction, trusted, 'file_metadata.created', receipt);
      await this.idempotency.completeInTransaction(transaction, trusted, {
        receiptId: begun.receiptId,
        response: { status: 201, headers: null, body: receipt },
      });
      return receipt;
    });
  }

  async findOne(input: {
    accessToken: string;
    companyId: string;
    id: string;
  }): Promise<FileMetadataReceipt> {
    const context = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: ['platform.files.read'],
    });
    const trusted: TrustedCompanyActorContext = {
      tenantId: context.principal.tenantId,
      companyId: context.company.id,
      actorUserId: context.principal.userId,
    };
    return this.database.inTenantTransaction(trusted.tenantId, async (transaction) => {
      const file = await transaction.fileMetadata.findFirst({
        where: { id: input.id, tenantId: trusted.tenantId, companyId: trusted.companyId },
      });
      if (!file) throw new NotFoundException('File metadata was not found.');
      return this.toReceipt(file, false);
    });
  }

  private async lockSource(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: CreateFileMetadataRequest,
  ): Promise<void> {
    const key = `${context.tenantId}:${context.companyId}:${request.sourceType}:${request.sourceId}:${request.purpose}`;
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${ADVISORY_LOCK_SEED}))
    `;
  }

  private async createReservedReference(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: CreateFileMetadataRequest,
  ): Promise<FileMetadata> {
    let version = 1;
    if (request.replacesFileMetadataId) {
      const replaced = await transaction.fileMetadata.findFirst({
        where: {
          id: request.replacesFileMetadataId,
          tenantId: context.tenantId,
          companyId: context.companyId,
        },
      });
      if (!replaced) throw new NotFoundException('The file metadata version to replace was not found.');
      if (
        replaced.status !== FileMetadataStatus.RESERVED ||
        replaced.sourceType !== request.sourceType ||
        replaced.sourceId !== request.sourceId ||
        replaced.purpose !== request.purpose
      ) {
        throw new ConflictException('The file metadata version cannot be superseded by this request.');
      }
      version = replaced.version + 1;
      await transaction.fileMetadata.update({
        where: { id: replaced.id },
        data: { status: FileMetadataStatus.SUPERSEDED, supersededAt: new Date() },
      });
      await this.writeAudit(transaction, context, 'file_metadata.superseded', {
        id: replaced.id,
        sourceType: replaced.sourceType,
        sourceId: replaced.sourceId,
        purpose: replaced.purpose,
        version: replaced.version,
      });
    } else {
      const current = await transaction.fileMetadata.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          sourceType: request.sourceType,
          sourceId: request.sourceId,
          purpose: request.purpose,
          status: FileMetadataStatus.RESERVED,
        },
        select: { id: true },
      });
      if (current) {
        throw new ConflictException('An active file metadata reference already exists for this source and purpose.');
      }
    }

    return transaction.fileMetadata.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        purpose: request.purpose,
        version,
        status: FileMetadataStatus.RESERVED,
        displayName: request.displayName,
        declaredMimeType: request.declaredMimeType.toLowerCase(),
        declaredByteSize: BigInt(request.declaredByteSize),
        declaredSha256: request.declaredSha256,
        storageReference: `reserved/${randomUUID()}`,
        replacesFileMetadataId: request.replacesFileMetadataId ?? null,
        createdByUserId: context.actorUserId,
      },
    });
  }

  private toReceipt(file: FileMetadata, replayed: boolean): FileMetadataReceipt {
    return fileMetadataReceiptSchema.parse({
      id: file.id,
      sourceType: file.sourceType,
      sourceId: file.sourceId,
      purpose: file.purpose,
      version: file.version,
      status: file.status,
      displayName: file.displayName,
      declaredMimeType: file.declaredMimeType,
      declaredByteSize: Number(file.declaredByteSize),
      declaredSha256: file.declaredSha256,
      replacesFileMetadataId: file.replacesFileMetadataId,
      createdByUserId: file.createdByUserId,
      createdAt: file.createdAt.toISOString(),
      replayed,
    });
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    action: string,
    afterJson: Record<string, unknown>,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action,
        entityType: 'FileMetadata',
        entityId: typeof afterJson['id'] === 'string' ? afterJson['id'] : randomUUID(),
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson: afterJson as Prisma.InputJsonValue,
      },
    });
  }
}

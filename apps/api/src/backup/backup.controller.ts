import { BadRequestException, Body, ConflictException, Controller, Get, GoneException, Headers, HttpCode, NotFoundException, Param, Post, Query, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { backupAuditListReceiptSchema, backupJobListReceiptSchema, backupJobQuerySchema, backupJobReceiptSchema, backupPolicyListReceiptSchema, backupPolicyReceiptSchema, companyArchiveMetadataReceiptSchema, companyIdSchema, createCompanyArchiveBackupRequestSchema, restoreAsNewDiscoveryReceiptSchema, upsertBackupPolicyRequestSchema } from '@baseer-erp/contracts';
import { CompanyContextService } from '../company-context/company-context.service.js';
import { BackupService, type BackupCompanyContext } from './backup.service.js';
import { BackupDownloadError, BackupDownloadService } from './backup-download.service.js';
import { RestoreAsNewError, RestoreAsNewService } from './restore-as-new.service.js';
import { BackupPolicyService } from './backup-policy.service.js';

@Controller('backups')
export class BackupController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly backups: BackupService,
    private readonly downloads: BackupDownloadService,
    private readonly restores: RestoreAsNewService,
    private readonly policies: BackupPolicyService,
  ) {}

  @Get('jobs')
  async listJobs(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = backupJobQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid backup job query.');
    const context = await this.authorize(authorization, companyId, 'backup.read');
    return backupJobListReceiptSchema.parse({ companyId: context.companyId, jobs: await this.backups.listJobs(context, parsed.data.limit) });
  }

  @Get('jobs/:jobId')
  async readJob(@Param('jobId') jobId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsedJobId = companyIdSchema.safeParse(jobId);
    if (!parsedJobId.success) throw new BadRequestException('Invalid backup job identifier.');
    return backupJobReceiptSchema.parse(await this.backups.readJob(await this.authorize(authorization, companyId, 'backup.read'), parsedJobId.data));
  }

  @Get('jobs/:jobId/archive-metadata')
  async readCompanyArchiveMetadata(@Param('jobId') jobId: string, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsedJobId = companyIdSchema.safeParse(jobId);
    if (!parsedJobId.success) throw new BadRequestException('Invalid backup job identifier.');
    const metadata = await this.downloads.getCompanyArchiveDownloadMetadata(await this.authorize(authorization, companyId, 'backup.download'), parsedJobId.data);
    return companyArchiveMetadataReceiptSchema.parse({
      archiveCoverage: metadata.archiveCoverage,
      restoreEligible: metadata.restoreEligible,
      artifact: metadata.artifact && {
        ...metadata.artifact,
        byteSize: metadata.artifact.byteSize.toString(),
        verifiedAt: metadata.artifact.verifiedAt.toISOString(),
        expiresAt: metadata.artifact.expiresAt?.toISOString() ?? null,
      },
    });
  }

  @Get('jobs/:jobId/download')
  async downloadJob(
    @Param('jobId') jobId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-baseer-company-id') companyId: string | undefined,
    @Headers('x-baseer-archive-coverage-ack') coverageAcknowledgement: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const parsedJobId = companyIdSchema.safeParse(jobId);
    if (!parsedJobId.success) throw new BadRequestException('Invalid backup job identifier.');
    const context = await this.authorize(authorization, companyId, 'backup.download');
    if (coverageAcknowledgement !== 'PARTIAL_CONFIGURATION_ONLY') {
      throw new ConflictException('Download requires explicit acknowledgement that this archive contains partial configuration only and cannot be restored.');
    }
    if (range) return reply.code(416).header('accept-ranges', 'none').send();
    let archive;
    try {
      archive = await this.downloads.resolveVerifiedEncryptedDownload(context, parsedJobId.data);
    } catch (error) {
      this.throwDownloadError(error);
    }
    try {
      await this.backups.recordCompanyArchiveDownloadAuthorized(context, archive);
      const stream = archive.openReadStream();
      let bytesRead = 0n;
      let terminal = false;
      const recordOutcome = (outcome: 'source_completed' | 'source_aborted' | 'source_failed') => {
        if (terminal) return;
        terminal = true;
        void this.backups.recordCompanyArchiveDownloadOutcome(context, archive, outcome, bytesRead).catch(() => undefined);
      };
      stream.on('data', (chunk: Buffer | string) => { bytesRead += BigInt(Buffer.byteLength(chunk)); });
      stream.once('end', () => { recordOutcome('source_completed'); });
      stream.once('error', () => { recordOutcome('source_failed'); void archive.dispose(); });
      stream.once('close', () => { recordOutcome(bytesRead === archive.byteSize ? 'source_completed' : 'source_aborted'); void archive.dispose(); });
      return reply
        .header('content-type', archive.contentType)
        .header('content-disposition', `attachment; filename="${archive.filename}"`)
        .header('content-length', archive.byteSize.toString())
        .header('x-archive-sha256', archive.sha256)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store, max-age=0')
        .header('pragma', 'no-cache')
        .header('referrer-policy', 'no-referrer')
        .header('content-security-policy', 'sandbox')
        .header('accept-ranges', 'none')
        .send(stream);
    } catch (error) {
      await archive.dispose().catch(() => undefined);
      throw error;
    }
  }

  @Get('audit-events')
  async listAuditEvents(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = backupJobQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid backup audit query.');
    const context = await this.authorize(authorization, companyId, 'backup.audit.view');
    return backupAuditListReceiptSchema.parse({ companyId: context.companyId, events: await this.backups.listAuditEvents(context, parsed.data.limit) });
  }

  @Get('policies')
  async listPolicies(@Query() query: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const parsed = backupJobQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid backup policy query.');
    const context = await this.authorize(authorization, companyId, 'backup.schedule.manage');
    return backupPolicyListReceiptSchema.parse({ companyId: context.companyId, policies: await this.policies.list(context, parsed.data.limit) });
  }

  @Post('policies')
  async upsertPolicy(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = upsertBackupPolicyRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid backup policy request.');
    return backupPolicyReceiptSchema.parse(await this.policies.upsert(await this.authorize(authorization, companyId, 'backup.schedule.manage'), request.data));
  }

  @Post('jobs/company-archive')
  @HttpCode(201)
  async createCompanyArchive(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const request = createCompanyArchiveBackupRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Invalid company archive backup request.');
    return backupJobReceiptSchema.parse(await this.backups.createCompanyArchiveJob(await this.authorize(authorization, companyId, 'backup.create'), request.data));
  }

  /**
   * Discovery is intentionally the only restore entry point in this gate.
   * Present partial archives return a safe conflict before any upload,
   * decryption, target-company creation, or importer invocation.
   */
  @Post('restores/as-new/discover')
  async discoverRestoreAsNew(@Body() body: unknown, @Headers('authorization') authorization?: string, @Headers('x-baseer-company-id') companyId?: string) {
    const context = await this.authorize(authorization, companyId, 'backup.restore.request');
    try {
      return restoreAsNewDiscoveryReceiptSchema.parse(await this.restores.requestRestoreAsNew(context, body));
    } catch (error) {
      if (error instanceof RestoreAsNewError) throw new ConflictException(error.message);
      if (error instanceof BackupDownloadError && error.code === 'DOWNLOAD_JOB_NOT_FOUND') throw new NotFoundException('The requested backup archive was not found.');
      throw error;
    }
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string): Promise<BackupCompanyContext> {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success) throw new BadRequestException('Invalid backup company context.');
    const authorized = await this.companyContext.authorize({ accessToken, companyId: parsedCompanyId.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }

  private throwDownloadError(error: unknown): never {
    if (!(error instanceof BackupDownloadError)) throw error;
    if (error.code === 'DOWNLOAD_JOB_NOT_FOUND' || error.code === 'DOWNLOAD_ARTIFACT_NOT_FOUND') throw new NotFoundException('The requested backup archive was not found.');
    if (error.code === 'DOWNLOAD_JOB_NOT_PUBLISHED' || error.code === 'DOWNLOAD_ARTIFACT_NOT_VERIFIED') throw new ConflictException('The requested backup archive is not ready for download.');
    if (error.code === 'DOWNLOAD_ARTIFACT_EXPIRED') throw new GoneException('The requested backup archive has expired.');
    throw new ServiceUnavailableException('The requested backup archive cannot be safely served.');
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { AcknowledgeNurixMigrationExceptionRequest, ApproveNurixCompanyMapsRequest, ApproveNurixDirectCandidatesRequest, CreateCommercialNurixMigrationCounterpartyRequest, CreateNurixProvisionalSuppliersRequest, ResolveNurixMigrationCounterpartyRequest } from '@baseer-erp/contracts';
import { LegacyMigrationCounterpartyCandidateKind, LegacyMigrationCounterpartyResolutionKind, LegacyMigrationReviewActionKind, LegacyMigrationRunStatus, Prisma } from '../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { RequestContext } from '../observability/request-context.js';
import type { TrustedTenantAdministratorContext } from '../administration/tenant-administration-context.service.js';
import { normalizeNurixCounterpartyAlias } from './nurix-counterparty-alias-resolution.js';

const SOURCE_SYSTEM = 'NOORIX_POSTGRES_ARCHIVE';
const directCandidateDefinitions = {
  CATEGORY_DIRECT: 'nurix-category-direct/v1',
  ACCOUNT_CODE_TYPE: 'nurix-account-code-type/v1',
} as const;
const COMPANY_MAP_APPROVAL_KEY = 'ALL_PLANNED_COMPANY_MAPS';
const PROVISIONAL_SUPPLIER_TRANSFORM_VERSION = 'nurix-provisional-supplier/v1';
const PROVISIONAL_SUPPLIER_TARGET_ENTITY = 'FINANCE_SUPPLIER';

type DirectCandidateKind = keyof typeof directCandidateDefinitions;

/**
 * The review gate only exposes aggregate lineage already held in Baseer.
 * Source rows, archive paths, source identifiers, credentials, and any
 * financial payload remain outside the application boundary.
 */
@Injectable()
export class NurixMigrationReviewService {
  constructor(private readonly database: DatabaseService) {}

  async listRuns(context: TrustedTenantAdministratorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const runs = await tx.legacyMigrationRun.findMany({
        where: { tenantId: context.tenantId, sourceSystem: SOURCE_SYSTEM },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: 50,
      });
      return { runs: await Promise.all(runs.map((run) => this.summary(tx, run))) };
    });
  }

  async review(context: TrustedTenantAdministratorContext, runId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await tx.legacyMigrationRun.findFirst({ where: { id: runId, tenantId: context.tenantId, sourceSystem: SOURCE_SYSTEM } });
      if (!run) throw new NotFoundException('Nurix migration run was not found.');
      const [summary, exceptions, actions] = await Promise.all([
        this.summary(tx, run),
        tx.legacyMigrationException.findMany({
          where: { runId, tenantId: context.tenantId },
          orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 250,
          select: { id: true, severity: true, code: true, message: true, sourceEntity: true, createdAt: true },
        }),
        tx.legacyMigrationReviewAction.findMany({
          where: { runId, tenantId: context.tenantId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 250,
          select: { id: true, action: true, actionKey: true, reason: true, createdAt: true },
        }),
      ]);
      const acknowledged = new Set(actions.filter((action) => action.action === LegacyMigrationReviewActionKind.ACKNOWLEDGE_EXCEPTION).map((action) => action.actionKey));
      return {
        run: summary,
        exceptions: exceptions.map((exception) => ({
          id: exception.id,
          severity: exception.severity,
          code: exception.code,
          message: exception.message,
          sourceEntity: exception.sourceEntity,
          acknowledged: acknowledged.has(exception.id),
          createdAt: exception.createdAt.toISOString(),
        })),
        actions: actions.map((action) => ({
          id: action.id,
          kind: action.action,
          actionKey: action.actionKey,
          reason: action.reason,
          createdAt: action.createdAt.toISOString(),
        })),
      };
    });
  }

  async approveDirectCandidates(context: TrustedTenantAdministratorContext, runId: string, request: ApproveNurixDirectCandidatesRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const transformVersion = directCandidateDefinitions[request.kind];
      const candidateCount = await tx.legacyMigrationRecordMap.count({ where: { tenantId: context.tenantId, runId, transformVersion } });
      if (!candidateCount) throw new ConflictException('There are no direct candidates in this scope to approve.');
      const snapshot = this.hash({ version: 1, runId: run.id, sourceFingerprint: run.sourceFingerprint, transformVersion, candidateCount, kind: request.kind });
      try {
        const action = await tx.legacyMigrationReviewAction.create({
          data: {
            id: randomUUID(), tenantId: context.tenantId, runId, action: LegacyMigrationReviewActionKind.APPROVE_DIRECT_CANDIDATES,
            actionKey: request.kind, reason: request.reason, reviewSnapshotSha256: snapshot, createdByUserId: context.actorUserId,
          },
        });
        await this.audit(tx, context, 'nurix_migration.direct_candidates_approved', action.id, { kind: request.kind, candidateCount, transformVersion, reviewSnapshotSha256: snapshot });
        return { id: action.id, kind: action.action, actionKey: action.actionKey, reason: action.reason, createdAt: action.createdAt.toISOString() };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This direct candidate scope has already been approved for this immutable run.');
        throw error;
      }
    });
  }

  async approveCompanyMaps(context: TrustedTenantAdministratorContext, runId: string, request: ApproveNurixCompanyMapsRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const maps = await tx.legacyMigrationCompanyMap.findMany({ where: { tenantId: context.tenantId, runId }, orderBy: [{ sourceCompanyId: 'asc' }, { id: 'asc' }], select: { sourceCompanyId: true, targetCompanyId: true, state: true } });
      if (!maps.length) throw new ConflictException('There are no planned company maps to approve.');
      if (maps.some((map) => map.state !== 'PLANNED')) throw new ConflictException('Only a fully planned immutable company-map set can be approved.');
      const snapshot = this.hash({ version: 1, runId: run.id, sourceFingerprint: run.sourceFingerprint, maps });
      try {
        const action = await tx.legacyMigrationReviewAction.create({
          data: { id: randomUUID(), tenantId: context.tenantId, runId, action: LegacyMigrationReviewActionKind.APPROVE_COMPANY_MAPS, actionKey: COMPANY_MAP_APPROVAL_KEY, reason: request.reason, reviewSnapshotSha256: snapshot, createdByUserId: context.actorUserId },
        });
        await this.audit(tx, context, 'nurix_migration.company_maps_approved', action.id, { companyMapCount: maps.length, reviewSnapshotSha256: snapshot });
        return { id: action.id, kind: action.action, actionKey: action.actionKey, reason: action.reason, createdAt: action.createdAt.toISOString() };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This immutable company-map set has already been approved.');
        throw error;
      }
    });
  }

  /**
   * Creates a company-scoped supplier shell for every archived source supplier.
   * The original supplier name and source checksum remain on the immutable
   * record map; identity linkage is optional and can be added later. No
   * category, payment, balance, invoice, or journal is imported here.
   */
  async createProvisionalSuppliers(context: TrustedTenantAdministratorContext, runId: string, request: CreateNurixProvisionalSuppliersRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const [companyMaps, approvedActions, candidates, resolutions] = await Promise.all([
        tx.legacyMigrationCompanyMap.findMany({ where: { tenantId: context.tenantId, runId }, select: { sourceCompanyId: true, targetCompanyId: true, state: true } }),
        tx.legacyMigrationReviewAction.findMany({ where: { tenantId: context.tenantId, runId, action: { in: [LegacyMigrationReviewActionKind.APPROVE_COMPANY_MAPS, LegacyMigrationReviewActionKind.APPROVE_DIRECT_CANDIDATES] } }, select: { action: true, actionKey: true } }),
        tx.legacyMigrationCounterpartyCandidate.findMany({ where: { tenantId: context.tenantId, runId }, orderBy: [{ sourceCompanyId: 'asc' }, { sourceSupplierId: 'asc' }], select: { sourceCompanyId: true, sourceSupplierId: true, sourceChecksum: true, nameAr: true, nameEn: true } }),
        tx.legacyMigrationCounterpartyResolution.findMany({ where: { tenantId: context.tenantId, runId }, select: { sourceCompanyId: true, sourceSupplierId: true, identityId: true } }),
      ]);
      const approved = new Set(approvedActions.filter((action) => action.action === LegacyMigrationReviewActionKind.APPROVE_DIRECT_CANDIDATES).map((action) => action.actionKey));
      const companyMapsApproved = approvedActions.some((action) => action.action === LegacyMigrationReviewActionKind.APPROVE_COMPANY_MAPS && action.actionKey === COMPANY_MAP_APPROVAL_KEY);
      if (!companyMapsApproved || companyMaps.some((map) => map.state !== 'PLANNED') || !approved.has('CATEGORY_DIRECT') || !approved.has('ACCOUNT_CODE_TYPE')) {
        throw new ConflictException('Company, category, and account review approvals are required before creating provisional suppliers.');
      }
      if (!candidates.length) throw new ConflictException('There are no source suppliers in this immutable migration run.');
      const targetCompanyBySource = new Map(companyMaps.map((map) => [map.sourceCompanyId, map.targetCompanyId]));
      const identityBySource = new Map(resolutions.map((item) => [`${item.sourceCompanyId}:${item.sourceSupplierId}`, item.identityId]));
      let created = 0;
      let reused = 0;
      let linkedToExistingIdentity = 0;
      for (const candidate of candidates) {
        const targetCompanyId = targetCompanyBySource.get(candidate.sourceCompanyId);
        if (!targetCompanyId) throw new ConflictException('A source supplier has no approved target company map.');
        const sourceEntity = this.provisionalSupplierSourceEntity(candidate.sourceCompanyId);
        const existing = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId: context.tenantId, runId, sourceEntity, sourceId: candidate.sourceSupplierId }, select: { targetCompanyId: true, targetEntity: true, targetId: true, transformVersion: true, sourceChecksum: true } });
        if (existing) {
          if (existing.targetCompanyId !== targetCompanyId || existing.targetEntity !== PROVISIONAL_SUPPLIER_TARGET_ENTITY || existing.transformVersion !== PROVISIONAL_SUPPLIER_TRANSFORM_VERSION || existing.sourceChecksum !== candidate.sourceChecksum) {
            throw new ConflictException('An existing provisional supplier map differs from the immutable source evidence.');
          }
          reused += 1;
          continue;
        }
        const identityId = identityBySource.get(`${candidate.sourceCompanyId}:${candidate.sourceSupplierId}`) ?? null;
        const supplier = await tx.financeSupplier.create({
          data: {
            id: randomUUID(), tenantId: context.tenantId, companyId: targetCompanyId,
            counterpartyIdentityId: identityId,
            categoryId: null,
            // Noorix exposes no supplier type. This neutral starter value is
            // intentionally not used to post documents; the later document
            // transform assigns the compatible category/type explicitly.
            supplierType: 'EXPENSE',
            nameAr: candidate.nameAr,
            nameEn: candidate.nameEn,
          },
        });
        await tx.legacyMigrationRecordMap.create({
          data: {
            id: randomUUID(), tenantId: context.tenantId, runId, targetCompanyId,
            sourceCompanyId: candidate.sourceCompanyId, sourceEntity, sourceId: candidate.sourceSupplierId,
            targetEntity: PROVISIONAL_SUPPLIER_TARGET_ENTITY, targetId: supplier.id,
            transformVersion: PROVISIONAL_SUPPLIER_TRANSFORM_VERSION, sourceChecksum: candidate.sourceChecksum,
          },
        });
        created += 1;
        if (identityId) linkedToExistingIdentity += 1;
      }
      const receipt = { created, reused, linkedToExistingIdentity, total: candidates.length };
      await this.audit(tx, context, 'nurix_migration.provisional_suppliers_created', run.id, {
        ...receipt,
        transformVersion: PROVISIONAL_SUPPLIER_TRANSFORM_VERSION,
        supplierTypePolicy: 'EXPENSE_UNTIL_DOCUMENT_TRANSFORM',
        reviewReason: request.reason,
      });
      return receipt;
    });
  }

  async acknowledgeException(context: TrustedTenantAdministratorContext, runId: string, exceptionId: string, request: AcknowledgeNurixMigrationExceptionRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const exception = await tx.legacyMigrationException.findFirst({ where: { id: exceptionId, runId, tenantId: context.tenantId }, select: { id: true, code: true, severity: true, sourceEntity: true } });
      if (!exception) throw new NotFoundException('Nurix migration exception was not found.');
      const snapshot = this.hash({ version: 1, runId: run.id, sourceFingerprint: run.sourceFingerprint, exceptionId: exception.id, code: exception.code, severity: exception.severity, sourceEntity: exception.sourceEntity });
      try {
        const action = await tx.legacyMigrationReviewAction.create({
          data: {
            id: randomUUID(), tenantId: context.tenantId, runId, exceptionId: exception.id, action: LegacyMigrationReviewActionKind.ACKNOWLEDGE_EXCEPTION,
            actionKey: exception.id, reason: request.reason, reviewSnapshotSha256: snapshot, createdByUserId: context.actorUserId,
          },
        });
        await this.audit(tx, context, 'nurix_migration.exception_acknowledged', action.id, { exceptionCode: exception.code, severity: exception.severity, reviewSnapshotSha256: snapshot });
        return { id: action.id, kind: action.action, actionKey: action.actionKey, reason: action.reason, createdAt: action.createdAt.toISOString() };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This exception has already been acknowledged for this immutable run.');
        throw error;
      }
    });
  }

  async listCounterpartyCandidates(context: TrustedTenantAdministratorContext, runId: string, cursor?: string, kind: LegacyMigrationCounterpartyCandidateKind = LegacyMigrationCounterpartyCandidateKind.REVIEW_REQUIRED) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.requireReviewableRun(tx, context.tenantId, runId);
      const candidateQuery = { where: { tenantId: context.tenantId, runId, kind }, orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }], take: 51, select: { id: true, sourceCompanyId: true, sourceSupplierId: true, nameAr: true, nameEn: true, kind: true } };
      const candidates = cursor
        ? await tx.legacyMigrationCounterpartyCandidate.findMany({ ...candidateQuery, cursor: { id: cursor }, skip: 1 })
        : await tx.legacyMigrationCounterpartyCandidate.findMany(candidateQuery);
      const page = candidates.slice(0, 50);
      const [resolutions, identities] = await Promise.all([
        tx.legacyMigrationCounterpartyResolution.findMany({ where: { tenantId: context.tenantId, runId }, include: { identity: { select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } } } }),
        tx.financeCounterpartyIdentity.findMany({ where: { tenantId: context.tenantId, isActive: true }, orderBy: [{ canonicalNameAr: 'asc' }, { id: 'asc' }], take: 250, select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } }),
      ]);
      const resolutionBySource = new Map(resolutions.map((resolution) => [`${resolution.sourceCompanyId}:${resolution.sourceSupplierId}`, resolution]));
      return {
        candidates: page.map((candidate) => {
          const resolution = resolutionBySource.get(`${candidate.sourceCompanyId}:${candidate.sourceSupplierId}`);
          return { ...candidate, resolution: resolution ? { kind: resolution.kind, identity: resolution.identity } : null };
        }),
        identities,
        nextCursor: candidates.length > 50 ? page.at(-1)?.id ?? null : null,
      };
    });
  }

  async listCounterpartyReviewGroups(context: TrustedTenantAdministratorContext, runId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.requireReviewableRun(tx, context.tenantId, runId);
      const [candidates, resolutions, identities] = await Promise.all([
        tx.legacyMigrationCounterpartyCandidate.findMany({ where: { tenantId: context.tenantId, runId, kind: LegacyMigrationCounterpartyCandidateKind.REVIEW_REQUIRED }, select: { sourceCompanyId: true, sourceSupplierId: true, nameAr: true } }),
        tx.legacyMigrationCounterpartyResolution.findMany({ where: { tenantId: context.tenantId, runId }, select: { sourceCompanyId: true, sourceSupplierId: true } }),
        tx.financeCounterpartyIdentity.findMany({ where: { tenantId: context.tenantId, isActive: true }, orderBy: [{ canonicalNameAr: 'asc' }, { id: 'asc' }], take: 250, select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } }),
      ]);
      const resolved = new Set(resolutions.map((resolution) => `${resolution.sourceCompanyId}:${resolution.sourceSupplierId}`));
      const groups = new Map<string, { nameAr: string; count: number; companyIds: Set<string> }>();
      for (const candidate of candidates) {
        if (resolved.has(`${candidate.sourceCompanyId}:${candidate.sourceSupplierId}`)) continue;
        const normalized = normalizeNurixCounterpartyAlias(candidate.nameAr);
        const key = this.hash({ version: 1, normalized });
        const group = groups.get(key) ?? { nameAr: candidate.nameAr, count: 0, companyIds: new Set<string>() };
        group.count += 1;
        group.companyIds.add(candidate.sourceCompanyId);
        groups.set(key, group);
      }
      return { groups: [...groups.entries()].map(([key, group]) => ({ key, nameAr: group.nameAr, count: group.count, companyCount: group.companyIds.size })).sort((left, right) => right.count - left.count || left.nameAr.localeCompare(right.nameAr, 'ar')).slice(0, 100), identities };
    });
  }

  /**
   * Read-only, conservative review assistance. It never writes aliases,
   * creates suppliers, or applies a suggestion. Exact canonical matches are
   * high confidence; commercial-name signals merely reduce review effort.
   */
  async listCounterpartySuggestions(context: TrustedTenantAdministratorContext, runId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.requireReviewableRun(tx, context.tenantId, runId);
      const [candidates, resolutions, identities] = await Promise.all([
        tx.legacyMigrationCounterpartyCandidate.findMany({ where: { tenantId: context.tenantId, runId, kind: LegacyMigrationCounterpartyCandidateKind.REVIEW_REQUIRED }, select: { sourceCompanyId: true, sourceSupplierId: true, nameAr: true } }),
        tx.legacyMigrationCounterpartyResolution.findMany({ where: { tenantId: context.tenantId, runId }, select: { sourceCompanyId: true, sourceSupplierId: true } }),
        tx.financeCounterpartyIdentity.findMany({ where: { tenantId: context.tenantId, isActive: true }, orderBy: [{ canonicalNameAr: 'asc' }, { id: 'asc' }], take: 250, select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } }),
      ]);
      const resolved = new Set(resolutions.map((resolution) => `${resolution.sourceCompanyId}:${resolution.sourceSupplierId}`));
      const groups = new Map<string, { nameAr: string; count: number; companyIds: Set<string> }>();
      for (const candidate of candidates) {
        if (resolved.has(`${candidate.sourceCompanyId}:${candidate.sourceSupplierId}`)) continue;
        const normalized = normalizeNurixCounterpartyAlias(candidate.nameAr);
        const key = this.hash({ version: 1, normalized });
        const group = groups.get(key) ?? { nameAr: candidate.nameAr, count: 0, companyIds: new Set<string>() };
        group.count += 1;
        group.companyIds.add(candidate.sourceCompanyId);
        groups.set(key, group);
      }
      const identityByNormalizedName = new Map(identities.map((identity) => [normalizeNurixCounterpartyAlias(identity.canonicalNameAr), identity]));
      const suggestions = [...groups.entries()].map(([groupKey, group]) => this.counterpartySuggestion(groupKey, group, identityByNormalizedName.get(normalizeNurixCounterpartyAlias(group.nameAr)) ?? null));
      const ordered = suggestions.sort((left, right) => this.suggestionRank(left.confidence) - this.suggestionRank(right.confidence) || right.count - left.count || left.nameAr.localeCompare(right.nameAr, 'ar'));
      return {
        suggestions: ordered.slice(0, 250),
        summary: {
          high: suggestions.filter((suggestion) => suggestion.confidence === 'HIGH').length,
          medium: suggestions.filter((suggestion) => suggestion.confidence === 'MEDIUM').length,
          low: suggestions.filter((suggestion) => suggestion.confidence === 'LOW').length,
        },
      };
    });
  }

  async resolveCounterpartyReviewGroup(context: TrustedTenantAdministratorContext, runId: string, groupKey: string, request: ResolveNurixMigrationCounterpartyRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const identity = await tx.financeCounterpartyIdentity.findFirst({ where: { id: request.identityId, tenantId: context.tenantId, isActive: true }, select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } });
      if (!identity) throw new NotFoundException('The selected active counterparty identity was not found.');
      const [candidates, resolutions] = await Promise.all([
        tx.legacyMigrationCounterpartyCandidate.findMany({ where: { tenantId: context.tenantId, runId, kind: LegacyMigrationCounterpartyCandidateKind.REVIEW_REQUIRED }, select: { sourceCompanyId: true, sourceSupplierId: true, sourceChecksum: true, nameAr: true, nameEn: true } }),
        tx.legacyMigrationCounterpartyResolution.findMany({ where: { tenantId: context.tenantId, runId }, select: { sourceCompanyId: true, sourceSupplierId: true } }),
      ]);
      const resolved = new Set(resolutions.map((resolution) => `${resolution.sourceCompanyId}:${resolution.sourceSupplierId}`));
      const group = candidates.filter((candidate) => !resolved.has(`${candidate.sourceCompanyId}:${candidate.sourceSupplierId}`) && this.hash({ version: 1, normalized: normalizeNurixCounterpartyAlias(candidate.nameAr) }) === groupKey);
      if (!group.length) throw new ConflictException('This exact-name review group is no longer available. Refresh the queue before deciding.');
      for (const candidate of group) {
        const aliasRegistered = await this.registerManualSourceAlias(tx, context.tenantId, candidate, identity.id);
        await this.createManualCounterpartyResolution(tx, context, run, candidate, identity.id, request.reason, false, aliasRegistered);
      }
      return { resolved: group.length, identity };
    });
  }

  /** Creates one commercial identity for one conservative exact-name group. */
  async createCommercialCounterpartyReviewGroup(context: TrustedTenantAdministratorContext, runId: string, groupKey: string, request: CreateCommercialNurixMigrationCounterpartyRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const group = await this.unresolvedCounterpartyReviewGroup(tx, context.tenantId, runId, groupKey);
      const { identity, identityCreated } = await this.findOrCreateCommercialIdentity(tx, context.tenantId, group[0]!);
      for (const [index, candidate] of group.entries()) {
        const aliasRegistered = await this.registerManualSourceAlias(tx, context.tenantId, candidate, identity.id);
        await this.createManualCounterpartyResolution(tx, context, run, candidate, identity.id, request.reason, identityCreated && index === 0, aliasRegistered);
      }
      return { resolved: group.length, identity, identityCreated };
    });
  }

  async resolveCounterpartyCandidate(context: TrustedTenantAdministratorContext, runId: string, candidateId: string, request: ResolveNurixMigrationCounterpartyRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const candidate = await this.requireUnresolvedCounterpartyCandidate(tx, context.tenantId, runId, candidateId);
      const identity = await tx.financeCounterpartyIdentity.findFirst({ where: { id: request.identityId, tenantId: context.tenantId, isActive: true }, select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } });
      if (!identity) throw new NotFoundException('The selected active counterparty identity was not found.');
      const aliasRegistered = await this.registerManualSourceAlias(tx, context.tenantId, candidate, identity.id);
      const resolution = await this.createManualCounterpartyResolution(tx, context, run, candidate, identity.id, request.reason, false, aliasRegistered);
      return { id: resolution.id, kind: resolution.kind, identity };
    });
  }

  async createCommercialCounterpartyAndResolve(context: TrustedTenantAdministratorContext, runId: string, candidateId: string, request: CreateCommercialNurixMigrationCounterpartyRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const run = await this.requireReviewableRun(tx, context.tenantId, runId);
      const candidate = await this.requireUnresolvedCounterpartyCandidate(tx, context.tenantId, runId, candidateId);
      const { identity, identityCreated } = await this.findOrCreateCommercialIdentity(tx, context.tenantId, candidate);
      const aliasRegistered = await this.registerManualSourceAlias(tx, context.tenantId, candidate, identity.id);
      const resolution = await this.createManualCounterpartyResolution(tx, context, run, candidate, identity.id, request.reason, identityCreated, aliasRegistered);
      return { id: resolution.id, kind: resolution.kind, identity, identityCreated };
    });
  }

  private async requireUnresolvedCounterpartyCandidate(tx: Prisma.TransactionClient, tenantId: string, runId: string, candidateId: string) {
    const candidate = await tx.legacyMigrationCounterpartyCandidate.findFirst({ where: { id: candidateId, tenantId, runId }, select: { id: true, sourceCompanyId: true, sourceSupplierId: true, nameAr: true, nameEn: true, kind: true, sourceChecksum: true } });
    if (!candidate) throw new NotFoundException('Noorix supplier review candidate was not found.');
    if (candidate.kind !== LegacyMigrationCounterpartyCandidateKind.REVIEW_REQUIRED) throw new ConflictException('Only unresolved supplier candidates can receive a manual identity decision.');
    const existing = await tx.legacyMigrationCounterpartyResolution.findFirst({ where: { tenantId, runId, sourceCompanyId: candidate.sourceCompanyId, sourceSupplierId: candidate.sourceSupplierId }, select: { id: true } });
    if (existing) throw new ConflictException('This supplier candidate already has an immutable identity decision.');
    return candidate;
  }

  private counterpartySuggestion(groupKey: string, group: { nameAr: string; count: number; companyIds: Set<string> }, identity: { id: string; canonicalKey: string; canonicalNameAr: string; kind: string } | null) {
    const shared = group.count > 1 && group.companyIds.size > 1;
    if (identity) return { groupKey, nameAr: group.nameAr, count: group.count, companyCount: group.companyIds.size, action: 'MATCH_EXISTING_IDENTITY' as const, confidence: 'HIGH' as const, reasonAr: 'تطابق الاسم بعد التطبيع المحافظ مع هوية قائمة؛ يبقى الاعتماد اليدوي مطلوبًا.', identity };
    const normalized = normalizeNurixCounterpartyAlias(group.nameAr);
    const publicOrUtility = /وزارة|هيئ|مدير|منص|جواز|اقام|تأمين|بلدي|امان|كهرب|مياه|اتصالات|غاز|gosi|stc/.test(normalized);
    if (publicOrUtility) return { groupKey, nameAr: group.nameAr, count: group.count, companyCount: group.companyIds.size, action: 'REVIEW_MANUALLY' as const, confidence: 'MEDIUM' as const, reasonAr: 'الاسم يحمل مؤشرات جهة عامة أو مزود خدمة؛ لا يُنشأ كمورد تجاري دون مراجعة بشرية.', identity: null };
    const commercial = /شرك|مؤسس|تجار|تموين|مخبز|مطعم|مقاول|محدود|مصنع|مركز|مكتب|مؤسس/.test(normalized);
    if (shared && commercial) return { groupKey, nameAr: group.nameAr, count: group.count, companyCount: group.companyIds.size, action: 'CREATE_COMMERCIAL_GROUP' as const, confidence: 'HIGH' as const, reasonAr: 'اسم تجاري متطابق في أكثر من شركة، ولا يحمل مؤشرات جهة عامة أو مزود خدمة. راجع ثم أنشئ هوية موحّدة.', identity: null };
    if (commercial) return { groupKey, nameAr: group.nameAr, count: group.count, companyCount: group.companyIds.size, action: 'CREATE_COMMERCIAL_GROUP' as const, confidence: 'MEDIUM' as const, reasonAr: 'الاسم يحمل مؤشرات تجارية، لكنه يحتاج اعتمادك قبل إنشاء هوية تجارية.', identity: null };
    return { groupKey, nameAr: group.nameAr, count: group.count, companyCount: group.companyIds.size, action: 'REVIEW_MANUALLY' as const, confidence: 'LOW' as const, reasonAr: 'لا تتوفر قرائن كافية لاقتراح ربط أو إنشاء آمن؛ راجعه يدويًا.', identity: null };
  }

  private suggestionRank(confidence: 'HIGH' | 'MEDIUM' | 'LOW'): number { return confidence === 'HIGH' ? 0 : confidence === 'MEDIUM' ? 1 : 2; }

  private async unresolvedCounterpartyReviewGroup(tx: Prisma.TransactionClient, tenantId: string, runId: string, groupKey: string) {
    const [candidates, resolutions] = await Promise.all([
      tx.legacyMigrationCounterpartyCandidate.findMany({ where: { tenantId, runId, kind: LegacyMigrationCounterpartyCandidateKind.REVIEW_REQUIRED }, orderBy: [{ sourceCompanyId: 'asc' }, { sourceSupplierId: 'asc' }], select: { sourceCompanyId: true, sourceSupplierId: true, sourceChecksum: true, nameAr: true, nameEn: true } }),
      tx.legacyMigrationCounterpartyResolution.findMany({ where: { tenantId, runId }, select: { sourceCompanyId: true, sourceSupplierId: true } }),
    ]);
    const resolved = new Set(resolutions.map((resolution) => `${resolution.sourceCompanyId}:${resolution.sourceSupplierId}`));
    const group = candidates.filter((candidate) => !resolved.has(`${candidate.sourceCompanyId}:${candidate.sourceSupplierId}`) && this.hash({ version: 1, normalized: normalizeNurixCounterpartyAlias(candidate.nameAr) }) === groupKey);
    if (!group.length) throw new ConflictException('This exact-name review group is no longer available. Refresh the queue before deciding.');
    return group;
  }

  private async findOrCreateCommercialIdentity(tx: Prisma.TransactionClient, tenantId: string, candidate: { nameAr: string; nameEn?: string | null }) {
    const normalized = normalizeNurixCounterpartyAlias(candidate.nameAr);
    const canonicalKey = `MANUAL_${this.hash({ tenantId, normalized }).slice(0, 24).toUpperCase()}`;
    let identity = await tx.financeCounterpartyIdentity.findFirst({ where: { tenantId, canonicalKey }, select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } });
    let identityCreated = false;
    if (!identity) {
      identity = await tx.financeCounterpartyIdentity.create({ data: { id: randomUUID(), tenantId, canonicalKey, canonicalNameAr: candidate.nameAr, canonicalNameEn: candidate.nameEn ?? null, kind: 'COMMERCIAL_SUPPLIER' }, select: { id: true, canonicalKey: true, canonicalNameAr: true, kind: true } });
      await tx.financeCounterpartyAlias.create({ data: { id: randomUUID(), tenantId, identityId: identity.id, normalizedAlias: normalized, nameAr: candidate.nameAr, nameEn: candidate.nameEn ?? null, kind: 'CANONICAL' } });
      identityCreated = true;
    }
    return { identity, identityCreated };
  }

  private async registerManualSourceAlias(tx: Prisma.TransactionClient, tenantId: string, candidate: { nameAr: string; nameEn?: string | null }, identityId: string) {
    const normalizedAlias = normalizeNurixCounterpartyAlias(candidate.nameAr);
    const existing = await tx.financeCounterpartyAlias.findFirst({ where: { tenantId, normalizedAlias }, select: { identityId: true } });
    if (existing) {
      if (existing.identityId !== identityId) throw new ConflictException('This supplier name is already an explicit alias for a different identity.');
      return false;
    }
    await tx.financeCounterpartyAlias.create({ data: { id: randomUUID(), tenantId, identityId, normalizedAlias, nameAr: candidate.nameAr, nameEn: candidate.nameEn ?? null, kind: 'SOURCE_VARIANT' } });
    return true;
  }

  private async createManualCounterpartyResolution(tx: Prisma.TransactionClient, context: TrustedTenantAdministratorContext, run: { id: string; sourceFingerprint: string }, candidate: { sourceCompanyId: string; sourceSupplierId: string; sourceChecksum: string }, identityId: string, reason: string, identityCreated = false, aliasRegistered = false) {
    const resolution = await tx.legacyMigrationCounterpartyResolution.create({ data: { id: randomUUID(), tenantId: context.tenantId, runId: run.id, sourceCompanyId: candidate.sourceCompanyId, sourceSupplierId: candidate.sourceSupplierId, identityId, kind: LegacyMigrationCounterpartyResolutionKind.MANUAL, transformVersion: 'nurix-counterparty-manual/v1', sourceChecksum: candidate.sourceChecksum } });
    await this.attachIdentityToProvisionalSupplier(tx, context.tenantId, run.id, candidate.sourceCompanyId, candidate.sourceSupplierId, identityId);
    await this.audit(tx, context, 'nurix_migration.counterparty_manually_resolved', resolution.id, { runId: run.id, sourceFingerprint: run.sourceFingerprint, identityId, identityCreated, aliasRegistered, reviewReason: reason, transformVersion: resolution.transformVersion, sourceChecksum: candidate.sourceChecksum });
    return resolution;
  }

  private async attachIdentityToProvisionalSupplier(tx: Prisma.TransactionClient, tenantId: string, runId: string, sourceCompanyId: string, sourceSupplierId: string, identityId: string) {
    const map = await tx.legacyMigrationRecordMap.findFirst({
      where: { tenantId, runId, sourceEntity: this.provisionalSupplierSourceEntity(sourceCompanyId), sourceId: sourceSupplierId, targetEntity: PROVISIONAL_SUPPLIER_TARGET_ENTITY, transformVersion: PROVISIONAL_SUPPLIER_TRANSFORM_VERSION },
      select: { targetCompanyId: true, targetId: true },
    });
    if (!map) return;
    const supplier = await tx.financeSupplier.findFirst({ where: { id: map.targetId, tenantId, companyId: map.targetCompanyId }, select: { id: true, counterpartyIdentityId: true } });
    if (!supplier) throw new ConflictException('The mapped provisional supplier is missing from its target company.');
    if (supplier.counterpartyIdentityId && supplier.counterpartyIdentityId !== identityId) throw new ConflictException('The provisional supplier is already linked to a different central identity.');
    if (!supplier.counterpartyIdentityId) await tx.financeSupplier.update({ where: { id: supplier.id }, data: { counterpartyIdentityId: identityId } });
  }

  private provisionalSupplierSourceEntity(sourceCompanyId: string): string {
    return `SUPPLIER_${this.hash({ sourceCompanyId }).slice(0, 24)}`;
  }

  private async requireReviewableRun(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
    const run = await tx.legacyMigrationRun.findFirst({ where: { id: runId, tenantId, sourceSystem: SOURCE_SYSTEM } });
    if (!run) throw new NotFoundException('Nurix migration run was not found.');
    if (run.status !== LegacyMigrationRunStatus.DISCOVERY && run.status !== LegacyMigrationRunStatus.DRY_RUN) throw new ConflictException('This migration run is not open for review.');
    return run;
  }

  private async summary(tx: Prisma.TransactionClient, run: { id: string; sourceSystem: string; sourceFingerprint: string; transformVersion: string; status: LegacyMigrationRunStatus; createdAt: Date }) {
    const [companyCount, exceptionGroups, directCounts, approvedActions, counterpartyResolutionGroups, counterpartyCandidates, provisionalSuppliers, provisionalVaults] = await Promise.all([
      tx.legacyMigrationCompanyMap.count({ where: { runId: run.id } }),
      tx.legacyMigrationException.groupBy({ by: ['severity'], where: { runId: run.id }, _count: { _all: true } }),
      Promise.all(Object.entries(directCandidateDefinitions).map(async ([kind, transformVersion]) => ({ kind: kind as DirectCandidateKind, count: await tx.legacyMigrationRecordMap.count({ where: { runId: run.id, transformVersion } }) }))),
      tx.legacyMigrationReviewAction.findMany({ where: { runId: run.id, action: { in: [LegacyMigrationReviewActionKind.APPROVE_DIRECT_CANDIDATES, LegacyMigrationReviewActionKind.APPROVE_COMPANY_MAPS] } }, select: { action: true, actionKey: true } }),
      tx.legacyMigrationCounterpartyResolution.groupBy({ by: ['kind'], where: { runId: run.id }, _count: { _all: true } }),
      tx.legacyMigrationCounterpartyCandidate.count({ where: { runId: run.id } }),
      tx.legacyMigrationRecordMap.count({ where: { runId: run.id, targetEntity: PROVISIONAL_SUPPLIER_TARGET_ENTITY, transformVersion: PROVISIONAL_SUPPLIER_TRANSFORM_VERSION } }),
      tx.legacyMigrationRecordMap.count({ where: { runId: run.id, targetEntity: 'FINANCE_VAULT', transformVersion: 'nurix-provisional-vault/v1' } }),
    ]);
    const severityCount = (severity: 'BLOCKER' | 'REVIEW' | 'WARNING') => exceptionGroups.find((group) => group.severity === severity)?._count._all ?? 0;
    const approved = new Set(approvedActions.filter((action) => action.action === LegacyMigrationReviewActionKind.APPROVE_DIRECT_CANDIDATES).map((action) => action.actionKey));
    const resolvedCounterparties = counterpartyResolutionGroups.reduce((total, group) => total + group._count._all, 0);
    const approvedCompanyMaps = approvedActions.some((action) => action.action === LegacyMigrationReviewActionKind.APPROVE_COMPANY_MAPS && action.actionKey === COMPANY_MAP_APPROVAL_KEY) ? companyCount : 0;
    const categoryCandidatesApproved = approved.has('CATEGORY_DIRECT');
    const accountCandidatesApproved = approved.has('ACCOUNT_CODE_TYPE');
    const canCreateProvisionalSuppliers = companyCount > 0 && companyCount === approvedCompanyMaps && categoryCandidatesApproved && accountCandidatesApproved;
    return {
      id: run.id, sourceSystem: SOURCE_SYSTEM, sourceFingerprintPrefix: run.sourceFingerprint.slice(0, 12).toLowerCase(), transformVersion: run.transformVersion, status: run.status, companyCount,
      directCandidates: directCounts.map((candidate) => ({ kind: candidate.kind, count: candidate.count, approved: approved.has(candidate.kind) })),
      counterpartyResolutions: {
        explicitAlias: counterpartyResolutionGroups.find((group) => group.kind === 'EXPLICIT_ALIAS')?._count._all ?? 0,
        manual: counterpartyResolutionGroups.find((group) => group.kind === 'MANUAL')?._count._all ?? 0,
      },
      supplierReadiness: {
        candidates: counterpartyCandidates,
        resolved: resolvedCounterparties,
        unresolved: Math.max(counterpartyCandidates - resolvedCounterparties, 0),
        companyMaps: companyCount,
        approvedCompanyMaps,
        categoryCandidatesApproved,
        accountCandidatesApproved,
        provisionalSuppliers,
        provisionalVaults,
        canCreateProvisionalSuppliers,
        canStage: counterpartyCandidates > 0 && counterpartyCandidates === resolvedCounterparties && companyCount > 0 && companyCount === approvedCompanyMaps && categoryCandidatesApproved && accountCandidatesApproved,
      },
      exceptionCounts: { blockers: severityCount('BLOCKER'), review: severityCount('REVIEW'), warnings: severityCount('WARNING') },
      createdAt: run.createdAt.toISOString(),
    };
  }

  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

  private async audit(tx: Prisma.TransactionClient, context: TrustedTenantAdministratorContext, action: string, entityId: string, afterJson: Record<string, unknown>) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, action, entityType: 'LegacyMigrationReviewAction', entityId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: afterJson as Prisma.InputJsonValue } });
  }
}

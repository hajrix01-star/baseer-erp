import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import {
  CompanyStatus,
  SessionStatus,
  UserStatus,
} from "../generated/prisma/client.js";
import {
  IdentityTokenError,
  IdentityTokenService,
} from "../identity/identity-token.service.js";
import { effectivePermissionCodes, SYSTEM_ROLE_TEMPLATES } from "../administration/administration-permissions.js";

export interface CompanyContextAuthorizationInput {
  accessToken: string;
  companyId: string;
  requiredCapabilities: readonly string[];
}
export interface CompanyContextCapabilityInspectionInput {
  accessToken: string;
  companyId: string;
  requestedCapabilities: readonly string[];
}
export interface CompanyContextReceipt {
  principal: { tenantId: string; userId: string };
  company: { id: string };
  capabilities: readonly string[];
}
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PERMISSION_CODE_LENGTH = 120;
const COMPANY_MANAGER_CAPABILITIES: readonly string[] = SYSTEM_ROLE_TEMPLATES.find((role) => role.code === "BASEER_COMPANY_MANAGER")?.permissions ?? [];
/**
 * Migration review is read-only, but several legitimate read actions do not
 * use the older `.read` suffix. Keep this policy explicit: never infer a
 * financial operation from the spelling of its permission code.
 */
const MIGRATION_REVIEW_READ_CAPABILITIES = new Set([
  "backup.audit.view",
  "finance.daily_sales.history.read_all",
  "hr.employee_documents.download",
  "platform.output.export",
  "platform.output.preview",
]);

function isMigrationReviewReadCapability(capability: string): boolean {
  return capability.endsWith(".read") || MIGRATION_REVIEW_READ_CAPABILITIES.has(capability);
}

@Injectable()
export class CompanyContextService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: IdentityTokenService,
  ) {}

  /** Company scope is derived from live membership. A tenant owner is the explicit private-system exception and may access every active company in that tenant. */
  async authorize(
    input: CompanyContextAuthorizationInput,
  ): Promise<CompanyContextReceipt> {
    return this.authorizeCapabilities(
      input?.accessToken,
      input?.companyId,
      input?.requiredCapabilities,
      true,
    );
  }

  /**
   * Authenticates one live company context and returns only the requested
   * capabilities actually granted there. Catalog-defined prerequisites are
   * resolved in memory, so an action grant also supplies its required read
   * capability without mutating the stored role.
   */
  async authorizeAvailable(
    input: CompanyContextCapabilityInspectionInput,
  ): Promise<CompanyContextReceipt> {
    return this.authorizeCapabilities(
      input?.accessToken,
      input?.companyId,
      input?.requestedCapabilities,
      false,
    );
  }

  private async authorizeCapabilities(
    accessToken: unknown,
    companyIdValue: unknown,
    capabilityValues: unknown,
    requireAll: boolean,
  ): Promise<CompanyContextReceipt> {
    const claims = this.verifyAccessToken(accessToken);
    const companyId = this.companyId(companyIdValue);
    const requestedCapabilities = this.requiredCapabilities(capabilityValues);
    return this.database.inTenantTransaction(
      claims.tenantId,
      async (transaction) => {
        const now = new Date();
        const [user, session, company, membership, owner] = await Promise.all([
          transaction.user.findFirst({
            where: { id: claims.userId, tenantId: claims.tenantId },
            select: { status: true, sessionVersion: true },
          }),
          transaction.appSession.findFirst({
            where: {
              id: claims.sessionId,
              tenantId: claims.tenantId,
              userId: claims.userId,
            },
            select: { status: true, sessionVersion: true, expiresAt: true },
          }),
          transaction.company.findFirst({
            where: { id: companyId, tenantId: claims.tenantId },
            select: { status: true, migrationReviewLocked: true },
          }),
          transaction.companyMembership.findFirst({
            where: {
              tenantId: claims.tenantId,
              userId: claims.userId,
              companyId,
            },
            select: { roleId: true },
          }),
          transaction.tenantAdministrationAssignment.findFirst({
            where: {
              tenantId: claims.tenantId,
              userId: claims.userId,
              isOwner: true,
            },
            select: { userId: true },
          }),
        ]);
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          user.sessionVersion !== claims.sessionVersion ||
          !session ||
          session.status !== SessionStatus.ACTIVE ||
          session.sessionVersion !== claims.sessionVersion ||
          session.expiresAt <= now
        )
          throw this.unauthorized();
        if (!company || company.status !== CompanyStatus.ACTIVE)
          throw this.forbidden();
        if (company.migrationReviewLocked && requestedCapabilities.some((capability) => !isMigrationReviewReadCapability(capability)))
          throw new ConflictException("This company is active for migration review only; operational changes are locked.");
        if (owner)
          return {
            principal: { tenantId: claims.tenantId, userId: claims.userId },
            company: { id: companyId },
            capabilities: requestedCapabilities,
          };
        if (!membership) throw this.forbidden();
        // A system Company Manager is governed by the immutable role template.
        // Resolve newly released template capabilities in memory instead of
        // mutating RolePermission during an ordinary authorization read. This
        // keeps authentication side-effect free and works with a least-privilege
        // runtime database role; custom roles retain their explicit grants.
        const systemManager = await transaction.role.findFirst({ where: { id: membership.roleId, tenantId: claims.tenantId, code: "BASEER_COMPANY_MANAGER", isSystem: true }, select: { id: true } });
        const grants = await transaction.rolePermission.findMany({
          where: {
            tenantId: claims.tenantId,
            roleId: membership.roleId,
          },
          select: { permissionCode: true },
        });
        const directPermissionCodes = grants.map((grant) => grant.permissionCode);
        if (systemManager) {
          directPermissionCodes.push(...COMPANY_MANAGER_CAPABILITIES);
        }
        const granted = new Set(effectivePermissionCodes(directPermissionCodes));
        if (requireAll && requestedCapabilities.some((capability) => !granted.has(capability)))
          throw this.forbidden();
        return {
          principal: { tenantId: claims.tenantId, userId: claims.userId },
          company: { id: companyId },
          capabilities: requestedCapabilities.filter((capability) => granted.has(capability)),
        };
      },
    );
  }
  private verifyAccessToken(accessToken: unknown) {
    if (typeof accessToken !== "string" || !accessToken)
      throw this.unauthorized();
    try {
      return this.tokens.verify(accessToken, "access");
    } catch (error) {
      if (error instanceof IdentityTokenError) throw this.unauthorized();
      throw error;
    }
  }
  private companyId(value: unknown): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value))
      throw this.forbidden();
    return value;
  }
  private requiredCapabilities(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) throw this.forbidden();
    const capabilities = value.map((capability) => {
      if (
        typeof capability !== "string" ||
        !capability ||
        capability.length > MAX_PERMISSION_CODE_LENGTH
      )
        throw this.forbidden();
      return capability;
    });
    if (new Set(capabilities).size !== capabilities.length)
      throw this.forbidden();
    return capabilities;
  }
  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException("Invalid authentication credentials.");
  }
  private forbidden(): ForbiddenException {
    return new ForbiddenException("Company access is not permitted.");
  }
}

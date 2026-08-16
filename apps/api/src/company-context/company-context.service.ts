import {
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

export interface CompanyContextAuthorizationInput {
  accessToken: string;
  companyId: string;
  requiredCapabilities: readonly string[];
}
export interface CompanyContextReceipt {
  principal: { tenantId: string; userId: string };
  company: { id: string };
  capabilities: readonly string[];
}
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PERMISSION_CODE_LENGTH = 120;

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
    const claims = this.verifyAccessToken(input?.accessToken);
    const companyId = this.companyId(input?.companyId);
    const requiredCapabilities = this.requiredCapabilities(
      input?.requiredCapabilities,
    );
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
            select: { status: true },
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
        if (owner)
          return {
            principal: { tenantId: claims.tenantId, userId: claims.userId },
            company: { id: companyId },
            capabilities: requiredCapabilities,
          };
        if (!membership) throw this.forbidden();
        const grants = await transaction.rolePermission.findMany({
          where: {
            tenantId: claims.tenantId,
            roleId: membership.roleId,
            permissionCode: { in: requiredCapabilities },
          },
          select: { permissionCode: true },
        });
        const granted = new Set(grants.map((grant) => grant.permissionCode));
        if (requiredCapabilities.some((capability) => !granted.has(capability)))
          throw this.forbidden();
        return {
          principal: { tenantId: claims.tenantId, userId: claims.userId },
          company: { id: companyId },
          capabilities: requiredCapabilities,
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

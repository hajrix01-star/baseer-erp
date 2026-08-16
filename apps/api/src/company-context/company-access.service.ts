import { Injectable, UnauthorizedException } from "@nestjs/common";
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

@Injectable()
export class CompanyAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: IdentityTokenService,
  ) {}

  async listAvailableCompanies(accessToken: string) {
    const claims = this.verifyAccessToken(accessToken);
    return this.database.inTenantTransaction(
      claims.tenantId,
      async (transaction) => {
        const now = new Date();
        const [user, session, owner] = await Promise.all([
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
        if (owner) {
          return transaction.company
            .findMany({
              where: {
                tenantId: claims.tenantId,
                status: CompanyStatus.ACTIVE,
              },
              orderBy: { nameAr: "asc" },
              take: 250,
              select: { id: true, nameAr: true, nameEn: true },
            })
            .then((companies) =>
              companies.map((company) => ({ ...company, permissionCodes: [] })),
            );
        }
        return transaction.companyMembership
          .findMany({
            where: {
              tenantId: claims.tenantId,
              userId: claims.userId,
              company: { status: CompanyStatus.ACTIVE },
            },
            orderBy: { company: { nameAr: "asc" } },
            take: 250,
            select: {
              company: { select: { id: true, nameAr: true, nameEn: true } },
              role: {
                select: { grants: { select: { permissionCode: true } } },
              },
            },
          })
          .then((memberships) =>
            memberships.map((membership) => ({
              ...membership.company,
              permissionCodes: membership.role.grants.map(
                (grant) => grant.permissionCode,
              ),
            })),
          );
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
  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException("Invalid authentication credentials.");
  }
}

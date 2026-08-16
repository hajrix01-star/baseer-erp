import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { SessionStatus, UserStatus } from "../generated/prisma/client.js";
import { IdentityTokenError, IdentityTokenService } from "../identity/identity-token.service.js";

export type TrustedTenantAdministratorContext = Readonly<{ tenantId: string; actorUserId: string; isOwner: boolean }>;

@Injectable()
export class TenantAdministrationContextService {
  constructor(private readonly database: DatabaseService, private readonly tokens: IdentityTokenService) {}

  async authorize(accessToken: string): Promise<TrustedTenantAdministratorContext> {
    const claims = this.verify(accessToken);
    return this.database.inTenantTransaction(claims.tenantId, async (transaction) => {
      const now = new Date();
      const [user, session, assignment] = await Promise.all([
        transaction.user.findFirst({ where: { id: claims.userId, tenantId: claims.tenantId }, select: { status: true, sessionVersion: true } }),
        transaction.appSession.findFirst({ where: { id: claims.sessionId, tenantId: claims.tenantId, userId: claims.userId }, select: { status: true, sessionVersion: true, expiresAt: true } }),
        transaction.tenantAdministrationAssignment.findFirst({ where: { tenantId: claims.tenantId, userId: claims.userId }, select: { isOwner: true } }),
      ]);
      if (!user || user.status !== UserStatus.ACTIVE || user.sessionVersion !== claims.sessionVersion || !session || session.status !== SessionStatus.ACTIVE || session.sessionVersion !== claims.sessionVersion || session.expiresAt <= now) throw new UnauthorizedException("Invalid authentication credentials.");
      if (!assignment) throw new ForbiddenException("Tenant administration access is not permitted.");
      return { tenantId: claims.tenantId, actorUserId: claims.userId, isOwner: assignment.isOwner };
    });
  }

  async authorizeOwner(accessToken: string): Promise<TrustedTenantAdministratorContext> {
    const context = await this.authorize(accessToken);
    if (!context.isOwner) throw new ForbiddenException("Tenant owner access is not permitted.");
    return context;
  }
  private verify(accessToken: string) {
    try { return this.tokens.verify(accessToken, "access"); }
    catch (error) { if (error instanceof IdentityTokenError) throw new UnauthorizedException("Invalid authentication credentials."); throw error; }
  }
}

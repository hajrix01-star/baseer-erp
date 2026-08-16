import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';
import { Prisma, SessionStatus, UserStatus } from '../generated/prisma/client.js';
import { IdentityTokenError, IdentityTokenService } from './identity-token.service.js';
import { normalizeLoginIdentifier } from './login-identifier.js';
import {
  hashRefreshToken,
  verifyPassword,
  verifyRefreshTokenHash,
} from './password.util.js';

export interface SignInInput {
  tenantCode: string;
  login: string;
  password: string;
  requestId: string;
}

export interface RefreshInput {
  refreshToken: string;
  requestId: string;
}

export interface SignOutInput {
  accessToken: string;
  requestId: string;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    nameAr: string;
    nameEn: string;
    preferredLanguage: string;
  };
  sessionExpiresAt: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: IdentityTokenService,
  ) {}

  async signIn(input: SignInInput): Promise<AuthTokenPair> {
    const tenantCode = this.requiredString(input.tenantCode).trim();
    const loginNormalized = normalizeLoginIdentifier(input.login, input.tenantCode);
    const password = this.requiredString(input.password);
    const requestId = this.requestId(input.requestId);

    // Tenant code is the only tenant locator accepted at this public boundary.
    const tenant = await this.database.client.tenant.findUnique({
      where: { code: tenantCode },
      select: { id: true },
    });
    if (!tenant) {
      throw this.unauthorized();
    }

    return this.database.inTenantTransaction(tenant.id, async (transaction) => {
      const user = await transaction.user.findFirst({
        where: { tenantId: tenant.id, loginNormalized },
      });
      if (!user || user.status !== UserStatus.ACTIVE || !(await verifyPassword(password, user.passwordHash))) {
        throw this.unauthorized();
      }

      const sessionId = randomUUID();
      const tokenSubject = {
        sessionId,
        userId: user.id,
        tenantId: tenant.id,
        sessionVersion: user.sessionVersion,
      };
      const access = this.tokens.issueAccess(tokenSubject);
      const refresh = this.tokens.issueRefresh(tokenSubject);

      await transaction.appSession.create({
        data: {
          id: sessionId,
          tenantId: tenant.id,
          userId: user.id,
          sessionVersion: user.sessionVersion,
          refreshTokenHash: hashRefreshToken(refresh.token),
          status: SessionStatus.ACTIVE,
          expiresAt: new Date(refresh.claims.exp * 1_000),
        },
      });
      await this.writeAuditEvent(transaction, {
        tenantId: tenant.id,
        actorUserId: user.id,
        sessionId,
        sessionVersion: user.sessionVersion,
        requestId,
        action: 'identity.sign_in',
      });

      return this.toTokenPair(access, refresh, user);
    });
  }

  async refresh(input: RefreshInput): Promise<AuthTokenPair> {
    const refreshToken = this.requiredString(input.refreshToken);
    const requestId = this.requestId(input.requestId);
    const claims = this.verify(refreshToken, 'refresh');

    const result = await this.database.inTenantTransaction(claims.tenantId, async (transaction) => {
      const now = new Date();
      const user = await transaction.user.findFirst({
        where: { id: claims.userId, tenantId: claims.tenantId },
      });
      if (!user || user.status !== UserStatus.ACTIVE || user.sessionVersion !== claims.sessionVersion) {
        return null;
      }

      const session = await transaction.appSession.findFirst({
        where: {
          id: claims.sessionId,
          tenantId: claims.tenantId,
          userId: claims.userId,
          sessionVersion: claims.sessionVersion,
          status: SessionStatus.ACTIVE,
        },
      });
      if (!session) {
        return null;
      }
      if (session.expiresAt <= now) {
        await transaction.appSession.updateMany({
          where: { id: session.id, status: SessionStatus.ACTIVE },
          data: { status: SessionStatus.EXPIRED },
        });
        return null;
      }
      if (!verifyRefreshTokenHash(refreshToken, session.refreshTokenHash)) {
        // Returning normally commits the revocation; throwing here would roll it back.
        await this.revokeActiveSession(transaction, session.id, claims.tenantId, claims.userId);
        return null;
      }

      const tokenSubject = {
        sessionId: session.id,
        userId: user.id,
        tenantId: claims.tenantId,
        sessionVersion: user.sessionVersion,
      };
      const access = this.tokens.issueAccess(tokenSubject);
      const nextRefresh = this.tokens.issueRefresh(tokenSubject);
      const rotation = await transaction.appSession.updateMany({
        where: {
          id: session.id,
          tenantId: claims.tenantId,
          userId: user.id,
          sessionVersion: user.sessionVersion,
          status: SessionStatus.ACTIVE,
          expiresAt: { gt: now },
          refreshTokenHash: session.refreshTokenHash,
        },
        data: {
          refreshTokenHash: hashRefreshToken(nextRefresh.token),
          expiresAt: new Date(nextRefresh.claims.exp * 1_000),
        },
      });
      if (rotation.count !== 1) {
        // A lost rotation race is refresh replay: invalidate the session's new token too.
        await this.revokeActiveSession(transaction, session.id, claims.tenantId, claims.userId);
        return null;
      }

      await this.writeAuditEvent(transaction, {
        tenantId: claims.tenantId,
        actorUserId: user.id,
        sessionId: session.id,
        sessionVersion: user.sessionVersion,
        requestId,
        action: 'identity.refresh',
      });
      return this.toTokenPair(access, nextRefresh, user);
    });

    if (!result) {
      throw this.unauthorized();
    }

    return result;
  }

  async signOut(input: SignOutInput): Promise<void> {
    const claims = this.verify(this.requiredString(input.accessToken), 'access');
    const requestId = this.requestId(input.requestId);

    await this.database.inTenantTransaction(claims.tenantId, async (transaction) => {
      const user = await transaction.user.findFirst({
        where: { id: claims.userId, tenantId: claims.tenantId },
      });
      if (!user || user.status !== UserStatus.ACTIVE || user.sessionVersion !== claims.sessionVersion) {
        throw this.unauthorized();
      }

      const revocation = await transaction.appSession.updateMany({
        where: {
          id: claims.sessionId,
          tenantId: claims.tenantId,
          userId: claims.userId,
          sessionVersion: claims.sessionVersion,
          status: SessionStatus.ACTIVE,
        },
        data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
      });
      if (revocation.count !== 1) {
        throw this.unauthorized();
      }

      await this.writeAuditEvent(transaction, {
        tenantId: claims.tenantId,
        actorUserId: user.id,
        sessionId: claims.sessionId,
        sessionVersion: claims.sessionVersion,
        requestId,
        action: 'identity.sign_out',
      });
    });
  }

  private verify(token: string, tokenType: 'access' | 'refresh') {
    try {
      return this.tokens.verify(token, tokenType);
    } catch (error) {
      if (error instanceof IdentityTokenError) {
        throw this.unauthorized();
      }
      throw error;
    }
  }

  private async revokeActiveSession(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await transaction.appSession.updateMany({
      where: { id: sessionId, tenantId, userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  private async writeAuditEvent(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      actorUserId: string;
      sessionId: string;
      sessionVersion: number;
      requestId: string;
      action: 'identity.sign_in' | 'identity.refresh' | 'identity.sign_out';
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: 'AppSession',
        entityId: input.sessionId,
        requestId: input.requestId,
        afterJson: {
          sessionId: input.sessionId,
          sessionVersion: input.sessionVersion,
        },
      },
    });
  }

  private toTokenPair(
    access: ReturnType<IdentityTokenService['issueAccess']>,
    refresh: ReturnType<IdentityTokenService['issueRefresh']>,
    user: {
      id: string;
      nameAr: string;
      nameEn: string;
      preferredLanguage: string;
    },
  ): AuthTokenPair {
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      user: {
        id: user.id,
        nameAr: user.nameAr,
        nameEn: user.nameEn,
        preferredLanguage: user.preferredLanguage,
      },
      sessionExpiresAt: new Date(refresh.claims.exp * 1_000).toISOString(),
    };
  }

  private requestId(value: string): string {
    const requestId = this.requiredString(value).trim();
    if (requestId.length > 120) {
      throw this.unauthorized();
    }

    return requestId;
  }

  private requiredString(value: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw this.unauthorized();
    }

    return value;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException('Invalid authentication credentials.');
  }
}

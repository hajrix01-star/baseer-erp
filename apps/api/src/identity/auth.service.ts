import { Injectable, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service.js";
import {
  Prisma,
  SessionStatus,
  UserStatus,
} from "../generated/prisma/client.js";
import {
  IdentityTokenError,
  IdentityTokenService,
} from "./identity-token.service.js";
import {
  hashPassword,
  hashRefreshToken,
  verifyPassword,
  verifyRefreshTokenHash,
} from "./password.util.js";

export interface SignInInput {
  login: string;
  password: string;
  requestId: string;
}
export interface ActivateOwnerInput {
  email: string;
  activationCode: string;
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

type AuthUser = {
  id: string;
  tenantId: string;
  nameAr: string;
  nameEn: string;
  preferredLanguage: string;
  passwordHash: string;
  status: UserStatus;
  sessionVersion: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: IdentityTokenService,
  ) {}

  /** Resolves a globally unique email/username. No client-selected tenant is accepted. */
  async signIn(input: SignInInput): Promise<AuthTokenPair> {
    const user = await this.resolveActiveUser(input.login);
    return this.database.inTenantTransaction(
      user.tenantId,
      async (transaction) => {
        const liveUser = await transaction.user.findFirst({
          where: { id: user.id, tenantId: user.tenantId },
        });
        if (
          !liveUser ||
          liveUser.status !== UserStatus.ACTIVE ||
          !(await verifyPassword(
            this.requiredString(input.password),
            liveUser.passwordHash,
          ))
        )
          throw this.unauthorized();
        return this.issueSession(
          transaction,
          user.tenantId,
          liveUser,
          this.requestId(input.requestId),
          "identity.sign_in",
        );
      },
    );
  }

  /** One controlled bootstrap only. The code is invalidated atomically after the owner chooses a password. */
  async activateOwner(input: ActivateOwnerInput): Promise<void> {
    const email = this.email(input.email);
    const activationCode = this.requiredString(input.activationCode);
    const password = this.requiredString(input.password);
    const requestId = this.requestId(input.requestId);
    const tenantId = await this.systemTenantId();
    const candidates = await this.database.inTenantTransaction(
      tenantId,
      (transaction) =>
        transaction.user.findMany({
          where: {
            tenantId,
            loginNormalized: email,
            tenantAdministrationAssignments: { some: { isOwner: true } },
          },
          select: { id: true, tenantId: true },
          take: 2,
        }),
    );
    const owner = candidates[0];
    if (candidates.length !== 1 || !owner) throw this.unauthorized();
    await this.database.inTenantTransaction(
      owner.tenantId,
      async (transaction) => {
        const assignment =
          await transaction.tenantAdministrationAssignment.findFirst({
            where: {
              tenantId: owner.tenantId,
              userId: owner.id,
              isOwner: true,
            },
            select: {
              ownerActivationTokenHash: true,
              ownerActivationExpiresAt: true,
            },
          });
        const now = new Date();
        if (
          !assignment?.ownerActivationTokenHash ||
          !assignment.ownerActivationExpiresAt ||
          assignment.ownerActivationExpiresAt <= now ||
          !(await verifyPassword(
            activationCode,
            assignment.ownerActivationTokenHash,
          ))
        )
          throw this.unauthorized();
        const claimed =
          await transaction.tenantAdministrationAssignment.updateMany({
            where: {
              tenantId: owner.tenantId,
              userId: owner.id,
              isOwner: true,
              ownerActivationTokenHash: assignment.ownerActivationTokenHash,
              ownerActivationExpiresAt: { gt: now },
            },
            data: {
              ownerActivationTokenHash: null,
              ownerActivationExpiresAt: null,
            },
          });
        if (claimed.count !== 1) throw this.unauthorized();
        const updated = await transaction.user.update({
          where: { id: owner.id },
          data: {
            passwordHash: await hashPassword(password),
            status: UserStatus.ACTIVE,
            sessionVersion: { increment: 1 },
          },
        });
        await transaction.appSession.updateMany({
          where: {
            tenantId: owner.tenantId,
            userId: owner.id,
            status: SessionStatus.ACTIVE,
          },
          data: { status: SessionStatus.REVOKED, revokedAt: now },
        });
        await this.writeAuditEvent(transaction, {
          tenantId: owner.tenantId,
          actorUserId: owner.id,
          sessionId: owner.id,
          sessionVersion: updated.sessionVersion,
          requestId,
          action: "identity.owner_activated",
        });
      },
    );
  }

  async refresh(input: RefreshInput): Promise<AuthTokenPair> {
    const refreshToken = this.requiredString(input.refreshToken);
    const requestId = this.requestId(input.requestId);
    const claims = this.verify(refreshToken, "refresh");
    const result = await this.database.inTenantTransaction(
      claims.tenantId,
      async (transaction) => {
        const now = new Date();
        const [user, session] = await Promise.all([
          transaction.user.findFirst({
            where: { id: claims.userId, tenantId: claims.tenantId },
          }),
          transaction.appSession.findFirst({
            where: {
              id: claims.sessionId,
              tenantId: claims.tenantId,
              userId: claims.userId,
              sessionVersion: claims.sessionVersion,
              status: SessionStatus.ACTIVE,
            },
          }),
        ]);
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          user.sessionVersion !== claims.sessionVersion ||
          !session
        )
          return null;
        if (session.expiresAt <= now) {
          await transaction.appSession.updateMany({
            where: { id: session.id, status: SessionStatus.ACTIVE },
            data: { status: SessionStatus.EXPIRED },
          });
          return null;
        }
        if (!verifyRefreshTokenHash(refreshToken, session.refreshTokenHash)) {
          await this.revokeActiveSession(
            transaction,
            session.id,
            claims.tenantId,
            claims.userId,
          );
          return null;
        }
        const subject = {
          sessionId: session.id,
          userId: user.id,
          tenantId: claims.tenantId,
          sessionVersion: user.sessionVersion,
        };
        const access = this.tokens.issueAccess(subject);
        const nextRefresh = this.tokens.issueRefresh(subject);
        const rotation = await transaction.appSession.updateMany({
          where: {
            id: session.id,
            tenantId: claims.tenantId,
            userId: claims.userId,
            sessionVersion: claims.sessionVersion,
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
          await this.revokeActiveSession(
            transaction,
            session.id,
            claims.tenantId,
            claims.userId,
          );
          return null;
        }
        await this.writeAuditEvent(transaction, {
          tenantId: claims.tenantId,
          actorUserId: user.id,
          sessionId: session.id,
          sessionVersion: user.sessionVersion,
          requestId,
          action: "identity.refresh",
        });
        return this.toTokenPair(access, nextRefresh, user);
      },
    );
    if (!result) throw this.unauthorized();
    return result;
  }

  async signOut(input: SignOutInput): Promise<void> {
    const claims = this.verify(
      this.requiredString(input.accessToken),
      "access",
    );
    const requestId = this.requestId(input.requestId);
    await this.database.inTenantTransaction(
      claims.tenantId,
      async (transaction) => {
        const user = await transaction.user.findFirst({
          where: { id: claims.userId, tenantId: claims.tenantId },
        });
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          user.sessionVersion !== claims.sessionVersion
        )
          throw this.unauthorized();
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
        if (revocation.count !== 1) throw this.unauthorized();
        await this.writeAuditEvent(transaction, {
          tenantId: claims.tenantId,
          actorUserId: user.id,
          sessionId: claims.sessionId,
          sessionVersion: user.sessionVersion,
          requestId,
          action: "identity.sign_out",
        });
      },
    );
  }

  private async resolveActiveUser(login: string): Promise<AuthUser> {
    const tenantId = await this.systemTenantId();
    const normalized = this.login(login);
    const users = await this.database.inTenantTransaction(
      tenantId,
      (transaction) =>
        transaction.user.findMany({
          where: normalized.includes("@")
            ? { tenantId, loginNormalized: normalized }
            : {
                tenantId,
                OR: [
                  { loginNormalized: `${normalized}@hajrix.com` },
                  { loginNormalized: { startsWith: `${normalized}@`, endsWith: ".baseer.local" } },
                ],
              },
          select: {
            id: true,
            tenantId: true,
            nameAr: true,
            nameEn: true,
            preferredLanguage: true,
            passwordHash: true,
            status: true,
            sessionVersion: true,
          },
          take: 2,
        }),
    );
    const user = users[0];
    if (users.length !== 1 || !user || user.status !== UserStatus.ACTIVE)
      throw this.unauthorized();
    return user;
  }

  /** The private installation owns one internal tenant. It is deployment config, never a browser field. */
  private async systemTenantId(): Promise<string> {
    const code = process.env.BASEER_SYSTEM_TENANT_CODE?.trim();
    if (!code || !/^[A-Za-z0-9._-]{1,64}$/.test(code))
      throw this.unauthorized();
    const tenant = await this.database.client.tenant.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!tenant) throw this.unauthorized();
    return tenant.id;
  }
  private async issueSession(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    user: {
      id: string;
      sessionVersion: number;
      nameAr: string;
      nameEn: string;
      preferredLanguage: string;
    },
    requestId: string,
    action: "identity.sign_in",
  ): Promise<AuthTokenPair> {
    const sessionId = randomUUID();
    const subject = {
      sessionId,
      userId: user.id,
      tenantId,
      sessionVersion: user.sessionVersion,
    };
    const access = this.tokens.issueAccess(subject);
    const refresh = this.tokens.issueRefresh(subject);
    await transaction.appSession.create({
      data: {
        id: sessionId,
        tenantId,
        userId: user.id,
        sessionVersion: user.sessionVersion,
        refreshTokenHash: hashRefreshToken(refresh.token),
        status: SessionStatus.ACTIVE,
        expiresAt: new Date(refresh.claims.exp * 1_000),
      },
    });
    await this.writeAuditEvent(transaction, {
      tenantId,
      actorUserId: user.id,
      sessionId,
      sessionVersion: user.sessionVersion,
      requestId,
      action,
    });
    return this.toTokenPair(access, refresh, user);
  }
  private verify(token: string, tokenType: "access" | "refresh") {
    try {
      return this.tokens.verify(token, tokenType);
    } catch (error) {
      if (error instanceof IdentityTokenError) throw this.unauthorized();
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
      action:
        | "identity.sign_in"
        | "identity.owner_activated"
        | "identity.refresh"
        | "identity.sign_out";
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: "AppSession",
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
    access: ReturnType<IdentityTokenService["issueAccess"]>,
    refresh: ReturnType<IdentityTokenService["issueRefresh"]>,
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
  private login(value: string): string {
    const login = this.requiredString(value)
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("en-US");
    if (
      !/^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?(?:@[^\s@]+\.[^\s@]+)?$/.test(
        login,
      ) ||
      login.length > 254
    )
      throw this.unauthorized();
    return login;
  }
  private email(value: string): string {
    const email = this.login(value);
    if (!email.includes("@")) throw this.unauthorized();
    return email;
  }
  private requestId(value: string): string {
    const requestId = this.requiredString(value).trim();
    if (requestId.length > 120) throw this.unauthorized();
    return requestId;
  }
  private requiredString(value: string): string {
    if (typeof value !== "string" || !value.trim()) throw this.unauthorized();
    return value;
  }
  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException("Invalid authentication credentials.");
  }
}

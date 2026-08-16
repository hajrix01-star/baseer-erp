import {
  correlationIdSchema,
  legacyCompatibleSignInRequestSchema,
  refreshSessionRequestSchema,
  sessionReceiptSchema,
  tenantCodeSchema,
} from '@baseer-erp/contracts';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { RequestContext } from '../observability/request-context.js';

import { AuthService } from './auth.service.js';
import { normalizeLoginIdentifier } from './login-identifier.js';
import { SignInRateLimitService } from './sign-in-rate-limit.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly signInRateLimit: SignInRateLimitService,
  ) {}

  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body() body: unknown,
    @Headers('x-baseer-tenant-code') tenantCode?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    const request = legacyCompatibleSignInRequestSchema.safeParse(body);
    if (!request.success) {
      throw this.unauthorized();
    }

    const normalizedTenantCode = this.tenantCode(tenantCode);
    const normalizedLogin = normalizeLoginIdentifier(request.data.login, normalizedTenantCode);
    const key = this.signInRateLimit.key(normalizedTenantCode, normalizedLogin);
    this.signInRateLimit.assertAllowed(key);
    try {
      const session = await this.auth.signIn({
        tenantCode: normalizedTenantCode,
        login: request.data.login,
        password: request.data.password,
        requestId: this.requestId(requestId),
      });
      this.signInRateLimit.recordSuccess(key);
      return this.sessionReceipt(session);
    } catch (error) {
      if (error instanceof UnauthorizedException) this.signInRateLimit.recordFailure(key);
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Headers('x-request-id') requestId?: string,
  ) {
    const request = refreshSessionRequestSchema.safeParse(body);
    if (!request.success) {
      throw this.unauthorized();
    }

    return this.sessionReceipt(await this.auth.refresh({
      refreshToken: request.data.refreshToken,
      requestId: this.requestId(requestId),
    }));
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(
    @Headers('authorization') authorization?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<void> {
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    if (!match?.[1]) {
      throw this.unauthorized();
    }

    await this.auth.signOut({
      accessToken: match[1],
      requestId: this.requestId(requestId),
    });
  }

  private sessionReceipt(value: unknown) {
    const receipt = sessionReceiptSchema.safeParse(value);
    if (!receipt.success) {
      throw new InternalServerErrorException('Identity response contract violation.');
    }

    return receipt.data;
  }

  private tenantCode(value: string | undefined): string {
    const code = tenantCodeSchema.safeParse(value);
    if (!code.success) {
      throw this.unauthorized();
    }

    return code.data;
  }

  private requestId(value: string | undefined): string {
    const contextual = RequestContext.correlationId();
    if (contextual) return contextual;
    const requestId = correlationIdSchema.safeParse(value);
    return requestId.success ? requestId.data : RequestContext.resolveCorrelationId(undefined);
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException('Invalid authentication credentials.');
  }
}
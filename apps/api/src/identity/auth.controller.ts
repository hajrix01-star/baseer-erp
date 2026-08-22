import {
  activateOwnerRequestSchema,
  correlationIdSchema,
  legacyCompatibleSignInRequestSchema,
  refreshSessionRequestSchema,
  sessionReceiptSchema,
} from "@baseer-erp/contracts";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { RequestContext } from "../observability/request-context.js";
import { AuthService } from "./auth.service.js";
import {
  AUTH_THROTTLE_WINDOW_MS,
  ownerActivationIdentityTracker,
  refreshIdentityTracker,
  signInIdentityTracker,
} from "./auth-throttle-policy.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("sign-in")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    authIp: { limit: 10, ttl: AUTH_THROTTLE_WINDOW_MS, blockDuration: AUTH_THROTTLE_WINDOW_MS },
    authIdentity: {
      limit: 5,
      ttl: AUTH_THROTTLE_WINDOW_MS,
      blockDuration: AUTH_THROTTLE_WINDOW_MS,
      getTracker: signInIdentityTracker,
    },
  })
  async signIn(
    @Body() body: unknown,
    @Headers("x-request-id") requestId?: string,
  ) {
    const request = legacyCompatibleSignInRequestSchema.safeParse(body);
    if (!request.success) throw this.unauthorized();
    return this.sessionReceipt(await this.auth.signIn({
      ...request.data,
      requestId: this.requestId(requestId),
    }));
  }

  @Post("owner/activate")
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    authIp: { limit: 5, ttl: AUTH_THROTTLE_WINDOW_MS, blockDuration: AUTH_THROTTLE_WINDOW_MS },
    authIdentity: {
      limit: 3,
      ttl: AUTH_THROTTLE_WINDOW_MS,
      blockDuration: AUTH_THROTTLE_WINDOW_MS,
      getTracker: ownerActivationIdentityTracker,
    },
  })
  async activateOwner(
    @Body() body: unknown,
    @Headers("x-request-id") requestId?: string,
  ): Promise<void> {
    const request = activateOwnerRequestSchema.safeParse(body);
    if (!request.success) throw this.unauthorized();
    await this.auth.activateOwner({
      ...request.data,
      requestId: this.requestId(requestId),
    });
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    authIp: { limit: 30, ttl: AUTH_THROTTLE_WINDOW_MS, blockDuration: AUTH_THROTTLE_WINDOW_MS },
    authIdentity: {
      limit: 10,
      ttl: AUTH_THROTTLE_WINDOW_MS,
      blockDuration: AUTH_THROTTLE_WINDOW_MS,
      getTracker: refreshIdentityTracker,
    },
  })
  async refresh(
    @Body() body: unknown,
    @Headers("x-request-id") requestId?: string,
  ) {
    const request = refreshSessionRequestSchema.safeParse(body);
    if (!request.success) throw this.unauthorized();
    return this.sessionReceipt(
      await this.auth.refresh({
        refreshToken: request.data.refreshToken,
        requestId: this.requestId(requestId),
      }),
    );
  }

  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @Headers("authorization") authorization?: string,
    @Headers("x-request-id") requestId?: string,
  ): Promise<void> {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) throw this.unauthorized();
    await this.auth.signOut({
      accessToken,
      requestId: this.requestId(requestId),
    });
  }

  private sessionReceipt(value: unknown) {
    const receipt = sessionReceiptSchema.safeParse(value);
    if (!receipt.success)
      throw new InternalServerErrorException(
        "Identity response contract violation.",
      );
    return receipt.data;
  }
  private requestId(value: string | undefined): string {
    const contextual = RequestContext.correlationId();
    if (contextual) return contextual;
    const requestId = correlationIdSchema.safeParse(value);
    return requestId.success
      ? requestId.data
      : RequestContext.resolveCorrelationId(undefined);
  }
  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException("Invalid authentication credentials.");
  }
}

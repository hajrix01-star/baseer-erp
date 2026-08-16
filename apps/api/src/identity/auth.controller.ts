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
} from "@nestjs/common";
import { RequestContext } from "../observability/request-context.js";
import { AuthService } from "./auth.service.js";
import { SignInRateLimitService } from "./sign-in-rate-limit.service.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly signInRateLimit: SignInRateLimitService,
  ) {}

  @Post("sign-in")
  @HttpCode(200)
  async signIn(
    @Body() body: unknown,
    @Headers("x-request-id") requestId?: string,
  ) {
    const request = legacyCompatibleSignInRequestSchema.safeParse(body);
    if (!request.success) throw this.unauthorized();
    const key = this.signInRateLimit.key("global", request.data.login);
    this.signInRateLimit.assertAllowed(key);
    try {
      const session = await this.auth.signIn({
        ...request.data,
        requestId: this.requestId(requestId),
      });
      this.signInRateLimit.recordSuccess(key);
      return this.sessionReceipt(session);
    } catch (error) {
      if (error instanceof UnauthorizedException)
        this.signInRateLimit.recordFailure(key);
      throw error;
    }
  }

  @Post("owner/activate")
  @HttpCode(204)
  async activateOwner(
    @Body() body: unknown,
    @Headers("x-request-id") requestId?: string,
  ): Promise<void> {
    const request = activateOwnerRequestSchema.safeParse(body);
    if (!request.success) throw this.unauthorized();
    const key = this.signInRateLimit.key("owner-bootstrap", request.data.email);
    this.signInRateLimit.assertAllowed(key);
    try {
      await this.auth.activateOwner({
        ...request.data,
        requestId: this.requestId(requestId),
      });
      this.signInRateLimit.recordSuccess(key);
    } catch (error) {
      if (error instanceof UnauthorizedException)
        this.signInRateLimit.recordFailure(key);
      throw error;
    }
  }

  @Post("refresh")
  @HttpCode(200)
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

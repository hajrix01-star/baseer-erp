import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ownerDailyBriefBasiraAnswerReceiptSchema, ownerDailyBriefBasiraAnswerRequestSchema, ownerDailyBriefHistoryQuerySchema, ownerDailyBriefHistoryReceiptSchema, ownerDailyBriefQuerySchema, ownerDailyBriefReceiptSchema } from "@baseer-erp/contracts";

import { TenantAdministrationContextService } from "../administration/tenant-administration-context.service.js";
import { OwnerDailyBriefService } from "./owner-daily-brief.service.js";

/** This endpoint deliberately accepts no company id: the server determines the
 * tenant's active companies after authenticating the tenant owner. */
@Controller("owner/daily-brief")
export class OwnerDailyBriefController {
  constructor(
    private readonly tenantAdministration: TenantAdministrationContextService,
    private readonly ownerDailyBrief: OwnerDailyBriefService,
  ) {}

  @Get("history")
  async history(
    @Query() query: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    const parsed = ownerDailyBriefHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid owner daily brief history query.");
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new UnauthorizedException("Invalid authentication credentials.");
    return ownerDailyBriefHistoryReceiptSchema.parse({
      reports: await this.ownerDailyBrief.history(await this.tenantAdministration.authorizeOwner(token), parsed.data),
    });
  }

  @Get()
  async read(
    @Query() query: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    const parsed = ownerDailyBriefQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid owner daily brief query.");
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new UnauthorizedException("Invalid authentication credentials.");
    return ownerDailyBriefReceiptSchema.parse(
      await this.ownerDailyBrief.read(await this.tenantAdministration.authorizeOwner(token), parsed.data),
    );
  }

  @Post("basira-answers")
  @HttpCode(200)
  async answerWithBasira(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const request = ownerDailyBriefBasiraAnswerRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException("Invalid owner Daily Brief Basira request.");
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new UnauthorizedException("Invalid authentication credentials.");
    return ownerDailyBriefBasiraAnswerReceiptSchema.parse(
      await this.ownerDailyBrief.answerWithBasira(await this.tenantAdministration.authorizeOwner(token), request.data),
    );
  }
}

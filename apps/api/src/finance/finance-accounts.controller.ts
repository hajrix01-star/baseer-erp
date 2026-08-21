import { BadRequestException, Controller, ForbiddenException, Get, Headers, Param, Query, UnauthorizedException } from "@nestjs/common";
import { companyIdSchema, financeAccountMovementQuerySchema, financeAccountMovementReceiptSchema, financeAccountsWorkspaceQuerySchema, financeAccountsWorkspaceReceiptSchema, financeJournalEntryDetailSchema } from "@baseer-erp/contracts";
import { CompanyContextService } from "../company-context/company-context.service.js";
import { FinanceAccountsService } from "./finance-accounts.service.js";

/** A read-only account drill-down, separate from the business-event register. */
@Controller("finance/accounts")
export class FinanceAccountsController {
  constructor(private readonly contexts: CompanyContextService, private readonly accounts: FinanceAccountsService) {}

  @Get()
  async workspace(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = financeAccountsWorkspaceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid finance accounts query.");
    const context = await this.authorize(authorization, companyId);
    return financeAccountsWorkspaceReceiptSchema.parse(await this.accounts.workspace(context, {
      ...(parsed.data.fromBusinessDate ? { from: new Date(`${parsed.data.fromBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.toBusinessDate ? { to: new Date(`${parsed.data.toBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.businessMonths.length ? { businessMonths: parsed.data.businessMonths } : {}),
      ...(parsed.data.q ? { q: parsed.data.q } : {}),
    }));
  }

  @Get("journal-entries/:journalEntryId")
  async journalEntry(@Param("journalEntryId") journalEntryId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    if (!companyIdSchema.safeParse(journalEntryId).success) throw new BadRequestException("Invalid journal entry.");
    return financeJournalEntryDetailSchema.parse(await this.accounts.journalEntry(await this.authorize(authorization, companyId), journalEntryId));
  }

  @Get(":accountId/movements")
  async movements(@Param("accountId") accountId: string, @Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const id = companyIdSchema.safeParse(accountId);
    const parsed = financeAccountMovementQuerySchema.safeParse(query);
    if (!id.success || !parsed.success) throw new BadRequestException("Invalid account movement query.");
    const context = await this.authorize(authorization, companyId);
    return financeAccountMovementReceiptSchema.parse(await this.accounts.movements(context, id.data, {
      ...(parsed.data.fromBusinessDate ? { from: new Date(`${parsed.data.fromBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.toBusinessDate ? { to: new Date(`${parsed.data.toBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.businessMonths.length ? { businessMonths: parsed.data.businessMonths } : {}),
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      pageSize: parsed.data.pageSize,
    }));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new UnauthorizedException("Invalid authentication credentials.");
    const id = companyIdSchema.safeParse(companyId);
    if (!id.success) throw new ForbiddenException("Company finance scope is not permitted.");
    const authorized = await this.contexts.authorize({ accessToken: token, companyId: id.data, requiredCapabilities: ["finance.configuration.read"] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

import { BadRequestException, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Body, Query, UnauthorizedException } from "@nestjs/common";
import { companyIdSchema, createTreasuryReconciliationRequestSchema, financeJournalEntryDetailSchema, reverseTreasuryTransferRequestSchema, reverseTreasuryTransferReceiptSchema, treasuryReconciliationReceiptSchema, treasuryReconciliationsQuerySchema, treasuryReconciliationsReceiptSchema, treasuryTransferRequestSchema, treasuryTransferReceiptSchema, treasuryVaultActivityQuerySchema, treasuryVaultActivityReceiptSchema, treasuryWorkspaceQuerySchema, treasuryWorkspaceReceiptSchema } from "@baseer-erp/contracts";
import { CompanyContextService } from "../company-context/company-context.service.js";
import { FinanceAccountsService } from "./finance-accounts.service.js";
import { TreasuryService } from "./treasury.service.js";

@Controller("finance/treasury")
export class TreasuryController {
  constructor(private readonly contexts: CompanyContextService, private readonly treasury: TreasuryService, private readonly accounts: FinanceAccountsService) {}

  @Get()
  async workspace(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = treasuryWorkspaceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid treasury query.");
    const context = await this.authorize(authorization, companyId, "finance.vaults.read");
    return treasuryWorkspaceReceiptSchema.parse(await this.treasury.workspace(context, {
      ...(parsed.data.fromBusinessDate ? { from: new Date(`${parsed.data.fromBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.toBusinessDate ? { to: new Date(`${parsed.data.toBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.businessMonths.length ? { businessMonths: parsed.data.businessMonths } : {}),
      includeArchived: parsed.data.includeArchived,
    }));
  }

  @Get(":vaultId/activity")
  async activity(@Param("vaultId") vaultId: string, @Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const id = companyIdSchema.safeParse(vaultId);
    const parsed = treasuryVaultActivityQuerySchema.safeParse(query);
    if (!id.success || !parsed.success) throw new BadRequestException("Invalid vault activity query.");
    const context = await this.authorize(authorization, companyId, "finance.vaults.read");
    return treasuryVaultActivityReceiptSchema.parse(await this.treasury.activity(context, id.data, {
      ...(parsed.data.fromBusinessDate ? { from: new Date(`${parsed.data.fromBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.toBusinessDate ? { to: new Date(`${parsed.data.toBusinessDate}T00:00:00.000Z`) } : {}),
      ...(parsed.data.businessMonths.length ? { businessMonths: parsed.data.businessMonths } : {}),
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      pageSize: parsed.data.pageSize,
    }));
  }

  /** The treasury activity link opens the immutable source journal under the same read capability. */
  @Get("journal-entries/:journalEntryId")
  async journalEntry(@Param("journalEntryId") journalEntryId: string, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const id = companyIdSchema.safeParse(journalEntryId);
    if (!id.success) throw new BadRequestException("Invalid journal entry.");
    const context = await this.authorize(authorization, companyId, "finance.vaults.read");
    return financeJournalEntryDetailSchema.parse(await this.accounts.journalEntry(context, id.data));
  }

  @Get("reconciliations")
  async reconciliations(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = treasuryReconciliationsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid treasury-control query.");
    const context = await this.authorize(authorization, companyId, "finance.vaults.read");
    return treasuryReconciliationsReceiptSchema.parse(await this.treasury.reconciliations(context, {
      pageSize: parsed.data.pageSize,
      ...(parsed.data.vaultId ? { vaultId: parsed.data.vaultId } : {}),
      ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    }));
  }

  @Post("transfers")
  @HttpCode(201)
  async transfer(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = treasuryTransferRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid vault transfer request.");
    const context = await this.authorize(authorization, companyId, "finance.vaults.transfer");
    const { notes, ...transfer } = parsed.data;
    return treasuryTransferReceiptSchema.parse(await this.treasury.transfer(context, { ...transfer, ...(notes ? { notes } : {}) }));
  }

  @Post("transfers/reverse")
  async reverseTransfer(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = reverseTreasuryTransferRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid vault-transfer reversal request.");
    const context = await this.authorize(authorization, companyId, "finance.vaults.cancel");
    return reverseTreasuryTransferReceiptSchema.parse(await this.treasury.reverseTransfer(context, parsed.data));
  }

  @Post("reconciliations")
  @HttpCode(201)
  async reconcile(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = createTreasuryReconciliationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid bank reconciliation or cash-count request.");
    const context = await this.authorize(authorization, companyId, "finance.vaults.reconcile");
    const { referenceNumber, notes, ...command } = parsed.data;
    return treasuryReconciliationReceiptSchema.parse(await this.treasury.reconcile(context, {
      ...command,
      ...(referenceNumber ? { referenceNumber } : {}),
      ...(notes ? { notes } : {}),
    }));
  }

  private async authorize(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new UnauthorizedException("Invalid authentication credentials.");
    const id = companyIdSchema.safeParse(companyId);
    if (!id.success) throw new ForbiddenException("Company finance scope is not permitted.");
    const authorized = await this.contexts.authorize({ accessToken: token, companyId: id.data, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

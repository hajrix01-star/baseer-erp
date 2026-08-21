import {
  companyIdSchema,
  correctDailySalesClosingRequestSchema,
  createDailySalesClosingRequestSchema,
  createDailySalesClosingBatchRequestSchema,
  dailySalesCalendarQuerySchema,
  dailySalesCashHandoversReceiptSchema,
  dailySalesEntryDateReceiptSchema,
  dailySalesChannelVaultsReceiptSchema,
  dailySalesShiftSummaryReceiptSchema,
  dailySalesWorkspaceReceiptSchema,
  dailySalesClosingsQuerySchema,
  dailySalesClosingsReceiptSchema,
  dailySalesCalendarReceiptSchema,
  dailySalesClosingReceiptSchema,
  dailySalesClosingBatchReceiptSchema,
  dailySalesClosingReversalReceiptSchema,
  dailySalesClosingPreviewReceiptSchema,
  operationalDayReceiptSchema,
  previewDailySalesClosingRequestSchema,
  reverseDailySalesClosingRequestSchema,
  setOperationalDayRequestSchema,
} from "@baseer-erp/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { CompanyAccessService } from "../company-context/company-access.service.js";
import { TenantAdministrationContextService } from "../administration/tenant-administration-context.service.js";
import { BusinessDateService } from "../business-date/business-date.service.js";
import {
  CASHIER_CLOSING_HISTORY_LIMIT,
  DailySalesReadService,
  FULL_CLOSING_HISTORY_LIMIT,
} from "./daily-sales-read.service.js";
import { DailySalesService } from "./daily-sales.service.js";
import { OperationalCalendarService } from "./operational-calendar.service.js";

const DAILY_SALES_READ_CAPABILITY = "finance.daily_sales.read";
const DAILY_SALES_FULL_HISTORY_CAPABILITY =
  "finance.daily_sales.history.read_all";
const DAILY_SALES_LEGACY_WRITE_CAPABILITY = "finance.daily_sales.write";
const DAILY_SALES_CREATE_CAPABILITY = "finance.daily_sales.create";
const DAILY_SALES_CORRECT_CAPABILITY = "finance.daily_sales.correct";
const DAILY_SALES_REVERSE_CAPABILITY = "finance.daily_sales.reverse";
const OPERATIONAL_CALENDAR_MANAGE_CAPABILITY =
  "finance.operational_calendar.manage";

/**
 * Narrow operational commands only. This controller deliberately exposes no
 * manual journal operation and accepts company scope only through live context.
 */
@Controller("finance")
export class DailySalesController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly tenantAdministration: TenantAdministrationContextService,
    private readonly companyAccess: CompanyAccessService,
    private readonly dailySales: DailySalesService,
    private readonly reads: DailySalesReadService,
    private readonly calendar: OperationalCalendarService,
    private readonly businessDates: BusinessDateService,
  ) {}

  @Get("daily-sales/workspace")
  async getWorkspace(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const parsed = dailySalesClosingsQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException("Invalid daily-sales workspace query.");
    const context = await this.authorize(
      authorization,
      companyId,
      DAILY_SALES_READ_CAPABILITY,
    );
    const accessToken = this.accessToken(authorization);
    const fullHistory = await this.canReadFullClosingHistory(
      authorization,
      companyId,
    );
    const historyLimit = fullHistory
      ? FULL_CLOSING_HISTORY_LIMIT
      : CASHIER_CLOSING_HISTORY_LIMIT;
    const pageSize = Math.min(parsed.data.pageSize, historyLimit);
    const [vaults, closingPage, entryDate, companies, managementReports] =
      await Promise.all([
        this.reads.listChannelVaults(context),
        this.reads.listClosings(context, parsed.data, { pageSize, ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}) }),
        this.businessDates.currentForTrustedContext(context),
        this.companyAccess.listAvailableCompanies(accessToken),
        fullHistory
          ? Promise.all([
              this.reads.listCashHandovers(context, parsed.data),
              this.reads.listShiftSummary(context, parsed.data),
            ])
          : Promise.resolve(null),
      ]);
    const activeCompany = companies.find(
      (company) => company.id === context.companyId,
    );
    if (!activeCompany)
      throw new ForbiddenException("Company finance scope is not permitted.");
    return dailySalesWorkspaceReceiptSchema.parse({
      companyId: context.companyId,
      fromBusinessDate: parsed.data.fromBusinessDate,
      toBusinessDate: parsed.data.toBusinessDate,
      permissionCodes: activeCompany.permissionCodes,
      ownerCanCorrect: await this.isOwner(authorization, context),
      entryDate: {
        businessDate: entryDate.businessDate,
        timezone: entryDate.timezone,
      },
      vaults,
      historyLimit: pageSize,
      closings: closingPage.closings,
      hasMore: closingPage.hasMore,
      nextCursor: closingPage.nextCursor,
      cashHandovers: managementReports?.[0] ?? {
        totalCashHandoverAmount: "0.0000",
        recordCount: 0,
        handovers: [],
      },
      shifts: managementReports?.[1] ?? [],
    });
  }
  @Get("daily-sales/closings")
  async getClosings(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const parsed = dailySalesClosingsQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException("Invalid daily-sales closings query.");
    const context = await this.authorize(
      authorization,
      companyId,
      DAILY_SALES_READ_CAPABILITY,
    );
    const fullHistory = await this.canReadFullClosingHistory(
      authorization,
      companyId,
    );
    const historyLimit = fullHistory
      ? FULL_CLOSING_HISTORY_LIMIT
      : CASHIER_CLOSING_HISTORY_LIMIT;
    const pageSize = Math.min(parsed.data.pageSize, historyLimit);
    const closingPage = await this.reads.listClosings(context, parsed.data, {
      pageSize,
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    });
    return dailySalesClosingsReceiptSchema.parse({
      companyId: context.companyId,
      fromBusinessDate: parsed.data.fromBusinessDate,
      toBusinessDate: parsed.data.toBusinessDate,
      historyLimit: pageSize,
      closings: closingPage.closings,
      hasMore: closingPage.hasMore,
      nextCursor: closingPage.nextCursor,
    });
  }

  @Get("daily-sales/cash-handovers")
  async getCashHandovers(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const parsed = dailySalesClosingsQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException("Invalid cash-handover query.");
    const context = await this.authorize(
      authorization,
      companyId,
      DAILY_SALES_FULL_HISTORY_CAPABILITY,
    );
    const handovers = await this.reads.listCashHandovers(context, parsed.data);
    return dailySalesCashHandoversReceiptSchema.parse({
      companyId: context.companyId,
      fromBusinessDate: parsed.data.fromBusinessDate,
      toBusinessDate: parsed.data.toBusinessDate,
      ...handovers,
    });
  }

  @Get("daily-sales/shift-summary")
  async getShiftSummary(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const parsed = dailySalesClosingsQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException("Invalid daily-sales shift-summary query.");
    const context = await this.authorize(
      authorization,
      companyId,
      DAILY_SALES_FULL_HISTORY_CAPABILITY,
    );
    return dailySalesShiftSummaryReceiptSchema.parse({
      companyId: context.companyId,
      fromBusinessDate: parsed.data.fromBusinessDate,
      toBusinessDate: parsed.data.toBusinessDate,
      shifts: await this.reads.listShiftSummary(context, parsed.data),
    });
  }

  @Get("daily-sales/channel-vaults")
  async getChannelVaults(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const context = await this.authorize(
      authorization,
      companyId,
      DAILY_SALES_READ_CAPABILITY,
    );
    return dailySalesChannelVaultsReceiptSchema.parse({
      companyId: context.companyId,
      vaults: await this.reads.listChannelVaults(context),
    });
  }
  @Get("daily-sales/entry-date")
  async getEntryDate(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const context = await this.authorize(authorization, companyId, [
      DAILY_SALES_CREATE_CAPABILITY,
      DAILY_SALES_LEGACY_WRITE_CAPABILITY,
    ]);
    const current = await this.businessDates.currentForTrustedContext(context);
    return dailySalesEntryDateReceiptSchema.parse({
      companyId: context.companyId,
      businessDate: current.businessDate,
      timezone: current.timezone,
    });
  }

  @Post("daily-sales/closings/preview")
  @HttpCode(200)
  async previewClosing(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = previewDailySalesClosingRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException(
        "Invalid daily-sales closing preview request.",
      );
    const context = await this.authorize(authorization, companyId, [
      DAILY_SALES_CREATE_CAPABILITY,
      DAILY_SALES_LEGACY_WRITE_CAPABILITY,
    ]);
    return dailySalesClosingPreviewReceiptSchema.parse(
      await this.dailySales.preview({
        context,
        request: {
          businessDate: request.data.businessDate,
          scope: request.data.scope,
          customerCount: request.data.customerCount,
          allocations: request.data.allocations,
          ...(request.data.cashHandoverAmount === undefined
            ? {}
            : { cashHandoverAmount: request.data.cashHandoverAmount }),
          ...(request.data.notes === undefined
            ? {}
            : { notes: request.data.notes }),
        },
      }),
    );
  }
  @Post("daily-sales/closings/batch")
  @HttpCode(201)
  async createClosingBatch(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createDailySalesClosingBatchRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException("Invalid daily-sales batch request.");
    const context = await this.authorize(authorization, companyId, [
      DAILY_SALES_CREATE_CAPABILITY,
      DAILY_SALES_LEGACY_WRITE_CAPABILITY,
    ]);
    return dailySalesClosingBatchReceiptSchema.parse(
      await this.dailySales.createBatch({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: {
          businessDate: request.data.businessDate,
          entries: request.data.entries.map((entry) => ({
            scope: entry.scope,
            customerCount: entry.customerCount,
            allocations: entry.allocations,
            ...(entry.cashHandoverAmount === undefined
              ? {}
              : { cashHandoverAmount: entry.cashHandoverAmount }),
            ...(entry.notes === undefined ? {} : { notes: entry.notes }),
          })),
        },
      }),
    );
  }
  @Post("daily-sales/closings")
  @HttpCode(201)
  async createClosing(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createDailySalesClosingRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException("Invalid daily-sales closing request.");
    const context = await this.authorize(authorization, companyId, [
      DAILY_SALES_CREATE_CAPABILITY,
      DAILY_SALES_LEGACY_WRITE_CAPABILITY,
    ]);
    return dailySalesClosingReceiptSchema.parse(
      await this.dailySales.create({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: {
          businessDate: request.data.businessDate,
          scope: request.data.scope,
          customerCount: request.data.customerCount,
          allocations: request.data.allocations,
          ...(request.data.cashHandoverAmount === undefined
            ? {}
            : { cashHandoverAmount: request.data.cashHandoverAmount }),
          ...(request.data.notes === undefined
            ? {}
            : { notes: request.data.notes }),
        },
      }),
    );
  }

  @Post("daily-sales/closings/correct")
  @HttpCode(200)
  async correctClosing(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    // Authorize first so an untrusted caller cannot distinguish command-shape
    // details from a privileged correction endpoint.
    const context = await this.authorizeOwner(authorization, companyId);
    const request = correctDailySalesClosingRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException("Invalid daily-sales correction request.");
    return dailySalesClosingReceiptSchema.parse(
      await this.dailySales.correct({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: {
          closingId: request.data.closingId,
          businessDate: request.data.businessDate,
          customerCount: request.data.customerCount,
          allocations: request.data.allocations,
          ...(request.data.cashHandoverAmount === undefined
            ? {}
            : { cashHandoverAmount: request.data.cashHandoverAmount }),
          ...(request.data.notes === undefined
            ? {}
            : { notes: request.data.notes }),
        },
      }),
    );
  }

  @Post("daily-sales/closings/reverse")
  @HttpCode(200)
  async reverseClosing(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = reverseDailySalesClosingRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException("Invalid daily-sales reversal request.");
    const context = await this.authorize(authorization, companyId, [
      DAILY_SALES_REVERSE_CAPABILITY,
      DAILY_SALES_LEGACY_WRITE_CAPABILITY,
    ]);
    return dailySalesClosingReversalReceiptSchema.parse(
      await this.dailySales.reverse({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: {
          closingId: request.data.closingId,
          businessDate: request.data.businessDate,
          reason: request.data.reason,
        },
      }),
    );
  }

  @Post("operational-calendar/days")
  @HttpCode(200)
  async setOperationalDay(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = setOperationalDayRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException("Invalid operational-calendar request.");
    const context = await this.authorize(authorization, companyId, [
      OPERATIONAL_CALENDAR_MANAGE_CAPABILITY,
      DAILY_SALES_LEGACY_WRITE_CAPABILITY,
    ]);
    return operationalDayReceiptSchema.parse(
      await this.calendar.setDay({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: {
          businessDate: request.data.businessDate,
          status: request.data.status,
          ...(request.data.source === undefined
            ? {}
            : { source: request.data.source }),
          ...(request.data.note === undefined
            ? {}
            : { note: request.data.note }),
        },
      }),
    );
  }

  @Get("operational-calendar")
  async getOperationalCalendar(
    @Query() query: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const parsed = dailySalesCalendarQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException("Invalid operational-calendar query.");
    const context = await this.authorize(
      authorization,
      companyId,
      DAILY_SALES_READ_CAPABILITY,
    );
    return dailySalesCalendarReceiptSchema.parse({
      companyId: context.companyId,
      fromBusinessDate: parsed.data.fromBusinessDate,
      toBusinessDate: parsed.data.toBusinessDate,
      days: await this.calendar.listCalendar(context, parsed.data),
    });
  }

  private async canReadFullClosingHistory(
    authorization: string | undefined,
    companyId: string | undefined,
  ) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!accessToken || !parsedCompanyId.success) return false;
    try {
      await this.companyContext.authorize({
        accessToken,
        companyId: parsedCompanyId.data,
        requiredCapabilities: [DAILY_SALES_FULL_HISTORY_CAPABILITY],
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async authorizeOwner(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = this.accessToken(authorization);
    const owner = await this.tenantAdministration.authorizeOwner(accessToken);
    const context = await this.authorize(authorization, companyId, DAILY_SALES_CORRECT_CAPABILITY);
    if (owner.tenantId !== context.tenantId || owner.actorUserId !== context.actorUserId)
      throw new ForbiddenException("Tenant owner access is not permitted.");
    return context;
  }

  private async isOwner(authorization: string | undefined, context: { tenantId: string; actorUserId: string }) {
    try {
      const owner = await this.tenantAdministration.authorizeOwner(this.accessToken(authorization));
      return owner.tenantId === context.tenantId && owner.actorUserId === context.actorUserId;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private accessToken(authorization: string | undefined): string {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken)
      throw new UnauthorizedException("Invalid authentication credentials.");
    return accessToken;
  }
  private async authorize(
    authorization: string | undefined,
    companyId: string | undefined,
    capabilities: string | readonly string[],
  ) {
    const accessToken = this.accessToken(authorization);
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success)
      throw new ForbiddenException("Company finance scope is not permitted.");

    const acceptedCapabilities = Array.isArray(capabilities)
      ? capabilities
      : [capabilities];
    let authorized: Awaited<
      ReturnType<CompanyContextService["authorize"]>
    > | null = null;
    for (const capability of acceptedCapabilities) {
      try {
        authorized = await this.companyContext.authorize({
          accessToken,
          companyId: parsedCompanyId.data,
          requiredCapabilities: [capability],
        });
        break;
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    if (!authorized)
      throw new ForbiddenException("Company finance scope is not permitted.");
    return {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
  }
}

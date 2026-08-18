import { BadRequestException, Controller, ForbiddenException, Get, Headers, Query, UnauthorizedException } from "@nestjs/common";
import { companyIdSchema, financeInvoiceRegisterQuerySchema, financeInvoiceRegisterReceiptSchema } from "@baseer-erp/contracts";
import { CompanyContextService } from "../company-context/company-context.service.js";
import { InvoiceRegisterService } from "./invoice-register.service.js";

@Controller("finance/invoice-register")
export class InvoiceRegisterController {
  constructor(private readonly contexts: CompanyContextService, private readonly register: InvoiceRegisterService) {}
  @Get()
  async workspace(@Query() query: unknown, @Headers("authorization") authorization?: string, @Headers("x-baseer-company-id") companyId?: string) {
    const parsed = financeInvoiceRegisterQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid invoice-register query.");
    const context = await this.authorize(authorization, companyId);
    const months = parsed.data.businessMonths?.split(",") ?? [];
    const kinds = parsed.data.kinds?.split(",") as ("SALE" | "PURCHASE" | "EXPENSE" | "OBLIGATION" | "OTHER")[] | undefined;
    const supplierIds = parsed.data.supplierIds?.split(",") ?? [];
    const categoryIds = parsed.data.categoryIds?.split(",") ?? [];
    const statuses = parsed.data.statuses?.split(",") as ("POSTED" | "CANCELLED")[] | undefined;
    return financeInvoiceRegisterReceiptSchema.parse(await this.register.workspace(context, { ...(parsed.data.fromBusinessDate ? { from: new Date(`${parsed.data.fromBusinessDate}T00:00:00.000Z`) } : {}), ...(parsed.data.toBusinessDate ? { to: new Date(`${parsed.data.toBusinessDate}T00:00:00.000Z`) } : {}), businessMonths: months, kinds: kinds ?? [], supplierIds, categoryIds, statuses: statuses ?? [], ...(parsed.data.q ? { q: parsed.data.q } : {}), ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}), pageSize: parsed.data.pageSize }));
  }
  private async authorize(authorization: string | undefined, companyId: string | undefined) {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]; if (!token) throw new UnauthorizedException("Invalid authentication credentials.");
    const id = companyIdSchema.safeParse(companyId); if (!id.success) throw new ForbiddenException("Company finance scope is not permitted.");
    const authorized = await this.contexts.authorize({ accessToken: token, companyId: id.data, requiredCapabilities: ["finance.purchase_expense.read"] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

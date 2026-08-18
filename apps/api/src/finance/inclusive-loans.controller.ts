import {
  companyIdSchema,
  createOpeningInclusiveLoanRequestSchema,
  recordInclusiveLoanRepaymentRequestSchema,
  reverseInclusiveLoanRepaymentRequestSchema,
  inclusiveLoanOpeningReceiptSchema,
  inclusiveLoanRepaymentReceiptSchema,
  inclusiveLoansReceiptSchema,
} from "@baseer-erp/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Get,
  Post,
  UnauthorizedException,
} from "@nestjs/common";

import { CompanyContextService } from "../company-context/company-context.service.js";
import { InclusiveLoanRepaymentService } from "./inclusive-loan-repayment.service.js";
import { InclusiveLoanService } from "./inclusive-loan.service.js";

const LOANS_READ_CAPABILITY = "finance.loans.read";
const LOANS_WRITE_CAPABILITY = "finance.loans.write";

@Controller("finance/inclusive-loans")
export class InclusiveLoansController {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly loans: InclusiveLoanService,
    private readonly repayments: InclusiveLoanRepaymentService,
  ) {}

  @Get()
  async list(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const context = await this.authorize(authorization, companyId, LOANS_READ_CAPABILITY);
    return inclusiveLoansReceiptSchema.parse({
      companyId: context.companyId,
      loans: await this.loans.list(context),
    });
  }
  @Post()
  @HttpCode(201)
  async createOpening(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = createOpeningInclusiveLoanRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException("Invalid inclusive-loan opening request.");
    const context = await this.authorize(authorization, companyId);
    return inclusiveLoanOpeningReceiptSchema.parse(
      await this.loans.createOpeningLoan({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: {
          sourceDocumentNumber: request.data.sourceDocumentNumber,
          originalAmount: request.data.originalAmount,
          openingOutstandingAmount: request.data.openingOutstandingAmount,
          installmentAmount: request.data.installmentAmount,
          termMonths: request.data.termMonths,
          firstInstallmentDueDate: request.data.firstInstallmentDueDate,
          openingBusinessDate: request.data.openingBusinessDate,
          ...(request.data.notes ? { notes: request.data.notes } : {}),
        },
      }),
    );
  }

  @Post("repayments")
  @HttpCode(201)
  async recordRepayment(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = recordInclusiveLoanRepaymentRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException(
        "Invalid inclusive-loan repayment request.",
      );
    const context = await this.authorize(authorization, companyId);
    return inclusiveLoanRepaymentReceiptSchema.parse(
      await this.repayments.recordRepayment({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: request.data,
      }),
    );
  }

  @Post("repayments/reverse")
  @HttpCode(201)
  async reverseRepayment(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const request = reverseInclusiveLoanRepaymentRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException(
        "Invalid inclusive-loan repayment reversal request.",
      );
    const context = await this.authorize(authorization, companyId);
    return inclusiveLoanRepaymentReceiptSchema.parse(
      await this.repayments.reverseRepayment({
        context,
        idempotencyKey: request.data.idempotencyKey,
        request: request.data,
      }),
    );
  }

  private async authorize(
    authorization: string | undefined,
    companyId: string | undefined,
    capability = LOANS_WRITE_CAPABILITY,
  ) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken)
      throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success)
      throw new ForbiddenException("Company finance scope is not permitted.");
    const authorized = await this.companyContext.authorize({
      accessToken,
      companyId: parsedCompanyId.data,
      requiredCapabilities: [capability],
    });
    return {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
  }
}

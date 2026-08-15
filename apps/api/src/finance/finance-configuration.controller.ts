import {
  companyIdSchema,
  financeConfigurationReceiptSchema,
} from "@baseer-erp/contracts";
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";

import { FinanceConfigurationService } from "./finance-configuration.service.js";

@Controller("finance/configuration")
export class FinanceConfigurationController {
  constructor(private readonly configuration: FinanceConfigurationService) {}

  @Get()
  async read(
    @Headers("authorization") authorization?: string,
    @Headers("x-baseer-company-id") companyId?: string,
  ) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken)
      throw new UnauthorizedException("Invalid authentication credentials.");
    const parsedCompanyId = companyIdSchema.safeParse(companyId);
    if (!parsedCompanyId.success)
      throw new ForbiddenException("Company finance scope is not permitted.");
    return financeConfigurationReceiptSchema.parse(
      await this.configuration.read({
        accessToken,
        companyId: parsedCompanyId.data,
      }),
    );
  }
}

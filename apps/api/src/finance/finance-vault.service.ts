import { BadRequestException, Injectable } from '@nestjs/common';

import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceVaultStatus,
  type Prisma,
} from '../generated/prisma/client.js';

@Injectable()
export class FinanceVaultService {
  async assertActivePaymentDestination(
    transaction: Prisma.TransactionClient,
    input: { tenantId: string; companyId: string; vaultId: string },
  ): Promise<{ id: string; accountId: string }> {
    const vault = await transaction.financeVault.findFirst({
      where: {
        id: input.vaultId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceVaultStatus.ACTIVE,
        isPaymentDestination: true,
        account: { type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE },
      },
      select: { id: true, accountId: true },
    });
    if (!vault) throw new BadRequestException('The selected payment destination is not active for this company.');
    return vault;
  }
}

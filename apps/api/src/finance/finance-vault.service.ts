import { BadRequestException, Injectable } from '@nestjs/common';

import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceVaultPaymentMethod,
  FinanceVaultStatus,
  type Prisma,
} from '../generated/prisma/client.js';

@Injectable()
export class FinanceVaultService {
  async assertActiveVault(
    transaction: Prisma.TransactionClient,
    input: { tenantId: string; companyId: string; vaultId: string },
  ): Promise<{ id: string; accountId: string; paymentMethod: FinanceVaultPaymentMethod; paymentMethods: FinanceVaultPaymentMethod[] }> {
    const vault = await transaction.financeVault.findFirst({
      where: { id: input.vaultId, tenantId: input.tenantId, companyId: input.companyId, status: FinanceVaultStatus.ACTIVE, account: { type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE } },
      select: { id: true, accountId: true, paymentMethod: true, paymentMethods: true },
    });
    if (!vault) throw new BadRequestException("The selected vault is not active for this company.");
    return vault;
  }
  async assertActiveSalesChannel(
    transaction: Prisma.TransactionClient,
    input: { tenantId: string; companyId: string; vaultId: string },
  ): Promise<{ id: string; accountId: string; paymentMethod: FinanceVaultPaymentMethod }> {
    const vault = await transaction.financeVault.findFirst({
      where: {
        id: input.vaultId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceVaultStatus.ACTIVE,
        isSalesChannel: true,
        account: { type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE },
      },
      select: { id: true, accountId: true, paymentMethod: true },
    });
    if (!vault) throw new BadRequestException('The selected sales channel is not active for this company.');
    return vault;
  }

  async assertActiveCashObservationVault(
    transaction: Prisma.TransactionClient,
    input: { tenantId: string; companyId: string; vaultId: string },
  ): Promise<{ id: string }> {
    const vault = await transaction.financeVault.findFirst({
      where: {
        id: input.vaultId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceVaultStatus.ACTIVE,
        type: 'CASH',
        account: { type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE },
      },
      select: { id: true },
    });
    if (!vault) throw new BadRequestException('The selected cash-observation vault is not active for this company.');
    return vault;
  }
  async assertActivePaymentDestination(
    transaction: Prisma.TransactionClient,
    input: { tenantId: string; companyId: string; vaultId: string },
  ): Promise<{ id: string; accountId: string; paymentMethod: FinanceVaultPaymentMethod; paymentMethods: FinanceVaultPaymentMethod[] }> {
    const vault = await transaction.financeVault.findFirst({
      where: {
        id: input.vaultId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceVaultStatus.ACTIVE,
        isPaymentDestination: true,
        account: { type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE },
      },
      select: { id: true, accountId: true, paymentMethod: true, paymentMethods: true },
    });
    if (!vault) throw new BadRequestException('The selected payment destination is not active for this company.');
    return vault;
  }
}

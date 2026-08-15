import { ConflictException, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  FinanceSupplierDueStatus,
  Prisma,
} from "../generated/prisma/client.js";

export type SupplierDueHistoryInput = Readonly<{
  status?: FinanceSupplierDueStatus;
  supplierId?: string;
}>;

@Injectable()
export class SupplierDueQueriesService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    context: TrustedCompanyActorContext,
    input: SupplierDueHistoryInput,
  ) {
    return this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        const dues = await transaction.financeSupplierDue.findMany({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            ...(input.status ? { status: input.status } : {}),
            ...(input.supplierId ? { supplierId: input.supplierId } : {}),
          },
          select: {
            id: true,
            supplierId: true,
            categoryId: true,
            sourceDocumentNumber: true,
            originalBusinessDate: true,
            dueDate: true,
            originalAmount: true,
            paidAmount: true,
            remainingAmount: true,
            status: true,
            supplier: { select: { nameAr: true, nameEn: true } },
            category: { select: { code: true, nameAr: true } },
            payments: {
              select: {
                id: true,
                vaultId: true,
                businessDate: true,
                amount: true,
                status: true,
                journalEntryId: true,
              },
              orderBy: [{ businessDate: "asc" }, { id: "asc" }],
              take: 10_000,
            },
          },
          orderBy: [{ originalBusinessDate: "desc" }, { id: "desc" }],
          take: 10_000,
        });
        return dues.map((due) => {
          if (!due.category)
            throw new ConflictException(
              "A supplier due is missing its category history.",
            );
          return {
            id: due.id,
            supplierId: due.supplierId,
            supplierNameAr: due.supplier.nameAr,
            supplierNameEn: due.supplier.nameEn,
            categoryId: due.categoryId,
            categoryCode: due.category.code,
            categoryNameAr: due.category.nameAr,
            sourceDocumentNumber: due.sourceDocumentNumber,
            originalBusinessDate: due.originalBusinessDate,
            dueDate: due.dueDate,
            originalAmount: due.originalAmount.toFixed(4),
            paidAmount: due.paidAmount.toFixed(4),
            remainingAmount: due.remainingAmount.toFixed(4),
            status: due.status,
            payments: due.payments.map((payment) => ({
              id: payment.id,
              vaultId: payment.vaultId,
              businessDate: payment.businessDate,
              amount: payment.amount.toFixed(4),
              status: payment.status,
              journalEntryId: payment.journalEntryId,
            })),
          };
        });
      },
    );
  }
}

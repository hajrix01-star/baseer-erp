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
  cursor?: string;
  pageSize: number;
}>;

export type SupplierDuePaymentHistoryInput = Readonly<{
  cursor?: string;
  pageSize: number;
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
        const baseWhere: Prisma.FinanceSupplierDueWhereInput = {
            tenantId: context.tenantId,
            companyId: context.companyId,
            ...(input.status ? { status: input.status } : {}),
            ...(input.supplierId ? { supplierId: input.supplierId } : {}),
          };
        const cursor = input.cursor
          ? await transaction.financeSupplierDue.findFirst({
              where: { ...baseWhere, id: input.cursor },
              select: { id: true, originalBusinessDate: true },
            })
          : null;
        if (input.cursor && !cursor)
          throw new ConflictException(
            "The supplier-due history cursor is no longer valid.",
          );
        const dues = await transaction.financeSupplierDue.findMany({
          where: cursor
            ? {
                ...baseWhere,
                OR: [
                  { originalBusinessDate: { lt: cursor.originalBusinessDate } },
                  {
                    originalBusinessDate: cursor.originalBusinessDate,
                    id: { lt: cursor.id },
                  },
                ],
              }
            : baseWhere,
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
            _count: { select: { payments: true } },
          },
          orderBy: [{ originalBusinessDate: "desc" }, { id: "desc" }],
          take: input.pageSize + 1,
        });
        const hasMore = dues.length > input.pageSize;
        const page = hasMore ? dues.slice(0, input.pageSize) : dues;
        const nextCursor = hasMore ? page.at(-1)?.id ?? null : null;
        return {
          dues: page.map((due) => {
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
            paymentCount: due._count.payments,
          };
          }),
          hasMore,
          nextCursor,
        };
      },
    );
  }

  async listPayments(
    context: TrustedCompanyActorContext,
    dueId: string,
    input: SupplierDuePaymentHistoryInput,
  ) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const due = await transaction.financeSupplierDue.findFirst({
        where: { id: dueId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true },
      });
      if (!due) throw new ConflictException("The supplier due was not found.");
      const cursor = input.cursor
        ? await transaction.financeSupplierDuePayment.findFirst({
            where: { id: input.cursor, tenantId: context.tenantId, companyId: context.companyId, dueId },
            select: { id: true, businessDate: true },
          })
        : null;
      if (input.cursor && !cursor)
        throw new ConflictException("The supplier-due payment cursor is no longer valid.");
      const payments = await transaction.financeSupplierDuePayment.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          dueId,
          ...(cursor
            ? {
                OR: [
                  { businessDate: { lt: cursor.businessDate } },
                  { businessDate: cursor.businessDate, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        select: { id: true, vaultId: true, businessDate: true, amount: true, status: true, journalEntryId: true },
        orderBy: [{ businessDate: "desc" }, { id: "desc" }],
        take: input.pageSize + 1,
      });
      const hasMore = payments.length > input.pageSize;
      const page = hasMore ? payments.slice(0, input.pageSize) : payments;
      return {
        dueId: due.id,
        payments: page.map((payment) => ({
          id: payment.id,
          vaultId: payment.vaultId,
          businessDate: payment.businessDate,
          amount: payment.amount.toFixed(4),
          status: payment.status,
          journalEntryId: payment.journalEntryId,
        })),
        hasMore,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      };
    });
  }
}

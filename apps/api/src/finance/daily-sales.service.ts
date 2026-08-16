import { ConflictException, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { DailySalesPostingService } from "./daily-sales-posting.service.js";
import { DailySalesCommandSupportService } from "./daily-sales-command-support.service.js";
import { DailySalesWriteService } from "./daily-sales-write.service.js";
import type {
  CreateDailySalesClosingRequest,
  CreateDailySalesClosingBatchRequest,
  CorrectDailySalesClosingRequest,
  DailySalesClosingPreview,
  DailySalesClosingReceipt,
  DailySalesClosingBatchReceipt,
  DailySalesClosingReversalReceipt,
  DailySalesCommand,
  ReverseDailySalesClosingRequest,
} from "./daily-sales.types.js";

export type {
  DailySalesAllocationInput,
  DailySalesFields,
  CreateDailySalesClosingRequest,
  CreateDailySalesClosingBatchRequest,
  CorrectDailySalesClosingRequest,
  ReverseDailySalesClosingRequest,
  DailySalesCommand,
  DailySalesClosingPreview,
  DailySalesClosingReceipt,
  DailySalesClosingBatchReceipt,
  DailySalesClosingReversalReceipt,
} from "./daily-sales.types.js";

const CREATE_CLOSING_OPERATION = "finance.daily_sales.create";
const CORRECT_CLOSING_OPERATION = "finance.daily_sales.correct";
const REVERSE_CLOSING_OPERATION = "finance.daily_sales.reverse";

/** Coordinates transaction, idempotency and the dedicated daily-sales writers. */
@Injectable()
export class DailySalesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly posting: DailySalesPostingService,
    private readonly support: DailySalesCommandSupportService,
    private readonly writes: DailySalesWriteService,
  ) {}
  async preview(
    input: Readonly<{
      context: TrustedCompanyActorContext;
      request: CreateDailySalesClosingRequest;
    }>,
  ): Promise<DailySalesClosingPreview> {
    return this.database.inTenantTransaction(
      input.context.tenantId,
      async (transaction) => {
        const fields = await this.posting.validateFields(
          transaction,
          input.context,
          input.request,
        );
        await this.posting.assertOpenPeriodAndNotFuture(
          transaction,
          input.context,
          fields.businessDate,
        );
        const accounting = await this.posting.resolveAccounting(
          transaction,
          input.context,
          fields.grossAmount,
        );
        return {
          grossAmount: fields.grossAmount.toFixed(4),
          netAmount: accounting.netAmount.toFixed(4),
          vatAmount: accounting.vatAmount.toFixed(4),
          vatRateBasisPoints: accounting.vatRateBasisPoints,
        };
      },
    );
  }
  async create(
    command: DailySalesCommand<CreateDailySalesClosingRequest>,
  ): Promise<DailySalesClosingReceipt> {
    return this.database.inTenantTransaction(
      command.context.tenantId,
      async (transaction) => {
        const begun = await this.support.begin(
          transaction,
          command.context,
          CREATE_CLOSING_OPERATION,
          command.idempotencyKey,
          this.support.requestForCreate(command.request),
        );
        if (begun.kind === "replay")
          return this.support.hydrateReceipt(begun.response.body);
        if (begun.kind === "in-progress")
          throw new ConflictException(
            "The daily-sales request is still in progress.",
          );
        const receipt = await this.writes.createInTransaction(
          transaction,
          command.context,
          command.request,
          this.support.requestId(),
        );
        await this.support.complete(transaction, command.context, {
          receiptId: begun.receiptId,
          response: {
            status: 201,
            headers: null,
            body: this.support.serialiseReceipt(receipt),
          },
        });
        return receipt;
      },
    );
  }

  async createBatch(
    command: DailySalesCommand<CreateDailySalesClosingBatchRequest>,
  ): Promise<DailySalesClosingBatchReceipt> {
    return this.database.inTenantTransaction(
      command.context.tenantId,
      async (transaction) => {
        const begun = await this.support.begin(
          transaction,
          command.context,
          "finance.daily_sales.create_batch",
          command.idempotencyKey,
          this.support.requestForBatch(command.request),
        );
        if (begun.kind === "replay")
          return this.support.hydrateBatchReceipt(begun.response.body);
        if (begun.kind === "in-progress")
          throw new ConflictException(
            "The daily-sales batch request is still in progress.",
          );
        const closings: DailySalesClosingReceipt[] = [];
        for (const entry of command.request.entries) {
          closings.push(
            await this.writes.createInTransaction(
              transaction,
              command.context,
              { ...entry, businessDate: command.request.businessDate },
              this.support.requestId(),
            ),
          );
        }
        const receipt = { closings };
        await this.support.complete(transaction, command.context, {
          receiptId: begun.receiptId,
          response: {
            status: 201,
            headers: null,
            body: this.support.serialiseBatchReceipt(receipt),
          },
        });
        return receipt;
      },
    );
  }
  async correct(
    command: DailySalesCommand<CorrectDailySalesClosingRequest>,
  ): Promise<DailySalesClosingReceipt> {
    return this.database.inTenantTransaction(
      command.context.tenantId,
      async (transaction) => {
        const begun = await this.support.begin(
          transaction,
          command.context,
          CORRECT_CLOSING_OPERATION,
          command.idempotencyKey,
          this.support.requestForCorrect(command.request),
        );
        if (begun.kind === "replay")
          return this.support.hydrateReceipt(begun.response.body);
        if (begun.kind === "in-progress")
          throw new ConflictException(
            "The daily-sales correction is still in progress.",
          );
        const receipt = await this.writes.correctInTransaction(
          transaction,
          command.context,
          command.request,
          this.support.requestId(),
        );
        await this.support.complete(transaction, command.context, {
          receiptId: begun.receiptId,
          response: {
            status: 200,
            headers: null,
            body: this.support.serialiseReceipt(receipt),
          },
        });
        return receipt;
      },
    );
  }

  async reverse(
    command: DailySalesCommand<ReverseDailySalesClosingRequest>,
  ): Promise<DailySalesClosingReversalReceipt> {
    return this.database.inTenantTransaction(
      command.context.tenantId,
      async (transaction) => {
        const begun = await this.support.begin(
          transaction,
          command.context,
          REVERSE_CLOSING_OPERATION,
          command.idempotencyKey,
          {
            closingId: command.request.closingId,
            businessDate: this.support.dateValue(command.request.businessDate),
            reason: command.request.reason,
          },
        );
        if (begun.kind === "replay")
          return begun.response
            .body as unknown as DailySalesClosingReversalReceipt;
        if (begun.kind === "in-progress")
          throw new ConflictException(
            "The daily-sales reversal is still in progress.",
          );
        const receipt = await this.writes.reverseInTransaction(
          transaction,
          command.context,
          command.request,
          this.support.requestId(),
        );
        await this.support.complete(transaction, command.context, {
          receiptId: begun.receiptId,
          response: { status: 200, headers: null, body: { ...receipt } },
        });
        return receipt;
      },
    );
  }
}

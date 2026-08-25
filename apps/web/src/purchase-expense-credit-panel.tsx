import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput } from "./baseer-form-fields";
import {
  BaseerSummaryMetric,
  BaseerSummaryMetricGrid,
} from "./baseer-summary-metric";
import { BaseerDataGridField as DataTable } from "./baseer-data-grid-field";
import { activeSession, api, requestId } from "./daily-sales-client";
import { compareMoneyDecimals, isPositiveMoneyDecimal } from "./decimal-string";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import { formatMoney } from "./number-format";

export type PurchaseCreditWorkspace = {
  companyId: string;
  asOfBusinessDate: string;
  openSupplierCount: number;
  openInvoiceCount: number;
  originalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  suppliers: Array<{
    supplierId: string;
    supplierNameAr: string;
    supplierNameEn: string | null;
    invoiceCount: number;
    originalAmount: string;
    paidAmount: string;
    remainingAmount: string;
    dues: Array<{
      id: string;
      documentNumber: string;
      kind: "PURCHASE" | "EXPENSE";
      businessDate: string;
      dueDate: string | null;
      categoryNameAr: string | null;
      categoryNameEn: string | null;
      originalAmount: string;
      paidAmount: string;
      remainingAmount: string;
    }>;
  }>;
  hasMore: boolean;
  nextCursor: string | null;
};
type CreditPaymentForm = {
  vaultId: string;
  amount: string;
  businessDate: string;
};

export function PurchaseExpenseCreditPanel({
  credit,
  language,
  vaults,
  reload,
}: {
  credit: PurchaseCreditWorkspace | null;
  language: "ar" | "en";
  vaults: ReadonlyArray<{ id: string; nameAr: string; nameEn: string }>;
  reload: (cursor?: string) => Promise<void>;
}) {
  const text = financeText(language);
  const [target, setTarget] = useState<
    PurchaseCreditWorkspace["suppliers"][number]["dues"][number] | null
  >(null);
  const [message, setMessage] = useState("");
  if (!credit)
    return (
      <BaseerCard>
        <p>{text.loading}</p>
      </BaseerCard>
    );

  const invoices = credit.suppliers.flatMap((supplier) =>
    supplier.dues.map((due) => ({
      ...due,
      supplierNameAr: supplier.supplierNameAr,
      supplierNameEn: supplier.supplierNameEn,
    })),
  );
  return (
    <>
      <BaseerSummaryMetricGrid ariaLabel={text.credit} role="list">
        <BaseerSummaryMetric
          role="listitem"
          label={text.openCreditSuppliers}
          value={credit.openSupplierCount}
        />
        <BaseerSummaryMetric
          role="listitem"
          label={text.openCreditInvoices}
          value={credit.openInvoiceCount}
        />
        <BaseerSummaryMetric
          role="listitem"
          label={text.creditOutstanding}
          value={formatMoney(credit.remainingAmount)}
        />
      </BaseerSummaryMetricGrid>
      {message ? (
        <p className="daily-sales-message success">{message}</p>
      ) : null}
      <section
        style={{
          marginTop: "var(--section-gap)",
          paddingTop: "var(--section-gap)",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div className="administration-section-heading">
          <div>
            <h3>{text.openCreditInvoices}</h3>
            <p>
              {text.creditAsOf} {credit.asOfBusinessDate.slice(0, 10)}
            </p>
          </div>
        </div>
        {invoices.length ? (
          <DataTable
            ariaLabel={text.openCreditInvoices}
            caption={text.openCreditInvoices}
            rowKey={(invoice) => invoice.id}
            columns={[
              {
                id: "supplier",
                header: text.supplier,
                width: "15rem",
                cell: (invoice) =>
                  displayName(language, {
                    nameAr: invoice.supplierNameAr,
                    nameEn: invoice.supplierNameEn,
                  }),
              },
              {
                id: "number",
                header: text.invoiceNumber,
                width: "10rem",
                cell: (invoice) => invoice.documentNumber,
              },
              {
                id: "kind",
                header: text.invoiceType,
                width: "8rem",
                cell: (invoice) =>
                  invoice.kind === "PURCHASE"
                    ? text.purchaseInvoice
                    : text.expenseInvoice,
              },
              {
                id: "category",
                header: text.financialCategory,
                width: "13rem",
                cell: (invoice) =>
                  displayName(language, {
                    nameAr: invoice.categoryNameAr ?? "—",
                    nameEn: invoice.categoryNameEn ?? "—",
                  }),
              },
              {
                id: "date",
                header: text.supplierInvoiceDate,
                width: "9rem",
                cell: (invoice) => invoice.businessDate.slice(0, 10),
              },
              {
                id: "remaining",
                header: text.outstanding,
                width: "9rem",
                numeric: true,
                cell: (invoice) => formatMoney(invoice.remainingAmount),
              },
              {
                id: "action",
                header: "",
                width: "10rem",
                cell: (invoice) => (
                  <BaseerButton
                    type="button"
                    variant="secondary"
                    onClick={() => setTarget(invoice)}
                  >
                    {text.recordSettlement}
                  </BaseerButton>
                ),
              },
            ]}
            rows={invoices}
          />
        ) : (
          <p className="empty-results">{text.noCreditInvoices}</p>
        )}
        {credit.hasMore && credit.nextCursor ? (
          <BaseerButton
            type="button"
            variant="secondary"
            onClick={() => void reload(credit.nextCursor ?? undefined)}
          >
            {text.loadMore}
          </BaseerButton>
        ) : null}
      </section>
      <CreditPaymentDialog
        language={language}
        due={target}
        vaults={vaults}
        defaultBusinessDate={credit.asOfBusinessDate.slice(0, 10)}
        onClose={() => setTarget(null)}
        onSaved={async () => {
          setTarget(null);
          setMessage(text.repaymentSaved);
          await reload();
        }}
      />
    </>
  );
}

function CreditPaymentDialog({
  language,
  due,
  vaults,
  defaultBusinessDate,
  onClose,
  onSaved,
}: {
  language: "ar" | "en";
  due: PurchaseCreditWorkspace["suppliers"][number]["dues"][number] | null;
  vaults: ReadonlyArray<{ id: string; nameAr: string; nameEn: string }>;
  defaultBusinessDate: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const text = financeText(language);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const validation = useMemo(
    () =>
      z
        .object({
          vaultId: z
            .string()
            .min(
              1,
              language === "ar"
                ? "اختر قناة الدفع."
                : "Choose a payment channel.",
            ),
          amount: z
            .string()
            .trim()
            .refine(
              isPositiveMoneyDecimal,
              language === "ar"
                ? "أدخل مبلغاً صحيحاً."
                : "Enter a valid amount.",
            ),
          businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .refine(
          (value) =>
            !due ||
            (isPositiveMoneyDecimal(value.amount) &&
              compareMoneyDecimals(value.amount, due.remainingAmount) <= 0),
          {
            path: ["amount"],
            message:
              language === "ar"
                ? "المبلغ يجب أن يكون ضمن الرصيد المتبقي."
                : "Amount must not exceed the outstanding balance.",
          },
        ),
    [due, language],
  );
  const form = useBaseerForm<CreditPaymentForm>({
    defaultValues: {
      vaultId: "",
      amount: due?.remainingAmount ?? "",
      businessDate: defaultBusinessDate,
    },
    schema: validation,
    shouldFocusError: true,
  });
  const businessDate = form.watch("businessDate");
  useEffect(() => {
    if (due) {
      form.reset({
        vaultId: "",
        amount: due.remainingAmount,
        businessDate: defaultBusinessDate,
      });
      setError("");
    }
  }, [defaultBusinessDate, due, form]);
  if (!due) return null;
  const submit = async (value: CreditPaymentForm) => {
    const current = activeSession();
    if (!current || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(current, "/finance/supplier-dues/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dueId: due.id,
          vaultId: value.vaultId,
          businessDate: value.businessDate,
          amount: value.amount,
          idempotencyKey: requestId(),
        }),
      });
      await onSaved();
    } catch (requestError) {
      setError(
        presentBaseerApiError(requestError, language, text.recordSettlement),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <BaseerFormDialog
      open
      title={text.recordSettlement}
      language={language}
      formId="purchase-expense-credit-payment"
      submitLabel={saving ? text.saving : text.recordSettlement}
      busy={saving}
      error={error}
      onClose={onClose}
    >
        <p>
          {due.documentNumber} · {formatMoney(due.remainingAmount)}
        </p>
        <form
          id="purchase-expense-credit-payment"
          className="daily-sales-dialog__form"
          data-baseer-rhf-form="true"
          noValidate
          onSubmit={form.handleSubmit((value) => void submit(value))}
        >
          <label>
            {text.paymentDate}
            <BaseerDatePicker
              language={language}
              label={text.paymentDate}
              max={defaultBusinessDate}
              value={businessDate}
              onChange={(value) =>
                form.setValue("businessDate", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          </label>
          <label>
            {text.paymentChannel}
            <select
              aria-invalid={Boolean(form.formState.errors.vaultId)}
              {...form.register("vaultId")}
            >
              <option value="">{text.selectVault}</option>
              {vaults.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {displayName(language, vault)}
                </option>
              ))}
            </select>
            {form.formState.errors.vaultId ? (
              <small role="alert">
                {form.formState.errors.vaultId.message}
              </small>
            ) : null}
          </label>
          <label>
            {text.repaymentAmount} (SAR)
            <BaseerMoneyInput
              aria-invalid={Boolean(form.formState.errors.amount)}
              value={form.watch("amount")}
              onValueChange={(amount) => form.setValue("amount", amount, { shouldDirty: true, shouldValidate: true })}
            />
            {form.formState.errors.amount ? (
              <small role="alert">{form.formState.errors.amount.message}</small>
            ) : null}
          </label>
        </form>
    </BaseerFormDialog>
  );
}

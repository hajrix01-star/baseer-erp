import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import {
  activeSession,
  api,
  requestId,
  type ActiveSession,
} from "./daily-sales-client";
import { isPositiveMoneyDecimal } from "./decimal-string";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import type { Profile } from "./recurring-expense-workspace";
import { formatNumber } from "./number-format";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import { BaseerValidatedFormField as BaseerValidatedForm } from "./baseer-validated-form-field";

type Configuration = {
  profile: { vatAccountingEnabled: boolean; vatRateBasisPoints: number } | null;
  vaults: Array<{
    id: string;
    nameAr: string;
    nameEn: string;
    status: "ACTIVE" | "ARCHIVED";
    isPaymentDestination: boolean;
    paymentMethod:
      | "CASH"
      | "BANK_TRANSFER"
      | "BANK_CARD"
      | "BANK_PAYMENT"
      | "APP";
    paymentMethods: Array<
      "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP"
    >;
  }>;
  categories: Array<{
    id: string;
    nameAr: string;
    nameEn: string;
    kind: "PURCHASE" | "EXPENSE";
    status: "ACTIVE";
    isPosting?: boolean;
    suggestedSupplierId: string | null;
  }>;
  suppliers: Array<{
    id: string;
    nameAr: string;
    nameEn: string | null;
    status: "ACTIVE";
    categoryId: string | null;
  }>;
};
type Loan = {
  id: string;
  sourceDocumentNumber: string;
  originalAmount: string;
  openingOutstandingAmount: string;
  paidAmount: string;
  remainingAmount: string;
  installmentAmount: string;
  termMonths: number;
  firstInstallmentDueDate: string;
  openingBusinessDate: string;
  status: "ACTIVE" | "SETTLED";
  notes: string | null;
};
type Document = {
  id: string;
  documentNumber: string;
  kind: "PURCHASE" | "EXPENSE";
  settlementKind: "PAID" | "PAYABLE";
  status: string;
  businessDate: string;
  grossAmount: string;
  batchNumber: string | null;
  supplierNameAr: string | null;
  supplierNameEn: string | null;
  categoryNameAr: string;
  categoryNameEn: string;
};
type LoanForm = {
  sourceDocumentNumber: string;
  originalAmount: string;
  openingOutstandingAmount: string;
  installmentAmount: string;
  termMonths: string;
  firstInstallmentDueDate: string;
  openingBusinessDate: string;
  notes: string;
};
type RepaymentForm = {
  loanId: string;
  vaultId: string;
  amount: string;
  businessDate: string;
};
type Workspace = {
  companyId: string;
  businessDate: string;
  configuration: Configuration;
  loans: Loan[];
  recurringProfiles: Profile[];
  documents: Document[];
};

const money = (value: string) => formatNumber(value);
const RecurringExpenseWorkspace = lazy(async () => ({
  default: (await import("./recurring-expense-workspace"))
    .RecurringExpenseWorkspace,
}));
const RecurringExpensePaymentBatch = lazy(async () => ({
  default: (await import("./recurring-expense-workspace"))
    .RecurringExpensePaymentBatch,
}));
const emptyLoan = (businessDate: string): LoanForm => ({
  sourceDocumentNumber: "",
  originalAmount: "",
  openingOutstandingAmount: "",
  installmentAmount: "",
  termMonths: "",
  firstInstallmentDueDate: businessDate,
  openingBusinessDate: businessDate,
  notes: "",
});

type ExpensesWorkspaceTab = "items" | "batch" | "history";

export function ExpensesObligationsWorkspace({
  language,
  activeTab = "items",
  onTabChange,
}: {
  language: "ar" | "en";
  activeTab?: ExpensesWorkspaceTab;
  onTabChange?: (tab: ExpensesWorkspaceTab) => void;
}) {
  const text = financeText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [tab, setTab] = useState<ExpensesWorkspaceTab>(activeTab);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState("");
  const loadWorkspace = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    const receipt = await api<Workspace>(
      current,
      "/finance/expenses-obligations-workspace",
    );
    setWorkspace(receipt);
    setLoadError("");
  }, []);
  useEffect(() => {
    void loadWorkspace().catch((error) =>
      setLoadError(
        presentBaseerApiError(error, language, text.expensesObligations),
      ),
    );
  }, [language, loadWorkspace]);
  useEffect(() => {
    setTab(activeTab);
  }, [activeTab]);
  if (!session) return <DailySalesSignIn language={language} />;
  if (!workspace)
    return (
      <BaseerCard>
        <p className={`daily-sales-message ${loadError ? "error" : "success"}`}>
          {loadError || text.loading}
        </p>
      </BaseerCard>
    );
  return (
    <section
      className="daily-sales-workspace expenses-obligations-workspace"
      aria-label={text.expensesObligations}
    >
      <BaseerWorkspaceTabs
        ariaLabel={text.expensesObligations}
        idPrefix="expenses-tab"
        activeId={tab}
        tabs={[
          { id: "items", label: text.itemsAndObligations },
          { id: "batch", label: text.batchPayment },
          { id: "history", label: text.settlementHistory },
        ]}
        onChange={(id) => {
          const next = id as ExpensesWorkspaceTab;
          setTab(next);
          onTabChange?.(next);
        }}
      />
      <BaseerBatchPanel
        id={`expenses-tab-panel-${tab}`}
        labelledBy={`expenses-tab-${tab}`}
      >
        {tab === "items" ? (
          <ItemsAndObligations
            language={language}
            workspace={workspace}
            reload={loadWorkspace}
          />
        ) : null}
        {tab === "batch" ? (
          <ExpenseSettlementBatch
            language={language}
            configuration={workspace.configuration}
            profiles={workspace.recurringProfiles}
            businessDate={workspace.businessDate}
            reload={loadWorkspace}
          />
        ) : null}
        {tab === "history" ? (
          <SettlementHistory
            language={language}
            documents={workspace.documents}
            loans={workspace.loans}
          />
        ) : null}
      </BaseerBatchPanel>
    </section>
  );
}

function ItemsAndObligations({
  language,
  workspace,
  reload,
}: {
  language: "ar" | "en";
  workspace: Workspace;
  reload: () => Promise<void>;
}) {
  const text = financeText(language);
  const { loans, configuration } = workspace;
  const [message, setMessage] = useState<{
    kind: "idle" | "error" | "success";
    text: string;
  }>({ kind: "idle", text: "" });
  const [showLoan, setShowLoan] = useState(false);
  const [loanForm, setLoanForm] = useState<LoanForm>(() =>
    emptyLoan(workspace.businessDate),
  );
  const [paying, setPaying] = useState<Loan | null>(null);
  const [repayment, setRepayment] = useState<RepaymentForm | null>(null);
  const [saving, setSaving] = useState(false);
  const vaults = useMemo(
    () =>
      configuration?.vaults.filter(
        (vault) => vault.status === "ACTIVE" && vault.isPaymentDestination,
      ) ?? [],
    [configuration],
  );
  const updateLoan = <K extends keyof LoanForm>(key: K, value: LoanForm[K]) =>
    setLoanForm((current) => ({ ...current, [key]: value }));
  const updateRepayment = <K extends keyof RepaymentForm>(
    key: K,
    value: RepaymentForm[K],
  ) =>
    setRepayment((current) =>
      current ? { ...current, [key]: value } : current,
    );
  const required = language === "ar" ? "أكمل الحقول المطلوبة بقيم صحيحة." : "Complete the required fields with valid values.";
  const loanSchemaFactory = ({ z, baseerDecimalString }: Parameters<NonNullable<React.ComponentProps<typeof BaseerValidatedForm>["schemaFactory"]>>[0]) => { const moneyField = baseerDecimalString(required, 4, 14).refine(isPositiveMoneyDecimal, required); return z.object({ sourceDocumentNumber: z.string().trim().min(1, required).max(160), originalAmount: moneyField, openingOutstandingAmount: moneyField, installmentAmount: moneyField, termMonths: z.string().regex(/^(?:[1-9]|[1-9]\d|[1-5]\d{2}|600)$/, required), firstInstallmentDueDate: z.string().date(required), openingBusinessDate: z.string().date(required), notes: z.string().max(1000) }).strict(); };
  const repaymentSchemaFactory = ({ z, baseerDecimalString }: Parameters<NonNullable<React.ComponentProps<typeof BaseerValidatedForm>["schemaFactory"]>>[0]) => { const moneyField = baseerDecimalString(required, 4, 14).refine(isPositiveMoneyDecimal, required); return z.object({ loanId: z.string().uuid(required), vaultId: z.string().uuid(required), amount: moneyField, businessDate: z.string().date(required) }).strict(); };
  const saveLoan = async () => {
    const current = activeSession();
    if (!current || saving) return;
    setSaving(true);
    setMessage({ kind: "idle", text: "" });
    try {
      await api(current, "/finance/inclusive-loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...loanForm,
          termMonths: Number(loanForm.termMonths),
          notes: loanForm.notes.trim() || undefined,
          idempotencyKey: requestId(),
        }),
      });
      setShowLoan(false);
      setLoanForm(emptyLoan(workspace.businessDate));
      setMessage({ kind: "success", text: text.loanSaved });
      await reload();
    } catch (error) {
      setMessage({
        kind: "error",
        text: presentBaseerApiError(error, language, text.loans),
      });
    } finally {
      setSaving(false);
    }
  };
  const saveRepayment = async () => {
    const current = activeSession();
    if (!current || !paying || !repayment || saving) return;
    setSaving(true);
    setMessage({ kind: "idle", text: "" });
    try {
      const receipt = await api<{ remainingAmount: string }>(
        current,
        "/finance/inclusive-loans/repayments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            loanId: paying.id,
            vaultId: repayment.vaultId,
            amount: repayment.amount,
            businessDate: repayment.businessDate,
            idempotencyKey: requestId(),
          }),
        },
      );
      setPaying(null);
      setRepayment(null);
      setMessage({
        kind: "success",
        text: `${text.repaymentSaved} ${text.remainingLoan}: SAR ${money(receipt.remainingAmount)}.`,
      });
      await reload();
    } catch (error) {
      setMessage({
        kind: "error",
        text: presentBaseerApiError(error, language, text.recordRepayment),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {message.kind !== "idle" ? (
        <p className={`daily-sales-message ${message.kind}`}>{message.text}</p>
      ) : null}
      <Suspense
        fallback={
          <BaseerCard>
            <p>{text.loading}</p>
          </BaseerCard>
        }
      >
        <RecurringExpenseWorkspace
          language={language}
          configuration={configuration}
          profiles={workspace.recurringProfiles}
          businessDate={workspace.businessDate}
          reload={reload}
        />
      </Suspense>
      <div className="expenses-obligations-subhead">
        <div>
          <h4>{text.loans}</h4>
        </div>
        <BaseerButton
          type="button"
          variant="primary"
          onClick={() => {
            setShowLoan(true);
            setPaying(null);
          }}
        >
          {text.addLoan}
        </BaseerButton>
      </div>
      {showLoan ? (
        <BaseerCard>
          <BaseerValidatedForm
            className="recurring-expense-form"
            values={loanForm}
            schemaFactory={loanSchemaFactory}
            errorSummaryLabel={required}
            onValid={() => saveLoan()}
          >
            <div className="recurring-expense-grid">
              <label>
                {text.loanReference}
                <input
                  required
                  value={loanForm.sourceDocumentNumber}
                  placeholder={text.loanReference}
                  onChange={(event) =>
                    updateLoan("sourceDocumentNumber", event.target.value)
                  }
                />
              </label>
              <label>
                {text.originalLoanAmount} (SAR)
                <input
                  required
                  inputMode="decimal"
                  value={loanForm.originalAmount}
                  placeholder={text.originalLoanAmount}
                  onChange={(event) =>
                    updateLoan("originalAmount", event.target.value)
                  }
                />
              </label>
              <label>
                {text.openingOutstandingAmount} (SAR)
                <input
                  required
                  inputMode="decimal"
                  value={loanForm.openingOutstandingAmount}
                  placeholder={text.openingOutstandingAmount}
                  onChange={(event) =>
                    updateLoan("openingOutstandingAmount", event.target.value)
                  }
                />
              </label>
              <label>
                {text.monthlyInstallment} (SAR)
                <input
                  required
                  inputMode="decimal"
                  value={loanForm.installmentAmount}
                  placeholder={text.monthlyInstallment}
                  onChange={(event) =>
                    updateLoan("installmentAmount", event.target.value)
                  }
                />
              </label>
              <label>
                {text.totalTermMonths}
                <input
                  required
                  type="number"
                  min="1"
                  max="600"
                  value={loanForm.termMonths}
                  placeholder="24"
                  onChange={(event) =>
                    updateLoan("termMonths", event.target.value)
                  }
                />
              </label>
              <label>
                {text.firstDueDate}
                <BaseerDatePicker
                  language={language}
                  label={text.firstDueDate}
                  value={loanForm.firstInstallmentDueDate}
                  onChange={(value) =>
                    updateLoan("firstInstallmentDueDate", value)
                  }
                />
              </label>
              <label>
                {text.trackingStartDate}
                <BaseerDatePicker
                  language={language}
                  label={text.trackingStartDate}
                  max={workspace.businessDate}
                  value={loanForm.openingBusinessDate}
                  onChange={(value) => updateLoan("openingBusinessDate", value)}
                />
              </label>
              <label className="recurring-span">
                {text.notes}
                <input
                  value={loanForm.notes}
                  placeholder={text.optional}
                  onChange={(event) => updateLoan("notes", event.target.value)}
                />
              </label>
            </div>
            <footer>
              <BaseerButton
                type="button"
                variant="secondary"
                onClick={() => setShowLoan(false)}
              >
                {text.cancel}
              </BaseerButton>
              <BaseerButton variant="primary" disabled={saving}>
                {saving ? text.saving : text.save}
              </BaseerButton>
            </footer>
          </BaseerValidatedForm>
        </BaseerCard>
      ) : null}
      <div className="recurring-profile-list">
        {loans.map((loan) => (
          <BaseerCard key={loan.id}>
            <article className="recurring-profile">
              <div>
                <span className="eyebrow">
                  {text.financialObligation} ·{" "}
                  {loan.status === "SETTLED" ? text.settled : text.active}
                </span>
                <h4>{loan.sourceDocumentNumber}</h4>
                <p>
                  {text.term}: {loan.termMonths} · {text.firstDue}:{" "}
                  {loan.firstInstallmentDueDate.slice(0, 10)}
                </p>
              </div>
              <div className="recurring-profile__amount">
                <span>{text.remainingLoan}</span>
                <strong>SAR {money(loan.remainingAmount)}</strong>
                <small>
                  {text.repaid}: SAR {money(loan.paidAmount)} ·{" "}
                  {text.installment}: SAR {money(loan.installmentAmount)}
                </small>
              </div>
              <div className="recurring-profile__actions">
                {loan.status === "ACTIVE" ? (
                  <BaseerButton
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setPaying(loan);
                      setRepayment({
                        loanId: loan.id,
                        vaultId: "",
                        amount: loan.installmentAmount,
                        businessDate: workspace.businessDate,
                      });
                    }}
                  >
                    {text.recordRepayment}
                  </BaseerButton>
                ) : null}
              </div>
            </article>
          </BaseerCard>
        ))}
      </div>
      {!loans.length ? (
        <BaseerCard>
          <p className="empty-results">{text.noLoans}</p>
        </BaseerCard>
      ) : null}
      {paying && repayment ? (
        <BaseerCard>
          <BaseerValidatedForm
            className="recurring-expense-form"
            values={repayment}
            schemaFactory={repaymentSchemaFactory}
            errorSummaryLabel={required}
            onValid={() => saveRepayment()}
          >
            <header>
              <h4>
                {text.loanPayment}: {paying.sourceDocumentNumber}
              </h4>
              <span>
                {text.currentBalance}: SAR {money(paying.remainingAmount)}
              </span>
            </header>
            <div className="recurring-expense-grid">
              <label>
                {text.paymentChannel}
                <select
                  required
                  value={repayment.vaultId}
                  onChange={(event) =>
                    updateRepayment("vaultId", event.target.value)
                  }
                >
                  <option value="">{text.selectChannel}</option>
                  {vaults.map((vault) => (
                    <option key={vault.id} value={vault.id}>
                      {displayName(language, vault)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {text.repaymentAmount} (SAR)
                <input
                  required
                  inputMode="decimal"
                  value={repayment.amount}
                  onChange={(event) =>
                    updateRepayment("amount", event.target.value)
                  }
                />
              </label>
              <label>
                {text.paymentDate}
                <BaseerDatePicker
                  language={language}
                  label={text.paymentDate}
                  max={workspace.businessDate}
                  value={repayment.businessDate}
                  onChange={(value) => updateRepayment("businessDate", value)}
                />
              </label>
            </div>
            <footer>
              <BaseerButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setPaying(null);
                  setRepayment(null);
                }}
              >
                {text.cancel}
              </BaseerButton>
              <BaseerButton variant="primary" disabled={saving}>
                {saving ? text.saving : text.recordSettlement}
              </BaseerButton>
            </footer>
          </BaseerValidatedForm>
        </BaseerCard>
      ) : null}
    </>
  );
}

function ExpenseSettlementBatch({
  language,
  configuration,
  profiles,
  businessDate: serverBusinessDate,
  reload,
}: {
  language: "ar" | "en";
  configuration: Configuration;
  profiles: Profile[];
  businessDate: string;
  reload: () => Promise<void>;
}) {
  return (
    <Suspense
      fallback={
        <BaseerCard>
          <p>{financeText(language).loading}</p>
        </BaseerCard>
      }
    >
      <RecurringExpensePaymentBatch
        language={language}
        configuration={configuration}
        profiles={profiles}
        businessDate={serverBusinessDate}
        reload={reload}
      />
    </Suspense>
  );

}
function SettlementHistory({
  language,
  documents: sourceDocuments,
  loans,
}: {
  language: "ar" | "en";
  documents: Document[];
  loans: Loan[];
}) {
  const text = financeText(language);
  const documents = sourceDocuments.filter(
    (document) => document.kind === "EXPENSE",
  );
  return (
    <BaseerCard>
      <div className="administration-section-heading">
        <div>
          <h4>{text.settlementHistory}</h4>
        </div>
      </div>
      <div className="administration-list">
        {documents.map((document) => (
          <article key={document.id}>
            <strong>{document.documentNumber}</strong>
            <span>{document.businessDate.slice(0, 10)}</span>
            <span>
              {displayName(language, {
                nameAr: document.categoryNameAr,
                nameEn: document.categoryNameEn,
              })}
              {document.supplierNameAr
                ? ` · ${displayName(language, { nameAr: document.supplierNameAr, nameEn: document.supplierNameEn })}`
                : ""}
            </span>
            <strong>SAR {money(document.grossAmount)}</strong>
          </article>
        ))}
        {loans.map((loan) => (
          <article key={`loan-${loan.id}`}>
            <strong>
              {text.loan} · {loan.sourceDocumentNumber}
            </strong>
            <span>{text.remainingLoan}</span>
            <span>
              {loan.status === "SETTLED" ? text.settled : text.active}
            </span>
            <strong>SAR {money(loan.remainingAmount)}</strong>
          </article>
        ))}
      </div>
      {!documents.length && !loans.length ? (
        <p className="empty-results">{text.noResults}</p>
      ) : null}
    </BaseerCard>
  );
}

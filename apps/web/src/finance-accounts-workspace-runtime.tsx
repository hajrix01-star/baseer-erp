import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import {
  BaseerPeriodFilter,
  baseerPeriodLabel,
  baseerPeriodQuery,
  defaultBaseerPeriodRange,
  type BaseerPeriodRange,
} from "./baseer-period-filter";
import {
  BaseerSummaryMetric,
  BaseerSummaryMetricGrid,
} from "./baseer-summary-metric";
import { BaseerWorkspaceTabs } from "./baseer-batch-layout";
import type { BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { financeText } from "./finance-copy";
import { formatCount, formatDate, formatMoney } from "./number-format";
import { presentBaseerApiError } from "./baseer-api-error";
import {
  absoluteMoneyDecimal,
  compareMoneyDecimals,
  subtractMoneyDecimals,
} from "./decimal-string";
import "./finance-accounts-workspace.css";

type Language = "ar" | "en";
type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type Account = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  status: "ACTIVE" | "ARCHIVED";
  isSystem: boolean;
  balanceDebit: string;
  balanceCredit: string;
  periodDebit: string;
  periodCredit: string;
};
type AccountsReceipt = {
  companyId: string;
  asOfBusinessDate: string;
  fromBusinessDate: string | null;
  toBusinessDate: string | null;
  summary: { accountCount: number; periodDebit: string; periodCredit: string };
  accounts: Account[];
};
type Movement = {
  id: string;
  journalEntryId: string;
  businessDate: string;
  sourceType: string;
  sourceReference: string;
  displayLabelAr: string;
  displayLabelEn: string;
  displayReference: string;
  description: string | null;
  debitAmount: string;
  creditAmount: string;
  reversalOfEntryId: string | null;
  reversalEntryId: string | null;
};
type MovementReceipt = {
  account: Account;
  asOfBusinessDate: string;
  fromBusinessDate: string | null;
  toBusinessDate: string | null;
  summary: Pick<
    Account,
    "balanceDebit" | "balanceCredit" | "periodDebit" | "periodCredit"
  >;
  items: Movement[];
  nextCursor: string | null;
};
type Journal = {
  id: string;
  sourceType: string;
  sourceReference: string;
  displayLabelAr: string;
  displayLabelEn: string;
  displayReference: string;
  businessDate: string;
  description: string | null;
  status: "POSTED" | "REVERSED";
  postedAt: string;
  reversalOfEntryId: string | null;
  reversalEntryId: string | null;
  lines: Array<{
    id: string;
    lineNumber: number;
    accountCode: string;
    accountNameAr: string;
    accountNameEn: string;
    debitAmount: string;
    creditAmount: string;
    description: string | null;
  }>;
};
const BaseerFilterBar = lazy(async () => ({
  default: (await import("./baseer-filter-bar")).BaseerFilterBar,
}));

export function FinanceAccountsWorkspaceRuntime({ language }: { language: Language }) {
  const text = financeText(language);
  const labels =
    language === "ar"
      ? {
          title: "الحسابات",
          description:
            "دليل الحسابات وحركة الحساب المحدد من القيود المنشورة — لا يوجد سجل عمليات مكرر.",
          search: "ابحث بالكود أو اسم الحساب",
          hideZeroAccounts: "إخفاء الحسابات صفرية الرصيد",
          showAccountingDetails: "إظهار تفاصيل الحركة المحاسبية",
          accountType: "النوع",
          balance: "الرصيد",
          netPeriodMovement: "صافي حركة الفترة",
          periodDebit: "إجمالي القيود المدينة",
          periodCredit: "إجمالي القيود الدائنة",
          movements: "حركة الحساب",
          viewMovements: "عرض الحركة",
          noAccounts: "لا توجد حسابات مطابقة.",
          journal: "القيد",
          source: "المصدر",
          reference: "المرجع",
          active: "نشط",
          archived: "مؤرشف",
          assets: "أصول",
          liabilities: "التزامات",
          equity: "حقوق ملكية",
          revenue: "إيرادات",
          expense: "مصروفات",
          totalAccounts: "الحسابات",
          asOf: "الرصيد حتى",
          noMovement: "لا توجد حركة لهذا الحساب ضمن الفترة.",
          ledgerNote:
            "هذه حركة حساب محدد؛ كل صف مرتبط بالقيد الأصلي نفسه. إجمالي القيود لا يعني مبلغًا مدفوعًا نقدًا.",
          debitBalance: "رصيد مدين",
          creditBalance: "رصيد دائن",
          debitMovement: "مدين",
          creditMovement: "دائن",
          totalDebitMovement: "إجمالي قيود الفترة — مدين",
          totalCreditMovement: "إجمالي قيود الفترة — دائن",
          reversalEntry: "قيد عكس",
          reversedEntry: "تم عكسه",
        }
      : {
          title: "Accounts",
          description:
            "Chart of accounts and selected-account activity from posted journals — not a duplicate movement register.",
          search: "Search account code or name",
          hideZeroAccounts: "Hide zero-balance accounts",
          showAccountingDetails: "Show accounting movement details",
          accountType: "Type",
          balance: "Balance",
          netPeriodMovement: "Net period movement",
          periodDebit: "Total debit entries",
          periodCredit: "Total credit entries",
          movements: "Account activity",
          viewMovements: "View activity",
          noAccounts: "No matching accounts.",
          journal: "Journal",
          source: "Source",
          reference: "Reference",
          active: "Active",
          archived: "Archived",
          assets: "Assets",
          liabilities: "Liabilities",
          equity: "Equity",
          revenue: "Revenue",
          expense: "Expenses",
          totalAccounts: "Accounts",
          asOf: "Balance as of",
          noMovement: "No movements for this account in the selected period.",
          ledgerNote:
            "This is activity for one account; every row links to its original journal entry. Total entries do not mean cash paid.",
          debitBalance: "Debit balance",
          creditBalance: "Credit balance",
          debitMovement: "Debit",
          creditMovement: "Credit",
          totalDebitMovement: "Period entries — debit",
          totalCreditMovement: "Period entries — credit",
          reversalEntry: "Reversal entry",
          reversedEntry: "Reversed",
        };
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(
    defaultBaseerPeriodRange,
  );
  const [search, setSearch] = useState("");
  const [hideZeroAccounts, setHideZeroAccounts] = useState(false);
  const [showAccountingDetails, setShowAccountingDetails] = useState(false);
  const [receipt, setReceipt] = useState<AccountsReceipt | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const [activity, setActivity] = useState<MovementReceipt | null>(null);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<"activity" | "journal">("activity");

  const query = useCallback(() => {
    const params = new URLSearchParams(baseerPeriodQuery(period));
    if (search.trim()) params.set("q", search.trim());
    return params;
  }, [period, search]);
  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    const result = await api<AccountsReceipt>(
      current,
      `/finance/accounts?${query().toString()}`,
    );
    setReceipt(result);
  }, [query]);
  useEffect(() => {
    void load().catch((error) =>
      setMessage(presentBaseerApiError(error, language, labels.title)),
    );
  }, [language, labels.title, load]);

  const openAccount = async (account: Account, cursor?: string) => {
    const current = activeSession();
    if (!current) return;
    setSelected(account);
    setPane("activity");
    setJournal(null);
    setBusy(true);
    try {
      const params = query();
      if (cursor) params.set("cursor", cursor);
      const next = await api<MovementReceipt>(
        current,
        `/finance/accounts/${account.id}/movements?${params.toString()}`,
      );
      setActivity((previous) =>
        cursor && previous
          ? { ...next, items: [...previous.items, ...next.items] }
          : next,
      );
    } catch (error) {
      setMessage(presentBaseerApiError(error, language, labels.movements));
    } finally {
      setBusy(false);
    }
  };
  const openJournal = async (journalEntryId: string) => {
    const current = activeSession();
    if (!current) return;
    setBusy(true);
    try {
      setJournal(
        await api<Journal>(
          current,
          `/finance/accounts/journal-entries/${journalEntryId}`,
        ),
      );
      setPane("journal");
    } catch (error) {
      setMessage(presentBaseerApiError(error, language, labels.journal));
    } finally {
      setBusy(false);
    }
  };
  const typeLabel = (type: AccountType) =>
    type === "ASSET"
      ? labels.assets
      : type === "LIABILITY"
        ? labels.liabilities
        : type === "EQUITY"
          ? labels.equity
          : type === "REVENUE"
            ? labels.revenue
            : labels.expense;
  const accountName = (account: Account) =>
    language === "ar" ? account.nameAr : account.nameEn || account.nameAr;
  const balance = (debit: string, credit: string) => {
    const comparison = compareMoneyDecimals(debit, credit);
    const value = subtractMoneyDecimals(debit, credit);
    const direction =
      comparison > 0 ? "debit" : comparison < 0 ? "credit" : "zero";
    return (
      <span
        className={`finance-account-amount finance-account-amount--${direction}`}
      >
        {comparison === 0
          ? formatMoney("0")
          : `${formatMoney(absoluteMoneyDecimal(value))} · ${comparison > 0 ? labels.debitBalance : labels.creditBalance}`}
      </span>
    );
  };
  const netMovement = (debit: string, credit: string) => {
    const comparison = compareMoneyDecimals(debit, credit);
    const value = subtractMoneyDecimals(debit, credit);
    const direction =
      comparison > 0 ? "debit" : comparison < 0 ? "credit" : "zero";
    return (
      <span
        className={`finance-account-amount finance-account-amount--${direction}`}
      >
        {comparison === 0
          ? formatMoney("0")
          : `${formatMoney(absoluteMoneyDecimal(value))} · ${comparison > 0 ? labels.debitMovement : labels.creditMovement}`}
      </span>
    );
  };
  const entryAmount = (amount: string, direction: "debit" | "credit") => (
    <span
      className={`finance-account-amount finance-account-amount--${compareMoneyDecimals(amount, "0") === 0 ? "zero" : direction}`}
    >
      {formatMoney(amount)}
    </span>
  );
  const debitHeading = (label: string) => (
    <span className="finance-account-column-heading finance-account-column-heading--debit">
      {label}
    </span>
  );
  const creditHeading = (label: string) => (
    <span className="finance-account-column-heading finance-account-column-heading--credit">
      {label}
    </span>
  );
  const accountColumns: BaseerDataGridColumn<Account>[] = useMemo(
    () => [
      {
        id: "code",
        header: language === "ar" ? "الكود" : "Code",
        cell: (item) => <span dir="ltr">{item.code}</span>,
      },
      {
        id: "account",
        header: text.account,
        cell: (item) => (
          <button
            type="button"
            className="baseer-link-button"
            onClick={() => void openAccount(item)}
          >
            {accountName(item)}
          </button>
        ),
      },
      {
        id: "type",
        header: labels.accountType,
        cell: (item) => (
          <span className="daily-sales-badge">{typeLabel(item.type)}</span>
        ),
      },
      {
        id: "net-period",
        header: labels.netPeriodMovement,
        numeric: true,
        align: "end",
        cell: (item) => netMovement(item.periodDebit, item.periodCredit),
      },
      {
        id: "balance",
        header: labels.balance,
        numeric: true,
        align: "end",
        cell: (item) => balance(item.balanceDebit, item.balanceCredit),
      },
      ...(showAccountingDetails
        ? [
            {
              id: "debit",
              header: debitHeading(labels.periodDebit),
              numeric: true,
              align: "end" as const,
              cell: (item: Account) => entryAmount(item.periodDebit, "debit"),
            },
            {
              id: "credit",
              header: creditHeading(labels.periodCredit),
              numeric: true,
              align: "end" as const,
              cell: (item: Account) => entryAmount(item.periodCredit, "credit"),
            },
          ]
        : []),
    ],
    [language, showAccountingDetails, text.account, labels],
  );
  const movementColumns: BaseerDataGridColumn<Movement>[] = [
    {
      id: "date",
      header: text.documentDate,
      cell: (item) => <bdi dir="ltr">{formatDate(item.businessDate, language)}</bdi>,
    },
    {
      id: "reference",
      header: labels.reference,
      cell: (item) => (
        <button
          type="button"
          dir="ltr"
          className="baseer-link-button"
          onClick={() => void openJournal(item.journalEntryId)}
        >
          {item.displayReference}
        </button>
      ),
    },
    {
      id: "source",
      header: labels.source,
      cell: (item) => (
        <>
          {language === "ar" ? item.displayLabelAr : item.displayLabelEn}
          {item.reversalOfEntryId ? (
            <>
              {" "}
              ·{" "}
              <span className="daily-sales-badge">{labels.reversalEntry}</span>
            </>
          ) : item.reversalEntryId ? (
            <>
              {" "}
              ·{" "}
              <span className="daily-sales-badge">{labels.reversedEntry}</span>
            </>
          ) : null}
        </>
      ),
    },
    {
      id: "description",
      header: text.notes,
      cell: (item) => item.description ?? "—",
    },
    {
      id: "debit",
      header: debitHeading(text.debit),
      numeric: true,
      align: "end",
      cell: (item) => entryAmount(item.debitAmount, "debit"),
    },
    {
      id: "credit",
      header: creditHeading(text.creditAmount),
      numeric: true,
      align: "end",
      cell: (item) => entryAmount(item.creditAmount, "credit"),
    },
  ];
  const journalColumns: BaseerDataGridColumn<Journal["lines"][number]>[] = [
    {
      id: "line",
      header: "#",
      numeric: true,
      align: "center",
      cell: (item) => <bdi dir="ltr">{formatCount(item.lineNumber, language)}</bdi>,
    },
    {
      id: "account",
      header: text.account,
      cell: (item) =>
        `${item.accountCode} · ${language === "ar" ? item.accountNameAr : item.accountNameEn}`,
    },
    {
      id: "debit",
      header: debitHeading(text.debit),
      numeric: true,
      align: "end",
      cell: (item) => entryAmount(item.debitAmount, "debit"),
    },
    {
      id: "credit",
      header: creditHeading(text.creditAmount),
      numeric: true,
      align: "end",
      cell: (item) => entryAmount(item.creditAmount, "credit"),
    },
  ];
  const visibleAccounts = useMemo(
    () =>
      receipt?.accounts.filter(
        (account) =>
          !hideZeroAccounts ||
          compareMoneyDecimals(account.balanceDebit, account.balanceCredit) !==
            0,
      ) ?? [],
    [hideZeroAccounts, receipt],
  );
  const defaultPeriod = defaultBaseerPeriodRange();
  const hasPeriod =
    period.preset !== defaultPeriod.preset ||
    period.from !== defaultPeriod.from ||
    period.to !== defaultPeriod.to ||
    period.months.join(",") !== defaultPeriod.months.join(",");
  const appliedFilters = [
    ...(hasPeriod
      ? [
          {
            id: "period",
            label: baseerPeriodLabel(period, language),
            onRemove: () => setPeriod(defaultBaseerPeriodRange()),
          },
        ]
      : []),
    ...(search.trim()
      ? [{ id: "search", label: search.trim(), onRemove: () => setSearch("") }]
      : []),
    ...(hideZeroAccounts
      ? [
          {
            id: "hide-zero-accounts",
            label: labels.hideZeroAccounts,
            onRemove: () => setHideZeroAccounts(false),
          },
        ]
      : []),
    ...(showAccountingDetails
      ? [
          {
            id: "show-accounting-details",
            label: labels.showAccountingDetails,
            onRemove: () => setShowAccountingDetails(false),
          },
        ]
      : []),
  ];
  if (!session) return <DailySalesSignIn language={language} />;
  return (
    <section
      className="daily-sales-workspace finance-setup-workspace finance-accounts-workspace"
      aria-label={labels.title}
    >
      <header className="administration-section-heading">
        <div>
          <p className="eyebrow">{text.finance}</p>
          <h3>{labels.title}</h3>
          <p>{labels.description}</p>
        </div>
      </header>
      <Suspense fallback={null}>
        <BaseerFilterBar
          controlsPresentation="menu"
          language={language}
          search={search}
          searchLabel={labels.title}
          searchPlaceholder={labels.search}
          onSearchChange={setSearch}
          appliedFilters={appliedFilters}
          onClear={() => {
            setSearch("");
            setPeriod(defaultBaseerPeriodRange());
            setHideZeroAccounts(false);
            setShowAccountingDetails(false);
          }}
          controls={
            <>
              <BaseerPeriodFilter
                language={language}
                value={period}
                onChange={setPeriod}
              />
              <BaseerFilterToggle
                label={labels.hideZeroAccounts}
                checked={hideZeroAccounts}
                onChange={setHideZeroAccounts}
              />
              <BaseerFilterToggle
                label={labels.showAccountingDetails}
                checked={showAccountingDetails}
                onChange={setShowAccountingDetails}
              />
            </>
          }
        />
      </Suspense>
      {message ? <p className="daily-sales-message error">{message}</p> : null}
      {!receipt ? (
        <BaseerCard>
          <p>{text.loading}</p>
        </BaseerCard>
      ) : (
        <>
          <BaseerSummaryMetricGrid>
            <BaseerSummaryMetric
              label={labels.totalAccounts}
              value={String(receipt.summary.accountCount)}
            />
            <BaseerSummaryMetric
              label={debitHeading(labels.totalDebitMovement)}
              value={entryAmount(receipt.summary.periodDebit, "debit")}
            />
            <BaseerSummaryMetric
              label={creditHeading(labels.totalCreditMovement)}
              value={entryAmount(receipt.summary.periodCredit, "credit")}
            />
            <BaseerSummaryMetric
              label={labels.asOf}
              value={receipt.asOfBusinessDate}
            />
          </BaseerSummaryMetricGrid>
          {visibleAccounts.length ? (
            <BaseerDataGrid
              ariaLabel={labels.title}
              caption={labels.title}
              columns={accountColumns}
              rows={visibleAccounts}
              rowKey={(item) => item.id}
            />
          ) : (
            <BaseerCard>
              <p>{labels.noAccounts}</p>
            </BaseerCard>
          )}
        </>
      )}
      <BaseerDialog
        open={selected !== null}
        size="wide"
        language={language}
        title={
          selected
            ? `${selected.code} · ${accountName(selected)}`
            : labels.movements
        }
        busy={busy}
        onClose={() => {
          setSelected(null);
          setActivity(null);
          setJournal(null);
        }}
        footer={
          <BaseerButton
            type="button"
            onClick={() => {
              setSelected(null);
              setActivity(null);
              setJournal(null);
            }}
          >
            {text.cancel}
          </BaseerButton>
        }
      >
        <BaseerWorkspaceTabs
          ariaLabel={labels.movements}
          idPrefix="finance-account-file"
          activeId={pane}
          onChange={(value) => setPane(value as "activity" | "journal")}
          tabs={[
            { id: "activity", label: labels.movements },
            { id: "journal", label: labels.journal },
          ]}
        />
        {pane === "activity" ? (
          <>
            {activity ? (
              <>
                <BaseerSummaryMetricGrid>
                  <BaseerSummaryMetric
                    label={labels.netPeriodMovement}
                    value={netMovement(
                      activity.summary.periodDebit,
                      activity.summary.periodCredit,
                    )}
                  />
                  <BaseerSummaryMetric
                    label={labels.balance}
                    value={balance(
                      activity.summary.balanceDebit,
                      activity.summary.balanceCredit,
                    )}
                  />
                  <BaseerSummaryMetric
                    label={debitHeading(labels.periodDebit)}
                    value={entryAmount(activity.summary.periodDebit, "debit")}
                  />
                  <BaseerSummaryMetric
                    label={creditHeading(labels.periodCredit)}
                    value={entryAmount(activity.summary.periodCredit, "credit")}
                  />
                </BaseerSummaryMetricGrid>
                <p>{labels.ledgerNote}</p>
                {activity.items.length ? (
                  <BaseerDataGrid
                    ariaLabel={labels.movements}
                    caption={labels.movements}
                    columns={movementColumns}
                    rows={activity.items}
                    rowKey={(item) => item.id}
                  />
                ) : (
                  <p>{labels.noMovement}</p>
                )}
                {activity.nextCursor ? (
                  <BaseerButton
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      selected &&
                      void openAccount(
                        selected,
                        activity.nextCursor ?? undefined,
                      )
                    }
                  >
                    {text.loadMore}
                  </BaseerButton>
                ) : null}
              </>
            ) : (
              <p>{text.loading}</p>
            )}
          </>
        ) : journal ? (
          <div className="administration-form">
            <label>
              {labels.reference}
              <output dir="ltr">{journal.displayReference}</output>
            </label>
            <label>
              {labels.source}
              <output>
                {language === "ar"
                  ? journal.displayLabelAr
                  : journal.displayLabelEn}
              </output>
            </label>
            <label>
              {text.documentDate}
              <output dir="ltr">{formatDate(journal.businessDate, language)}</output>
            </label>
            <label>
              {text.notes}
              <output>{journal.description ?? "—"}</output>
            </label>
            <BaseerDataGrid
              ariaLabel={labels.journal}
              caption={labels.journal}
              columns={journalColumns}
              rows={journal.lines}
              rowKey={(item) => item.id}
            />
          </div>
        ) : (
          <p>{text.loading}</p>
        )}
      </BaseerDialog>
    </section>
  );
}

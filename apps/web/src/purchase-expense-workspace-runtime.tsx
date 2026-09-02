import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { BaseerButton } from "./baseer-button";
import {
  BaseerBatchFooter,
  BaseerBatchHeader,
  BaseerBatchPanel,
  BaseerWorkspaceTabs,
} from "./baseer-batch-layout";
import { BaseerCard } from "./baseer-card";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterSelect } from "./baseer-filter-controls";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerMoneyInput, BaseerTextArea, BaseerTextInput } from "./baseer-form-fields";
import { BaseerPeriodFilter, baseerPeriodLabel, defaultBaseerPeriodRange, iso, riyadhToday, type BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerLoadFailure } from "./baseer-load-failure";
import { BaseerNotice } from "./baseer-workspace";
import { formatMoney } from "./number-format";
import { presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import {
  activeSession,
  api,
  requestId,
  type ActiveSession,
} from "./daily-sales-client";
import { isPositiveMoneyDecimal } from "./decimal-string";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import { takeMarketingFinanceHandoff, type MarketingFinanceHandoff } from "./marketing-finance-handoff";
import { hasActivePermission } from "./module-access";
import type { PurchaseCreditWorkspace } from "./purchase-expense-credit-panel";
import { BaseerValidatedFormField as BaseerValidatedForm } from "./baseer-validated-form-field";

// The entry grid contains the search controls and mobile presentation. It is
// deferred until company configuration has arrived, avoiding a second large
// parsing task during navigation into purchases.
const LazyOutflowBatchEntryTable = lazy(async () => ({
  default: (await import("./outflow-batch-entry-table")).OutflowBatchEntryTable,
}));
const OutflowBatchEntryTable =
  LazyOutflowBatchEntryTable as unknown as typeof import("./outflow-batch-entry-table").OutflowBatchEntryTable;
const PurchaseExpenseCreditPanel = lazy(async () => ({
  default: (await import("./purchase-expense-credit-panel"))
    .PurchaseExpenseCreditPanel,
}));
const QuickAdvanceDialog = lazy(async () => ({
  default: (await import("./quick-advance-dialog")).QuickAdvanceDialog,
}));

type Configuration = {
  profile: { vatAccountingEnabled: boolean; vatRateBasisPoints: number } | null;
  vaults: Array<{
    id: string;
    nameAr: string;
    nameEn: string;
    type: "CASH" | "BANK" | "APP";
    status: "ACTIVE" | "ARCHIVED";
    isPaymentDestination: boolean;
  }>;
  categories: Array<{
    id: string;
    nameAr: string;
    nameEn: string;
    kind: "PURCHASE" | "EXPENSE";
    status: "ACTIVE";
    isPosting?: boolean;
  }>;
  suppliers: Array<{
    id: string;
    nameAr: string;
    nameEn: string | null;
    status: "ACTIVE";
    categoryId: string | null;
    isFavorite: boolean;
  }>;
};
type Document = {
  id: string;
  documentNumber: string;
  kind: "PURCHASE" | "EXPENSE";
  settlementKind: "PAID" | "PAYABLE";
  status: "POSTED" | "CANCELLED";
  businessDate: string;
  grossAmount: string;
  batchNumber: string | null;
  supplierNameAr: string | null;
  supplierNameEn: string | null;
  supplierId: string | null;
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
  supplierInvoiceNumber: string | null;
  supplierInvoiceMissingReason: string | null;
  supplierInvoiceDate: string | null;
  vatRateBasisPoints: number;
  assetWarrantyFollowUp: boolean;
  notes: string | null;
  postingVersion: number;
  allocations: Array<{
    vaultId: string;
    grossAmount: string;
    paymentMethod: string;
  }>;
};
const LINKED_OUTFLOW_DOCUMENT_KEY = "baseer-open-outflow-document";
type CreditWorkspace = PurchaseCreditWorkspace;
type BatchRow = {
  id: string;
  kind: "" | "PURCHASE" | "EXPENSE";
  settlementKind: "PAID" | "PAYABLE";
  categoryId: string;
  supplierId: string;
  invoiceNumber: string;
  missingReason: string;
  supplierInvoiceDate: string;
  grossAmount: string;
  isTaxable: boolean;
  assetWarrantyFollowUp: boolean;
  vaultId: string;
  notes: string;
};

const systemBusinessDate = () => {
  const { year, month, day } = riyadhToday();
  return iso(year, month, day);
};
const newRow = (supplierInvoiceDate = systemBusinessDate()): BatchRow => ({
  id: requestId(),
  kind: "",
  settlementKind: "PAID",
  categoryId: "",
  supplierId: "",
  invoiceNumber: "",
  missingReason: "",
  supplierInvoiceDate,
  grossAmount: "",
  isTaxable: true,
  assetWarrantyFollowUp: false,
  vaultId: "",
  notes: "",
});
const initialRows = () => Array.from({ length: 3 }, () => newRow());
const rowHasValue = (row: BatchRow) =>
  Boolean(
    row.categoryId ||
      row.supplierId ||
      row.invoiceNumber.trim() ||
      row.missingReason.trim() ||
      row.supplierInvoiceDate ||
      row.grossAmount.trim() ||
      row.vaultId ||
      row.notes.trim(),
  );
const rowForDocument = (document: Document): BatchRow => ({
  id: requestId(),
  kind: document.kind,
  settlementKind: document.settlementKind,
  categoryId: document.categoryId,
  supplierId: document.supplierId ?? "",
  invoiceNumber: document.supplierInvoiceNumber ?? "",
  missingReason: document.supplierInvoiceMissingReason ?? "",
  supplierInvoiceDate: document.supplierInvoiceDate?.slice(0, 10) ?? "",
  grossAmount: document.grossAmount,
  isTaxable: document.vatRateBasisPoints > 0,
  assetWarrantyFollowUp: document.assetWarrantyFollowUp,
  vaultId: document.allocations[0]?.vaultId ?? "",
  notes: document.notes ?? "",
});

type PurchaseWorkspaceTab = "entry" | "history" | "credit";

export function PurchaseExpenseWorkspaceRuntime({
  language,
  migrationReviewLocked = false,
  activeTab = "entry",
  onTabChange,
}: {
  language: "ar" | "en";
  migrationReviewLocked?: boolean;
  activeTab?: PurchaseWorkspaceTab;
  onTabChange?: (tab: PurchaseWorkspaceTab) => void;
}) {
  const text = financeText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [remoteSuppliers, setRemoteSuppliers] = useState<
    Configuration["suppliers"]
  >([]);
  const [remoteCategories, setRemoteCategories] = useState<
    Configuration["categories"]
  >([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [ownerCanAmend, setOwnerCanAmend] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState<BaseerPeriodRange>(() => defaultBaseerPeriodRange());
  const [historyKind, setHistoryKind] = useState<"ALL" | Document["kind"]>(
    "ALL",
  );
  const [historySettlement, setHistorySettlement] = useState<
    "ALL" | Document["settlementKind"]
  >("ALL");
  const [historyStatus, setHistoryStatus] = useState<
    "ALL" | Document["status"]
  >("POSTED");
  const [credit, setCredit] = useState<CreditWorkspace | null>(null);
  const [tab, setTab] = useState<PurchaseWorkspaceTab>(() => migrationReviewLocked && hasActivePermission("finance.purchase_expense.read") ? "history" : activeTab);
  const [quickAdvanceOpen, setQuickAdvanceOpen] = useState(false);
  // The server deliberately rejects every operational capability while a
  // company is migration-review locked. Do not request entry references with
  // a create capability merely to render this page; switch to an available
  // read surface instead.
  const canCreate = hasActivePermission("finance.purchase_expense.create") && !migrationReviewLocked;
  const canIssueAdvance = hasActivePermission("hr.advances.issue") && !migrationReviewLocked;
  const canReadHistory = hasActivePermission("finance.purchase_expense.read");
  const canReadCredit = canReadHistory && hasActivePermission("finance.supplier_dues.read");
  const availableTabs = useMemo(() => [
    ...(canCreate ? [{ id: "entry" as const, label: text.entry }] : []),
    ...(canReadHistory ? [{ id: "history" as const, label: text.invoiceHistory }] : []),
    ...(canReadCredit ? [{ id: "credit" as const, label: text.credit }] : []),
  ], [canCreate, canReadCredit, canReadHistory, text.credit, text.entry, text.invoiceHistory]);
  const [businessDate, setBusinessDate] = useState(systemBusinessDate);
  const [lastReceipt, setLastReceipt] = useState<{
    grossAmount: string;
    netAmount: string;
    vatAmount: string;
    documentCount: number;
  } | null>(null);
  const [batchNotes, setBatchNotes] = useState("");
  const [rows, setRows] = useState<BatchRow[]>(initialRows);
  const [marketingHandoff, setMarketingHandoff] = useState<MarketingFinanceHandoff | null>(null);
  const [message, setMessage] = useState<{
    kind: "idle" | "success" | "error";
    text: string;
  }>({ kind: "idle", text: "" });
  const [saving, setSaving] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<Document | null>(null);
  const [viewTarget, setViewTarget] = useState<Document | null>(null);
  const [amendTarget, setAmendTarget] = useState<Document | null>(null);
  const [amendmentRow, setAmendmentRow] = useState<BatchRow | null>(null);
  const [amendmentDate, setAmendmentDate] = useState("");
  const [reversalBusinessDate, setReversalBusinessDate] = useState("");
  const [reversalReason, setReversalReason] = useState("");
  const validationMessage = language === "ar" ? "أكمل بيانات السند بقيم صحيحة." : "Complete the document with valid values.";
  const validRow = (row: BatchRow) => Boolean(row.kind && row.categoryId && isPositiveMoneyDecimal(row.grossAmount) && (Boolean(row.invoiceNumber.trim()) !== Boolean(row.missingReason.trim())) && (row.settlementKind !== "PAYABLE" || row.supplierId) && (row.settlementKind !== "PAID" || row.vaultId));
  const batchSchemaFactory = ({ z }: Parameters<NonNullable<React.ComponentProps<typeof BaseerValidatedForm>["schemaFactory"]>>[0]) => z.object({ businessDate: z.string().date(validationMessage), batchNotes: z.string().max(1000), rows: z.array(z.custom<BatchRow>()).max(100) }).strict().superRefine((value, context) => { const entered = value.rows.filter(rowHasValue); if (!entered.length || entered.some((row) => !validRow(row))) context.addIssue({ code: "custom", path: ["rows"], message: validationMessage }); });
  const reversalSchemaFactory = ({ z }: Parameters<NonNullable<React.ComponentProps<typeof BaseerValidatedForm>["schemaFactory"]>>[0]) => z.object({ businessDate: z.string().date(validationMessage), reason: z.string().trim().min(1, validationMessage).max(1000) }).strict();
  const amendmentSchemaFactory = ({ z }: Parameters<NonNullable<React.ComponentProps<typeof BaseerValidatedForm>["schemaFactory"]>>[0]) => z.object({ businessDate: z.string().date(validationMessage), row: z.custom<BatchRow>() }).strict().superRefine((value, context) => { if (!validRow(value.row)) context.addIssue({ code: "custom", path: ["row"], message: validationMessage }); });
  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    const [nextConfiguration, nextDocuments] = await Promise.all([
      canCreate ? api<Configuration>(current, "/finance/purchase-expense-documents/entry-references") : Promise.resolve<Configuration>({ profile: null, vaults: [], categories: [], suppliers: [] }),
      canReadHistory ? api<{ documents: Document[]; ownerCanAmend: boolean }>(
        current,
        "/finance/purchase-expense-documents",
      ) : Promise.resolve({ documents: [], ownerCanAmend: false }),
    ]);
    setConfiguration(nextConfiguration);
    setDocuments(nextDocuments.documents);
    setOwnerCanAmend(nextDocuments.ownerCanAmend);
  }, [canCreate, canReadHistory]);
  const loadCredit = useCallback(async (cursor?: string) => {
    const current = activeSession();
    if (!current) return;
    const snapshot = await api<CreditWorkspace>(
      current,
      `/finance/purchase-expense-documents/credit-workspace?pageSize=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setCredit((previous) =>
      cursor && previous
        ? {
            ...snapshot,
            suppliers: mergeCreditSupplierPages(
              previous.suppliers,
              snapshot.suppliers,
            ),
          }
        : snapshot,
    );
    setBusinessDate(
      (currentDate) => currentDate || snapshot.asOfBusinessDate.slice(0, 10),
    );
  }, []);
  const reportLoadFailure = useCallback((error: unknown) => {
    setMessage({
      kind: "error",
      text: presentBaseerLoadError(error, language, { ar: "بيانات المشتريات", en: "purchase data" }),
    });
  }, [language]);
  const retryLoad = useCallback(() => { void load().catch(reportLoadFailure); }, [load, reportLoadFailure]);
  useEffect(() => { retryLoad(); }, [retryLoad]);
  useEffect(() => {
    if (!canCreate) return;
    const current = activeSession();
    if (!current) return;
    const draft = takeMarketingFinanceHandoff(current.companyId);
    if (!draft) return;
    const period = draft.startsOn && draft.endsOn ? `${draft.startsOn} — ${draft.endsOn}` : draft.startsOn ?? draft.endsOn ?? "غير محددة";
    const notes = [`حملة تسويقية: ${draft.campaignTitleAr}`, `فترة الحملة: ${period}`, ...(draft.campaignSummary ? [`تفاصيل الحملة: ${draft.campaignSummary}`] : [])].join("\n");
    const row = newRow(draft.startsOn ?? systemBusinessDate());
    setBusinessDate(draft.startsOn ?? "");
    setBatchNotes(notes);
    setRows([{ ...row, kind: "EXPENSE", grossAmount: draft.plannedCost ?? "", notes }]);
    setMarketingHandoff(draft);
    setMessage({ kind: "success", text: language === "ar" ? "تمت تعبئة فاتورة الحملة. أكمل المورد والتصنيف وطريقة السداد ثم احفظ." : "Campaign invoice details were prefilled. Complete supplier, category, and settlement, then save." });
  }, [canCreate, language, session?.companyId]);
  useEffect(() => {
    const stage = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.hash.slice(1)).get("stage");
    const candidate = stage === "history" ? "history" : activeTab;
    setTab(availableTabs.some((item) => item.id === candidate) ? candidate : availableTabs[0]?.id ?? "entry");
  }, [activeTab, availableTabs]);
  useEffect(() => {
    const documentId = window.sessionStorage.getItem(LINKED_OUTFLOW_DOCUMENT_KEY);
    if (!documentId) return;
    const document = documents.find((candidate) => candidate.id === documentId);
    if (!document) return;
    setTab("history");
    setViewTarget(document);
    window.sessionStorage.removeItem(LINKED_OUTFLOW_DOCUMENT_KEY);
  }, [documents]);
  useEffect(() => {
    if (tab === "credit" && canReadCredit)
      void loadCredit().catch((error) =>
        setMessage({
          kind: "error",
          text: presentBaseerApiError(error, language, text.credit),
        }),
      );
  }, [canReadCredit, language, loadCredit, tab, text.credit]);

  const categories = useMemo(() => {
    const byId = new Map<string, Configuration["categories"][number]>();
    for (const category of [
      ...(configuration?.categories ?? []),
      ...remoteCategories,
    ])
      if (category.status === "ACTIVE" && category.isPosting !== false)
        byId.set(category.id, category);
    return [...byId.values()];
  }, [configuration, remoteCategories]);
  const suppliers = useMemo(() => {
    const byId = new Map<string, Configuration["suppliers"][number]>();
    for (const supplier of [
      ...(configuration?.suppliers ?? []),
      ...remoteSuppliers,
    ])
      if (supplier.status === "ACTIVE") byId.set(supplier.id, supplier);
    return [...byId.values()].sort(
      (left, right) =>
        Number(right.isFavorite) - Number(left.isFavorite) ||
        displayName(language, left).localeCompare(
          displayName(language, right),
          language,
        ),
    );
  }, [configuration, language, remoteSuppliers]);
  const paymentVaults = useMemo(
    () =>
      configuration?.vaults.filter(
        (item) => item.status === "ACTIVE" && item.isPaymentDestination,
      ) ?? [],
    [configuration],
  );
  const visibleHistory = useMemo(() => {
    const query = historySearch.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      const searchable = [
        document.documentNumber,
        document.businessDate,
        document.supplierNameAr,
        document.supplierNameEn,
        document.categoryNameAr,
        document.categoryNameEn,
        document.supplierInvoiceNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!query || searchable.includes(query)) &&
        document.businessDate >= historyPeriod.from &&
        document.businessDate <= historyPeriod.to &&
        (historyPeriod.preset !== "MONTH" ||
          historyPeriod.months.includes(document.businessDate.slice(0, 7))) &&
        (historyKind === "ALL" || document.kind === historyKind) &&
        (historySettlement === "ALL" ||
          document.settlementKind === historySettlement) &&
        (historyStatus === "ALL" || document.status === historyStatus)
      );
    });
  }, [documents, historyKind, historyPeriod, historySearch, historySettlement, historyStatus]);
  const historyByDay = useMemo(() => {
    const days = new Map<string, Document[]>();
    for (const document of visibleHistory) {
      const day = document.businessDate.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), document]);
    }
    return [...days.entries()];
  }, [visibleHistory]);
  const historyFilters = [
    ...(historySearch
      ? [
          {
            id: "query",
            label: historySearch,
            onRemove: () => setHistorySearch(""),
          },
        ]
      : []),
    ...((historyPeriod.from !== defaultBaseerPeriodRange().from ||
      historyPeriod.to !== defaultBaseerPeriodRange().to ||
      historyPeriod.preset !== defaultBaseerPeriodRange().preset ||
      historyPeriod.months.join(",") !== defaultBaseerPeriodRange().months.join(","))
      ? [{
          id: "period",
          label: baseerPeriodLabel(historyPeriod, language),
          onRemove: () => setHistoryPeriod(defaultBaseerPeriodRange()),
        }]
      : []),
    ...(historyKind !== "ALL"
      ? [
          {
            id: "kind",
            label:
              historyKind === "PURCHASE"
                ? text.purchaseInvoice
                : text.expenseInvoice,
            onRemove: () => setHistoryKind("ALL"),
          },
        ]
      : []),
    ...(historySettlement !== "ALL"
      ? [
          {
            id: "settlement",
            label: historySettlement === "PAID" ? text.paid : text.payable,
            onRemove: () => setHistorySettlement("ALL"),
          },
        ]
      : []),
    ...(historyStatus !== "POSTED"
      ? [
          {
            id: "status",
            label: historyStatus === "CANCELLED" ? text.cancelled : text.all,
            onRemove: () => setHistoryStatus("POSTED"),
          },
        ]
      : []),
  ];
  const enteredRows = useMemo(() => rows.filter(rowHasValue), [rows]);
  const change = <K extends keyof BatchRow>(
    rowId: string,
    key: K,
    value: BatchRow[K],
  ) =>
    setRows((current) =>
      current.map((row) =>
        row.id !== rowId
          ? row
          : key === "kind"
            ? { ...row, kind: value as BatchRow["kind"], categoryId: "" }
            : { ...row, [key]: value },
      ),
    );
  const chooseSupplier = (rowId: string, supplierId: string) =>
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const supplier = suppliers.find((item) => item.id === supplierId);
        const categoryId =
          supplier?.categoryId &&
          categories.some(
            (category) =>
              category.id === supplier.categoryId && category.kind === row.kind,
          )
            ? supplier.categoryId
            : row.categoryId;
        return { ...row, supplierId, categoryId };
      }),
    );
  const setSupplierFavorite = async (
    supplierId: string,
    isFavorite: boolean,
  ) => {
    const current = activeSession();
    if (!current) return;
    setConfiguration((prior) =>
      prior
        ? {
            ...prior,
            suppliers: prior.suppliers.map((supplier) =>
              supplier.id === supplierId
                ? { ...supplier, isFavorite }
                : supplier,
            ),
          }
        : prior,
    );
    try {
      await api(current, "/finance/master-data/suppliers/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          isFavorite,
          idempotencyKey: requestId(),
        }),
      });
    } catch (error) {
      setConfiguration((prior) =>
        prior
          ? {
              ...prior,
              suppliers: prior.suppliers.map((supplier) =>
                supplier.id === supplierId
                  ? { ...supplier, isFavorite: !isFavorite }
                  : supplier,
              ),
            }
          : prior,
      );
      setMessage({
        kind: "error",
        text: presentBaseerApiError(error, language, text.supplierFavorite),
      });
    }
  };
  const remoteSupplierSearch = useCallback(
    async (query: string, signal: AbortSignal) => {
      const current = activeSession();
      if (!current) return [];
      const receipt = await api<{
        suppliers: Array<
          Pick<
            Configuration["suppliers"][number],
            "id" | "nameAr" | "nameEn" | "categoryId" | "isFavorite"
          >
        >;
      }>(
        current,
        `/finance/configuration/suppliers?pageSize=50${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`,
        { signal },
      );
      setRemoteSuppliers((previous) => {
        const byId = new Map(
          previous.map((supplier) => [supplier.id, supplier]),
        );
        for (const supplier of receipt.suppliers)
          byId.set(supplier.id, { ...supplier, status: "ACTIVE" });
        return [...byId.values()];
      });
      return receipt.suppliers.map((supplier) => ({
        id: supplier.id,
        label: displayName(language, supplier),
        isFavorite: supplier.isFavorite,
      }));
    },
    [language],
  );
  const remoteCategorySearch = useCallback(
    async (kind: BatchRow["kind"], query: string, signal: AbortSignal) => {
      const current = activeSession();
      if (!current || !kind) return [];
      const receipt = await api<{
        categories: Array<
          Pick<
            Configuration["categories"][number],
            "id" | "nameAr" | "nameEn" | "kind"
          >
        >;
      }>(
        current,
        `/finance/configuration/categories?pageSize=50&kind=${kind}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`,
        { signal },
      );
      setRemoteCategories((previous) => {
        const byId = new Map(
          previous.map((category) => [category.id, category]),
        );
        for (const category of receipt.categories)
          byId.set(category.id, {
            ...category,
            status: "ACTIVE",
            isPosting: true,
          });
        return [...byId.values()];
      });
      return receipt.categories.map((category) => ({
        id: category.id,
        label: displayName(language, category),
      }));
    },
    [language],
  );
  const renderSupplierAction = (supplier: {
    id: string;
    isFavorite?: boolean;
  }) => {
    const isFavorite = Boolean(supplier.isFavorite);
    return (
      <BaseerButton
        aria-label={
          isFavorite ? text.removeFavoriteSupplier : text.addFavoriteSupplier
        }
        title={
          isFavorite ? text.removeFavoriteSupplier : text.addFavoriteSupplier
        }
        type="button"
        variant="icon"
        style={{
          width: "2rem",
          minWidth: "2rem",
          minHeight: "2rem",
          padding: 0,
          border: 0,
          background: "transparent",
          boxShadow: "none",
          color: isFavorite ? "var(--brand)" : "var(--muted)",
        }}
        onClick={() => void setSupplierFavorite(supplier.id, !isFavorite)}
      >
        {isFavorite ? "★" : "☆"}
      </BaseerButton>
    );
  };
  const remove = (rowId: string) =>
    setRows((current) =>
      current.length === 1
        ? current
        : current.filter((row) => row.id !== rowId),
    );
  const submit = async () => {
    const current = activeSession();
    if (!current || saving) return;
    if (!businessDate) {
      setMessage({ kind: "error", text: text.selectDate });
      return;
    }
    if (!enteredRows.length) {
      setMessage({ kind: "error", text: text.atLeastOneRow });
      return;
    }
    for (const [index, row] of enteredRows.entries()) {
      if (
        !row.kind ||
        !row.categoryId ||
        !isPositiveMoneyDecimal(row.grossAmount) ||
        (!row.invoiceNumber.trim() && !row.missingReason.trim()) ||
        (row.invoiceNumber.trim() && row.missingReason.trim()) ||
        (row.settlementKind === "PAYABLE" && !row.supplierId) ||
        (row.settlementKind === "PAID" && !row.vaultId)
      ) {
        setMessage({ kind: "error", text: text.invoiceValidation(index + 1) });
        return;
      }
    }
    setSaving(true);
    setMessage({ kind: "idle", text: "" });
    try {
      const receipt = await api<{
        documentCount: number;
        grossAmount: string;
        netAmount: string;
        vatAmount: string;
        documents: Array<{ documentId: string }>;
      }>(current, "/finance/purchase-expense-documents/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessDate,
          ...(batchNotes.trim() ? { notes: batchNotes.trim() } : {}),
          items: enteredRows.map((row) => ({
            kind: row.kind,
            settlementKind: row.settlementKind,
            categoryId: row.categoryId,
            ...(row.supplierId ? { supplierId: row.supplierId } : {}),
            ...(row.invoiceNumber.trim()
              ? { supplierInvoiceNumber: row.invoiceNumber.trim() }
              : { supplierInvoiceMissingReason: row.missingReason.trim() }),
            ...(row.supplierInvoiceDate
              ? { supplierInvoiceDate: row.supplierInvoiceDate }
              : {}),
            grossAmount: row.grossAmount,
            isTaxable: row.isTaxable,
            assetWarrantyFollowUp: row.assetWarrantyFollowUp,
            allocations:
              row.settlementKind === "PAID"
                ? [{ vaultId: row.vaultId, grossAmount: row.grossAmount }]
                : [],
            ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
          })),
          idempotencyKey: requestId(),
        }),
      });
      setRows(initialRows());
      setBatchNotes("");
      setLastReceipt(receipt);
      if (marketingHandoff) {
        const document = receipt.documents[0];
        try {
          if (!document) throw new Error("The Finance receipt did not contain a document.");
          await api(current, `/marketing/campaigns/${marketingHandoff.campaignId}/financial-documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ financialDocumentId: document.documentId, idempotencyKey: requestId() }),
          });
          setMarketingHandoff(null);
          setMessage({ kind: "success", text: language === "ar" ? `${text.batchSaved(receipt.documentCount)} وتم ربط المستند بالحملة تلقائياً.` : `${text.batchSaved(receipt.documentCount)} The document was linked to the campaign.` });
        } catch (linkError) {
          setMessage({ kind: "error", text: language === "ar" ? `${text.batchSaved(receipt.documentCount)} لكن تعذر ربطه بالحملة. افتح الحملة واربط المستند المثبت يدوياً.` : `${text.batchSaved(receipt.documentCount)} The campaign link failed; open the campaign and link the posted document manually.` });
        }
      } else setMessage({ kind: "success", text: text.batchSaved(receipt.documentCount) });
      await Promise.all([load(), loadCredit()]);
    } catch (error) {
      setMessage({
        kind: "error",
        text: presentBaseerApiError(error, language, text.saveBatch),
      });
    } finally {
      setSaving(false);
    }
  };
  const openReverse = (document: Document) => {
    setReverseTarget(document);
    setReversalBusinessDate(businessDate || document.businessDate.slice(0, 10));
    setReversalReason("");
  };
  const openView = (document: Document) => setViewTarget(document);
  const openAmendment = (document: Document) => {
    setAmendTarget(document);
    setAmendmentRow(rowForDocument(document));
    setAmendmentDate(document.businessDate.slice(0, 10));
  };
  const updateAmendment = <K extends keyof BatchRow>(
    key: K,
    value: BatchRow[K],
  ) =>
    setAmendmentRow((row) =>
      row
        ? key === "kind"
          ? { ...row, kind: value as BatchRow["kind"], categoryId: "" }
          : { ...row, [key]: value }
        : row,
    );
  const submitAmendment = async () => {
    const current = activeSession();
    const row = amendmentRow;
    if (!current || !amendTarget || !row || saving) return;
    if (
      !amendmentDate ||
      !row.kind ||
      !row.categoryId ||
      !isPositiveMoneyDecimal(row.grossAmount) ||
      (!row.invoiceNumber.trim() && !row.missingReason.trim()) ||
      (row.invoiceNumber.trim() && row.missingReason.trim()) ||
      (row.settlementKind === "PAYABLE" && !row.supplierId) ||
      (row.settlementKind === "PAID" && !row.vaultId)
    ) {
      setMessage({ kind: "error", text: text.invoiceValidation(1) });
      return;
    }
    setSaving(true);
    setMessage({ kind: "idle", text: "" });
    try {
      await api(current, "/finance/purchase-expense-documents/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: amendTarget.id,
          kind: row.kind,
          settlementKind: row.settlementKind,
          categoryId: row.categoryId,
          ...(row.supplierId ? { supplierId: row.supplierId } : {}),
          ...(row.invoiceNumber.trim()
            ? { supplierInvoiceNumber: row.invoiceNumber.trim() }
            : { supplierInvoiceMissingReason: row.missingReason.trim() }),
          businessDate: amendmentDate,
          ...(row.supplierInvoiceDate
            ? { supplierInvoiceDate: row.supplierInvoiceDate }
            : {}),
          grossAmount: row.grossAmount,
          isTaxable: row.isTaxable,
          assetWarrantyFollowUp: row.assetWarrantyFollowUp,
          allocations:
            row.settlementKind === "PAID"
              ? [{ vaultId: row.vaultId, grossAmount: row.grossAmount }]
              : [],
          ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
          idempotencyKey: requestId(),
        }),
      });
      setAmendTarget(null);
      setAmendmentRow(null);
      setMessage({
        kind: "success",
        text:
          language === "ar"
            ? "تم تحديث السند وحفظ نسخة تدقيقية جديدة."
            : "The document was updated and a new audit revision was saved.",
      });
      await Promise.all([load(), loadCredit()]);
    } catch (error) {
      setMessage({
        kind: "error",
        text: presentBaseerApiError(
          error,
          language,
          language === "ar" ? "تعديل السند" : "Amending document",
        ),
      });
    } finally {
      setSaving(false);
    }
  };
  const reverseDocument = async () => {
    const current = activeSession();
    if (
      !current ||
      !reverseTarget ||
      saving ||
      !reversalBusinessDate ||
      !reversalReason.trim()
    )
      return;
    setSaving(true);
    setMessage({ kind: "idle", text: "" });
    try {
      await api(current, "/finance/purchase-expense-documents/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: reverseTarget.id,
          businessDate: reversalBusinessDate,
          reason: reversalReason.trim(),
          idempotencyKey: requestId(),
        }),
      });
      setReverseTarget(null);
      setMessage({ kind: "success", text: text.documentReversed });
      await Promise.all([load(), loadCredit()]);
    } catch (error) {
      setMessage({
        kind: "error",
        text: presentBaseerApiError(error, language, text.reverseDocument),
      });
    } finally {
      setSaving(false);
    }
  };
  if (!session) return <DailySalesSignIn language={language} />;
  if (migrationReviewLocked && !canReadHistory) return <section className="daily-sales-workspace baseer-batch-workspace purchase-expense-workspace" aria-label={text.purchases}><BaseerCard><div className="baseer-workspace__heading"><div><p className="overline">{language === "ar" ? "مراجعة ترحيل" : "Migration review"}</p><h2>{language === "ar" ? "المشتريات للقراءة فقط" : "Purchases are read-only"}</h2><p>{language === "ar" ? "الشركة مقفلة لمراجعة الترحيل. لا تتاح عمليات إنشاء أو تعديل المشتريات حتى يرفع المالك القفل." : "This company is locked for migration review. Purchase creation and changes remain unavailable until the owner removes the lock."}</p></div></div></BaseerCard></section>;
  return (
    <section
      className="daily-sales-workspace baseer-batch-workspace purchase-expense-workspace"
      aria-label={text.purchases}
    >
      {message.kind !== "idle" && !(message.kind === "error" && !configuration) && (
        <p className={`daily-sales-message ${message.kind}`}>{message.text}</p>
      )}
      {!configuration ? (
        <BaseerCard>
          {message.kind === "error" ? <BaseerLoadFailure message={message.text} language={language} onRetry={retryLoad} /> : <p>{text.loadingCompanySetup}</p>}
        </BaseerCard>
      ) : (
        <section style={{ minWidth: 0 }}>
          {migrationReviewLocked ? <BaseerNotice tone="warning" title={language === "ar" ? "إدخال المشتريات مقفل لمراجعة الترحيل" : "Purchase entry is locked for migration review"}>{language === "ar" ? "الشركة في وضع القراءة فقط؛ لذلك لا يظهر تبويب الإدخال أو زر الإضافة. يرفع مالك الشركة القفل من الإدارة ← الشركات بعد اكتمال مراجعة الترحيل." : "This company is read-only, so the entry tab and add button are hidden. A company owner can remove the lock from Administration → Companies after the migration review is complete."}</BaseerNotice> : null}
          <div className="purchase-expense-workspace__tabs-row">
            <BaseerWorkspaceTabs
              ariaLabel={text.batchInvoices}
              idPrefix="purchase-tab"
              activeId={tab}
              tabs={availableTabs}
              onChange={(id) => {
                const next = id as PurchaseWorkspaceTab;
                setTab(next);
                onTabChange?.(next);
              }}
            />
            {canIssueAdvance ? <button type="button" className="purchase-expense-workspace__advance-add" aria-label={language === "ar" ? "إدخال سلفة" : "Enter advance"} title={language === "ar" ? "إدخال سلفة" : "Enter advance"} onClick={() => setQuickAdvanceOpen(true)}>+</button> : null}
          </div>
          {quickAdvanceOpen ? <Suspense fallback={null}><QuickAdvanceDialog open language={language} onClose={() => setQuickAdvanceOpen(false)} /></Suspense> : null}
          {tab === "entry" ? (
            <>
              <BaseerBatchPanel
                id="purchase-tab-panel-entry"
                labelledBy="purchase-tab-entry"
              >
                {!configuration.profile && (
                  <p className="daily-sales-message error">
                    {text.setupRequired}
                  </p>
                )}
                <BaseerValidatedForm
                  values={{ businessDate, batchNotes, rows }}
                  schemaFactory={batchSchemaFactory}
                  errorSummaryLabel={validationMessage}
                  onValid={() => submit()}
                  className="baseer-batch-form purchase-batch-entry"
                >
                  <BaseerBatchHeader>
                    <label>
                      {text.batchDate}
                      <BaseerDatePicker
                        plain
                        presentation="popover"
                        language={language}
                        label={text.batchDate}
                        value={businessDate}
                        onChange={setBusinessDate}
                      />
                    </label>
                    <label>
                      {text.batchNotes}
                      <BaseerTextInput
                        value={batchNotes}
                        placeholder={text.optional}
                        onChange={(event) => setBatchNotes(event.target.value)}
                      />
                    </label>
                  </BaseerBatchHeader>
                  <Suspense
                    fallback={
                      <BaseerCard>
                        <p>{text.loading}</p>
                      </BaseerCard>
                    }
                  >
                    <OutflowBatchEntryTable
                      language={language}
                      text={text}
                      ariaLabel={text.batchEntry}
                      rows={rows}
                      categories={categories}
                      suppliers={suppliers}
                      vaults={paymentVaults}
                      vatEnabled={Boolean(
                        configuration.profile?.vatAccountingEnabled,
                      )}
                      vatRateBasisPoints={
                        configuration.profile?.vatRateBasisPoints ?? 1500
                      }
                      allowedKinds={["PURCHASE", "EXPENSE"]}
                      maxInvoiceDate={businessDate || undefined}
                      showAssetWarrantyFollowUp
                      onChange={change}
                      onSupplierChange={chooseSupplier}
                      remoteSupplierSearch={remoteSupplierSearch}
                      remoteCategorySearch={remoteCategorySearch}
                      renderSupplierAction={renderSupplierAction}
                      onRemove={remove}
                    />
                  </Suspense>
                  <BaseerBatchFooter
                    summary={
                      lastReceipt ? (
                        <>
                          <span>
                            {text.net}{" "}
                            <strong>
                              {formatMoney(lastReceipt.netAmount)}
                            </strong>
                          </span>
                          <span>
                            {text.tax}{" "}
                            <strong>
                              {formatMoney(lastReceipt.vatAmount)}
                            </strong>
                          </span>
                          <span>
                            {text.lastBatchTotal}{" "}
                            <strong>
                              {formatMoney(lastReceipt.grossAmount)}
                            </strong>
                          </span>
                        </>
                      ) : null
                    }
                  >
                    {!marketingHandoff ? <BaseerButton
                      aria-label={text.addRow}
                      type="button"
                      variant="icon"
                      className="baseer-batch-add-row"
                      onClick={() =>
                        setRows((current) => [...current, newRow(businessDate)])
                      }
                    >
                      +
                    </BaseerButton> : null}
                    <BaseerButton
                      variant="primary"
                      className="baseer-batch-save"
                      disabled={saving || !configuration.profile}
                    >
                      {saving
                        ? text.saving
                        : text.saveInvoiceCount(enteredRows.length)}
                    </BaseerButton>
                  </BaseerBatchFooter>
                </BaseerValidatedForm>
              </BaseerBatchPanel>
            </>
          ) : tab === "history" ? (
              <BaseerBatchPanel
                id="purchase-tab-panel-history"
                labelledBy="purchase-tab-history"
              >
                <section className="purchase-invoice-history">
                  <div className="administration-section-heading">
                    <div>
                      <h3>{text.invoiceHistory}</h3>
                    </div>
                    <span>
                      {visibleHistory.length} {text.invoiceCount}
                    </span>
                  </div>
                  <BaseerFilterBar
                    controlsPresentation="inline"
                    language={language}
                    search={historySearch}
                    searchLabel={text.invoiceHistory}
                    searchPlaceholder={
                      language === "ar"
                        ? "ابحث برقم الفاتورة أو المورد أو البند"
                        : "Search number, supplier, or category"
                    }
                    onSearchChange={setHistorySearch}
                    appliedFilters={historyFilters}
                    onClear={() => {
                      setHistorySearch("");
                      setHistoryPeriod(defaultBaseerPeriodRange());
                      setHistoryKind("ALL");
                      setHistorySettlement("ALL");
                      setHistoryStatus("POSTED");
                    }}
                    controls={
                      <>
                        <BaseerPeriodFilter
                          language={language}
                          value={historyPeriod}
                          onChange={setHistoryPeriod}
                        />
                        <BaseerFilterSelect
                          label={text.invoiceType}
                          value={historyKind}
                          onChange={(event) =>
                            setHistoryKind(
                              event.target.value as typeof historyKind,
                            )
                          }
                        >
                          <option value="ALL">{text.all}</option>
                          <option value="PURCHASE">
                            {text.purchaseInvoice}
                          </option>
                          <option value="EXPENSE">{text.expenseInvoice}</option>
                        </BaseerFilterSelect>
                        <BaseerFilterSelect
                          label={text.settlement}
                          value={historySettlement}
                          onChange={(event) =>
                            setHistorySettlement(
                              event.target.value as typeof historySettlement,
                            )
                          }
                        >
                          <option value="ALL">{text.all}</option>
                          <option value="PAID">{text.paid}</option>
                          <option value="PAYABLE">{text.payable}</option>
                        </BaseerFilterSelect>
                        <BaseerFilterSelect
                          label={text.status}
                          value={historyStatus}
                          onChange={(event) =>
                            setHistoryStatus(
                              event.target.value as typeof historyStatus,
                            )
                          }
                        >
                          <option value="POSTED">{text.posted}</option>
                          <option value="CANCELLED">{text.cancelled}</option>
                          <option value="ALL">{text.all}</option>
                        </BaseerFilterSelect>
                      </>
                    }
                  />
                  {historyByDay.length ? (
                    <div className="purchase-history-by-day">
                      {historyByDay.map(([day, dayDocuments]) => (
                        <section key={day} className="purchase-history-day">
                          <header>
                            <time dateTime={day} dir="ltr">
                              {day}
                            </time>
                            <span>
                              {dayDocuments.length}{" "}
                              {language === "ar"
                                ? "فاتورة"
                                : dayDocuments.length === 1
                                  ? "invoice"
                                  : "invoices"}
                            </span>
                          </header>
                          <div className="purchase-history-day__documents">
                            {dayDocuments.map((document) => (
                              <article key={document.id}>
                                <div className="purchase-history-document__number">
                                  <strong dir="ltr">
                                    {document.documentNumber}
                                  </strong>
                                  {document.postingVersion > 1 ? (
                                    <small>v{document.postingVersion}</small>
                                  ) : null}
                                </div>
                                <span>
                                  {document.kind === "PURCHASE"
                                    ? text.purchaseInvoice
                                    : text.expenseInvoice}{" "}
                                  ·{" "}
                                  {document.status === "POSTED"
                                    ? text.posted
                                    : text.cancelled}
                                </span>
                                <span>
                                  {displayName(language, {
                                    nameAr: document.categoryNameAr,
                                    nameEn: document.categoryNameEn,
                                  })}
                                  {document.supplierNameAr
                                    ? ` · ${displayName(language, { nameAr: document.supplierNameAr, nameEn: document.supplierNameEn })}`
                                    : ""}
                                </span>
                                <strong>
                                  {formatMoney(document.grossAmount)}
                                </strong>
                                <BaseerButton
                                  type="button"
                                  variant="secondary"
                                  onClick={() => openView(document)}
                                >
                                  {language === "ar" ? "عرض" : "View"}
                                </BaseerButton>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-results">{text.noInvoices}</p>
                  )}
                </section>
              </BaseerBatchPanel>
          ) : (
            <BaseerBatchPanel
              id="purchase-tab-panel-credit"
              labelledBy="purchase-tab-credit"
            >
              <Suspense
                fallback={
                  <BaseerCard>
                    <p>{text.loading}</p>
                  </BaseerCard>
                }
              >
                <PurchaseExpenseCreditPanel
                  credit={credit}
                  language={language}
                  vaults={paymentVaults}
                  reload={loadCredit}
                />
              </Suspense>
            </BaseerBatchPanel>
          )}
        </section>
      )}
      <BaseerDialog
        open={reverseTarget !== null}
        language={language}
        busy={saving}
        title={text.reverseDocument}
        onClose={() => setReverseTarget(null)}
        footer={
          <>
            <BaseerButton type="button" onClick={() => setReverseTarget(null)}>
              {text.cancel}
            </BaseerButton>
            <BaseerButton
              type="submit"
              variant="danger"
              form="reverse-purchase-document"
              disabled={
                saving || !reversalBusinessDate || !reversalReason.trim()
              }
            >
              {saving ? text.saving : text.confirmReversal}
            </BaseerButton>
          </>
        }
      >
        <BaseerValidatedForm
          id="reverse-purchase-document"
          className="administration-form"
          values={{ businessDate: reversalBusinessDate, reason: reversalReason }}
          schemaFactory={reversalSchemaFactory}
          errorSummaryLabel={validationMessage}
          onValid={() => reverseDocument()}
        >
          <p>{text.reverseDocumentDescription}</p>
          <BaseerDatePicker
            language={language}
            label={text.documentDate}
            min={reverseTarget?.businessDate.slice(0, 10)}
            max={businessDate || undefined}
            value={reversalBusinessDate}
            onChange={setReversalBusinessDate}
          />
          <label>
            {text.reversalReason}
            <BaseerTextArea
              required
              value={reversalReason}
              onValueChange={setReversalReason}
            />
          </label>
        </BaseerValidatedForm>
      </BaseerDialog>
      <BaseerDialog
        open={viewTarget !== null}
        language={language}
        className="purchase-document-dialog"
        title={viewTarget?.documentNumber ?? ""}
        onClose={() => setViewTarget(null)}
        footer={
          <div className="purchase-document-view__actions">
            {viewTarget?.status === "POSTED" && ownerCanAmend ? (
              <BaseerButton
                type="button"
                variant="primary"
                onClick={() => {
                  const target = viewTarget;
                  setViewTarget(null);
                  openAmendment(target);
                }}
              >
                {language === "ar" ? "تعديل" : "Edit"}
              </BaseerButton>
            ) : null}
            {viewTarget?.status === "POSTED" ? (
              <BaseerButton
                type="button"
                variant="danger"
                onClick={() => {
                  const target = viewTarget;
                  setViewTarget(null);
                  openReverse(target);
                }}
              >
                {language === "ar" ? "حذف" : "Delete"}
              </BaseerButton>
            ) : null}
            <BaseerButton
              type="button"
              variant="secondary"
              onClick={() => setViewTarget(null)}
            >
              {language === "ar" ? "إغلاق" : "Close"}
            </BaseerButton>
          </div>
        }
      >
        {viewTarget ? (
          <div className="purchase-document-view">
            <div>
              <span>{language === "ar" ? "نوع الفاتورة" : "Type"}</span>
              <strong>
                {viewTarget.kind === "PURCHASE"
                  ? text.purchaseInvoice
                  : text.expenseInvoice}
              </strong>
            </div>
            <div>
              <span>{text.documentDate}</span>
              <strong dir="ltr">{viewTarget.businessDate.slice(0, 10)}</strong>
            </div>
            <div>
              <span>{text.financialCategory}</span>
              <strong>
                {displayName(language, {
                  nameAr: viewTarget.categoryNameAr,
                  nameEn: viewTarget.categoryNameEn,
                })}
              </strong>
            </div>
            <div>
              <span>{language === "ar" ? "المورد" : "Supplier"}</span>
              <strong>
                {viewTarget.supplierNameAr
                  ? displayName(language, {
                      nameAr: viewTarget.supplierNameAr,
                      nameEn:
                        viewTarget.supplierNameEn ?? viewTarget.supplierNameAr,
                    })
                  : "—"}
              </strong>
            </div>
            <div>
              <span>{text.settlement}</span>
              <strong>
                {viewTarget.settlementKind === "PAID"
                  ? text.paid
                  : text.payable}
              </strong>
            </div>
            <div>
              <span>{text.totalAmount}</span>
              <strong>{formatMoney(viewTarget.grossAmount)}</strong>
            </div>
            <div>
              <span>
                {language === "ar" ? "رقم فاتورة المورد" : "Supplier invoice"}
              </span>
              <strong dir="ltr">
                {viewTarget.supplierInvoiceNumber ?? "—"}
              </strong>
            </div>
            <div>
              <span>{text.status}</span>
              <strong>
                {viewTarget.status === "POSTED" ? text.posted : text.cancelled}
              </strong>
            </div>
            {viewTarget.notes ? (
              <div className="purchase-document-view__notes">
                <span>{text.notes}</span>
                <p>{viewTarget.notes}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </BaseerDialog>
      <BaseerDialog
        open={amendTarget !== null && amendmentRow !== null}
        language={language}
        busy={saving}
        title={
          language === "ar"
            ? `تعديل ${amendTarget?.documentNumber ?? ""}`
            : `Edit ${amendTarget?.documentNumber ?? ""}`
        }
        onClose={() => {
          setAmendTarget(null);
          setAmendmentRow(null);
        }}
        footer={
          <>
            <BaseerButton
              type="button"
              onClick={() => {
                setAmendTarget(null);
                setAmendmentRow(null);
              }}
            >
              {text.cancel}
            </BaseerButton>
            <BaseerButton
              type="submit"
              variant="primary"
              form="amend-purchase-document"
              disabled={saving}
            >
              {saving
                ? text.saving
                : language === "ar"
                  ? "حفظ التعديل"
                  : "Save changes"}
            </BaseerButton>
          </>
        }
      >
        {amendmentRow ? (
          <BaseerValidatedForm
            id="amend-purchase-document"
            className="administration-form"
            values={{ businessDate: amendmentDate, row: amendmentRow }}
            schemaFactory={amendmentSchemaFactory}
            errorSummaryLabel={validationMessage}
            onValid={() => submitAmendment()}
          >
            <p>
              {language === "ar"
                ? "يحافظ النظام على رقم السند ويضيف نسخة تدقيقية جديدة؛ لا يظهر العكس ضمن تجربة التعديل."
                : "The document number remains unchanged. A new internal audit revision is posted safely."}
            </p>
            <BaseerDatePicker
              language={language}
              label={text.documentDate}
              min={amendTarget?.businessDate.slice(0, 10)}
              max={businessDate || undefined}
              value={amendmentDate}
              onChange={setAmendmentDate}
            />
            <label>
              {language === "ar" ? "نوع السند" : "Document type"}
              <BaseerStaticSelect label={language === "ar" ? "نوع السند" : "Document type"}
                value={amendmentRow.kind}
                onChange={(event) =>
                  updateAmendment(
                    "kind",
                    event.target.value as BatchRow["kind"],
                  )
                }
              >
                <option value="PURCHASE">{text.purchaseInvoice}</option>
                <option value="EXPENSE">{text.expenseInvoice}</option>
              </BaseerStaticSelect>
            </label>
            <label>
              {language === "ar" ? "التسوية" : "Settlement"}
              <BaseerStaticSelect label={language === "ar" ? "التسوية" : "Settlement"}
                value={amendmentRow.settlementKind}
                onChange={(event) =>
                  updateAmendment(
                    "settlementKind",
                    event.target.value as BatchRow["settlementKind"],
                  )
                }
              >
                <option value="PAID">
                  {language === "ar" ? "مدفوع" : "Paid"}
                </option>
                <option value="PAYABLE">
                  {language === "ar" ? "آجل" : "Payable"}
                </option>
              </BaseerStaticSelect>
            </label>
            <label>
              {text.financialCategory}
              <BaseerCombobox
                required
                label={text.financialCategory}
                value={amendmentRow.categoryId}
                placeholder={text.selectCategory}
                options={categories.filter((category) => category.kind === amendmentRow.kind).map((category) => ({ id: category.id, label: displayName(language, category) }))}
                onChange={(categoryId) => updateAmendment("categoryId", categoryId)}
              />
            </label>
            <label>
              {language === "ar" ? "المورد" : "Supplier"}
              <BaseerCombobox
                label={language === "ar" ? "المورد" : "Supplier"}
                value={amendmentRow.supplierId}
                placeholder={language === "ar" ? "بدون مورد" : "No supplier"}
                options={suppliers.map((supplier) => ({ id: supplier.id, label: displayName(language, supplier) }))}
                onChange={(supplierId) => updateAmendment("supplierId", supplierId)}
              />
            </label>
            <label>
              {language === "ar"
                ? "رقم فاتورة المورد"
                : "Supplier invoice number"}
              <input
                value={amendmentRow.invoiceNumber}
                onChange={(event) =>
                  updateAmendment("invoiceNumber", event.target.value)
                }
              />
            </label>
            <label>
              {language === "ar"
                ? "سبب عدم وجود الرقم"
                : "Missing-number reason"}
              <input
                value={amendmentRow.missingReason}
                onChange={(event) =>
                  updateAmendment("missingReason", event.target.value)
                }
              />
            </label>
            <label>
              {language === "ar" ? "المبلغ الإجمالي" : "Gross amount"}
              <BaseerMoneyInput
                required
                value={amendmentRow.grossAmount}
                onValueChange={(grossAmount) => updateAmendment("grossAmount", grossAmount)}
              />
            </label>
            {amendmentRow.settlementKind === "PAID" ? (
              <label>
                {language === "ar"
                  ? "الخزينة / طريقة الدفع"
                  : "Vault / payment method"}
                <BaseerCombobox
                  required
                  label={language === "ar" ? "الخزينة / طريقة الدفع" : "Vault / payment method"}
                  value={amendmentRow.vaultId}
                  placeholder={language === "ar" ? "اختر الخزينة" : "Choose a vault"}
                  options={paymentVaults.map((vault) => ({ id: vault.id, label: displayName(language, vault) }))}
                  onChange={(vaultId) => updateAmendment("vaultId", vaultId)}
                />
              </label>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={amendmentRow.isTaxable}
                onChange={(event) =>
                  updateAmendment("isTaxable", event.target.checked)
                }
              />{" "}
              {language === "ar" ? "خاضع للضريبة" : "Taxable"}
            </label>
            <label>
              {text.batchNotes}
              <textarea
                value={amendmentRow.notes}
                onChange={(event) =>
                  updateAmendment("notes", event.target.value)
                }
              />
            </label>
          </BaseerValidatedForm>
        ) : null}
      </BaseerDialog>
    </section>
  );
}

function mergeCreditSupplierPages(
  current: CreditWorkspace["suppliers"],
  next: CreditWorkspace["suppliers"],
) {
  const groups = new Map(
    current.map((supplier) => [
      supplier.supplierId,
      { ...supplier, dues: [...supplier.dues] },
    ]),
  );
  for (const supplier of next) {
    const existing = groups.get(supplier.supplierId);
    if (existing) {
      existing.dues.push(...supplier.dues);
      existing.invoiceCount += supplier.invoiceCount;
    } else groups.set(supplier.supplierId, supplier);
  }
  return [...groups.values()];
}

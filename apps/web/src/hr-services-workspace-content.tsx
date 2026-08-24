import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { baseerDecimalString, useBaseerForm, z } from "./baseer-form-state";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import type { BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { cancelHrEmployeeService, getHrEmployeeService, issueHrEmployeeServiceCost, listHrEmployeeServices, listHrEmployees, recordHrEmployeeServiceAndIssueCost, renewHrEmployeeService, reverseHrEmployeeServiceCost, updateHrEmployeeService, type HrEmployee, type HrEmployeeServiceComplianceStatus, type HrEmployeeServiceRecord, type HrService } from "./hr-services-client";
import { reportTopmostDialogError } from "./use-dialog-focus-trap";
import { hasActivePermission } from "./module-access";
import { consumeHrRouteStage } from "./hr-route-stage";

type Language = "ar" | "en";
type ServiceForm = { employeeId: string; serviceType: HrService["serviceType"]; referenceNumber: string; issueDate: string; expiryDate: string; supplierId: string; categoryId: string; visaDurationMonths: string; notes: string };
type CostForm = { serviceId: string; businessDate: string; grossAmount: string; isTaxable: boolean; vaultId: string; supplierInvoiceNumber: string; supplierInvoiceMissingReason: string; supplierInvoiceDate: string; notes: string };
type FinanceConfiguration = { suppliers: Array<{ id: string; nameAr: string; nameEn: string | null; status: "ACTIVE" | "ARCHIVED" }>; categories: Array<{ id: string; code: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" | "SALE"; status: "ACTIVE" | "ARCHIVED"; suggestedSupplierId: string | null; isPosting: boolean }>; vaults: Array<{ id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean }> };

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const emptyService = (employeeId = ""): ServiceForm => ({ employeeId, serviceType: "IQAMA_RENEWAL", referenceNumber: "", issueDate: today(), expiryDate: "", supplierId: "", categoryId: "", visaDurationMonths: "", notes: "" });
const emptyCost = (serviceId = "", vaultId = ""): CostForm => ({ serviceId, businessDate: today(), grossAmount: "", isTaxable: true, vaultId, supplierInvoiceNumber: "", supplierInvoiceMissingReason: "", supplierInvoiceDate: today(), notes: "" });
const defaultCategoryCode = (serviceType: HrService["serviceType"]): string | undefined => ({ IQAMA_ISSUANCE: "E2-4", IQAMA_RENEWAL: "E2-4", EXIT_REENTRY_VISA: "E2-4", SPONSORSHIP_TRANSFER: "E2-8", MEDICAL_INSURANCE: "E4-2", HEALTH_CERTIFICATE: "E2-9" } as Partial<Record<HrService["serviceType"], string>>)[serviceType];
const serviceTypes = ["IQAMA_ISSUANCE", "IQAMA_RENEWAL", "SPONSORSHIP_TRANSFER", "EXIT_REENTRY_VISA", "FLIGHT_TICKET", "MEDICAL_INSURANCE", "HEALTH_CERTIFICATE", "OTHER"] as const;
const isoDate = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);

function employeeLabel(language: Language, employee: Pick<HrEmployee, "employeeNumber" | "nameAr" | "nameEn">) { return `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`; }
function FieldError({ message }: { message?: string }) { return message ? <small role="alert" className="daily-sales-message error">{message}</small> : null; }

export function HrServicesWorkspace({ language, stage }: { language: Language; stage?: string | null }) {
  const ar = language === "ar";
  const copy = useMemo(() => ({
    required: ar ? "هذا الحقل مطلوب." : "This field is required.",
    date: ar ? "أدخل تاريخاً ميلادياً صحيحاً." : "Enter a valid Gregorian date.",
    amount: ar ? "أدخل مبلغاً عشرياً موجباً صحيحاً." : "Enter a valid positive decimal amount.",
    expiry: ar ? "تاريخ الانتهاء مطلوب لهذا النوع من الخدمات." : "An expiry date is required for this service type.",
    reference: ar ? "الرقم المرجعي مطلوب لهذا النوع من الخدمات." : "A reference number is required for this service type.",
    cancellationReason: ar ? "أدخل سبب الإلغاء قبل التأكيد." : "Enter a cancellation reason before confirming.",
    visaDuration: ar ? "أدخل مدة من شهر إلى خمسة أشهر." : "Enter a duration from one to five months.",
    afterIssue: ar ? "لا يمكن أن يسبق تاريخ الانتهاء تاريخ الإصدار." : "The expiry date cannot be before the issue date.",
  }), [ar]);
  const serviceSchema = useMemo(() => z.object({
    employeeId: z.string().trim().min(1, copy.required),
    serviceType: z.enum(serviceTypes),
    referenceNumber: z.string(),
    issueDate: z.string().refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), copy.date),
    expiryDate: z.string().refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), copy.date),
    supplierId: z.string(),
    categoryId: z.string(),
    visaDurationMonths: z.string(),
    notes: z.string(),
  }).superRefine((value, context) => {
    const requiresReference = value.serviceType === "IQAMA_ISSUANCE" || value.serviceType === "IQAMA_RENEWAL";
    const requiresExpiry = requiresReference || value.serviceType === "MEDICAL_INSURANCE" || value.serviceType === "HEALTH_CERTIFICATE";
    if (requiresReference && !value.referenceNumber.trim()) context.addIssue({ code: "custom", path: ["referenceNumber"], message: copy.reference });
    if (requiresExpiry && !value.expiryDate) context.addIssue({ code: "custom", path: ["expiryDate"], message: copy.expiry });
    if (value.issueDate && value.expiryDate && value.expiryDate < value.issueDate) context.addIssue({ code: "custom", path: ["expiryDate"], message: copy.afterIssue });
    if (value.serviceType === "EXIT_REENTRY_VISA" && !/^[1-5]$/.test(value.visaDurationMonths)) context.addIssue({ code: "custom", path: ["visaDurationMonths"], message: copy.visaDuration });
  }), [copy]);
  const costSchema = useMemo(() => z.object({
    serviceId: z.string(),
    businessDate: isoDate(copy.date),
    grossAmount: baseerDecimalString(copy.amount),
    isTaxable: z.boolean(),
    vaultId: z.string().trim().min(1, copy.required),
    supplierInvoiceNumber: z.string(),
    supplierInvoiceMissingReason: z.string(),
    supplierInvoiceDate: z.string().refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), copy.date),
    notes: z.string(),
  }).superRefine((value, context) => {
    if (value.supplierInvoiceDate && value.supplierInvoiceDate > value.businessDate) context.addIssue({ code: "custom", path: ["supplierInvoiceDate"], message: ar ? "لا يمكن أن يتجاوز تاريخ الفاتورة تاريخ الدفع." : "The invoice date cannot be after the payment date." });
  }), [ar, copy]);
  const reversalSchema = useMemo(() => z.object({ serviceId: z.string().trim().min(1), businessDate: isoDate(copy.date), reason: z.string().trim().min(1, copy.required) }), [copy]);
  const cancellationSchema = useMemo(() => z.object({ reason: z.string().trim().min(1, copy.cancellationReason) }), [copy]);
  const serviceFormState = useBaseerForm<ServiceForm>({ schema: serviceSchema, defaultValues: emptyService(), mode: "onBlur" });
  const costFormState = useBaseerForm<CostForm>({ schema: costSchema, defaultValues: emptyCost(), mode: "onBlur" });
  const costReversalFormState = useBaseerForm<{ serviceId: string; businessDate: string; reason: string }>({ schema: reversalSchema, defaultValues: { serviceId: "", businessDate: today(), reason: "" }, mode: "onBlur" });
  const cancelFormState = useBaseerForm<{ reason: string }>({ schema: cancellationSchema, defaultValues: { reason: "" }, mode: "onBlur" });
  const serviceForm = serviceFormState.watch();
  const costForm = costFormState.watch();
  const costReversal = costReversalFormState.watch();
  const updateForm = <Values extends Record<string, unknown>>(form: { getValues: () => Values; setValue: (name: keyof Values, value: Values[keyof Values], options: { shouldDirty: boolean; shouldValidate: boolean }) => void }, update: Values | ((current: Values) => Values)) => {
    const next = typeof update === "function" ? update(form.getValues()) : update;
    (Object.keys(next) as Array<keyof Values>).forEach((key) => form.setValue(key, next[key], { shouldDirty: true, shouldValidate: true }));
  };
  const setServiceForm = (update: ServiceForm | ((current: ServiceForm) => ServiceForm)) => updateForm(serviceFormState, update);
  const setCostForm = (update: CostForm | ((current: CostForm) => CostForm)) => updateForm(costFormState, update);
  const setCostReversal = (update: { serviceId: string; businessDate: string; reason: string } | ((current: { serviceId: string; businessDate: string; reason: string }) => { serviceId: string; businessDate: string; reason: string })) => updateForm(costReversalFormState, update);
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [services, setServices] = useState<HrEmployeeServiceRecord[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [configuration, setConfiguration] = useState<FinanceConfiguration | null>(null);
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [summary, setSummary] = useState({ count: 0, expired: 0, due30: 0, due90: 0 });
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | HrService["serviceType"]>("");
  const [complianceFilter, setComplianceFilter] = useState<"" | HrEmployeeServiceComplianceStatus>("");
  const [expiryFilter, setExpiryFilter] = useState<"" | "EXPIRED" | "DUE_30" | "DUE_60" | "DUE_90" | "NO_EXPIRY">("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [costReversalOpen, setCostReversalOpen] = useState(false);
  const [detail, setDetail] = useState<HrEmployeeServiceRecord | null>(null);
  const [actionService, setActionService] = useState<HrEmployeeServiceRecord | null>(null);
  const showError = (text: string) => { if (!reportTopmostDialogError(text)) setMessage(text); };
  const loadRequestRef = useRef(0);
  const cancelReasonRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { const timeout = window.setTimeout(() => setServerSearch(search.trim()), 250); return () => window.clearTimeout(timeout); }, [search]);

  const loadConfiguration = useCallback(async () => {
    const current = activeSession(); if (!current) return null;
    const result = await api<FinanceConfiguration>(current, "/finance/configuration"); setConfiguration(result); return result;
  }, []);
  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return; }
    const requestNumber = ++loadRequestRef.current;
    if (!append) setLoading(true);
    try {
      const [serviceReceipt, employeeReceipt] = await Promise.all([listHrEmployeeServices(current, { employeeId: employeeFilter || undefined, serviceType: typeFilter || undefined, complianceStatus: complianceFilter || undefined, search: serverSearch || undefined, cursor, pageSize: 100 }), append ? Promise.resolve(null) : listHrEmployees(current)]);
      if (requestNumber !== loadRequestRef.current) return;
      setServices((previous) => append ? [...previous, ...serviceReceipt.services] : serviceReceipt.services);
      setNextCursor(serviceReceipt.nextCursor);
      setSummary(serviceReceipt.summary);
      if (employeeReceipt) setEmployees((current) => [...employeeReceipt.employees, ...current.filter((employee) => !employeeReceipt.employees.some((candidate) => candidate.id === employee.id))]);
    } catch (error) { showError(presentBaseerLoadError(error, language, { ar: "خدمات الموظفين", en: "employee services" })); }
    finally { if (requestNumber === loadRequestRef.current) setLoading(false); }
  }, [ar, complianceFilter, employeeFilter, language, serverSearch, typeFilter]);
  useEffect(() => { void load(); }, [load]);
  const searchEmployees = useCallback(async (query: string, activeOnly: boolean, signal: AbortSignal) => {
    const current = activeSession(); if (!current) return [];
    const receipt = await listHrEmployees(current, { search: query.trim() || undefined, pageSize: 50 }, { signal });
    const next = activeOnly ? receipt.employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE") : receipt.employees;
    setEmployees((existing) => [...existing, ...next.filter((employee) => !existing.some((candidate) => candidate.id === employee.id))]);
    return next.map((employee) => ({ id: employee.id, label: employeeLabel(language, employee) }));
  }, [language]);
  const searchAllEmployeeOptions = useCallback((query: string, signal: AbortSignal) => searchEmployees(query, false, signal), [searchEmployees]);
  const searchActiveEmployeeOptions = useCallback((query: string, signal: AbortSignal) => searchEmployees(query, true, signal), [searchEmployees]);

  const serviceTypeLabel = (value: HrService["serviceType"]) => ({ IQAMA_ISSUANCE: ar ? "إصدار إقامة" : "Iqama issuance", IQAMA_RENEWAL: ar ? "تجديد إقامة" : "Iqama renewal", SPONSORSHIP_TRANSFER: ar ? "نقل كفالة" : "Sponsorship transfer", EXIT_REENTRY_VISA: ar ? "خروج وعودة" : "Exit/re-entry visa", FLIGHT_TICKET: ar ? "تذكرة سفر" : "Flight ticket", MEDICAL_INSURANCE: ar ? "تأمين طبي" : "Medical insurance", HEALTH_CERTIFICATE: ar ? "شهادة صحية" : "Health certificate", OTHER: ar ? "خدمة أخرى" : "Other service" })[value];
  const complianceLabel = (value: HrEmployeeServiceComplianceStatus) => ({ ACTIVE: ar ? "سارية" : "Active", RENEWED: ar ? "مجددة" : "Renewed", CANCELLED: ar ? "ملغاة" : "Cancelled" })[value];
  const expiryState = (service: HrEmployeeServiceRecord): "EXPIRED" | "DUE_30" | "DUE_60" | "DUE_90" | "NO_EXPIRY" | "VALID" => {
    if (!service.expiryDate) return "NO_EXPIRY";
    if (service.expiryDate < today()) return "EXPIRED";
    if (service.expiryDate <= inDays(30)) return "DUE_30";
    if (service.expiryDate <= inDays(60)) return "DUE_60";
    if (service.expiryDate <= inDays(90)) return "DUE_90";
    return "VALID";
  };
  const expiryLabel = (value: ReturnType<typeof expiryState>) => ({ EXPIRED: ar ? "منتهية" : "Expired", DUE_30: ar ? "تنتهي خلال 30 يوماً" : "Due within 30 days", DUE_60: ar ? "تنتهي خلال 60 يوماً" : "Due within 60 days", DUE_90: ar ? "تنتهي خلال 90 يوماً" : "Due within 90 days", NO_EXPIRY: ar ? "بلا تاريخ انتهاء" : "No expiry", VALID: ar ? "صالحة" : "Valid" })[value];
  const statusLabel = (value: HrService["status"]) => value === "DRAFT" ? (ar ? "مسودة" : "Draft") : value === "ISSUED" ? (ar ? "مصدرة" : "Issued") : (ar ? "ملغاة" : "Cancelled");
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE"), [employees]);
  useEffect(() => {
    const category = configuration?.categories.find((item) => item.code === defaultCategoryCode(serviceForm.serviceType) && item.status === "ACTIVE" && item.kind === "EXPENSE" && item.isPosting);
    if (!category) return;
    setServiceForm((value) => value.categoryId === category.id ? value : { ...value, categoryId: category.id, supplierId: category.suggestedSupplierId ?? value.supplierId });
  }, [configuration, serviceForm.serviceType]);
  const activeSuppliers = configuration?.suppliers.filter((supplier) => supplier.status === "ACTIVE") ?? [];
  const activeCategories = configuration?.categories.filter((category) => category.status === "ACTIVE" && category.kind === "EXPENSE" && category.isPosting) ?? [];
  const activeVaults = configuration?.vaults.filter((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination) ?? [];
  const visibleServices = useMemo(() => services.filter((service) => !expiryFilter || expiryState(service) === expiryFilter), [expiryFilter, services]);
  const loadDetail = async (service: HrEmployeeServiceRecord) => { const current = activeSession(); if (!current) return; try { setDetail((await getHrEmployeeService(current, service.id)).service); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "تفاصيل الخدمة" : "Service details")); } };
  const prepareService = async (mode: "create" | "edit" | "renew", service?: HrEmployeeServiceRecord) => { try { const next = await loadConfiguration(); setActionService(service ?? null); serviceFormState.reset(service ? { employeeId: service.employeeId, serviceType: service.serviceType, referenceNumber: service.referenceNumber ?? "", issueDate: mode === "renew" ? today() : service.issueDate ?? "", expiryDate: service.expiryDate ?? "", supplierId: service.supplier?.id ?? "", categoryId: service.category?.id ?? "", visaDurationMonths: service.visaDurationMonths?.toString() ?? "", notes: service.notes ?? "" } : emptyService()); if (mode === "create") costFormState.reset(emptyCost("", next?.vaults.find((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination)?.id ?? "")); setDetail(null); if (mode === "create") setCreateOpen(true); if (mode === "edit") setEditOpen(true); if (mode === "renew") setRenewOpen(true); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "إعداد الخدمة" : "Preparing service")); } };
  useEffect(() => { if (stage !== "record-service") return; consumeHrRouteStage(5); void prepareService("create"); }, [stage]);
  const serviceFields = () => ({ serviceType: serviceForm.serviceType, referenceNumber: serviceForm.referenceNumber || undefined, issueDate: serviceForm.issueDate || undefined, expiryDate: serviceForm.expiryDate || undefined, supplierId: serviceForm.supplierId || undefined, categoryId: serviceForm.categoryId || undefined, visaDurationMonths: serviceForm.visaDurationMonths ? Number(serviceForm.visaDurationMonths) : undefined, notes: serviceForm.notes || undefined, idempotencyKey: requestId() });
  const saveCreate = async () => { if (!serviceForm.categoryId || !serviceForm.supplierId) { if (!serviceForm.categoryId) serviceFormState.setError("categoryId", { message: copy.required }); if (!serviceForm.supplierId) serviceFormState.setError("supplierId", { message: copy.required }); return; } const validCost = await costFormState.trigger(); if (!validCost) return; const current = activeSession(); if (!current || busy) return; setBusy(true); try { await recordHrEmployeeServiceAndIssueCost(current, { employeeId: serviceForm.employeeId, serviceType: serviceForm.serviceType, referenceNumber: serviceForm.referenceNumber || undefined, issueDate: serviceForm.issueDate || undefined, expiryDate: serviceForm.expiryDate || undefined, supplierId: serviceForm.supplierId, categoryId: serviceForm.categoryId, visaDurationMonths: serviceForm.visaDurationMonths ? Number(serviceForm.visaDurationMonths) : undefined, businessDate: costForm.businessDate, grossAmount: costForm.grossAmount, isTaxable: costForm.isTaxable, supplierInvoiceNumber: costForm.supplierInvoiceNumber || undefined, supplierInvoiceMissingReason: costForm.supplierInvoiceMissingReason || undefined, supplierInvoiceDate: costForm.supplierInvoiceDate || undefined, notes: serviceForm.notes || costForm.notes || undefined, allocations: [{ vaultId: costForm.vaultId, grossAmount: costForm.grossAmount }], idempotencyKey: requestId() }); setCreateOpen(false); setMessage(ar ? "تم تسجيل الخدمة وإصدار فاتورتها وربطها بملف الموظف." : "The service, invoice and employee record were posted."); await load(); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "تسجيل الخدمة وإصدار الفاتورة" : "Recording service and issuing invoice")); } finally { setBusy(false); } };
  const saveEdit = async () => { const current = activeSession(); if (!current || busy || !actionService) return; setBusy(true); try { await updateHrEmployeeService(current, { serviceId: actionService.id, ...serviceFields() }); setEditOpen(false); setActionService(null); setMessage(ar ? "تم تحديث الخدمة." : "Service updated."); await load(); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "تحديث الخدمة" : "Updating service")); } finally { setBusy(false); } };
  const saveRenew = async () => { const current = activeSession(); if (!current || busy || !actionService) return; setBusy(true); try { await renewHrEmployeeService(current, { serviceId: actionService.id, ...serviceFields() }); setRenewOpen(false); setActionService(null); setMessage(ar ? "تم إنشاء تجديد الخدمة." : "Service renewal created."); await load(); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "تجديد الخدمة" : "Renewing service")); } finally { setBusy(false); } };
  const saveCancel = async (reason: string) => { const current = activeSession(); if (!current || busy || !actionService) return; setBusy(true); try { await cancelHrEmployeeService(current, { serviceId: actionService.id, reason, idempotencyKey: requestId() }); setCancelOpen(false); setActionService(null); setMessage(ar ? "تم إلغاء الخدمة مع حفظ السبب." : "Service cancelled and reason recorded."); await load(); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "إلغاء الخدمة" : "Cancelling service")); } finally { setBusy(false); } };
  const openCost = async (service: HrEmployeeServiceRecord) => { if (!service.supplier || !service.category) { showError(ar ? "اختر المورد والبند المالي للخدمة قبل إصدار تكلفتها." : "Select the supplier and financial category before issuing the cost."); return; } try { const next = configuration ?? await loadConfiguration(); costFormState.reset(emptyCost(service.id, next?.vaults.find((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination)?.id ?? "")); setCostOpen(true); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "إعداد التكلفة" : "Preparing cost")); } };
  const saveCost = async () => { const current = activeSession(); if (!current || busy) return; setBusy(true); try { await issueHrEmployeeServiceCost(current, { serviceId: costForm.serviceId, businessDate: costForm.businessDate, grossAmount: costForm.grossAmount, isTaxable: costForm.isTaxable, supplierInvoiceNumber: costForm.supplierInvoiceNumber || undefined, supplierInvoiceMissingReason: costForm.supplierInvoiceMissingReason || undefined, supplierInvoiceDate: costForm.supplierInvoiceDate || undefined, notes: costForm.notes || undefined, allocations: [{ vaultId: costForm.vaultId, grossAmount: costForm.grossAmount }], idempotencyKey: requestId() }); setCostOpen(false); setDetail(null); setMessage(ar ? "تم إصدار تكلفة الخدمة وربطها بسجل الموظف." : "The service cost was posted and linked to the employee record."); await load(); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "إصدار التكلفة" : "Issuing cost")); } finally { setBusy(false); } };
  const reverseCost = async () => { const current = activeSession(); if (!current || busy) return; setBusy(true); try { await reverseHrEmployeeServiceCost(current, { ...costReversal, idempotencyKey: requestId() }); setCostReversalOpen(false); setDetail(null); setMessage(ar ? "تم إلغاء تكلفة الخدمة." : "The service cost was cancelled."); await load(); } catch (error) { showError(presentBaseerApiError(error, language, ar ? "إلغاء تكلفة الخدمة" : "Cancelling service cost")); } finally { setBusy(false); } };
  const appliedFilters = [{ id: "employee", value: employeeFilter, label: employees.find((employee) => employee.id === employeeFilter) ? employeeLabel(language, employees.find((employee) => employee.id === employeeFilter)!) : "", clear: () => setEmployeeFilter("") }, { id: "type", value: typeFilter, label: typeFilter ? serviceTypeLabel(typeFilter) : "", clear: () => setTypeFilter("") }, { id: "compliance", value: complianceFilter, label: complianceFilter ? complianceLabel(complianceFilter) : "", clear: () => setComplianceFilter("") }, { id: "expiry", value: expiryFilter, label: expiryFilter ? expiryLabel(expiryFilter) : "", clear: () => setExpiryFilter("") }].filter((item) => item.value).map((item) => ({ id: item.id, label: item.label, onRemove: item.clear }));
  const columns: readonly BaseerDataGridColumn<HrEmployeeServiceRecord>[] = [
    { id: "employee", header: ar ? "الموظف" : "Employee", cell: (row) => <BaseerButton variant="quiet" type="button" onClick={() => void loadDetail(row)}>{employeeLabel(language, row.employee)}</BaseerButton>, sort: (row) => ar ? row.employee.nameAr : row.employee.nameEn ?? row.employee.nameAr },
    { id: "service", header: ar ? "الخدمة" : "Service", cell: (row) => serviceTypeLabel(row.serviceType), sort: (row) => row.serviceType, width: "10rem" },
    { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row) => row.referenceNumber ?? "—", sort: (row) => row.referenceNumber ?? "", width: "10rem" },
    { id: "expiry", header: ar ? "الانتهاء" : "Expiry", cell: (row) => row.expiryDate ?? "—", sort: (row) => row.expiryDate ?? "", width: "9rem" },
    { id: "compliance", header: ar ? "الانتهاء" : "Expiry state", cell: (row) => expiryLabel(expiryState(row)), sort: (row) => row.expiryDate ?? "", width: "12rem" },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (row) => statusLabel(row.status), sort: (row) => row.status, width: "8rem" },
  ];
  const serviceRequiresReference = serviceForm.serviceType === "IQAMA_ISSUANCE" || serviceForm.serviceType === "IQAMA_RENEWAL";
  const serviceRequiresExpiry = serviceRequiresReference || serviceForm.serviceType === "MEDICAL_INSURANCE" || serviceForm.serviceType === "HEALTH_CERTIFICATE";
  if (!session) return <DailySalesSignIn language={language} />;
  const serviceFormBody = (id: string, submit: () => Promise<void>, employeeLocked = false, issueCost = false) => <form id={id} className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={serviceFormState.handleSubmit(() => void submit())}>
    <BaseerFormSection title={ar ? "بيانات الخدمة" : "Service details"}><BaseerFormGrid>
      <label className="baseer-form-field--full">{ar ? "الموظف" : "Employee"}<BaseerCombobox required disabled={employeeLocked} label={ar ? "الموظف" : "Employee"} value={serviceForm.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={activeEmployees.map((employee) => ({ id: employee.id, label: employeeLabel(language, employee) }))} remoteSearch={searchActiveEmployeeOptions} scopeKey={session?.companyId ?? "signed-out"} onChange={(employeeId) => setServiceForm((value) => ({ ...value, employeeId }))} /><FieldError message={serviceFormState.formState.errors.employeeId?.message} /></label>
      <label>{ar ? "نوع الخدمة" : "Service type"}<BaseerCombobox searchable={false} required label={ar ? "نوع الخدمة" : "Service type"} value={serviceForm.serviceType} placeholder={ar ? "اختر النوع" : "Select type"} options={serviceTypes.map((type) => ({ id: type, label: serviceTypeLabel(type) }))} onChange={(serviceType) => setServiceForm((value) => ({ ...value, serviceType: serviceType as HrService["serviceType"] }))} /></label>
      <label>{ar ? "البند المالي" : "Financial category"}<BaseerCombobox required={issueCost} label={ar ? "البند المالي" : "Financial category"} value={serviceForm.categoryId} placeholder={issueCost ? (ar ? "اختر البند" : "Select category") : (ar ? "اختياري" : "Optional")} options={activeCategories.map((category) => ({ id: category.id, label: ar ? category.nameAr : category.nameEn }))} onChange={(categoryId) => setServiceForm((value) => ({ ...value, categoryId }))} /><FieldError message={serviceFormState.formState.errors.categoryId?.message} /></label>
      <label>{ar ? "المورد" : "Supplier"}<BaseerCombobox required={issueCost} label={ar ? "المورد" : "Supplier"} value={serviceForm.supplierId} placeholder={issueCost ? (ar ? "اختر المورد" : "Select supplier") : (ar ? "اختياري" : "Optional")} options={activeSuppliers.map((supplier) => ({ id: supplier.id, label: ar ? supplier.nameAr : supplier.nameEn ?? supplier.nameAr }))} onChange={(supplierId) => setServiceForm((value) => ({ ...value, supplierId }))} /><FieldError message={serviceFormState.formState.errors.supplierId?.message} /></label>
      <label>{ar ? "الرقم المرجعي" : "Reference number"}<input aria-invalid={Boolean(serviceFormState.formState.errors.referenceNumber)} required={serviceRequiresReference} value={serviceForm.referenceNumber} onChange={(event) => setServiceForm((value) => ({ ...value, referenceNumber: event.target.value }))} /><FieldError message={serviceFormState.formState.errors.referenceNumber?.message} /></label>
      <label>{ar ? "تاريخ الإصدار" : "Issue date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الإصدار" : "Issue date"} clearable max={today()} value={serviceForm.issueDate} onChange={(issueDate) => setServiceForm((value) => ({ ...value, issueDate }))} /><FieldError message={serviceFormState.formState.errors.issueDate?.message} /></label>
      <label>{ar ? "تاريخ الانتهاء" : "Expiry date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الانتهاء" : "Expiry date"} clearable={!serviceRequiresExpiry} min={serviceForm.issueDate || undefined} value={serviceForm.expiryDate} onChange={(expiryDate) => setServiceForm((value) => ({ ...value, expiryDate }))} /><FieldError message={serviceFormState.formState.errors.expiryDate?.message} /></label>
      {serviceForm.serviceType === "EXIT_REENTRY_VISA" ? <label>{ar ? "المدة بالأشهر" : "Duration in months"}<input aria-invalid={Boolean(serviceFormState.formState.errors.visaDurationMonths)} required min="1" max="5" inputMode="numeric" value={serviceForm.visaDurationMonths} onChange={(event) => setServiceForm((value) => ({ ...value, visaDurationMonths: event.target.value }))} /><FieldError message={serviceFormState.formState.errors.visaDurationMonths?.message} /></label> : null}
      {!issueCost ? <label className="baseer-form-field--full">{ar ? "ملاحظات" : "Notes"}<textarea value={serviceForm.notes} onChange={(event) => setServiceForm((value) => ({ ...value, notes: event.target.value }))} /></label> : null}
    </BaseerFormGrid></BaseerFormSection>
    {issueCost ? <BaseerFormSection title={ar ? "الفاتورة والدفع" : "Invoice and payment"}><BaseerFormGrid>
      <label>{ar ? "قيمة الخدمة" : "Service amount"}<input aria-invalid={Boolean(costFormState.formState.errors.grossAmount)} required inputMode="decimal" value={costForm.grossAmount} onChange={(event) => setCostForm((value) => ({ ...value, grossAmount: event.target.value }))} /><FieldError message={costFormState.formState.errors.grossAmount?.message} /></label>
      <label>{ar ? "الخزينة أو البنك" : "Vault or bank"}<BaseerCombobox required label={ar ? "الخزينة أو البنك" : "Vault or bank"} value={costForm.vaultId} placeholder={ar ? "اختر جهة الدفع" : "Select payment destination"} options={activeVaults.map((vault) => ({ id: vault.id, label: ar ? vault.nameAr : vault.nameEn }))} onChange={(vaultId) => setCostForm((value) => ({ ...value, vaultId }))} /><FieldError message={costFormState.formState.errors.vaultId?.message} /></label>
      <label>{ar ? "رقم فاتورة المورد" : "Supplier invoice number"}<input value={costForm.supplierInvoiceNumber} onChange={(event) => setCostForm((value) => ({ ...value, supplierInvoiceNumber: event.target.value, supplierInvoiceMissingReason: event.target.value ? "" : value.supplierInvoiceMissingReason }))} /></label>
      <label>{ar ? "أو سبب عدم وجود رقم فاتورة" : "Or invoice-number missing reason"}<input value={costForm.supplierInvoiceMissingReason} onChange={(event) => setCostForm((value) => ({ ...value, supplierInvoiceMissingReason: event.target.value, supplierInvoiceNumber: event.target.value ? "" : value.supplierInvoiceNumber }))} /></label>
      <label className="baseer-form-checkbox"><input type="checkbox" checked={costForm.isTaxable} onChange={(event) => setCostForm((value) => ({ ...value, isTaxable: event.target.checked }))} /> {ar ? "الفاتورة خاضعة للضريبة" : "Invoice is taxable"}</label>
      <details className="baseer-form-advanced"><summary>{ar ? "تفاصيل اختيارية" : "Optional details"}</summary><div><label>{ar ? "تاريخ الفاتورة والدفع" : "Invoice and payment date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الفاتورة والدفع" : "Invoice and payment date"} max={today()} value={costForm.businessDate} onChange={(businessDate) => setCostForm((value) => ({ ...value, businessDate, supplierInvoiceDate: value.supplierInvoiceDate || businessDate }))} /></label><label>{ar ? "تاريخ فاتورة المورد" : "Supplier invoice date"}<BaseerDatePicker language={language} label={ar ? "تاريخ فاتورة المورد" : "Supplier invoice date"} clearable max={costForm.businessDate} value={costForm.supplierInvoiceDate} onChange={(supplierInvoiceDate) => setCostForm((value) => ({ ...value, supplierInvoiceDate }))} /></label><label className="baseer-form-field--full">{ar ? "ملاحظات" : "Notes"}<textarea value={serviceForm.notes} onChange={(event) => setServiceForm((value) => ({ ...value, notes: event.target.value }))} /></label></div></details>
    </BaseerFormGrid></BaseerFormSection> : null}
  </form>;
  return <section className="administration-panel" aria-label={ar ? "خدمات الموظفين والامتثال" : "Employee services and compliance"}>
    <header className="administration-section-heading"><h2>{ar ? "خدمات الموظفين والامتثال" : "Employee services & compliance"}</h2><BaseerButton type="button" onClick={() => void prepareService("create")}>{ar ? "تسجيل خدمة" : "Record service"}</BaseerButton></header>
    <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص الامتثال" : "Compliance summary"}><BaseerSummaryMetric label={ar ? "منتهية" : "Expired"} value={summary.expired} /><BaseerSummaryMetric label={ar ? "تنتهي خلال 30 يوماً" : "Due within 30 days"} value={summary.due30} /><BaseerSummaryMetric label={ar ? "تنتهي خلال 60–90 يوماً" : "Due within 60–90 days"} value={summary.due90} /></BaseerSummaryMetricGrid>
    <BaseerFilterBar language={language} search={search} searchLabel={ar ? "البحث في خدمات الموظفين" : "Search employee services"} searchPlaceholder={ar ? "ابحث بالموظف أو الرقم المرجعي" : "Search employee or reference"} onSearchChange={setSearch} controlsPresentation="menu" controls={<><BaseerCombobox label={ar ? "الموظف" : "Employee"} value={employeeFilter} placeholder={ar ? "كل الموظفين" : "All employees"} options={employees.map((employee) => ({ id: employee.id, label: employeeLabel(language, employee) }))} remoteSearch={searchAllEmployeeOptions} scopeKey={session?.companyId ?? "signed-out"} onChange={setEmployeeFilter} /><label>{ar ? "النوع" : "Type"}<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="">{ar ? "كل الأنواع" : "All types"}</option>{serviceTypes.map((type) => <option key={type} value={type}>{serviceTypeLabel(type)}</option>)}</select></label><label>{ar ? "السجل التشغيلي" : "Operational status"}<select value={complianceFilter} onChange={(event) => setComplianceFilter(event.target.value as typeof complianceFilter)}><option value="">{ar ? "كل الحالات" : "All statuses"}</option>{(["ACTIVE", "RENEWED", "CANCELLED"] as const).map((status) => <option key={status} value={status}>{complianceLabel(status)}</option>)}</select></label><label>{ar ? "الانتهاء" : "Expiry"}<select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value as typeof expiryFilter)}><option value="">{ar ? "كل الفترات" : "All periods"}</option>{(["EXPIRED", "DUE_30", "DUE_60", "DUE_90", "NO_EXPIRY"] as const).map((status) => <option key={status} value={status}>{expiryLabel(status)}</option>)}</select></label></>} appliedFilters={appliedFilters} onClear={() => { setEmployeeFilter(""); setTypeFilter(""); setComplianceFilter(""); setExpiryFilter(""); }} />
    {message ? <p className="daily-sales-message error">{message}</p> : null}
    {loading ? <BaseerCard>{ar ? "جارٍ تحميل خدمات الموظفين…" : "Loading employee services…"}</BaseerCard> : visibleServices.length ? <BaseerDataGrid ariaLabel={ar ? "سجل خدمات الموظفين" : "Employee services register"} caption={ar ? "سجل خدمات الموظفين" : "Employee services register"} columns={columns} rows={visibleServices} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد خدمات مطابقة لهذه الشركة." : "No matching employee services for this company."}</BaseerCard>}
    {nextCursor ? <BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    <BaseerFormDialog open={createOpen} title={ar ? "تسجيل خدمة وإصدار فاتورة" : "Record service and issue invoice"} size="standard" language={language} busy={busy} formId="hr-service-create" submitLabel={ar ? "تسجيل الخدمة وإصدار الفاتورة" : "Record service and issue invoice"} onClose={() => setCreateOpen(false)}>{serviceFormBody("hr-service-create", saveCreate, false, true)}</BaseerFormDialog>
    <BaseerFormDialog open={editOpen} title={ar ? "تعديل الخدمة" : "Edit service"} size="standard" language={language} busy={busy} formId="hr-service-edit" submitLabel={ar ? "حفظ التعديل" : "Save changes"} onClose={() => setEditOpen(false)}>{serviceFormBody("hr-service-edit", saveEdit, true)}</BaseerFormDialog>
    <BaseerFormDialog open={renewOpen} title={ar ? "تجديد الخدمة" : "Renew service"} size="standard" language={language} busy={busy} formId="hr-service-renew" submitLabel={ar ? "إنشاء التجديد" : "Create renewal"} onClose={() => setRenewOpen(false)}>{serviceFormBody("hr-service-renew", saveRenew, true)}</BaseerFormDialog>
    <BaseerFormDialog open={cancelOpen} title={ar ? "إلغاء الخدمة" : "Cancel service"} size="compact" language={language} busy={busy} formId="hr-service-cancel" submitLabel={ar ? "تأكيد الإلغاء" : "Confirm cancellation"} cancelLabel={ar ? "رجوع" : "Back"} onClose={() => setCancelOpen(false)}><form id="hr-service-cancel" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={cancelFormState.handleSubmit(({ reason }) => void saveCancel(reason), () => cancelReasonRef.current?.focus())}><BaseerFormSection title={ar ? "سبب الإلغاء" : "Cancellation reason"}><BaseerFormGrid columns="one"><label>{ar ? "سبب الإلغاء" : "Cancellation reason"}<textarea ref={cancelReasonRef} aria-invalid={Boolean(cancelFormState.formState.errors.reason)} disabled={busy} value={cancelFormState.watch("reason")} onChange={(event) => cancelFormState.setValue("reason", event.target.value, { shouldDirty: true, shouldValidate: true })} /><FieldError message={cancelFormState.formState.errors.reason?.message} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={costOpen} title={ar ? "إصدار تكلفة الخدمة" : "Issue service cost"} size="standard" language={language} busy={busy} formId="hr-service-cost" submitLabel={ar ? "إصدار التكلفة" : "Issue cost"} onClose={() => setCostOpen(false)}><form id="hr-service-cost" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={costFormState.handleSubmit(() => void saveCost())}><BaseerFormSection title={ar ? "بيانات الفاتورة والدفع" : "Invoice and payment details"}><BaseerFormGrid><label>{ar ? "التاريخ" : "Date"}<BaseerDatePicker language={language} label={ar ? "التاريخ" : "Date"} max={today()} value={costForm.businessDate} onChange={(businessDate) => setCostForm((value) => ({ ...value, businessDate }))} /><FieldError message={costFormState.formState.errors.businessDate?.message} /></label><label>{ar ? "المبلغ الإجمالي" : "Gross amount"}<input aria-invalid={Boolean(costFormState.formState.errors.grossAmount)} required inputMode="decimal" value={costForm.grossAmount} onChange={(event) => setCostForm((value) => ({ ...value, grossAmount: event.target.value }))} /><FieldError message={costFormState.formState.errors.grossAmount?.message} /></label><label>{ar ? "الخزينة" : "Vault"}<BaseerCombobox required label={ar ? "الخزينة" : "Vault"} value={costForm.vaultId} placeholder={ar ? "اختر الخزينة" : "Select vault"} options={activeVaults.map((vault) => ({ id: vault.id, label: ar ? vault.nameAr : vault.nameEn }))} onChange={(vaultId) => setCostForm((value) => ({ ...value, vaultId }))} /><FieldError message={costFormState.formState.errors.vaultId?.message} /></label><label>{ar ? "رقم فاتورة المورد" : "Supplier invoice number"}<input value={costForm.supplierInvoiceNumber} onChange={(event) => setCostForm((value) => ({ ...value, supplierInvoiceNumber: event.target.value }))} /></label><label>{ar ? "سبب عدم وجود الفاتورة" : "Invoice missing reason"}<input value={costForm.supplierInvoiceMissingReason} onChange={(event) => setCostForm((value) => ({ ...value, supplierInvoiceMissingReason: event.target.value }))} /></label><label>{ar ? "تاريخ الفاتورة" : "Invoice date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الفاتورة" : "Invoice date"} clearable max={costForm.businessDate} value={costForm.supplierInvoiceDate} onChange={(supplierInvoiceDate) => setCostForm((value) => ({ ...value, supplierInvoiceDate }))} /><FieldError message={costFormState.formState.errors.supplierInvoiceDate?.message} /></label><label className="baseer-form-checkbox"><input type="checkbox" checked={costForm.isTaxable} onChange={(event) => setCostForm((value) => ({ ...value, isTaxable: event.target.checked }))} /> {ar ? "خاضعة للضريبة" : "Taxable"}</label><label className="baseer-form-field--full">{ar ? "ملاحظات" : "Notes"}<textarea value={costForm.notes} onChange={(event) => setCostForm((value) => ({ ...value, notes: event.target.value }))} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={costReversalOpen} title={ar ? "إلغاء تكلفة الخدمة" : "Cancel service cost"} size="compact" language={language} busy={busy} formId="hr-service-cost-reversal" submitLabel={ar ? "إلغاء" : "Cancel"} onClose={() => setCostReversalOpen(false)}><form id="hr-service-cost-reversal" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={costReversalFormState.handleSubmit(() => void reverseCost())}><BaseerFormSection title={ar ? "سبب الإلغاء" : "Cancellation reason"}><BaseerFormGrid columns="one"><label>{ar ? "تاريخ الإلغاء" : "Cancellation date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الإلغاء" : "Cancellation date"} max={today()} value={costReversal.businessDate} onChange={(businessDate) => setCostReversal((value) => ({ ...value, businessDate }))} /><FieldError message={costReversalFormState.formState.errors.businessDate?.message} /></label><label>{ar ? "سبب الإلغاء" : "Cancellation reason"}<textarea aria-invalid={Boolean(costReversalFormState.formState.errors.reason)} required value={costReversal.reason} onChange={(event) => setCostReversal((value) => ({ ...value, reason: event.target.value }))} /><FieldError message={costReversalFormState.formState.errors.reason?.message} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerDialog open={Boolean(detail)} title={detail ? serviceTypeLabel(detail.serviceType) : ar ? "تفاصيل الخدمة" : "Service details"} language={language} busy={busy} onClose={() => setDetail(null)} footer={detail ? <><BaseerButton type="button" variant="secondary" disabled={busy || detail.status !== "DRAFT"} onClick={() => void prepareService("edit", detail)}>{ar ? "تعديل" : "Edit"}</BaseerButton><BaseerButton type="button" variant="secondary" disabled={busy || detail.status === "CANCELLED"} onClick={() => void prepareService("renew", detail)}>{ar ? "تجديد" : "Renew"}</BaseerButton>{detail.status === "DRAFT" ? <BaseerButton type="button" disabled={busy} onClick={() => void openCost(detail)}>{ar ? "إصدار التكلفة" : "Issue cost"}</BaseerButton> : null}{detail.costStatus === "POSTED" && detail.status === "ISSUED" && hasActivePermission("hr.employees.write") && hasActivePermission("finance.purchase_expense.cancel") ? <BaseerButton type="button" variant="danger" disabled={busy} onClick={() => { costReversalFormState.reset({ serviceId: detail.id, businessDate: today(), reason: "" }); setCostReversalOpen(true); }}>{ar ? "إلغاء التكلفة" : "Cancel cost"}</BaseerButton> : null}<BaseerButton type="button" variant="quiet" disabled={busy || detail.status !== "DRAFT"} onClick={() => { cancelFormState.reset({ reason: "" }); setActionService(detail); setDetail(null); setCancelOpen(true); }}>{ar ? "إلغاء الخدمة" : "Cancel service"}</BaseerButton></> : undefined}>{detail ? <dl className="administration-details"><div><dt>{ar ? "الموظف" : "Employee"}</dt><dd>{employeeLabel(language, detail.employee)}</dd></div><div><dt>{ar ? "نوع الخدمة" : "Service type"}</dt><dd>{serviceTypeLabel(detail.serviceType)}</dd></div><div><dt>{ar ? "الرقم المرجعي" : "Reference"}</dt><dd>{detail.referenceNumber ?? "—"}</dd></div><div><dt>{ar ? "الفترة" : "Period"}</dt><dd>{`${detail.issueDate ?? "—"} — ${detail.expiryDate ?? "—"}`}</dd></div><div><dt>{ar ? "الحالة التشغيلية" : "Operational status"}</dt><dd>{complianceLabel(detail.complianceStatus)}</dd></div><div><dt>{ar ? "حالة الانتهاء" : "Expiry state"}</dt><dd>{expiryLabel(expiryState(detail))}</dd></div><div><dt>{ar ? "الحالة" : "Status"}</dt><dd>{statusLabel(detail.status)}</dd></div><div><dt>{ar ? "العملية المالية" : "Financial transaction"}</dt><dd>{detail.costStatus === "REVERSED" ? (ar ? "ملغاة" : "Cancelled") : detail.outflowDocumentId ?? (ar ? "لم تُصدر" : "Not issued")}</dd></div>{detail.notes ? <div><dt>{ar ? "ملاحظات" : "Notes"}</dt><dd>{detail.notes}</dd></div> : null}</dl> : null}</BaseerDialog>
  </section>;
}

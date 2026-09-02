import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerCard } from "./baseer-card";
import { BaseerDataGrid, type BaseerDataGridColumn, type BaseerServerDataGridProps } from "./baseer-data-grid";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import { BaseerCheckbox, BaseerTextInput } from "./baseer-form-fields";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { hasActivePermission } from "./module-access";
import { OperationsRecipeEditor, type OperationsRecipeWorkspaceData } from "./operations-recipe-editor";
import type { OperationsCatalogConversionEdge } from "./operations-catalog-conversion-form";
import type { OperationsUnitForm } from "./operations-unit-form-dialog";
import { formatCount, formatDate, formatMoney } from "./number-format";
import "./operations-catalog-base.css";

type Language = "ar" | "en";
type Unit = { id: string; code: string; nameAr: string; nameEn: string | null; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE"; isActive: boolean };
type ItemUnit = { unitId: string; isBase: boolean; isActive: boolean; isOrderEnabled: boolean; lastPurchaseUnitPrice: string | null; lastPurchasePriceAt: string | null; menuSaleUnitPrice: string | null };
type Item = { id: string; code: string; nameAr: string; nameEn: string | null; kind: "RAW_MATERIAL" | "MENU_PRODUCT"; status: "ACTIVE" | "ARCHIVED"; sectionId: string | null; baseUnitId: string; itemUnits: ItemUnit[]; conversionVersion: { version: number; edges: Array<{ fromUnitId: string; toUnitId: string; factor: string }> } | null; liveRecipeUnitCost: string | null; liveRecipeCostStatus: "NO_RECIPE" | "INCOMPLETE" | "AVAILABLE" };
type Catalog = {
  units: Unit[];
  sections: Array<{ id: string; code: string; nameAr: string; nameEn: string | null; isActive: boolean }>;
  metrics: { activeRawMaterialCount: number; needsConversionCount: number; missingPurchasePriceCount: number };
  items: Item[];
  nextCursor: string | null;
  asOf: string;
};
export type ItemForm = { code: string; nameAr: string; nameEn: string; kind: Item["kind"]; sectionId: string; baseUnitId: string; unitIds: string[]; salePrice: string };
type Tab = "raw" | "units" | "menu" | "sections" | "archive";
type MenuCardTab = "details" | "price" | "recipe";
type RawMaterialCardTab = "details" | "units";

const emptyItem: ItemForm = { code: "", nameAr: "", nameEn: "", kind: "RAW_MATERIAL", sectionId: "", baseUnitId: "", unitIds: [], salePrice: "" };
const LazyOperationsUnitFormDialog = lazy(async () => ({ default: (await import("./operations-unit-form-dialog")).OperationsUnitFormDialog }));
const LazyOperationsCatalogItemCreateDialog = lazy(async () => ({ default: (await import("./operations-catalog-item-create-dialog")).OperationsCatalogItemCreateDialog }));
const LazyOperationsCatalogItemDetailsForm = lazy(async () => ({ default: (await import("./operations-catalog-item-details-form")).OperationsCatalogItemDetailsForm }));
const LazyOperationsCatalogPriceForm = lazy(async () => ({ default: (await import("./operations-catalog-price-form")).OperationsCatalogPriceForm }));
const LazyOperationsCatalogConversionForm = lazy(async () => ({ default: (await import("./operations-catalog-conversion-form")).OperationsCatalogConversionForm }));
const LazyBaseerServerDataGrid = lazy(async () => ({ default: (await import("./baseer-data-grid")).BaseerServerDataGrid })) as unknown as <Row extends object>(props: BaseerServerDataGridProps<Row>) => ReactNode;

export function OperationsCatalogWorkspace({ language }: { language: Language }) {
  const isArabic = language === "ar";
  const t = isArabic ? {
    title: "إدارة المنتجات الأولية", raw: "المواد الأولية", units: "الوحدات والتغليف", menu: "منتجات المنيو", archive: "الأرشيف", addMaterial: "إضافة مادة أولية", addUnit: "إضافة وحدة", addRestaurantUnits: "إضافة وحدات المطاعم الشائعة", active: "نشط", archived: "مؤرشف", materials: "مواد نشطة", needsConversion: "تحتاج تحويل", noPrice: "بلا سعر شراء", search: "ابحث بالاسم أو الرمز…", material: "المادة", baseUnit: "الوحدة الأساسية", lastPrice: "آخر سعر شراء", conversion: "التحويل", orderReady: "متاح للطلب", actions: "الإجراءات", manage: "فتح الكرت", recipe: "الرسبي والتكلفة", recipeDetails: "إدارة الرسبي", recipeCost: "تكلفة الرسبي", recipeCostLive: "تكلفة حية", refreshRecipeCost: "تحديث التكلفة", noRecipe: "لا يوجد رسبي", incompleteRecipeCost: "تكلفة غير مكتملة", itemUnits: "وحدات المادة", manageConversions: "إدارة التحويلات", publish: "نشر تحويل", archiveItem: "أرشفة", ready: "جاهز", incomplete: "غير مكتمل", none: "—", save: "حفظ", close: "إغلاق", details: "بيانات الصنف", code: "الرمز", nameAr: "الاسم بالعربية", nameEn: "الاسم بالإنجليزية", dimension: "البعد", count: "عدد", mass: "وزن", volume: "حجم", package: "تغليف", itemType: "نوع الصنف", rawMaterial: "مادة أولية", menuProduct: "منتج منيو", section: "قسم التسجيل", salePrice: "سعر بيع المنيو", unit: "الوحدة", activeOnItem: "مفعّلة للصنف", orderEnabled: "متاحة للطلب", saveUnits: "حفظ الوحدات", from: "من", to: "إلى", factor: "عامل التحويل", loading: "جارٍ تحميل إدارة المنتجات…", noData: "لا توجد بيانات بعد.", failed: "تعذر تنفيذ العملية. حاول مرة أخرى.", baseRebaseBlocked: "لا يمكن تغيير وحدة أساس المخزون لهذه المادة الآن لأنها مرتبطة برصيد فعلي أو طلب شراء مفتوح أو رسبي منشور. لا يحذف النظام هذه السجلات تلقائياً.", saved: "تم الحفظ بنجاح.", editUnit: "تعديل وحدة", editItem: "تعديل الصنف", editSalePrice: "تعديل سعر البيع", price: "السعر", loadMore: "تحميل المزيد", loadingMore: "جارٍ تحميل المزيد…" } : {
    title: "Raw material management", raw: "Raw materials", units: "Units & packaging", menu: "Menu products", archive: "Archive", addMaterial: "Add raw material", addUnit: "Add unit", addRestaurantUnits: "Add common restaurant units", active: "Active", archived: "Archived", materials: "Active materials", needsConversion: "Need conversion", noPrice: "No purchase price", search: "Search name or code…", material: "Material", baseUnit: "Base unit", lastPrice: "Last purchase price", conversion: "Conversion", orderReady: "Order ready", actions: "Actions", manage: "Open card", recipe: "Recipe & cost", recipeDetails: "Manage recipe", recipeCost: "Recipe cost", recipeCostLive: "Live cost", refreshRecipeCost: "Refresh cost", noRecipe: "No recipe", incompleteRecipeCost: "Incomplete cost", itemUnits: "Item units", manageConversions: "Manage conversions", publish: "Publish conversion", archiveItem: "Archive", ready: "Ready", incomplete: "Incomplete", none: "—", save: "Save", close: "Close", details: "Product details", code: "Code", nameAr: "Arabic name", nameEn: "English name", dimension: "Dimension", count: "Count", mass: "Mass", volume: "Volume", package: "Package", itemType: "Item type", rawMaterial: "Raw material", menuProduct: "Menu product", section: "Registration section", salePrice: "Menu sale price", unit: "Unit", activeOnItem: "Active on item", orderEnabled: "Available for ordering", saveUnits: "Save units", from: "From", to: "To", factor: "Factor", loading: "Loading material management…", noData: "No data yet.", failed: "Could not complete the operation. Try again.", baseRebaseBlocked: "The inventory base unit cannot change while this material has a balance, an open purchase request, or a published recipe. The system will not delete those records automatically.", saved: "Saved successfully.", editUnit: "Edit unit", editItem: "Edit item", editSalePrice: "Edit sale price", price: "Price", loadMore: "Load more", loadingMore: "Loading more…" };
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("raw");
  const [query, setQuery] = useState("");
  const [orderReadyOnly, setOrderReadyOnly] = useState(false);
  const [missingPurchasePriceOnly, setMissingPurchasePriceOnly] = useState(false);
  const [dialog, setDialog] = useState<"unit" | "item" | null>(null);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editingSection, setEditingSection] = useState<Catalog["sections"][number] | null>(null);
  const [sectionForm, setSectionForm] = useState({ code: "", nameAr: "", nameEn: "", isActive: true });
  const [unitForm, setUnitForm] = useState<OperationsUnitForm>({ nameAr: "", nameEn: "", dimension: "COUNT", isActive: true });
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem);
  const [conversion, setConversion] = useState({ itemId: "", edges: [] as OperationsCatalogConversionEdge[] });
  const [menuCardTab, setMenuCardTab] = useState<MenuCardTab>("details");
  const [rawMaterialCardTab, setRawMaterialCardTab] = useState<RawMaterialCardTab>("details");
  const [editingConversion, setEditingConversion] = useState(false);
  const [recipeWorkspace, setRecipeWorkspace] = useState<OperationsRecipeWorkspaceData | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const catalogRequest = useRef<AbortController | null>(null);
  const catalogScope = useRef("");
  const showDialog = useCallback((next: NonNullable<typeof dialog>) => { void import("./operations-catalog-workspace.css").finally(() => setDialog(next)); }, []);
  const unitName = useCallback((id: string) => { const unit = catalog?.units.find((entry) => entry.id === id); return isArabic ? unit?.nameAr ?? "—" : unit?.nameEn ?? unit?.nameAr ?? "—"; }, [catalog, isArabic]);
  const itemName = useCallback((item: Item) => isArabic ? item.nameAr : item.nameEn ?? item.nameAr, [isArabic]);
  const reload = useCallback(async (options: { cursor?: string; append?: boolean } = {}): Promise<Catalog | null> => {
    const current = activeSession();
    setSession(current);
    if (!current) { setCatalog(null); setLoading(false); return null; }
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    const search = query.trim();
    const params = new URLSearchParams({ pageSize: "50" });
    if (tab === "raw") { params.set("kind", "RAW_MATERIAL"); params.set("status", "ACTIVE"); }
    if (tab === "menu") { params.set("kind", "MENU_PRODUCT"); params.set("status", "ACTIVE"); }
    if (tab === "archive") params.set("status", "ARCHIVED");
    if (tab !== "units" && search) params.set("search", search);
    if (tab === "raw" && orderReadyOnly) params.set("orderReady", "true");
    if (tab === "raw" && missingPurchasePriceOnly) params.set("missingPurchasePrice", "true");
    if (options.cursor) params.set("cursor", options.cursor);
    const scope = `${current.companyId}:${tab}:${search}:${orderReadyOnly}:${missingPurchasePriceOnly}:${options.cursor ?? "first"}`;
    catalogScope.current = scope;
    options.append ? setLoadingMore(true) : setLoading(true);
    try {
      const next = await api<Catalog>(current, `/operations/catalog?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || catalogScope.current !== scope || activeSession()?.companyId !== current.companyId) return null;
      setCatalog((previous) => options.append && previous
        ? { ...next, items: [...previous.items, ...next.items.filter((item) => !previous.items.some((existing) => existing.id === item.id))] }
        : next);
      return next;
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: presentBaseerApiError(error, language, t.failed) });
      return null;
    } finally {
      if (!controller.signal.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [language, missingPurchasePriceOnly, orderReadyOnly, query, tab, t.failed]);
  const reloadRecipeWorkspace = useCallback(async () => { const current = activeSession(); if (!current) return; setRecipeLoading(true); setRecipeError(null); try { setRecipeWorkspace(await api<OperationsRecipeWorkspaceData>(current, "/operations/recipe-workspace")); } catch (error) { setRecipeError(presentBaseerApiError(error, language, t.failed)); } finally { setRecipeLoading(false); } }, [language, t.failed]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, query.trim() ? 220 : 0);
    return () => { window.clearTimeout(timer); catalogRequest.current?.abort(); };
  }, [missingPurchasePriceOnly, orderReadyOnly, query, reload, tab]);
  const write = async (path: string, body: Record<string, unknown>, options: { keepDialogOpen?: boolean } = {}) => { if (!session) return; setSaving(true); setNotice(null); try { await api(session, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: requestId() }) }); setNotice({ kind: "success", text: t.saved }); if (!options.keepDialogOpen) setDialog(null); const next = await reload(); if (options.keepDialogOpen && editingItem) setEditingItem(next?.items.find((item) => item.id === editingItem.id) ?? editingItem); } catch (error) { setNotice({ kind: "error", text: presentBaseerApiError(error, language, t.failed) }); } finally { setSaving(false); } };
  const activeRaw = tab === "raw" ? catalog?.items.filter((item) => item.kind === "RAW_MATERIAL" && item.status === "ACTIVE") ?? [] : [];
  const menu = tab === "menu" ? catalog?.items.filter((item) => item.kind === "MENU_PRODUCT" && item.status === "ACTIVE") ?? [] : [];
  const archived = tab === "archive" ? catalog?.items.filter((item) => item.status === "ARCHIVED") ?? [] : [];
  const loadMore = () => { if (catalog?.nextCursor && !loading && !loadingMore) void reload({ cursor: catalog.nextCursor, append: true }); };
  const canReadRecipes = hasActivePermission("operations.recipe.read");
  const openItem = (item?: Item, initialMenuTab: MenuCardTab = "details") => { setEditingItem(item ?? null); setItemForm(item ? { code: item.code, nameAr: item.nameAr, nameEn: item.nameEn ?? "", kind: item.kind, sectionId: item.sectionId ?? "", baseUnitId: item.baseUnitId, unitIds: item.itemUnits.filter((line) => line.isActive).map((line) => line.unitId), salePrice: item.itemUnits.find((line) => line.isBase)?.menuSaleUnitPrice ?? "" } : emptyItem); setMenuCardTab(initialMenuTab); setRawMaterialCardTab("details"); showDialog("item"); if (item?.kind === "MENU_PRODUCT" && canReadRecipes) void reloadRecipeWorkspace(); };
  const chainUnitIds = (item: Item, sourceEdges = item.conversionVersion?.edges ?? []) => {
    if (!sourceEdges.length) return [item.baseUnitId];
    const byFrom = new Map(sourceEdges.map((edge) => [edge.fromUnitId, edge]));
    const targets = new Set(sourceEdges.map((edge) => edge.toUnitId));
    const first = sourceEdges.find((edge) => !targets.has(edge.fromUnitId))?.fromUnitId;
    if (!first) return [item.baseUnitId];
    const chain: string[] = []; const seen = new Set<string>(); let cursor: string | undefined = first;
    while (cursor && !seen.has(cursor)) { chain.push(cursor); seen.add(cursor); cursor = byFrom.get(cursor)?.toUnitId; }
    return chain.length ? chain : [item.baseUnitId];
  };
  const materialStages = (item: Item) => {
    const stages = chainUnitIds(item);
    return <div className="operations-material-stages" aria-label={isArabic ? "مراحل المادة" : "Material stages"}>{stages.map((unitId, index) => <span key={unitId}>{index ? <bdi aria-hidden="true">←</bdi> : null}<em>{unitName(unitId)}</em></span>)}</div>;
  };
  const purchasePackaging = (item: Item) => item.itemUnits.filter((line) => line.isActive && line.isOrderEnabled);
  const conversionRowsFor = (item: Item) => {
    const sourceEdges = item.conversionVersion?.edges ?? [];
    if (!sourceEdges.length) return [];
    const byFrom = new Map(sourceEdges.map((edge) => [edge.fromUnitId, edge]));
    const targets = new Set(sourceEdges.map((edge) => edge.toUnitId));
    const first = sourceEdges.find((edge) => !targets.has(edge.fromUnitId)) ?? sourceEdges[0];
    const ordered: typeof sourceEdges = [];
    const seen = new Set<string>();
    let edge: (typeof sourceEdges)[number] | undefined = first;
    while (edge && !seen.has(edge.fromUnitId)) {
      ordered.push(edge);
      seen.add(edge.fromUnitId);
      edge = byFrom.get(edge.toUnitId);
    }
    // Keep a published row visible even if historic data contains an incomplete chain.
    for (const remaining of sourceEdges) if (!seen.has(remaining.fromUnitId)) ordered.push(remaining);
    return ordered.map((edge) => ({
      fromUnitId: edge.fromUnitId,
      toUnitId: edge.toUnitId,
      factor: edge.factor,
      isPurchasePackaging: item.itemUnits.find((line) => line.unitId === edge.fromUnitId)?.isOrderEnabled ?? false,
    }));
  };
  const openConversion = (item: Item) => {
    setEditingItem(item);
    setConversion({ itemId: item.id, edges: conversionRowsFor(item) });
    setRawMaterialCardTab("units");
    setEditingConversion(!item.conversionVersion);
  };
  const beginConversionEdit = (item: Item) => {
    // Reload the published snapshot every time editing starts; never make the user rebuild it.
    const edges = conversionRowsFor(item);
    setConversion({ itemId: item.id, edges: edges.some((edge) => edge.isPurchasePackaging) ? edges : edges.map((edge, index) => index === 0 ? { ...edge, isPurchasePackaging: true } : edge) });
    setEditingConversion(true);
  };
  const saveMaterialChain = async (edges: OperationsCatalogConversionEdge[]) => {
    if (!session || !editingItem || !catalog) return;
    const complete = edges.length > 0 && edges.every((edge) => edge.fromUnitId && edge.toUnitId && edge.factor);
    if (!complete) { setNotice({ kind: "error", text: isArabic ? "أكمل الوحدة والعامل في كل مرحلة أولاً." : "Complete the unit and factor in every stage first." }); return; }
    const selectedUnitIds = new Set([editingItem.baseUnitId, ...edges.flatMap((edge) => [edge.fromUnitId, edge.toUnitId])]);
    const configuredUnits = [
      ...editingItem.itemUnits.map((line) => ({ unitId: line.unitId, isActive: line.isActive || selectedUnitIds.has(line.unitId), isOrderEnabled: line.isOrderEnabled })),
      ...[...selectedUnitIds].filter((unitId) => !editingItem.itemUnits.some((line) => line.unitId === unitId)).map((unitId) => ({ unitId, isActive: true, isOrderEnabled: false })),
    ];
    const conversionSourceUnits = new Set(edges.map((edge) => edge.fromUnitId));
    const purchasingUnits = new Set(edges.filter((edge) => edge.isPurchasePackaging).map((edge) => edge.fromUnitId));
    setSaving(true); setNotice(null);
    try {
      await api(session, "/operations/catalog/item-units/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: editingItem.id, units: configuredUnits, idempotencyKey: requestId() }) });
      await api(session, "/operations/catalog/conversions/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: editingItem.id, edges: edges.map(({ fromUnitId, toUnitId, factor }) => ({ fromUnitId, toUnitId, factor })), idempotencyKey: requestId() }) });
      await api(session, "/operations/catalog/item-units/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: editingItem.id, units: configuredUnits.map((line) => ({ ...line, isOrderEnabled: conversionSourceUnits.has(line.unitId) ? purchasingUnits.has(line.unitId) : line.isOrderEnabled })), idempotencyKey: requestId() }) });
      const next = await reload();
      const refreshed = next?.items.find((item) => item.id === editingItem.id);
      if (refreshed) openConversion(refreshed);
      setNotice({ kind: "success", text: isArabic ? "تم حفظ الوحدات والتحويلات وتغليفات الشراء." : "Units, conversions, and purchase packaging were saved." });
    } catch (error) { setNotice({ kind: "error", text: presentBaseerApiError(error, language, t.failed) }); } finally { setSaving(false); }
  };
  const rawColumns: readonly BaseerDataGridColumn<Item>[] = [
    { id: "material", header: t.material, cell: (item) => <button type="button" className="operations-row-link" onClick={() => openItem(item)}><strong>{itemName(item)}</strong><small dir="ltr">{item.code}</small></button> },
    { id: "base", header: t.baseUnit, cell: (item) => unitName(item.baseUnitId) },
    { id: "stages", header: isArabic ? "المراحل" : "Stages", cell: (item) => materialStages(item) },
    { id: "price", header: t.lastPrice, cell: (item) => { const purchaseUnits = item.itemUnits.filter((line) => line.isActive && line.isOrderEnabled && line.lastPurchaseUnitPrice).sort((left, right) => (right.lastPurchasePriceAt ?? "").localeCompare(left.lastPurchasePriceAt ?? "")); return purchaseUnits.length ? <div className="operations-purchase-price-list">{purchaseUnits.map((line) => <div key={line.unitId}><strong><bdi dir="ltr">{formatMoney(line.lastPurchaseUnitPrice, isArabic ? "ر.س" : "SAR", language, 4)}</bdi></strong><small>{unitName(line.unitId)}{line.lastPurchasePriceAt ? ` · ${formatDate(line.lastPurchasePriceAt, language)}` : ""}</small></div>)}</div> : t.none; } },
    { id: "conversion", header: t.conversion, cell: (item) => item.itemUnits.filter((line) => line.isActive).length < 2 ? t.ready : item.conversionVersion ? <bdi dir="ltr">v{formatCount(item.conversionVersion.version, language)}</bdi> : t.incomplete },
    { id: "ready", header: t.orderReady, cell: (item) => item.itemUnits.some((line) => line.isActive && line.isOrderEnabled) ? t.ready : t.incomplete },
  ];
  const menuColumns: readonly BaseerDataGridColumn<Item>[] = [
    { id: "item", header: t.material, cell: (item) => <button type="button" className="operations-row-link" onClick={() => openItem(item, canReadRecipes ? "recipe" : "details")}><strong>{itemName(item)}</strong><small>{canReadRecipes ? t.recipeDetails : t.manage}</small></button> },
    { id: "recipe-cost", header: t.recipeCost, cell: (item) => item.liveRecipeCostStatus === "AVAILABLE" && item.liveRecipeUnitCost !== null ? <span><strong><bdi dir="ltr">{formatMoney(item.liveRecipeUnitCost, isArabic ? "ر.س" : "SAR", language, 4)}</bdi></strong><small>{t.recipeCostLive}</small></span> : <small>{item.liveRecipeCostStatus === "NO_RECIPE" ? t.noRecipe : t.incompleteRecipeCost}</small> },
    { id: "price", header: t.salePrice, cell: (item) => { const price = item.itemUnits.find((line) => line.isBase)?.menuSaleUnitPrice; return price ? <bdi dir="ltr">{formatMoney(price, isArabic ? "ر.س" : "SAR", language)}</bdi> : t.none; } },
  ];
  const archiveColumns: readonly BaseerDataGridColumn<Item>[] = [
    { id: "item", header: t.material, cell: (item) => <strong>{itemName(item)}</strong> },
    { id: "base", header: t.baseUnit, cell: (item) => unitName(item.baseUnitId) },
  ];
  const sectionColumns: readonly BaseerDataGridColumn<Catalog["sections"][number]>[] = [
    { id: "section", header: isArabic ? "القسم" : "Section", cell: (section) => <span><strong>{isArabic ? section.nameAr : section.nameEn ?? section.nameAr}</strong><small dir="ltr">{section.code}</small></span> },
    { id: "status", header: isArabic ? "الحالة" : "Status", cell: (section) => section.isActive ? t.active : t.archived },
    { id: "actions", header: t.actions, cell: (section) => <BaseerButton type="button" variant="secondary" onClick={() => { setEditingSection(section); setSectionForm({ code: section.code, nameAr: section.nameAr, nameEn: section.nameEn ?? "", isActive: section.isActive }); setSectionDialogOpen(true); }}>{isArabic ? "تعديل" : "Edit"}</BaseerButton> },
  ];
  if (!session) return <DailySalesSignIn language={language} />;
  const tabs: Array<{ id: Tab; label: string }> = [{ id: "raw", label: t.raw }, { id: "units", label: t.units }, { id: "menu", label: t.menu }, { id: "sections", label: isArabic ? "الأقسام" : "Sections" }, { id: "archive", label: t.archive }];
  const appliedFilters = [
    ...(orderReadyOnly ? [{ id: "order-ready", label: t.orderReady, onRemove: () => setOrderReadyOnly(false) }] : []),
    ...(missingPurchasePriceOnly ? [{ id: "missing-purchase-price", label: t.noPrice, onRemove: () => setMissingPurchasePriceOnly(false) }] : []),
  ];
  return <>
    <section className="operations-catalog" aria-label={t.title}>
      <header className="operations-catalog__header"><div><p className="eyebrow">Operations O1</p><h3>{t.title}</h3></div><div className="baseer-inline-actions"><BaseerButton type="button" variant="secondary" onClick={() => { setEditingUnit(null); setUnitForm({ nameAr: "", nameEn: "", dimension: "COUNT", isActive: true }); showDialog("unit"); }}>{t.addUnit}</BaseerButton><BaseerButton type="button" onClick={() => openItem()}>{t.addMaterial}</BaseerButton></div></header>
      {notice ? <p className={`daily-sales-message ${notice.kind}`}>{notice.text}</p> : null}
      {loading ? <BaseerCard><p>{t.loading}</p></BaseerCard> : <>
        <div className="operations-catalog__metrics"><BaseerCard variant="metric"><strong>{t.materials}</strong><p><bdi dir="ltr">{formatCount(catalog?.metrics.activeRawMaterialCount ?? 0, language)}</bdi></p></BaseerCard><BaseerCard variant="metric"><strong>{t.needsConversion}</strong><p><bdi dir="ltr">{formatCount(catalog?.metrics.needsConversionCount ?? 0, language)}</bdi></p></BaseerCard><BaseerCard variant="metric"><strong>{t.noPrice}</strong><p><bdi dir="ltr">{formatCount(catalog?.metrics.missingPurchasePriceCount ?? 0, language)}</bdi></p></BaseerCard></div>
        <BaseerWorkspaceTabs ariaLabel={t.title} idPrefix="operations-catalog" activeId={tab} onChange={(value) => { setQuery(""); setOrderReadyOnly(false); setMissingPurchasePriceOnly(false); setTab(value as Tab); }} tabs={tabs} />
        {tab !== "units" && tab !== "sections" ? <BaseerFilterBar controlsPresentation={tab === "raw" ? "menu" : "inline"} language={language} search={query} searchLabel={t.search} searchPlaceholder={t.search} onSearchChange={setQuery} appliedFilters={appliedFilters} onClear={() => { setOrderReadyOnly(false); setMissingPurchasePriceOnly(false); }} controls={tab === "raw" ? <><BaseerFilterToggle label={t.orderReady} checked={orderReadyOnly} onChange={setOrderReadyOnly} /><BaseerFilterToggle label={t.noPrice} checked={missingPurchasePriceOnly} onChange={setMissingPurchasePriceOnly} /></> : undefined} /> : null}
        {tab === "raw" ? <BaseerCard><div className="operations-catalog__card-heading"><div><h3>{t.raw}</h3></div></div>{activeRaw.length && catalog ? <Suspense fallback={<p>{t.loading}</p>}><LazyBaseerServerDataGrid ariaLabel={t.raw} caption={t.raw} page={{ rows: activeRaw, nextCursor: catalog.nextCursor, asOf: catalog.asOf }} rowKey={(item: Item) => item.id} columns={rawColumns} loadMoreControl={<BaseerButton type="button" variant="secondary" disabled={loading || loadingMore} onClick={loadMore}>{loadingMore ? t.loadingMore : t.loadMore}</BaseerButton>} /></Suspense> : <p>{t.noData}</p>}</BaseerCard> : null}
        {tab === "units" ? <BaseerCard><div className="operations-catalog__card-heading"><div><h3>{t.units}</h3></div><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => void write("/operations/catalog/units/restaurant-presets", {})}>{t.addRestaurantUnits}</BaseerButton></div>{catalog?.units.length ? <BaseerDataGrid ariaLabel={t.units} caption={t.units} rows={catalog.units} rowKey={(unit) => unit.id} columns={[{ id: "unit", header: t.unit, cell: (unit) => <button type="button" className="operations-row-link" onClick={() => { setEditingUnit(unit); setUnitForm({ nameAr: unit.nameAr, nameEn: unit.nameEn ?? "", dimension: unit.dimension, isActive: unit.isActive }); showDialog("unit"); }}><strong>{isArabic ? unit.nameAr : unit.nameEn ?? unit.nameAr}</strong><small>{unit.code}</small></button> }, { id: "dimension", header: t.dimension, cell: (unit) => t[unit.dimension.toLowerCase() as "count" | "mass" | "volume" | "package"] }]} /> : <p>{t.noData}</p>}</BaseerCard> : null}
        {tab === "sections" ? <BaseerCard><div className="operations-catalog__card-heading"><div><h3>{isArabic ? "الأقسام" : "Sections"}</h3><p>{isArabic ? "تُنظّم منتجات المنيو وتظهر في التسجيل الداخلي." : "Organize menu products and make them available to internal registration."}</p></div><BaseerButton type="button" onClick={() => { setEditingSection(null); setSectionForm({ code: "", nameAr: "", nameEn: "", isActive: true }); setSectionDialogOpen(true); }}>{isArabic ? "إضافة قسم" : "Add section"}</BaseerButton></div>{catalog?.sections.length ? <BaseerDataGrid ariaLabel={isArabic ? "الأقسام" : "Sections"} caption={isArabic ? "الأقسام" : "Sections"} rows={catalog.sections} rowKey={(section) => section.id} columns={sectionColumns} /> : <p>{t.noData}</p>}</BaseerCard> : null}
        {tab === "menu" ? <BaseerCard><div className="operations-catalog__card-heading"><div><h3>{t.menu}</h3><p>{isArabic ? "اضغط اسم الصنف لفتح كرت موحّد لإدارة البيانات وسعر البيع ورسبي المكونات." : "Select a product name to open one card for its details, sale price, and recipe."}</p></div><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void reload()}>{t.refreshRecipeCost}</BaseerButton></div>{menu.length && catalog ? <Suspense fallback={<p>{t.loading}</p>}><LazyBaseerServerDataGrid ariaLabel={t.menu} caption={t.menu} page={{ rows: menu, nextCursor: catalog.nextCursor, asOf: catalog.asOf }} rowKey={(item: Item) => item.id} columns={menuColumns} loadMoreControl={<BaseerButton type="button" variant="secondary" disabled={loading || loadingMore} onClick={loadMore}>{loadingMore ? t.loadingMore : t.loadMore}</BaseerButton>} /></Suspense> : <p>{t.noData}</p>}</BaseerCard> : null}
        {tab === "archive" ? <BaseerCard><h3>{t.archive}</h3>{archived.length && catalog ? <Suspense fallback={<p>{t.loading}</p>}><LazyBaseerServerDataGrid ariaLabel={t.archive} caption={t.archive} page={{ rows: archived, nextCursor: catalog.nextCursor, asOf: catalog.asOf }} rowKey={(item: Item) => item.id} columns={archiveColumns} loadMoreControl={<BaseerButton type="button" variant="secondary" disabled={loading || loadingMore} onClick={loadMore}>{loadingMore ? t.loadingMore : t.loadMore}</BaseerButton>} /></Suspense> : <p>{t.noData}</p>}</BaseerCard> : null}
      </>}
    </section>
    <Suspense fallback={null}><LazyOperationsUnitFormDialog open={dialog === "unit"} language={language} busy={saving} value={unitForm} editingCode={editingUnit?.code ?? null} onClose={() => setDialog(null)} onSubmit={(value) => write(editingUnit ? "/operations/catalog/units/update" : "/operations/catalog/units", editingUnit ? { ...value, unitId: editingUnit.id } : value)} /></Suspense>
    <BaseerDialog open={sectionDialogOpen} title={editingSection ? (isArabic ? "تعديل القسم" : "Edit section") : (isArabic ? "إضافة قسم" : "Add section")} language={language} busy={saving} onClose={() => setSectionDialogOpen(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setSectionDialogOpen(false)}>{t.close}</BaseerButton><BaseerButton type="submit" form="operations-section-form" disabled={saving}>{t.save}</BaseerButton></>}>
      <form id="operations-section-form" className="baseer-form-grid baseer-form-grid--two" onSubmit={(event) => { event.preventDefault(); const payload = { code: sectionForm.code.trim(), nameAr: sectionForm.nameAr.trim(), nameEn: sectionForm.nameEn.trim() || undefined, isActive: sectionForm.isActive }; if (!payload.code || !payload.nameAr) { setNotice({ kind: "error", text: isArabic ? "رمز القسم واسمه بالعربية مطلوبان." : "Section code and Arabic name are required." }); return; } const request = editingSection ? write("/operations/catalog/sections/update", { ...payload, sectionId: editingSection.id }) : write("/operations/catalog/sections", { code: payload.code, nameAr: payload.nameAr, nameEn: payload.nameEn }); void request.then(() => setSectionDialogOpen(false)); }}>
        <label>{t.code}<BaseerTextInput dir="ltr" value={sectionForm.code} onChange={(event) => setSectionForm((current) => ({ ...current, code: event.target.value }))} autoFocus /></label>
        <label>{t.nameAr}<BaseerTextInput value={sectionForm.nameAr} onChange={(event) => setSectionForm((current) => ({ ...current, nameAr: event.target.value }))} /></label>
        <label>{t.nameEn}<BaseerTextInput dir="ltr" value={sectionForm.nameEn} onChange={(event) => setSectionForm((current) => ({ ...current, nameEn: event.target.value }))} /></label>
        <label className="baseer-form-field--full"><span>{t.active}</span><BaseerCheckbox checked={sectionForm.isActive} onChange={(event) => setSectionForm((current) => ({ ...current, isActive: event.target.checked }))} /></label>
      </form>
    </BaseerDialog>
    <BaseerDialog open={dialog === "item" && editingItem?.kind === "MENU_PRODUCT"} title={editingItem ? `${t.menuProduct} — ${itemName(editingItem)}` : t.menuProduct} language={language} busy={saving} onClose={() => setDialog(null)} size="wide" className="operations-menu-product-card" footer={menuCardTab !== "recipe" ? <><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setDialog(null)}>{t.close}</BaseerButton><BaseerButton type="submit" form={menuCardTab === "price" ? "operations-menu-product-price" : "operations-menu-product-card"} disabled={saving}>{t.save}</BaseerButton></> : <BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setDialog(null)}>{t.close}</BaseerButton>}>
      {editingItem ? <><nav className="operations-menu-product-card__tabs" aria-label={t.menuProduct}><button type="button" className={menuCardTab === "details" ? "is-active" : ""} onClick={() => setMenuCardTab("details")}>{t.details}</button><button type="button" className={menuCardTab === "price" ? "is-active" : ""} onClick={() => setMenuCardTab("price")}>{t.salePrice}</button>{canReadRecipes ? <button type="button" className={menuCardTab === "recipe" ? "is-active" : ""} onClick={() => { setMenuCardTab("recipe"); if (!recipeWorkspace) void reloadRecipeWorkspace(); }}>{t.recipe}</button> : null}</nav>{menuCardTab === "details" ? <Suspense fallback={null}><LazyOperationsCatalogItemDetailsForm formId="operations-menu-product-card" language={language} value={{ itemId: editingItem.id, code: itemForm.code, nameAr: itemForm.nameAr, nameEn: itemForm.nameEn, sectionId: itemForm.sectionId, kind: editingItem.kind }} sections={catalog?.sections ?? []} onSubmit={(next) => write("/operations/catalog/items/update", { itemId: next.itemId, code: next.code, nameAr: next.nameAr, nameEn: next.nameEn || undefined, sectionId: next.sectionId || null })} /></Suspense> : menuCardTab === "price" ? <Suspense fallback={null}><LazyOperationsCatalogPriceForm formId="operations-menu-product-price" language={language} value={editingItem.itemUnits.find((line) => line.isBase)?.menuSaleUnitPrice ?? ""} onSubmit={(next) => { const unit = editingItem.itemUnits.find((line) => line.isBase); return unit ? write("/operations/catalog/item-units/price", { itemId: editingItem.id, unitId: unit.unitId, price: next.price }) : undefined; }} /></Suspense> : recipeLoading ? <p>{t.loading}</p> : recipeError ? <p className="daily-sales-message error">{recipeError}</p> : recipeWorkspace ? <OperationsRecipeEditor language={language} workspace={recipeWorkspace} productId={editingItem.id} onPublished={async () => { await Promise.all([reload(), reloadRecipeWorkspace()]); }} /> : null}</> : null}
    </BaseerDialog>
    <BaseerDialog open={dialog === "item" && editingItem?.kind === "RAW_MATERIAL"} title={editingItem ? `${t.rawMaterial} — ${itemName(editingItem)}` : t.rawMaterial} language={language} busy={saving} onClose={() => setDialog(null)} size="wide" className="operations-raw-material-card" footer={<><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setDialog(null)}>{t.close}</BaseerButton>{rawMaterialCardTab === "details" ? <BaseerButton type="submit" form="operations-raw-material-card" disabled={saving}>{t.save}</BaseerButton> : null}</>}>
      {editingItem ? <>
        <nav className="operations-menu-product-card__tabs" aria-label={t.rawMaterial}>
          <button type="button" className={rawMaterialCardTab === "details" ? "is-active" : ""} onClick={() => setRawMaterialCardTab("details")}>{t.details}</button>
          <button type="button" className={rawMaterialCardTab === "units" ? "is-active" : ""} onClick={() => openConversion(editingItem)}>{isArabic ? "الوحدات والتحويلات" : "Units & conversions"}</button>
        </nav>
        {rawMaterialCardTab === "details" ? <><Suspense fallback={null}><LazyOperationsCatalogItemDetailsForm formId="operations-raw-material-card" language={language} value={{ itemId: editingItem.id, code: itemForm.code, nameAr: itemForm.nameAr, nameEn: itemForm.nameEn, sectionId: "", kind: editingItem.kind }} sections={[]} onSubmit={(next) => write("/operations/catalog/items/update", { itemId: next.itemId, code: next.code, nameAr: next.nameAr, nameEn: next.nameEn || undefined, sectionId: null })} /></Suspense><section className="operations-material-overview"><div><small>{isArabic ? "وحدة أساس المخزون" : "Inventory base unit"}</small><strong>{unitName(editingItem.baseUnitId)}</strong></div><div><small>{isArabic ? "إصدار التحويل" : "Conversion version"}</small><strong>{editingItem.conversionVersion ? <bdi dir="ltr">v{formatCount(editingItem.conversionVersion.version, language)}</bdi> : t.none}</strong></div><div className="operations-material-overview__purchase"><small>{isArabic ? "تغليفات الشراء" : "Purchase packaging"}</small><div>{purchasePackaging(editingItem).length ? purchasePackaging(editingItem).map((line) => <span key={line.unitId}><em>{unitName(line.unitId)}</em>{line.lastPurchaseUnitPrice ? <bdi dir="ltr">{formatMoney(line.lastPurchaseUnitPrice, isArabic ? "ر.س" : "SAR", language, 4)}</bdi> : null}</span>) : <strong>{t.none}</strong>}</div></div></section><section className="operations-material-stages-card"><strong>{isArabic ? "المراحل المطبقة" : "Applied stages"}</strong>{materialStages(editingItem)}</section></> : <section className="operations-inline-conversion">
          <div className="operations-inline-conversion__header"><div><h4>{isArabic ? "الوحدات والتحويلات" : "Units & conversions"}</h4></div>{editingConversion ? <BaseerButton type="button" variant="secondary" onClick={() => openConversion(editingItem)}>{isArabic ? "إلغاء التعديل" : "Cancel edit"}</BaseerButton> : <BaseerButton type="button" onClick={() => beginConversionEdit(editingItem)}>{isArabic ? "تعديل" : "Edit"}</BaseerButton>}</div>
          <Suspense fallback={null}><LazyOperationsCatalogConversionForm language={language} editing={editingConversion} busy={saving} value={conversion.edges} baseUnitId={editingItem.baseUnitId} units={catalog?.units ?? []} unitName={unitName} onSubmit={(edges) => saveMaterialChain(edges)} /></Suspense>
        </section>}
      </> : null}
    </BaseerDialog>
    <Suspense fallback={null}><LazyOperationsCatalogItemCreateDialog open={dialog === "item" && !editingItem} language={language} busy={saving} value={itemForm} units={catalog?.units ?? []} sections={catalog?.sections ?? []} onClose={() => setDialog(null)} onSubmit={(value) => write("/operations/catalog/items", { code: value.code, nameAr: value.nameAr, nameEn: value.nameEn || undefined, kind: value.kind, sectionId: value.kind === "MENU_PRODUCT" ? value.sectionId || undefined : undefined, baseUnitId: value.baseUnitId, unitPrices: value.unitIds.map((unitId) => ({ unitId, ...(value.kind === "MENU_PRODUCT" && unitId === value.baseUnitId && value.salePrice ? { menuSaleUnitPrice: value.salePrice } : {}) })) })} /></Suspense>
  </>;
}

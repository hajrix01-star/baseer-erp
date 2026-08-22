import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerSelect } from "./baseer-select";
import { DataTable, type DataTableColumn } from "./data-table";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { hasActivePermission } from "./module-access";
import { OperationsRecipeEditor, type OperationsRecipeWorkspaceData } from "./operations-recipe-editor";
import type { OperationsUnitForm } from "./operations-unit-form-dialog";
import "./operations-catalog-base.css";

type Language = "ar" | "en";
type Unit = { id: string; code: string; nameAr: string; nameEn: string | null; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE"; isActive: boolean };
type ItemUnit = { unitId: string; isBase: boolean; isActive: boolean; isOrderEnabled: boolean; lastPurchaseUnitPrice: string | null; lastPurchasePriceAt: string | null; menuSaleUnitPrice: string | null };
type Item = { id: string; code: string; nameAr: string; nameEn: string | null; kind: "RAW_MATERIAL" | "MENU_PRODUCT"; status: "ACTIVE" | "ARCHIVED"; sectionId: string | null; baseUnitId: string; itemUnits: ItemUnit[]; conversionVersion: { version: number; edges: Array<{ fromUnitId: string; toUnitId: string; factor: string }> } | null; liveRecipeUnitCost: string | null; liveRecipeCostStatus: "NO_RECIPE" | "INCOMPLETE" | "AVAILABLE" };
type Catalog = { units: Unit[]; sections: Array<{ id: string; nameAr: string; nameEn: string | null; isActive: boolean }>; items: Item[] };
export type ItemForm = { code: string; nameAr: string; nameEn: string; kind: Item["kind"]; sectionId: string; baseUnitId: string; unitIds: string[]; salePrice: string };
type Tab = "raw" | "units" | "menu" | "archive";
type MenuCardTab = "details" | "price" | "recipe";
type RawMaterialCardTab = "details" | "units";

const emptyItem: ItemForm = { code: "", nameAr: "", nameEn: "", kind: "RAW_MATERIAL", sectionId: "", baseUnitId: "", unitIds: [], salePrice: "" };
const LazyOperationsUnitFormDialog = lazy(async () => ({ default: (await import("./operations-unit-form-dialog")).OperationsUnitFormDialog }));
const LazyOperationsCatalogItemCreateDialog = lazy(async () => ({ default: (await import("./operations-catalog-item-create-dialog")).OperationsCatalogItemCreateDialog }));
const LazyOperationsCatalogItemDetailsForm = lazy(async () => ({ default: (await import("./operations-catalog-item-details-form")).OperationsCatalogItemDetailsForm }));
const LazyOperationsCatalogPriceForm = lazy(async () => ({ default: (await import("./operations-catalog-price-form")).OperationsCatalogPriceForm }));

export function OperationsCatalogWorkspace({ language }: { language: Language }) {
  const isArabic = language === "ar";
  const t = isArabic ? {
    title: "إدارة المنتجات الأولية", description: "إدارة المواد ووحدات الشراء والتغليف والتحويلات. آخر سعر شراء يأتي من الاستلام الفعلي فقط.", raw: "المواد الأولية", units: "الوحدات والتغليف", menu: "منتجات المنيو", archive: "الأرشيف", addMaterial: "إضافة مادة أولية", addUnit: "إضافة وحدة", addRestaurantUnits: "إضافة وحدات المطاعم الشائعة", active: "نشط", archived: "مؤرشف", materials: "مواد نشطة", needsConversion: "تحتاج تحويل", noPrice: "بلا سعر شراء", search: "ابحث بالاسم أو الرمز…", material: "المادة", baseUnit: "الوحدة الأساسية", lastPrice: "آخر سعر شراء", conversion: "التحويل", orderReady: "متاح للطلب", actions: "الإجراءات", manage: "فتح الكرت", recipe: "الرسبي والتكلفة", recipeDetails: "إدارة الرسبي", recipeCost: "تكلفة الرسبي", recipeCostLive: "تكلفة حية", refreshRecipeCost: "تحديث التكلفة", noRecipe: "لا يوجد رسبي", incompleteRecipeCost: "تكلفة غير مكتملة", itemUnits: "وحدات المادة", manageConversions: "إدارة التحويلات", conversionsHelp: "عرّف الوحدات والتغليف أولاً، ثم اربطها بوحدة أساس المخزون. لا تغيّر التحويلات أي طلب أو استلام سابق.", publish: "نشر تحويل", archiveItem: "أرشفة", ready: "جاهز", incomplete: "غير مكتمل", none: "—", save: "حفظ", close: "إغلاق", details: "بيانات الصنف", code: "الرمز", nameAr: "الاسم بالعربية", nameEn: "الاسم بالإنجليزية", dimension: "البعد", count: "عدد", mass: "وزن", volume: "حجم", package: "تغليف", itemType: "نوع الصنف", rawMaterial: "مادة أولية", menuProduct: "منتج منيو", section: "قسم التسجيل", salePrice: "سعر بيع المنيو", unit: "الوحدة", activeOnItem: "مفعّلة للصنف", orderEnabled: "متاحة للطلب", saveUnits: "حفظ الوحدات", conversionHint: "اكتب: 1 من الوحدة الظاهرة = العامل × الوحدة التالية. النشر ينشئ إصداراً جديداً ولا يغيّر أي طلب أو استلام سابق.", from: "من", to: "إلى", factor: "عامل التحويل", lastReceiptHint: "تُحدّث عند الاستلام الفعلي", unitHelp: "الوحدة العامة تُعرّف مرة واحدة. التغليف يُربط بالمادة ثم تُعرّف كميته بالتحويل.", loading: "جارٍ تحميل إدارة المنتجات…", noData: "لا توجد بيانات بعد.", failed: "تعذر تنفيذ العملية. حاول مرة أخرى.", baseRebaseBlocked: "لا يمكن تغيير وحدة أساس المخزون لهذه المادة الآن لأنها مرتبطة برصيد فعلي أو طلب شراء مفتوح أو رسبي منشور. لا يحذف النظام هذه السجلات تلقائياً.", saved: "تم الحفظ بنجاح.", editUnit: "تعديل وحدة", editItem: "تعديل الصنف", editSalePrice: "تعديل سعر البيع", price: "السعر" } : {
    title: "Raw material management", description: "Manage materials, purchasing units, packaging, and conversions. Last purchase price comes from an actual receipt only.", raw: "Raw materials", units: "Units & packaging", menu: "Menu products", archive: "Archive", addMaterial: "Add raw material", addUnit: "Add unit", addRestaurantUnits: "Add common restaurant units", active: "Active", archived: "Archived", materials: "Active materials", needsConversion: "Need conversion", noPrice: "No purchase price", search: "Search name or code…", material: "Material", baseUnit: "Base unit", lastPrice: "Last purchase price", conversion: "Conversion", orderReady: "Order ready", actions: "Actions", manage: "Open card", recipe: "Recipe & cost", recipeDetails: "Manage recipe", recipeCost: "Recipe cost", recipeCostLive: "Live cost", refreshRecipeCost: "Refresh cost", noRecipe: "No recipe", incompleteRecipeCost: "Incomplete cost", itemUnits: "Item units", manageConversions: "Manage conversions", conversionsHelp: "Set up units and packaging first, then connect them to the inventory base unit. Conversions never change a prior request or receipt.", publish: "Publish conversion", archiveItem: "Archive", ready: "Ready", incomplete: "Incomplete", none: "—", save: "Save", close: "Close", details: "Product details", code: "Code", nameAr: "Arabic name", nameEn: "English name", dimension: "Dimension", count: "Count", mass: "Mass", volume: "Volume", package: "Package", itemType: "Item type", rawMaterial: "Raw material", menuProduct: "Menu product", section: "Registration section", salePrice: "Menu sale price", unit: "Unit", activeOnItem: "Active on item", orderEnabled: "Available for ordering", saveUnits: "Save units", conversionHint: "Enter: 1 of the shown unit = factor × the next unit. Publishing creates a new version and never changes a prior request or receipt.", from: "From", to: "To", factor: "Factor", lastReceiptHint: "Updated after actual receipt", unitHelp: "A shared unit is defined once. Packaging is attached to a material and then converted there.", loading: "Loading material management…", noData: "No data yet.", failed: "Could not complete the operation. Try again.", baseRebaseBlocked: "The inventory base unit cannot change while this material has a balance, an open purchase request, or a published recipe. The system will not delete those records automatically.", saved: "Saved successfully.", editUnit: "Edit unit", editItem: "Edit item", editSalePrice: "Edit sale price", price: "Price" };
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("raw");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"unit" | "item" | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [unitForm, setUnitForm] = useState<OperationsUnitForm>({ nameAr: "", nameEn: "", dimension: "COUNT", isActive: true });
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem);
  const [conversion, setConversion] = useState({ itemId: "", edges: [] as Array<{ fromUnitId: string; toUnitId: string; factor: string; isPurchasePackaging: boolean }> });
  const [menuCardTab, setMenuCardTab] = useState<MenuCardTab>("details");
  const [rawMaterialCardTab, setRawMaterialCardTab] = useState<RawMaterialCardTab>("details");
  const [editingConversion, setEditingConversion] = useState(false);
  const [recipeWorkspace, setRecipeWorkspace] = useState<OperationsRecipeWorkspaceData | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const showDialog = useCallback((next: NonNullable<typeof dialog>) => { void import("./operations-catalog-workspace.css").finally(() => setDialog(next)); }, []);
  const unitName = useCallback((id: string) => { const unit = catalog?.units.find((entry) => entry.id === id); return isArabic ? unit?.nameAr ?? "—" : unit?.nameEn ?? unit?.nameAr ?? "—"; }, [catalog, isArabic]);
  const itemName = useCallback((item: Item) => isArabic ? item.nameAr : item.nameEn ?? item.nameAr, [isArabic]);
  const reload = useCallback(async (): Promise<Catalog | null> => { const current = activeSession(); setSession(current); if (!current) { setCatalog(null); setLoading(false); return null; } setLoading(true); try { const next = await api<Catalog>(current, "/operations/catalog"); setCatalog(next); return next; } catch (error) { setNotice({ kind: "error", text: presentBaseerApiError(error, language, t.failed) }); return null; } finally { setLoading(false); } }, [language, t.failed]);
  const reloadRecipeWorkspace = useCallback(async () => { const current = activeSession(); if (!current) return; setRecipeLoading(true); setRecipeError(null); try { setRecipeWorkspace(await api<OperationsRecipeWorkspaceData>(current, "/operations/recipe-workspace")); } catch (error) { setRecipeError(presentBaseerApiError(error, language, t.failed)); } finally { setRecipeLoading(false); } }, [language, t.failed]);
  useEffect(() => { void reload(); }, [reload]);
  const write = async (path: string, body: Record<string, unknown>, options: { keepDialogOpen?: boolean } = {}) => { if (!session) return; setSaving(true); setNotice(null); try { await api(session, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: requestId() }) }); setNotice({ kind: "success", text: t.saved }); if (!options.keepDialogOpen) setDialog(null); const next = await reload(); if (options.keepDialogOpen && editingItem) setEditingItem(next?.items.find((item) => item.id === editingItem.id) ?? editingItem); } catch (error) { setNotice({ kind: "error", text: presentBaseerApiError(error, language, t.failed) }); } finally { setSaving(false); } };
  const raw = useMemo(() => catalog?.items.filter((item) => item.kind === "RAW_MATERIAL") ?? [], [catalog]);
  const activeRaw = raw.filter((item) => item.status === "ACTIVE");
  const displayed = (items: Item[]) => items.filter((item) => `${item.code} ${item.nameAr} ${item.nameEn ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const incomplete = activeRaw.filter((item) => item.itemUnits.filter((line) => line.isActive).length > 1 && !item.conversionVersion);
  const noPrice = activeRaw.filter((item) => !item.itemUnits.some((line) => line.isActive && line.isOrderEnabled && line.lastPurchaseUnitPrice));
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
  const linkConversionEdges = (edges: Array<{ fromUnitId: string; toUnitId: string; factor: string; isPurchasePackaging: boolean }>) => edges.map((edge, index) => index === 0 ? edge : { ...edge, fromUnitId: edges[index - 1]?.toUnitId ?? "" });
  const saveMaterialChain = async () => {
    if (!session || !editingItem || !catalog) return;
    const complete = conversion.edges.length > 0 && conversion.edges.every((edge) => edge.fromUnitId && edge.toUnitId && edge.factor);
    if (!complete) { setNotice({ kind: "error", text: isArabic ? "أكمل الوحدة والعامل في كل مرحلة أولاً." : "Complete the unit and factor in every stage first." }); return; }
    const selectedUnitIds = new Set([editingItem.baseUnitId, ...conversion.edges.flatMap((edge) => [edge.fromUnitId, edge.toUnitId])]);
    const configuredUnits = [
      ...editingItem.itemUnits.map((line) => ({ unitId: line.unitId, isActive: line.isActive || selectedUnitIds.has(line.unitId), isOrderEnabled: line.isOrderEnabled })),
      ...[...selectedUnitIds].filter((unitId) => !editingItem.itemUnits.some((line) => line.unitId === unitId)).map((unitId) => ({ unitId, isActive: true, isOrderEnabled: false })),
    ];
    const conversionSourceUnits = new Set(conversion.edges.map((edge) => edge.fromUnitId));
    const purchasingUnits = new Set(conversion.edges.filter((edge) => edge.isPurchasePackaging).map((edge) => edge.fromUnitId));
    setSaving(true); setNotice(null);
    try {
      await api(session, "/operations/catalog/item-units/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: editingItem.id, units: configuredUnits, idempotencyKey: requestId() }) });
      await api(session, "/operations/catalog/conversions/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: editingItem.id, edges: conversion.edges.map(({ fromUnitId, toUnitId, factor }) => ({ fromUnitId, toUnitId, factor })), idempotencyKey: requestId() }) });
      await api(session, "/operations/catalog/item-units/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: editingItem.id, units: configuredUnits.map((line) => ({ ...line, isOrderEnabled: conversionSourceUnits.has(line.unitId) ? purchasingUnits.has(line.unitId) : line.isOrderEnabled })), idempotencyKey: requestId() }) });
      const next = await reload();
      const refreshed = next?.items.find((item) => item.id === editingItem.id);
      if (refreshed) openConversion(refreshed);
      setNotice({ kind: "success", text: isArabic ? "تم حفظ الوحدات والتحويلات وتغليفات الشراء." : "Units, conversions, and purchase packaging were saved." });
    } catch (error) { setNotice({ kind: "error", text: presentBaseerApiError(error, language, t.failed) }); } finally { setSaving(false); }
  };
  const rawColumns: readonly DataTableColumn<Item>[] = [
    { id: "material", header: t.material, sort: itemName, cell: (item) => <button type="button" className="operations-row-link" onClick={() => openItem(item)}><strong>{itemName(item)}</strong><small>{item.code}</small></button> },
    { id: "base", header: t.baseUnit, cell: (item) => unitName(item.baseUnitId) },
    { id: "stages", header: isArabic ? "المراحل" : "Stages", cell: (item) => materialStages(item) },
    { id: "price", header: t.lastPrice, cell: (item) => { const purchaseUnits = item.itemUnits.filter((line) => line.isActive && line.isOrderEnabled && line.lastPurchaseUnitPrice).sort((left, right) => (right.lastPurchasePriceAt ?? "").localeCompare(left.lastPurchasePriceAt ?? "")); return purchaseUnits.length ? <div className="operations-purchase-price-list">{purchaseUnits.map((line) => <div key={line.unitId}><strong>{line.lastPurchaseUnitPrice} {isArabic ? "ر.س" : "SAR"}</strong><small>{unitName(line.unitId)}{line.lastPurchasePriceAt ? ` · ${new Date(line.lastPurchasePriceAt).toLocaleDateString("en-GB")}` : ""}</small></div>)}</div> : t.none; } },
    { id: "conversion", header: t.conversion, cell: (item) => item.itemUnits.filter((line) => line.isActive).length < 2 ? t.ready : item.conversionVersion ? `v${item.conversionVersion.version}` : t.incomplete },
    { id: "ready", header: t.orderReady, cell: (item) => item.itemUnits.some((line) => line.isActive && line.isOrderEnabled) ? t.ready : t.incomplete },
  ];
  if (!session) return <DailySalesSignIn language={language} />;
  const tabs: Array<{ id: Tab; label: string }> = [{ id: "raw", label: t.raw }, { id: "units", label: t.units }, { id: "menu", label: t.menu }, { id: "archive", label: t.archive }];
  const archived = catalog?.items.filter((item) => item.status === "ARCHIVED") ?? [];
  const menu = catalog?.items.filter((item) => item.kind === "MENU_PRODUCT" && item.status === "ACTIVE") ?? [];
  const draftBaseUnitId = editingItem?.baseUnitId || "";
  const defaultBridgeFactor = (fromUnitId: string, toUnitId: string) => {
    const normalizeCode = (id: string) => catalog?.units.find((unit) => unit.id === id)?.code.trim().toUpperCase().replaceAll(/[^A-Z]/g, "") ?? "";
    const from = normalizeCode(fromUnitId); const to = normalizeCode(toUnitId);
    const litreCodes = new Set(["L", "LTR", "LITRE", "LITER"]);
    const gramCodes = new Set(["G", "GR", "GRAM", "GRAMS"]);
    return litreCodes.has(from) && gramCodes.has(to) ? "1000" : "";
  };
  return <>
    <section className="operations-catalog" aria-label={t.title}>
      <header className="operations-catalog__header"><div><p className="eyebrow">Operations O1</p><h3>{t.title}</h3><p>{t.description}</p></div><div className="baseer-inline-actions"><BaseerButton type="button" variant="secondary" onClick={() => { setEditingUnit(null); setUnitForm({ nameAr: "", nameEn: "", dimension: "COUNT", isActive: true }); showDialog("unit"); }}>{t.addUnit}</BaseerButton><BaseerButton type="button" onClick={() => openItem()}>{t.addMaterial}</BaseerButton></div></header>
      {notice ? <p className={`daily-sales-message ${notice.kind}`}>{notice.text}</p> : null}
      {loading ? <BaseerCard><p>{t.loading}</p></BaseerCard> : <>
        <div className="operations-catalog__metrics"><BaseerCard><strong>{t.materials}</strong><p>{activeRaw.length}</p></BaseerCard><BaseerCard><strong>{t.needsConversion}</strong><p>{incomplete.length}</p></BaseerCard><BaseerCard><strong>{t.noPrice}</strong><p>{noPrice.length}</p></BaseerCard></div>
        <nav className="operations-catalog__tabs" aria-label={t.title}>{tabs.map((entry) => <button key={entry.id} type="button" className={tab === entry.id ? "is-active" : ""} onClick={() => { setTab(entry.id); if (entry.id === "menu") void reload(); }}>{entry.label}</button>)}</nav>
        {tab !== "units" ? <input className="operations-catalog__search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} /> : null}
        {tab === "raw" ? <BaseerCard><div className="operations-catalog__card-heading"><div><h3>{t.raw}</h3><p>{t.lastReceiptHint}</p></div></div>{displayed(activeRaw).length ? <DataTable ariaLabel={t.raw} caption={t.raw} rows={displayed(activeRaw)} rowKey={(item) => item.id} columns={rawColumns} /> : <p>{t.noData}</p>}</BaseerCard> : null}
        {tab === "units" ? <BaseerCard><div className="operations-catalog__card-heading"><div><h3>{t.units}</h3><p>{t.unitHelp}</p></div><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => void write("/operations/catalog/units/restaurant-presets", {})}>{t.addRestaurantUnits}</BaseerButton></div>{catalog?.units.length ? <DataTable ariaLabel={t.units} caption={t.units} rows={catalog.units} rowKey={(unit) => unit.id} columns={[{ id: "unit", header: t.unit, cell: (unit) => <button type="button" className="operations-row-link" onClick={() => { setEditingUnit(unit); setUnitForm({ nameAr: unit.nameAr, nameEn: unit.nameEn ?? "", dimension: unit.dimension, isActive: unit.isActive }); showDialog("unit"); }}><strong>{isArabic ? unit.nameAr : unit.nameEn ?? unit.nameAr}</strong><small>{unit.code}</small></button> }, { id: "dimension", header: t.dimension, cell: (unit) => t[unit.dimension.toLowerCase() as "count" | "mass" | "volume" | "package"] }]} /> : <p>{t.noData}</p>}</BaseerCard> : null}
        {tab === "menu" ? <BaseerCard><div className="operations-catalog__card-heading"><div><h3>{t.menu}</h3><p>{isArabic ? "اضغط اسم الصنف لفتح كرت موحّد لإدارة البيانات وسعر البيع ورسبي المكونات." : "Select a product name to open one card for its details, sale price, and recipe."}</p></div><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void reload()}>{t.refreshRecipeCost}</BaseerButton></div>{displayed(menu).length ? <DataTable ariaLabel={t.menu} caption={t.menu} rows={displayed(menu)} rowKey={(item) => item.id} columns={[{ id: "item", header: t.material, cell: (item) => <button type="button" className="operations-row-link" onClick={() => openItem(item, canReadRecipes ? "recipe" : "details")}><strong>{itemName(item)}</strong><small>{canReadRecipes ? t.recipeDetails : t.manage}</small></button> }, { id: "recipe-cost", header: t.recipeCost, cell: (item) => item.liveRecipeCostStatus === "AVAILABLE" && item.liveRecipeUnitCost !== null ? <span><strong><bdi>{item.liveRecipeUnitCost} {isArabic ? "ر.س" : "SAR"}</bdi></strong><small>{t.recipeCostLive}</small></span> : <small>{item.liveRecipeCostStatus === "NO_RECIPE" ? t.noRecipe : t.incompleteRecipeCost}</small> }, { id: "price", header: t.salePrice, cell: (item) => item.itemUnits.find((line) => line.isBase)?.menuSaleUnitPrice ?? t.none }]} /> : <p>{t.noData}</p>}</BaseerCard> : null}
        {tab === "archive" ? <BaseerCard><h3>{t.archive}</h3>{displayed(archived).length ? <DataTable ariaLabel={t.archive} caption={t.archive} rows={displayed(archived)} rowKey={(item) => item.id} columns={[{ id: "item", header: t.material, cell: (item) => <strong>{itemName(item)}</strong> }, { id: "base", header: t.baseUnit, cell: (item) => unitName(item.baseUnitId) }]} /> : <p>{t.noData}</p>}</BaseerCard> : null}
      </>}
    </section>
    <Suspense fallback={null}><LazyOperationsUnitFormDialog open={dialog === "unit"} language={language} busy={saving} value={unitForm} editingCode={editingUnit?.code ?? null} onClose={() => setDialog(null)} onSubmit={(value) => write(editingUnit ? "/operations/catalog/units/update" : "/operations/catalog/units", editingUnit ? { ...value, unitId: editingUnit.id } : value)} /></Suspense>
    <BaseerDialog open={dialog === "item" && editingItem?.kind === "MENU_PRODUCT"} title={editingItem ? `${t.menuProduct} — ${itemName(editingItem)}` : t.menuProduct} language={language} busy={saving} onClose={() => setDialog(null)} size="wide" className="operations-menu-product-card" footer={menuCardTab !== "recipe" ? <><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setDialog(null)}>{t.close}</BaseerButton><BaseerButton type="submit" form={menuCardTab === "price" ? "operations-menu-product-price" : "operations-menu-product-card"} disabled={saving}>{t.save}</BaseerButton></> : <BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setDialog(null)}>{t.close}</BaseerButton>}>
      {editingItem ? <><nav className="operations-menu-product-card__tabs" aria-label={t.menuProduct}><button type="button" className={menuCardTab === "details" ? "is-active" : ""} onClick={() => setMenuCardTab("details")}>{t.details}</button><button type="button" className={menuCardTab === "price" ? "is-active" : ""} onClick={() => setMenuCardTab("price")}>{t.salePrice}</button>{canReadRecipes ? <button type="button" className={menuCardTab === "recipe" ? "is-active" : ""} onClick={() => { setMenuCardTab("recipe"); if (!recipeWorkspace) void reloadRecipeWorkspace(); }}>{t.recipe}</button> : null}</nav>{menuCardTab === "details" ? <Suspense fallback={null}><LazyOperationsCatalogItemDetailsForm formId="operations-menu-product-card" language={language} value={{ itemId: editingItem.id, code: itemForm.code, nameAr: itemForm.nameAr, nameEn: itemForm.nameEn, sectionId: itemForm.sectionId, kind: editingItem.kind }} sections={catalog?.sections ?? []} onSubmit={(next) => write("/operations/catalog/items/update", { itemId: next.itemId, code: next.code, nameAr: next.nameAr, nameEn: next.nameEn || undefined, sectionId: next.sectionId || null })} /></Suspense> : menuCardTab === "price" ? <Suspense fallback={null}><LazyOperationsCatalogPriceForm formId="operations-menu-product-price" language={language} value={editingItem.itemUnits.find((line) => line.isBase)?.menuSaleUnitPrice ?? ""} onSubmit={(next) => { const unit = editingItem.itemUnits.find((line) => line.isBase); return unit ? write("/operations/catalog/item-units/price", { itemId: editingItem.id, unitId: unit.unitId, price: next.price }) : undefined; }} /></Suspense> : recipeLoading ? <p>{t.loading}</p> : recipeError ? <p className="daily-sales-message error">{recipeError}</p> : recipeWorkspace ? <OperationsRecipeEditor language={language} workspace={recipeWorkspace} productId={editingItem.id} onPublished={async () => { await Promise.all([reload(), reloadRecipeWorkspace()]); }} /> : null}</> : null}
    </BaseerDialog>
    <BaseerDialog open={dialog === "item" && editingItem?.kind === "RAW_MATERIAL"} title={editingItem ? `${t.rawMaterial} — ${itemName(editingItem)}` : t.rawMaterial} language={language} busy={saving} onClose={() => setDialog(null)} size="wide" className="operations-raw-material-card" footer={<><BaseerButton type="button" variant="secondary" disabled={saving} onClick={() => setDialog(null)}>{t.close}</BaseerButton>{rawMaterialCardTab === "details" ? <BaseerButton type="submit" form="operations-raw-material-card" disabled={saving}>{t.save}</BaseerButton> : null}</>}>
      {editingItem ? <>
        <nav className="operations-menu-product-card__tabs" aria-label={t.rawMaterial}>
          <button type="button" className={rawMaterialCardTab === "details" ? "is-active" : ""} onClick={() => setRawMaterialCardTab("details")}>{t.details}</button>
          <button type="button" className={rawMaterialCardTab === "units" ? "is-active" : ""} onClick={() => openConversion(editingItem)}>{isArabic ? "الوحدات والتحويلات" : "Units & conversions"}</button>
        </nav>
        {rawMaterialCardTab === "details" ? <><Suspense fallback={null}><LazyOperationsCatalogItemDetailsForm formId="operations-raw-material-card" language={language} value={{ itemId: editingItem.id, code: itemForm.code, nameAr: itemForm.nameAr, nameEn: itemForm.nameEn, sectionId: "", kind: editingItem.kind }} sections={[]} onSubmit={(next) => write("/operations/catalog/items/update", { itemId: next.itemId, code: next.code, nameAr: next.nameAr, nameEn: next.nameEn || undefined, sectionId: null })} /></Suspense><section className="operations-material-overview"><div><small>{isArabic ? "وحدة أساس المخزون" : "Inventory base unit"}</small><strong>{unitName(editingItem.baseUnitId)}</strong></div><div><small>{isArabic ? "إصدار التحويل" : "Conversion version"}</small><strong>{editingItem.conversionVersion ? <bdi dir="ltr">v{editingItem.conversionVersion.version}</bdi> : t.none}</strong></div><div className="operations-material-overview__purchase"><small>{isArabic ? "تغليفات الشراء" : "Purchase packaging"}</small><div>{purchasePackaging(editingItem).length ? purchasePackaging(editingItem).map((line) => <span key={line.unitId}><em>{unitName(line.unitId)}</em>{line.lastPurchaseUnitPrice ? <bdi>{line.lastPurchaseUnitPrice} {isArabic ? "ر.س" : "SAR"}</bdi> : null}</span>) : <strong>{t.none}</strong>}</div></div></section><section className="operations-material-stages-card"><strong>{isArabic ? "المراحل المطبقة" : "Applied stages"}</strong>{materialStages(editingItem)}</section></> : <section className="operations-inline-conversion">
          <header className="operations-inline-conversion__header"><div><h4>{isArabic ? "الوحدات والتحويلات" : "Units & conversions"}</h4></div>{editingConversion ? <BaseerButton type="button" variant="secondary" onClick={() => openConversion(editingItem)}>{isArabic ? "إلغاء التعديل" : "Cancel edit"}</BaseerButton> : <BaseerButton type="button" onClick={() => beginConversionEdit(editingItem)}>{isArabic ? "تعديل" : "Edit"}</BaseerButton>}</header>
          <form id="operations-inline-conversion" className="operations-inline-conversion__form" onSubmit={(event) => { event.preventDefault(); void saveMaterialChain(); }}>
            <fieldset className="operations-inline-conversion__fields" disabled={!editingConversion}>
            <div className="operations-inline-conversion__table-wrap"><table><thead><tr><th scope="col">#</th><th scope="col">{isArabic ? "من الوحدة" : "From unit"}</th><th scope="col">{t.factor}</th><th scope="col">{t.to}</th><th scope="col">{isArabic ? "تغليف شراء" : "Purchase packaging"}</th><th scope="col"><span className="visually-hidden">{isArabic ? "حذف" : "Remove"}</span></th></tr></thead><tbody>{conversion.edges.length ? conversion.edges.map((edge, index) => { const availableUnits = (catalog?.units ?? []).filter((unit) => unit.isActive && unit.id !== editingItem.baseUnitId); const targetOptions = (catalog?.units ?? []).filter((unit) => unit.isActive && unit.id !== edge.fromUnitId && (!conversion.edges.some((other) => other.fromUnitId === unit.id) || unit.id === edge.toUnitId || unit.id === editingItem.baseUnitId)); return <tr key={`${edge.fromUnitId || "new"}-${index}`}><td>{index + 1}</td><td><BaseerSelect searchable={false} required disabled={index > 0} id={`inline-conversion-from-${index}`} label={isArabic ? "من الوحدة" : "From unit"} value={edge.fromUnitId} placeholder={t.unit} options={index && edge.fromUnitId ? [{ id: edge.fromUnitId, label: unitName(edge.fromUnitId) }] : index ? [] : availableUnits.map((unit) => ({ id: unit.id, label: unitName(unit.id) }))} onChange={(fromUnitId) => { const next = [...conversion.edges]; next[index] = { ...edge, fromUnitId }; setConversion({ ...conversion, edges: linkConversionEdges(next) }); }} /></td><td><input required inputMode="decimal" value={edge.factor} placeholder="0" onChange={(event) => { const next = [...conversion.edges]; next[index] = { ...edge, factor: event.target.value }; setConversion({ ...conversion, edges: next }); }} /></td><td><BaseerSelect searchable={false} required id={`inline-conversion-to-${index}`} label={t.to} value={edge.toUnitId} placeholder={t.unit} options={targetOptions.map((unit) => ({ id: unit.id, label: unitName(unit.id) }))} onChange={(toUnitId) => { const next = [...conversion.edges]; next[index] = { ...edge, toUnitId, factor: edge.factor || defaultBridgeFactor(edge.fromUnitId, toUnitId) }; if (next[index + 1]) next[index + 1] = { ...next[index + 1], fromUnitId: toUnitId }; setConversion({ ...conversion, edges: linkConversionEdges(next) }); }} /></td><td><label className="operations-inline-conversion__purchase"><input type="checkbox" checked={edge.isPurchasePackaging} onChange={(event) => { const next = [...conversion.edges]; next[index] = { ...edge, isPurchasePackaging: event.target.checked }; setConversion({ ...conversion, edges: next }); }} /><span>{isArabic ? "يظهر في الطلب" : "Show in request"}</span></label></td><td><BaseerButton type="button" variant="quiet" disabled={index !== conversion.edges.length - 1} onClick={() => setConversion({ ...conversion, edges: conversion.edges.slice(0, -1) })}>{isArabic ? "حذف" : "Remove"}</BaseerButton></td></tr>; }) : <tr><td className="operations-inline-conversion__empty" colSpan={6}>{isArabic ? "أضف مرحلة بدءاً من تغليف الشراء أو أكبر وحدة مستخدمة." : "Add a stage starting from purchase packaging or the largest used unit."}</td></tr>}</tbody></table></div>
            <div className="operations-inline-conversion__actions"><BaseerButton type="button" variant="secondary" onClick={() => { const previous = conversion.edges.at(-1); if (!previous) { setConversion({ ...conversion, edges: [{ fromUnitId: "", toUnitId: editingItem.baseUnitId, factor: "", isPurchasePackaging: true }] }); return; } setConversion({ ...conversion, edges: [...conversion.edges, { fromUnitId: previous.toUnitId, toUnitId: "", factor: "", isPurchasePackaging: false }] }); }}>{isArabic ? "+ إضافة مرحلة" : "+ Add stage"}</BaseerButton><BaseerButton type="submit" disabled={!conversion.edges.length || saving}>{isArabic ? "حفظ الوحدات والتحويلات" : "Save units & conversions"}</BaseerButton></div>
            </fieldset>
            <div className="operations-inline-conversion__summary"><section><strong>{isArabic ? "سلسلة الصنف" : "Item chain"}</strong><div>{conversion.edges.length ? [conversion.edges[0]!.fromUnitId, ...conversion.edges.map((edge) => edge.toUnitId)].map((unitId, index) => <span key={`${unitId}-${index}`}>{index ? <bdi aria-hidden="true">←</bdi> : null}{unitName(unitId)}</span>) : <span>{unitName(editingItem.baseUnitId)}</span>}</div></section><section><strong>{isArabic ? "وحدة أساس المخزون" : "Inventory base unit"}</strong><span>{unitName(draftBaseUnitId)}</span></section></div>
            <section className="operations-inline-conversion__equations"><strong>{isArabic ? "معادلات التحويل" : "Conversion equations"}</strong>{conversion.edges.length && conversion.edges.every((edge) => edge.factor && edge.toUnitId) ? conversion.edges.map((edge, index) => <p key={`${edge.fromUnitId}-${edge.toUnitId}-${index}`}><bdi dir="ltr">1</bdi> {unitName(edge.fromUnitId)} <span>=</span> <bdi dir="ltr">{Number(edge.factor).toLocaleString("en-US", { maximumFractionDigits: 8 })}</bdi> {unitName(edge.toUnitId)}</p>) : <p>{isArabic ? "أكمل عامل التحويل والوحدة التالية لعرض المعادلات." : "Complete the factor and next unit to show the equations."}</p>}</section>
          </form>
        </section>}
      </> : null}
    </BaseerDialog>
    <Suspense fallback={null}><LazyOperationsCatalogItemCreateDialog open={dialog === "item" && !editingItem} language={language} busy={saving} value={itemForm} units={catalog?.units ?? []} sections={catalog?.sections ?? []} onClose={() => setDialog(null)} onSubmit={(value) => write("/operations/catalog/items", { code: value.code, nameAr: value.nameAr, nameEn: value.nameEn || undefined, kind: value.kind, sectionId: value.kind === "MENU_PRODUCT" ? value.sectionId || undefined : undefined, baseUnitId: value.baseUnitId, unitPrices: value.unitIds.map((unitId) => ({ unitId, ...(value.kind === "MENU_PRODUCT" && unitId === value.baseUnitId && value.salePrice ? { menuSaleUnitPrice: value.salePrice } : {}) })) })} /></Suspense>
  </>;
}

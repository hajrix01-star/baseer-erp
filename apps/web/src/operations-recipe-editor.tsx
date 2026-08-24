import { Fragment, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerSelect } from "./baseer-select";
import { formatQuantity, normalizeBaseerNumericInput } from "./number-format";
import { activeSession, api, requestId } from "./daily-sales-client";
import { hasActivePermission } from "./module-access";
import "./operations-recipe-workspace.css";

export type OperationsRecipeWorkspaceData = {
  units: Array<{ id: string; nameAr: string; nameEn: string | null; dimension: string }>;
  menuProducts: Array<{ id: string; nameAr: string; nameEn: string | null; itemUnits: Array<{ unitId: string; isActive: boolean }> }>;
  rawMaterials: Array<{ id: string; nameAr: string; nameEn: string | null; baseUnitId: string; itemUnits: Array<{ unitId: string; isActive: boolean }>; conversionVersion: { version: number; edges: Array<{ fromUnitId: string; toUnitId: string; factor: string }> } | null; weightedUnitCost: string }>;
  recipes: Array<{ outputItemId: string; version: number; outputQuantity: string; outputUnitId: string; estimatedCost: string; lines: Array<{ rawMaterialItemId: string; unitId: string; quantity: string; resolvedBaseQuantity: string }> }>;
};

type RecipeLine = { rawMaterialItemId: string; unitId: string; quantity: string };
type Preview = { estimatedCost: string | null; costPerOutputUnit: string | null; missingMaterialIds: string[]; lines: Array<{ rawMaterialItemId: string; unitId: string; quantity: string; resolvedBaseQuantity: string; weightedUnitCost: string | null; estimatedLineCost: string | null }> };
type Language = "ar" | "en";

/** Recipe authoring belongs to one menu-product card; it never exposes sale prices. */
export function OperationsRecipeEditor({ language, workspace, productId, onPublished }: { language: Language; workspace: OperationsRecipeWorkspaceData; productId: string; onPublished: () => Promise<void> | void }) {
  const ar = language === "ar";
  const t = ar ? {
    title: "الرسبي والتكلفة", description: "المواد والكميات هنا تخص هذا الصنف فقط. النشر ينشئ نسخة جديدة ولا يغيّر الوصفات السابقة.", outputQuantity: "كمية الناتج", unit: "وحدة الناتج", ingredients: "مكونات الرسبي", material: "المادة الأولية", quantity: "الكمية", baseQuantity: "بالوحدة الأساسية", unitCost: "متوسط تكلفة الوحدة", lineCost: "تكلفة البند", remove: "حذف", add: "إضافة مادة", preview: "تحديث التكلفة", publish: "نشر إصدار جديد", liveCost: "تكلفة تقديرية حية حسب متوسط تكلفة المخزون الحالي", batchCost: "تكلفة الدفعة", outputCost: "تكلفة وحدة الناتج", missing: "مواد بلا تكلفة مخزون", version: "الإصدار الحالي", select: "اختر", incomplete: "لا يمكن نشر تكلفة موثوقة قبل استلام المواد الناقصة.", noConversion: "لا يوجد مسار تحويل منشور لهذه الوحدة.", publishOnly: "ليس لديك صلاحية نشر وصفة.", saved: "تم نشر إصدار الوصفة بنجاح.", failed: "تعذر تنفيذ العملية. حاول مرة أخرى.", recipeHelp: "تُحفظ الوحدات وكمياتها كما هي وقت النشر. التسجيل الداخلي لا يخصم المواد تلقائياً." } : {
    title: "Recipe & cost", description: "Ingredients and quantities belong only to this menu product. Publishing creates a new version and never changes prior recipes.", outputQuantity: "Output quantity", unit: "Output unit", ingredients: "Recipe ingredients", material: "Raw material", quantity: "Quantity", baseQuantity: "In base unit", unitCost: "Weighted unit cost", lineCost: "Line cost", remove: "Remove", add: "Add material", preview: "Refresh cost", publish: "Publish new version", liveCost: "Live estimate from current weighted inventory cost", batchCost: "Batch cost", outputCost: "Output unit cost", missing: "Materials without inventory cost", version: "Current version", select: "Select", incomplete: "A reliable cost cannot be published until missing materials are received.", noConversion: "This unit has no published conversion path.", publishOnly: "You do not have permission to publish a recipe.", saved: "Recipe version published successfully.", failed: "Could not complete the operation. Try again.", recipeHelp: "Units and quantities are snapshotted when published. Internal registration does not deduct materials automatically." };
  const product = workspace.menuProducts.find((entry) => entry.id === productId);
  const currentRecipe = useMemo(() => workspace.recipes.find((recipe) => recipe.outputItemId === productId) ?? null, [workspace.recipes, productId]);
  const [outputUnitId, setOutputUnitId] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("1");
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const canPublish = hasActivePermission("operations.recipe.publish");

  const itemName = (item: { nameAr: string; nameEn: string | null }) => ar ? item.nameAr : item.nameEn ?? item.nameAr;
  const unitName = (id: string) => { const unit = workspace.units.find((entry) => entry.id === id); return ar ? unit?.nameAr ?? "—" : unit?.nameEn ?? unit?.nameAr ?? "—"; };
  const number = (value: string | null | undefined) => formatQuantity(value, 4, language);
  const material = (id: string) => workspace.rawMaterials.find((entry) => entry.id === id);
  const factorToBase = (selected: NonNullable<ReturnType<typeof material>>, unitId: string) => {
    if (unitId === selected.baseUnitId) return 1;
    // A material conversion is a connected relation, not a one-way recipe rule.
    // If `1 piece = 200 grams` and the base is piece, recipes may still select
    // grams: their factor to the base is 1 / 200.
    const adjacent = new Map<string, Array<{ unitId: string; factor: number }>>();
    for (const edge of selected.conversionVersion?.edges ?? []) {
      const factor = Number(edge.factor);
      if (!Number.isFinite(factor) || factor <= 0) return null;
      adjacent.set(edge.fromUnitId, [...(adjacent.get(edge.fromUnitId) ?? []), { unitId: edge.toUnitId, factor }]);
      adjacent.set(edge.toUnitId, [...(adjacent.get(edge.toUnitId) ?? []), { unitId: edge.fromUnitId, factor: 1 / factor }]);
    }
    const factors = new Map<string, number>([[unitId, 1]]);
    const queue = [unitId];
    while (queue.length) {
      const current = queue.shift()!;
      if (current === selected.baseUnitId) break;
      for (const next of adjacent.get(current) ?? []) if (!factors.has(next.unitId)) {
        factors.set(next.unitId, factors.get(current)! * next.factor);
        queue.push(next.unitId);
      }
    }
    const factor = factors.get(selected.baseUnitId);
    return factor && Number.isFinite(factor) && factor > 0 ? factor : null;
  };
  const unitChoices = (id: string) => { const selected = material(id); return selected?.itemUnits.filter((line) => line.isActive && factorToBase(selected, line.unitId) !== null) ?? []; };
  const liveEstimate = (selected: NonNullable<ReturnType<typeof material>>, line: RecipeLine) => {
    const factor = factorToBase(selected, line.unitId); const quantity = Number(line.quantity); const baseCost = Number(selected.weightedUnitCost);
    if (factor === null || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(baseCost) || baseCost <= 0) return null;
    return { baseQuantity: factor * quantity, selectedUnitCost: factor * baseCost, lineCost: factor * quantity * baseCost };
  };
  const currentCostPreview = (recipe: NonNullable<typeof currentRecipe>): Preview => {
    const nextLines = recipe.lines.map((line) => {
      const weightedUnitCost = material(line.rawMaterialItemId)?.weightedUnitCost ?? null;
      const hasCost = weightedUnitCost !== null && Number(weightedUnitCost) > 0;
      return { ...line, weightedUnitCost: hasCost ? weightedUnitCost : null, estimatedLineCost: hasCost ? (Number(line.resolvedBaseQuantity) * Number(weightedUnitCost)).toFixed(4) : null };
    });
    const missingMaterialIds = nextLines.filter((line) => !line.weightedUnitCost).map((line) => line.rawMaterialItemId);
    const estimatedCost = missingMaterialIds.length ? null : nextLines.reduce((sum, line) => sum + Number(line.estimatedLineCost ?? 0), 0).toFixed(4);
    return { estimatedCost, costPerOutputUnit: estimatedCost && Number(recipe.outputQuantity) > 0 ? (Number(estimatedCost) / Number(recipe.outputQuantity)).toFixed(4) : null, missingMaterialIds, lines: nextLines };
  };
  useEffect(() => {
    setOutputUnitId(currentRecipe?.outputUnitId ?? product?.itemUnits.find((line) => line.isActive)?.unitId ?? "");
    setOutputQuantity(currentRecipe?.outputQuantity ?? "1");
    setLines(currentRecipe?.lines.map(({ rawMaterialItemId, unitId, quantity }) => ({ rawMaterialItemId, unitId, quantity })) ?? []);
    setPreview(currentRecipe ? currentCostPreview(currentRecipe) : null);
    setMessage(null);
  }, [currentRecipe, product?.id, workspace.rawMaterials]);
  const changeLine = (index: number, patch: Partial<RecipeLine>) => { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); setPreview(null); };

  const calculate = async () => {
    const session = activeSession();
    if (!session || !product || !outputUnitId || !lines.length) return;
    setBusy(true); setMessage(null);
    try {
      const response = await api<Preview>(session, "/operations/recipes/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outputItemId: product.id, outputUnitId, outputQuantity, lines }) });
      setPreview(response);
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, t.failed) }); } finally { setBusy(false); }
  };
  const publish = async () => {
    const session = activeSession();
    if (!session || !product || !canPublish || !preview?.estimatedCost) return;
    setBusy(true); setMessage(null);
    try {
      await api(session, "/operations/recipes/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outputItemId: product.id, outputUnitId, outputQuantity, lines, idempotencyKey: requestId() }) });
      setMessage({ kind: "success", text: t.saved }); setPreview(null); await onPublished();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, t.failed) }); } finally { setBusy(false); }
  };

  if (!product) return null;
  return <section className="operations-recipe-editor" aria-label={t.title}>
    <header className="operations-recipe-editor__intro">
      <div><p className="operations-recipe-editor__eyebrow">{t.title}</p><h4>{t.ingredients}</h4></div>
      {currentRecipe ? <span className="operations-recipe-editor__version">{t.version} <bdi dir="ltr">v{currentRecipe.version}</bdi></span> : null}
    </header>
    {message ? <p className={`daily-sales-message ${message.kind}`}>{message.text}</p> : null}
    <div className="operations-recipe-editor__layout">
      <div className="operations-recipe-editor__main">
        <section className="operations-recipe-editor__output-bar">
          <div className="operations-recipe-editor__output">
            <label>{t.outputQuantity}<input required inputMode="decimal" dir="ltr" lang="en" value={outputQuantity} onChange={(event) => { setOutputQuantity(normalizeBaseerNumericInput(event.target.value)); setPreview(null); }} /></label>
            <label>{t.unit}<BaseerSelect searchable={false} required id={`recipe-output-unit-${product.id}`} label={t.unit} value={outputUnitId} placeholder={t.select} options={product.itemUnits.filter((line) => line.isActive).map((line) => ({ id: line.unitId, label: unitName(line.unitId) }))} onChange={(unitId) => { setOutputUnitId(unitId); setPreview(null); }} /></label>
          </div>
        </section>
        <section className="operations-recipe-editor__ingredients">
          <div className="operations-recipe-editor__panel-heading"><div><h5>{t.ingredients}</h5></div><BaseerButton type="button" variant="secondary" onClick={() => { setLines((current) => [...current, { rawMaterialItemId: "", unitId: "", quantity: "" }]); setPreview(null); }}>{t.add}</BaseerButton></div>
          <div className="operations-recipe-editor__table-wrap"><table className="operations-recipe-editor__table"><thead><tr><th scope="col">{t.material}</th><th scope="col">{t.unit}</th><th scope="col">{t.quantity}</th><th scope="col">{t.lineCost}</th><th scope="col"><span className="visually-hidden">{t.remove}</span></th></tr></thead><tbody>{lines.map((line, index) => { const selected = material(line.rawMaterialItemId); const estimate = preview?.lines[index]; const live = selected ? liveEstimate(selected, line) : null; return <Fragment key={`${line.rawMaterialItemId}-${index}`}><tr><td><BaseerSelect required id={`recipe-material-${index}`} label={t.material} value={line.rawMaterialItemId} placeholder={t.select} options={workspace.rawMaterials.filter((entry) => !lines.some((other, otherIndex) => otherIndex !== index && other.rawMaterialItemId === entry.id)).map((entry) => ({ id: entry.id, label: itemName(entry) }))} onChange={(id) => changeLine(index, { rawMaterialItemId: id, unitId: material(id)?.baseUnitId ?? "" })} /></td><td><BaseerSelect searchable={false} required id={`recipe-unit-${index}`} label={t.unit} value={line.unitId} placeholder={t.select} options={unitChoices(line.rawMaterialItemId).map((choice) => ({ id: choice.unitId, label: unitName(choice.unitId) }))} onChange={(unitId) => changeLine(index, { unitId })} /></td><td><input className="operations-recipe-editor__quantity" aria-label={t.quantity} required inputMode="decimal" dir="ltr" lang="en" value={line.quantity} onChange={(event) => changeLine(index, { quantity: normalizeBaseerNumericInput(event.target.value) })} /></td><td><div className="operations-recipe-editor__line-cost" dir="ltr">{estimate ? <><small>{t.baseQuantity}: {number(estimate.resolvedBaseQuantity)}</small><strong>{number(estimate.estimatedLineCost)}</strong></> : live ? <><small>{number(String(live.selectedUnitCost))} / {unitName(line.unitId)}</small><strong>{number(String(live.lineCost))}</strong></> : selected ? <><small>{t.unitCost}</small><strong>{number(selected.weightedUnitCost)}</strong></> : <strong>—</strong>}</div></td><td><BaseerButton type="button" variant="quiet" onClick={() => { setLines((current) => current.filter((_line, lineIndex) => lineIndex !== index)); setPreview(null); }}>{t.remove}</BaseerButton></td></tr>{selected && line.unitId !== selected.baseUnitId && !factorToBase(selected, line.unitId) ? <tr className="operations-recipe-editor__table-warning"><td colSpan={5}>{t.noConversion}</td></tr> : null}</Fragment>; })}</tbody></table></div>
        </section>
        <div className="operations-recipe-editor__actions"><BaseerButton type="button" variant="secondary" disabled={busy || !outputUnitId || !lines.length} onClick={() => void calculate()}>{t.preview}</BaseerButton><BaseerButton type="button" disabled={busy || !preview?.estimatedCost || !canPublish} onClick={() => void publish()}>{t.publish}</BaseerButton></div>
        {!canPublish ? <p className="operations-recipe-editor__permission">{t.publishOnly}</p> : null}
      </div>
      <aside className="operations-recipe-editor__summary"><strong className="operations-recipe-editor__calculator-title">{ar ? "حاسبة التكلفة" : "Cost calculator"}</strong><div className="operations-recipe-editor__metric"><span>{t.batchCost}</span><strong dir="ltr">{number(preview?.estimatedCost)}</strong></div><div className="operations-recipe-editor__metric"><span>{t.outputCost}</span><strong dir="ltr">{number(preview?.costPerOutputUnit)}</strong></div>{preview?.missingMaterialIds.length ? <div className="operations-recipe__warning"><strong>{t.missing}</strong><ul>{preview.missingMaterialIds.map((id) => <li key={id}>{material(id) ? itemName(material(id)!) : id}</li>)}</ul><p>{t.incomplete}</p></div> : null}</aside>
    </div>
  </section>;
}

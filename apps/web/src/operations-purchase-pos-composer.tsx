import { useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import "./operations-purchase-pos-composer.css";

type Language = "ar" | "en";
type Unit = { id: string; nameAr: string; nameEn: string | null; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" };
type Material = { id: string; nameAr: string; nameEn: string | null; itemUnits: Array<{ unitId: string; isActive: boolean; isOrderEnabled: boolean; lastPurchaseUnitPrice: string | null }> };
export type OperationsPurchasePosLine = { rawMaterialItemId: string; unitId: string; quantity: string; price?: string };

const palette = ["#0f766e", "#2563eb", "#7c3aed", "#c2410c", "#be123c", "#4d7c0f"];

export function OperationsPurchasePosComposer({ language, materials, units, lines, onChange }: { language: Language; materials: Material[]; units: Unit[]; lines: OperationsPurchasePosLine[]; onChange: (lines: OperationsPurchasePosLine[]) => void }) {
  const ar = language === "ar";
  const text = ar ? { search: "ابحث باسم المادة أو رمزها…", all: "كل الأقسام", cart: "سلة الطلب", empty: "اختر مادة لإدخال الكمية وتغليف الشراء.", quantity: "الكمية", unit: "التغليف والوحدة", price: "السعر المقترح", total: "إجمالي الطلب", lines: "بنود", remove: "حذف", decrease: "إنقاص", increase: "زيادة", add: "إضافة إلى الطلب", cancel: "إلغاء", chooseUnit: "اختر تغليف الشراء", noMaterials: "لا توجد مواد جاهزة للطلب بهذه الفلاتر.", dimensions: { COUNT: "عدد", MASS: "وزن", VOLUME: "حجم", PACKAGE: "تغليف" } } : { search: "Search by material or code…", all: "All sections", cart: "Request basket", empty: "Choose a material to enter its quantity and purchase packaging.", quantity: "Quantity", unit: "Packaging & unit", price: "Suggested price", total: "Request total", lines: "Lines", remove: "Remove", decrease: "Decrease", increase: "Increase", add: "Add to request", cancel: "Cancel", chooseUnit: "Choose purchase packaging", noMaterials: "No materials are ready for these filters.", dimensions: { COUNT: "Count", MASS: "Mass", VOLUME: "Volume", PACKAGE: "Package" } };
  const [search, setSearch] = useState("");
  const [dimension, setDimension] = useState<"ALL" | Unit["dimension"]>("ALL");
  const [editor, setEditor] = useState<{ material: Material; unitId: string; quantity: string; price: string } | null>(null);
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const name = (material: Material) => ar ? material.nameAr : material.nameEn ?? material.nameAr;
  const unitName = (unitId: string) => { const unit = unitById.get(unitId); return ar ? unit?.nameAr ?? "—" : unit?.nameEn ?? unit?.nameAr ?? "—"; };
  const eligible = (material: Material) => material.itemUnits.filter((line) => line.isActive && line.isOrderEnabled);
  const filtered = materials.filter((material) => {
    const query = search.trim().toLocaleLowerCase("ar");
    const inDimension = dimension === "ALL" || eligible(material).some((line) => unitById.get(line.unitId)?.dimension === dimension);
    return eligible(material).length > 0 && inDimension && (!query || [material.nameAr, material.nameEn].some((value) => value?.toLocaleLowerCase("ar").includes(query)));
  });
  const setLine = (index: number, patch: Partial<OperationsPurchasePosLine>) => onChange(lines.map((line, current) => current === index ? { ...line, ...patch } : line));
  const openEditor = (material: Material) => {
    const existing = lines.find((line) => line.rawMaterialItemId === material.id);
    const choices = eligible(material);
    const selected = choices.find((line) => line.unitId === existing?.unitId) ?? choices[0];
    if (!selected) return;
    setEditor({ material, unitId: selected.unitId, quantity: existing?.quantity ?? "1", price: existing?.price ?? selected.lastPurchaseUnitPrice ?? "" });
  };
  const commitEditor = () => {
    if (!editor || !Number(editor.quantity) || Number(editor.quantity) <= 0) return;
    const index = lines.findIndex((line) => line.rawMaterialItemId === editor.material.id);
    const next = { rawMaterialItemId: editor.material.id, unitId: editor.unitId, quantity: editor.quantity, price: editor.price };
    onChange(index >= 0 ? lines.map((line, current) => current === index ? next : line) : [...lines, next]);
    setEditor(null);
  };
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0);
  const dimensions: Array<["ALL" | Unit["dimension"], string]> = [["ALL", text.all], ["COUNT", text.dimensions.COUNT], ["MASS", text.dimensions.MASS], ["VOLUME", text.dimensions.VOLUME], ["PACKAGE", text.dimensions.PACKAGE]];
  return <section aria-label={text.cart} className="operations-purchase-pos">
    <div className="operations-purchase-pos__catalog">
      <div className="operations-purchase-pos__catalog-toolbar">
        <input className="operations-purchase-pos__search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text.search} />
        <div className="operations-purchase-pos__filters">{dimensions.map(([value, label]) => <BaseerButton key={value} type="button" variant={dimension === value ? "primary" : "secondary"} onClick={() => setDimension(value)}>{label}</BaseerButton>)}</div>
      </div>
      <div className="operations-purchase-pos__products">
        {filtered.map((material, index) => { const selected = lines.find((line) => line.rawMaterialItemId === material.id); return <button key={material.id} type="button" onClick={() => openEditor(material)} className={`operations-purchase-pos__product${selected ? " is-selected" : ""}`}><span className="operations-purchase-pos__product-accent" style={{ background: palette[index % palette.length] }} /><strong>{name(material)}</strong><small>{eligible(material).map((line) => unitName(line.unitId)).join(" · ")}</small>{selected ? <span className="operations-purchase-pos__product-count">{selected.quantity}</span> : null}</button>; })}
      </div>
      {!filtered.length ? <p className="operations-purchase-pos__empty-catalog">{text.noMaterials}</p> : null}
    </div>
    <aside className="operations-purchase-pos__cart">
      <div className="operations-purchase-pos__cart-header"><strong>{text.cart}</strong><span>{lines.length} {text.lines}</span></div>
      {!lines.length ? <p className="operations-purchase-pos__cart-empty">{text.empty}</p> : <div className="operations-purchase-pos__cart-table-wrap"><table className="operations-purchase-pos__cart-table"><thead><tr><th>{ar ? "الصنف" : "Material"}</th><th>{text.unit}</th><th>{text.quantity}</th><th>{text.price}</th><th>{text.total}</th><th><span className="visually-hidden">{text.remove}</span></th></tr></thead><tbody>{lines.map((line, index) => { const material = materials.find((entry) => entry.id === line.rawMaterialItemId); const choices = eligible(material ?? { id: "", nameAr: "", nameEn: null, itemUnits: [] }); const lineTotal = (Number(line.quantity) || 0) * (Number(line.price) || 0); return <tr key={`${line.rawMaterialItemId}-${index}`}><td data-label={ar ? "الصنف" : "Material"}><button type="button" className="operations-purchase-pos__cart-material" onClick={() => material && openEditor(material)}><strong>{material ? name(material) : "—"}</strong></button></td><td data-label={text.unit}><select aria-label={text.unit} value={line.unitId} onChange={(event) => { const next = choices.find((choice) => choice.unitId === event.target.value); setLine(index, { unitId: event.target.value, price: next?.lastPurchaseUnitPrice ?? line.price ?? "" }); }}>{choices.map((choice) => <option key={choice.unitId} value={choice.unitId}>{unitName(choice.unitId)}</option>)}</select></td><td data-label={text.quantity}><span className="operations-purchase-pos__cart-quantity"><button type="button" aria-label={text.decrease} onClick={() => setLine(index, { quantity: increment(line.quantity, -1) })}>−</button><input aria-label={text.quantity} inputMode="decimal" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} /><button type="button" aria-label={text.increase} onClick={() => setLine(index, { quantity: increment(line.quantity, 1) })}>+</button></span></td><td data-label={text.price}><input aria-label={text.price} inputMode="decimal" value={line.price ?? ""} onChange={(event) => setLine(index, { price: event.target.value })} placeholder={text.price} /></td><td data-label={text.total}><strong className="operations-purchase-pos__line-total"><bdi>{lineTotal.toFixed(2)}</bdi></strong></td><td><button type="button" aria-label={text.remove} onClick={() => onChange(lines.filter((_, current) => current !== index))} className="operations-purchase-pos__remove">×</button></td></tr>; })}</tbody></table></div>}
      <footer className="operations-purchase-pos__cart-total"><span>{text.total}</span><strong>{total.toFixed(2)} {ar ? "ر.س" : "SAR"}</strong></footer>
    </aside>
    <BaseerDialog open={Boolean(editor)} title={editor ? name(editor.material) : ""} language={language} onClose={() => setEditor(null)} className="operations-purchase-pos__item-dialog" footer={<><BaseerButton type="button" variant="secondary" onClick={() => setEditor(null)}>{text.cancel}</BaseerButton><BaseerButton type="button" disabled={!editor || !Number(editor.quantity) || Number(editor.quantity) <= 0} onClick={commitEditor}>{text.add}</BaseerButton></>}>
      {editor ? <section className="operations-purchase-pos__item-editor">
        <label>{text.unit}<select value={editor.unitId} onChange={(event) => { const next = eligible(editor.material).find((line) => line.unitId === event.target.value); if (next) setEditor({ ...editor, unitId: next.unitId, price: next.lastPurchaseUnitPrice ?? "" }); }}><option value="">{text.chooseUnit}</option>{eligible(editor.material).map((line) => <option key={line.unitId} value={line.unitId}>{unitName(line.unitId)}</option>)}</select></label>
        <label>{text.quantity}<span className="operations-purchase-pos__editor-quantity"><button type="button" aria-label={text.decrease} onClick={() => setEditor({ ...editor, quantity: increment(editor.quantity, -1) })}>−</button><input inputMode="decimal" value={editor.quantity} onChange={(event) => setEditor({ ...editor, quantity: event.target.value })} /><button type="button" aria-label={text.increase} onClick={() => setEditor({ ...editor, quantity: increment(editor.quantity, 1) })}>+</button></span></label>
        <label>{text.price}<input inputMode="decimal" value={editor.price} onChange={(event) => setEditor({ ...editor, price: event.target.value })} placeholder={text.price} /></label>
      </section> : null}
    </BaseerDialog>
  </section>;
}

function increment(value: string, amount: number) { return String(Math.max(0.000001, Number(value || 0) + amount)); }

import { useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import "./operations-purchase-pos-composer.css";

type Language = "ar" | "en";
type Unit = { id: string; nameAr: string; nameEn: string | null; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" };
type Material = { id: string; nameAr: string; nameEn: string | null; itemUnits: Array<{ unitId: string; isActive: boolean; isOrderEnabled: boolean; lastPurchaseUnitPrice: string | null }> };
export type OperationsPurchasePosLine = { rawMaterialItemId: string; unitId: string; quantity: string; price?: string };

const palette = ["#0f766e", "#2563eb", "#7c3aed", "#c2410c", "#be123c", "#4d7c0f"];

export function OperationsPurchasePosComposer({ language, materials, units, lines, onChange }: { language: Language; materials: Material[]; units: Unit[]; lines: OperationsPurchasePosLine[]; onChange: (lines: OperationsPurchasePosLine[]) => void }) {
  const ar = language === "ar";
  const text = ar ? { search: "ابحث عن مادة أولية…", all: "الكل", cart: "سلة الطلب", empty: "اختر المواد من البطاقات لإضافتها إلى السلة.", quantity: "الكمية", unit: "الوحدة", price: "السعر المقترح", total: "إجمالي الطلب", lines: "بنود", remove: "حذف", decrease: "إنقاص", increase: "زيادة", dimensions: { COUNT: "عدد", MASS: "وزن", VOLUME: "حجم", PACKAGE: "تغليف" } } : { search: "Search materials…", all: "All", cart: "Request basket", empty: "Choose materials from the cards to add them to the basket.", quantity: "Quantity", unit: "Unit", price: "Suggested price", total: "Request total", lines: "Lines", remove: "Remove", decrease: "Decrease", increase: "Increase", dimensions: { COUNT: "Count", MASS: "Mass", VOLUME: "Volume", PACKAGE: "Package" } };
  const [search, setSearch] = useState("");
  const [dimension, setDimension] = useState<"ALL" | Unit["dimension"]>("ALL");
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const name = (material: Material) => ar ? material.nameAr : material.nameEn ?? material.nameAr;
  const unitName = (unitId: string) => { const unit = unitById.get(unitId); return ar ? unit?.nameAr ?? "—" : unit?.nameEn ?? unit?.nameAr ?? "—"; };
  const eligible = (material: Material) => material.itemUnits.filter((line) => line.isActive && line.isOrderEnabled);
  const filtered = materials.filter((material) => {
    const query = search.trim().toLocaleLowerCase("ar");
    const inDimension = dimension === "ALL" || eligible(material).some((line) => unitById.get(line.unitId)?.dimension === dimension);
    return inDimension && (!query || [material.nameAr, material.nameEn].some((value) => value?.toLocaleLowerCase("ar").includes(query)));
  });
  const setLine = (index: number, patch: Partial<OperationsPurchasePosLine>) => onChange(lines.map((line, current) => current === index ? { ...line, ...patch } : line));
  const add = (material: Material) => {
    const unit = eligible(material)[0]; if (!unit) return;
    const index = lines.findIndex((line) => line.rawMaterialItemId === material.id && line.unitId === unit.unitId);
    if (index >= 0) return setLine(index, { quantity: increment(lines[index]?.quantity ?? "0", 1) });
    onChange([...lines, { rawMaterialItemId: material.id, unitId: unit.unitId, quantity: "1", price: unit.lastPurchaseUnitPrice ?? "" }]);
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
        {filtered.map((material, index) => { const selected = lines.filter((line) => line.rawMaterialItemId === material.id).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0); return <button key={material.id} type="button" onClick={() => add(material)} className={`operations-purchase-pos__product${selected > 0 ? " is-selected" : ""}`}><span className="operations-purchase-pos__product-accent" style={{ background: palette[index % palette.length] }} /><strong>{name(material)}</strong><small>{eligible(material).map((line) => unitName(line.unitId)).join(" · ")}</small>{selected > 0 ? <span className="operations-purchase-pos__product-count">{selected}</span> : null}</button>; })}
      </div>
    </div>
    <aside className="operations-purchase-pos__cart">
      <div className="operations-purchase-pos__cart-header"><strong>{text.cart}</strong><span>{lines.length} {text.lines}</span></div>
      {!lines.length ? <p className="operations-purchase-pos__cart-empty">{text.empty}</p> : <div className="operations-purchase-pos__cart-lines">{lines.map((line, index) => { const material = materials.find((entry) => entry.id === line.rawMaterialItemId); const choices = eligible(material ?? { id: "", nameAr: "", nameEn: null, itemUnits: [] }); return <article key={`${line.rawMaterialItemId}-${line.unitId}-${index}`} className="operations-purchase-pos__cart-line"><strong>{material ? name(material) : "—"}</strong><div className="operations-purchase-pos__quantity"><button type="button" aria-label={text.decrease} onClick={() => setLine(index, { quantity: increment(line.quantity, -1) })}>−</button><input aria-label={text.quantity} inputMode="decimal" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} /><button type="button" aria-label={text.increase} onClick={() => setLine(index, { quantity: increment(line.quantity, 1) })}>+</button></div><div className="operations-purchase-pos__line-fields"><select aria-label={text.unit} value={line.unitId} onChange={(event) => { const next = choices.find((choice) => choice.unitId === event.target.value); setLine(index, { unitId: event.target.value, price: next?.lastPurchaseUnitPrice ?? line.price ?? "" }); }}>{choices.map((choice) => <option key={choice.unitId} value={choice.unitId}>{unitName(choice.unitId)}</option>)}</select><input aria-label={text.price} inputMode="decimal" value={line.price ?? ""} onChange={(event) => setLine(index, { price: event.target.value })} placeholder={text.price} /></div><button type="button" onClick={() => onChange(lines.filter((_, current) => current !== index))} className="operations-purchase-pos__remove">{text.remove}</button></article>; })}</div>}
      <footer className="operations-purchase-pos__cart-total"><span>{text.total}</span><strong>{total.toFixed(2)} {ar ? "ر.س" : "SAR"}</strong></footer>
    </aside>
  </section>;
}

function increment(value: string, amount: number) { return String(Math.max(0.000001, Number(value || 0) + amount)); }

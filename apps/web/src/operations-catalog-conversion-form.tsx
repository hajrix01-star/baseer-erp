import { useEffect } from "react";

import { BaseerButton } from "./baseer-button";
import { baseerDecimalString, useBaseerForm, useFieldArray, z } from "./baseer-form-state";
import { BaseerSelect } from "./baseer-select";

type Language = "ar" | "en";
export type OperationsCatalogConversionEdge = { fromUnitId: string; toUnitId: string; factor: string; isPurchasePackaging: boolean };
type Unit = { id: string; code: string; nameAr: string; nameEn: string | null; isActive: boolean };
type Values = { edges: OperationsCatalogConversionEdge[] };

function validation(language: Language) {
  const ar = language === "ar";
  const required = ar ? "اختر الوحدة." : "Select a unit.";
  return z.object({
    edges: z.array(z.object({
      fromUnitId: z.string().min(1, required),
      toUnitId: z.string().min(1, required),
      factor: baseerDecimalString(ar ? "أدخل عامل تحويل موجباً بصيغة عشرية." : "Enter a positive decimal conversion factor.").refine((value) => /^(?:0\.0*[1-9]\d*|[1-9]\d*(?:\.\d{1,4})?)$/.test(value), ar ? "يجب أن يكون عامل التحويل أكبر من صفر." : "The conversion factor must be greater than zero."),
      isPurchasePackaging: z.boolean(),
    }).refine((edge) => edge.fromUnitId !== edge.toUnitId, { message: ar ? "يجب أن تختلف الوحدتان." : "The two units must differ." })).min(1, ar ? "أضف مرحلة تحويل واحدة على الأقل." : "Add at least one conversion stage."),
  });
}

/**
 * Central, lazy form adapter for a material's unit/conversion command.
 * It owns UX validation only; the parent keeps the exact server command sequence.
 */
export function OperationsCatalogConversionForm({ language, editing, busy, value, baseUnitId, units, unitName, onSubmit }: {
  language: Language;
  editing: boolean;
  busy: boolean;
  value: OperationsCatalogConversionEdge[];
  baseUnitId: string;
  units: Unit[];
  unitName: (id: string) => string;
  onSubmit: (edges: OperationsCatalogConversionEdge[]) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const t = ar ? {
    from: "من الوحدة", to: "إلى", factor: "عامل التحويل", unit: "الوحدة", purchase: "تغليف شراء", showInRequest: "يظهر في الطلب", remove: "حذف", add: "+ إضافة مرحلة", save: "حفظ الوحدات والتحويلات", empty: "أضف مرحلة بدءاً من تغليف الشراء أو أكبر وحدة مستخدمة.", chain: "سلسلة الصنف", base: "وحدة أساس المخزون", equations: "معادلات التحويل", incomplete: "أكمل عامل التحويل والوحدة التالية لعرض المعادلات.",
  } : {
    from: "From unit", to: "To", factor: "Conversion factor", unit: "Unit", purchase: "Purchase packaging", showInRequest: "Show in request", remove: "Remove", add: "+ Add stage", save: "Save units & conversions", empty: "Add a stage starting from purchase packaging or the largest used unit.", chain: "Item chain", base: "Inventory base unit", equations: "Conversion equations", incomplete: "Complete the factor and next unit to show the equations.",
  };
  const form = useBaseerForm<Values>({ schema: validation(language), defaultValues: { edges: value }, shouldFocusError: true });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "edges" });
  const edges = form.watch("edges");
  const { reset, setValue } = form;
  useEffect(() => { reset({ edges: value }); }, [reset, value]);

  const activeUnits = units.filter((unit) => unit.isActive);
  const suggestedFactor = (fromUnitId: string, toUnitId: string) => {
    const code = (id: string) => units.find((unit) => unit.id === id)?.code.trim().toUpperCase().replaceAll(/[^A-Z]/g, "") ?? "";
    const litres = new Set(["L", "LTR", "LITRE", "LITER"]);
    const grams = new Set(["G", "GR", "GRAM", "GRAMS"]);
    return litres.has(code(fromUnitId)) && grams.has(code(toUnitId)) ? "1000" : "";
  };
  const linkFollowingRows = (index: number, fromUnitId: string) => {
    if (edges[index + 1]) setValue(`edges.${index + 1}.fromUnitId`, fromUnitId, { shouldDirty: true, shouldValidate: true });
  };

  return <form id="operations-inline-conversion" className="operations-inline-conversion__form" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next.edges))}>
    <fieldset className="operations-inline-conversion__fields">
      <div className="operations-inline-conversion__table-wrap" role="region" aria-label={t.chain} tabIndex={0}><table><thead><tr><th scope="col">#</th><th scope="col">{t.from}</th><th scope="col">{t.factor}</th><th scope="col">{t.to}</th><th scope="col">{t.purchase}</th><th scope="col"><span className="visually-hidden">{t.remove}</span></th></tr></thead><tbody>{fields.length ? fields.map((field, index) => {
        const edge = edges[index] ?? field;
        const availableUnits = activeUnits.filter((unit) => unit.id !== baseUnitId);
        const targetOptions = activeUnits.filter((unit) => unit.id !== edge.fromUnitId && (!edges.some((other) => other.fromUnitId === unit.id) || unit.id === edge.toUnitId || unit.id === baseUnitId));
        return <tr key={field.id}><td>{index + 1}</td><td><BaseerSelect searchable={false} required disabled={!editing || busy || index > 0} id={`inline-conversion-from-${field.id}`} label={t.from} value={edge.fromUnitId} placeholder={t.unit} options={index && edge.fromUnitId ? [{ id: edge.fromUnitId, label: unitName(edge.fromUnitId) }] : index ? [] : availableUnits.map((unit) => ({ id: unit.id, label: unitName(unit.id) }))} onChange={(fromUnitId) => { setValue(`edges.${index}.fromUnitId`, fromUnitId, { shouldDirty: true, shouldValidate: true }); linkFollowingRows(index, fromUnitId); }} /></td><td><input required disabled={!editing || busy} inputMode="decimal" aria-label={t.factor} aria-invalid={Boolean(form.formState.errors.edges?.[index]?.factor)} placeholder="0" {...form.register(`edges.${index}.factor`)} /></td><td><BaseerSelect searchable={false} required disabled={!editing || busy} id={`inline-conversion-to-${field.id}`} label={t.to} value={edge.toUnitId} placeholder={t.unit} options={targetOptions.map((unit) => ({ id: unit.id, label: unitName(unit.id) }))} onChange={(toUnitId) => { const factor = edge.factor || suggestedFactor(edge.fromUnitId, toUnitId); setValue(`edges.${index}.toUnitId`, toUnitId, { shouldDirty: true, shouldValidate: true }); if (!edge.factor && factor) setValue(`edges.${index}.factor`, factor, { shouldDirty: true, shouldValidate: true }); linkFollowingRows(index, toUnitId); }} /></td><td><label className="operations-inline-conversion__purchase"><input type="checkbox" disabled={!editing || busy} {...form.register(`edges.${index}.isPurchasePackaging`)} /><span>{t.showInRequest}</span></label></td><td><BaseerButton type="button" variant="quiet" disabled={!editing || busy || index !== fields.length - 1} onClick={() => remove(index)}>{t.remove}</BaseerButton></td></tr>;
      }) : <tr><td className="operations-inline-conversion__empty" colSpan={6}>{t.empty}</td></tr>}</tbody></table></div>
      {form.formState.errors.edges?.message ? <p className="daily-sales-message error" role="alert">{form.formState.errors.edges.message}</p> : null}
      <div className="operations-inline-conversion__actions"><BaseerButton type="button" variant="secondary" disabled={!editing || busy} onClick={() => { const previous = edges.at(-1); append(previous ? { fromUnitId: previous.toUnitId, toUnitId: "", factor: "", isPurchasePackaging: false } : { fromUnitId: "", toUnitId: baseUnitId, factor: "", isPurchasePackaging: true }); }}>{t.add}</BaseerButton><BaseerButton type="submit" disabled={!editing || !fields.length || busy}>{t.save}</BaseerButton></div>
    </fieldset>
    <div className="operations-inline-conversion__summary"><section><strong>{t.chain}</strong><div>{edges.length ? [edges[0]!.fromUnitId, ...edges.map((edge) => edge.toUnitId)].map((unitId, index) => <span key={`${unitId}-${index}`}>{index ? <bdi aria-hidden="true">←</bdi> : null}{unitName(unitId)}</span>) : <span>{unitName(baseUnitId)}</span>}</div></section><section><strong>{t.base}</strong><span>{unitName(baseUnitId)}</span></section></div>
    <section className="operations-inline-conversion__equations"><strong>{t.equations}</strong>{edges.length && edges.every((edge) => edge.factor && edge.toUnitId) ? edges.map((edge, index) => <p key={`${edge.fromUnitId}-${edge.toUnitId}-${index}`}><bdi dir="ltr">1</bdi> {unitName(edge.fromUnitId)} <span>=</span> <bdi dir="ltr">{edge.factor}</bdi> {unitName(edge.toUnitId)}</p>) : <p>{t.incomplete}</p>}</section>
  </form>;
}

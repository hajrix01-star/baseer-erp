import { useBaseerForm, z } from "./baseer-form-state";
import { useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerDatePicker } from "./baseer-date-picker";
import { normalizeBaseerNumericInput } from "./number-format";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { openDailySalesWhatsApp } from "./daily-sales-whatsapp";

type Language = "ar" | "en";
type Section = { id: string; nameAr: string; nameEn: string | null };
type Product = { id: string; sectionId: string | null; nameAr: string; nameEn: string | null; units: Array<{ unitId: string; nameAr: string; nameEn: string | null }> };
type Workstation = { sections: Section[]; products: Product[] };
type Line = { menuProductItemId: string; unitId: string; quantity: string };
const today = () => new Date().toISOString().slice(0, 10);
const positiveDecimal = /^\d+(?:\.\d{1,4})?$/;
const schema = (language: Language) => z.object({ businessDate: z.string().min(1, language === "ar" ? "تاريخ العمل مطلوب." : "Business date is required."), sectionId: z.string().min(1, language === "ar" ? "اختر القسم أولاً." : "Select a section first.") });
type FormValues = z.infer<ReturnType<typeof schema>>;

export function OperationsInternalRegistrationEntry({ language, onSaved }: { language: Language; onSaved?: () => Promise<void> | void }) {
  const ar = language === "ar";
  const t = ar ? { date: "تاريخ العمل", section: "القسم", choose: "اختر القسم", search: "ابحث عن صنف…", basket: "سلة التسجيل", quantity: "الكمية", unit: "الوحدة", remove: "حذف", save: "حفظ التسجيل", share: "إرسال واتساب", failed: "تعذر إكمال العملية. حاول مرة أخرى." } : { date: "Business date", section: "Section", choose: "Choose section", search: "Search products…", basket: "Registration basket", quantity: "Quantity", unit: "Unit", remove: "Remove", save: "Save registration", share: "Share on WhatsApp", failed: "Could not complete the operation." };
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [workstation, setWorkstation] = useState<Workstation | null>(null);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const form = useBaseerForm<FormValues>({ schema: schema(language), defaultValues: { businessDate: today(), sectionId: "" } });
  const sectionId = form.watch("sectionId");
  const businessDate = form.watch("businessDate");
  const load = useCallback(async () => { const current = activeSession(); setSession(current); if (!current) return; try { const data = await api<Workstation>(current, "/operations/internal-registration/workstation"); setWorkstation(data); if (!form.getValues("sectionId")) form.setValue("sectionId", data.sections[0]?.id || "", { shouldValidate: true }); } catch (error) { setMessage(presentBaseerApiError(error, language, t.failed)); } }, [form, language, t.failed]);
  useEffect(() => { void load(); }, [load]);
  const productName = (product: Product) => ar ? product.nameAr : product.nameEn ?? product.nameAr;
  const products = useMemo(() => (workstation?.products ?? []).filter((product) => product.sectionId === sectionId && `${product.nameAr} ${product.nameEn ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [search, sectionId, workstation]);
  const add = (product: Product) => { const unit = product.units[0]; if (!unit) return; setLines((current) => { const index = current.findIndex((line) => line.menuProductItemId === product.id && line.unitId === unit.unitId); return index < 0 ? [...current, { menuProductItemId: product.id, unitId: unit.unitId, quantity: "1" }] : current.map((line, i) => i === index ? { ...line, quantity: String(Number(line.quantity) + 1) } : line); }); };
  const save = form.handleSubmit(async (value) => { if (!session) return; const invalid = lines.find((line) => !positiveDecimal.test(line.quantity) || Number(line.quantity) <= 0); if (!lines.length || invalid) { form.setError("root", { message: ar ? "أضف صنفاً بكمية صحيحة أكبر من صفر." : "Add a product with a valid quantity greater than zero." }); return; } setBusy(true); setMessage(null); try { await api(session, "/operations/internal-registration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessDate: value.businessDate, sectionId: value.sectionId, lines, idempotencyKey: requestId() }) }); setLines([]); form.clearErrors("root"); await onSaved?.(); } catch (error) { setMessage(presentBaseerApiError(error, language, t.failed)); } finally { setBusy(false); } });
  const share = () => openDailySalesWhatsApp([ar ? "تسجيل داخلي" : "Internal registration", businessDate, ...lines.map((line) => { const product = workstation?.products.find((item) => item.id === line.menuProductItemId); const unit = product?.units.find((item) => item.unitId === line.unitId); return `• ${product ? productName(product) : "—"}: ${line.quantity} ${unit ? ar ? unit.nameAr : unit.nameEn ?? unit.nameAr : ""}`; })].join("\n"));
  if (!session) return null;
  return <><div className="operations-internal-registration__meta"><label>{t.date}<BaseerDatePicker language={language} label={t.date} value={businessDate} onChange={(value) => form.setValue("businessDate", value, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.businessDate ? <small role="alert">{form.formState.errors.businessDate.message}</small> : null}</label><label>{t.section}<BaseerCombobox required label={t.section} value={sectionId} placeholder={t.choose} options={(workstation?.sections ?? []).map((section) => ({ id: section.id, label: ar ? section.nameAr : section.nameEn ?? section.nameAr }))} invalid={Boolean(form.formState.errors.sectionId)} onChange={(nextSectionId) => { form.setValue("sectionId", nextSectionId, { shouldDirty: true, shouldValidate: true }); setLines([]); }} />{form.formState.errors.sectionId ? <small role="alert">{form.formState.errors.sectionId.message}</small> : null}</label></div><div className="operations-internal-registration__layout"><section className="operations-internal-registration__products-pane" aria-label={t.search}><input className="operations-internal-registration__search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} />{products.map((product) => <button type="button" key={product.id} onClick={() => add(product)}><strong>{productName(product)}</strong><small>{product.units.map((unit) => ar ? unit.nameAr : unit.nameEn ?? unit.nameAr).join(" · ")}</small></button>)}</section><aside><header><strong>{t.basket}</strong></header>{lines.map((line, index) => { const product = workstation?.products.find((item) => item.id === line.menuProductItemId); return product ? <article key={`${line.menuProductItemId}-${line.unitId}`}><strong>{productName(product)}</strong><input aria-label={t.quantity} aria-invalid={!positiveDecimal.test(line.quantity) || Number(line.quantity) <= 0} inputMode="decimal" dir="ltr" lang="en" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, quantity: normalizeBaseerNumericInput(event.target.value) } : item))} /><select aria-label={t.unit} value={line.unitId} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, unitId: event.target.value } : item))}>{product.units.map((unit) => <option key={unit.unitId} value={unit.unitId}>{ar ? unit.nameAr : unit.nameEn ?? unit.nameAr}</option>)}</select><button type="button" className="operations-internal-registration__remove" onClick={() => setLines((current) => current.filter((_item, i) => i !== index))}>{t.remove}</button></article> : null; })}{form.formState.errors.root ? <small role="alert">{form.formState.errors.root.message}</small> : null}<footer><BaseerButton type="button" variant="secondary" disabled={!lines.length} onClick={share}>{t.share}</BaseerButton><BaseerButton type="button" disabled={busy} onClick={() => void save()}>{t.save}</BaseerButton></footer></aside></div></>;
}

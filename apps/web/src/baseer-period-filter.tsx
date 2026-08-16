import { useMemo } from "react";

export type BaseerPeriodPreset = "DAY" | "MONTH" | "MULTI_MONTH" | "QUARTER" | "RANGE";

export type BaseerPeriodRange = {
  preset: BaseerPeriodPreset;
  from: string;
  to: string;
};

type Language = "ar" | "en";

type Props = {
  language: Language;
  value: BaseerPeriodRange;
  onChange: (range: BaseerPeriodRange) => void;
  presets?: readonly BaseerPeriodPreset[];
  className?: string;
};

const labels: Record<Language, Record<BaseerPeriodPreset, string>> = {
  ar: { DAY: "اليوم", MONTH: "هذا الشهر", MULTI_MONTH: "3 أشهر", QUARTER: "ربع سنة", RANGE: "نطاق" },
  en: { DAY: "Today", MONTH: "This month", MULTI_MONTH: "3 months", QUARTER: "Quarter", RANGE: "Range" },
};

function riyadhToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function baseerPeriodRange(preset: Exclude<BaseerPeriodPreset, "RANGE">): BaseerPeriodRange {
  const today = riyadhToday();
  if (preset === "DAY") return { preset, from: iso(today.year, today.month, today.day), to: iso(today.year, today.month, today.day) };
  if (preset === "MONTH") return { preset, from: iso(today.year, today.month, 1), to: iso(today.year, today.month, monthEnd(today.year, today.month)) };
  if (preset === "MULTI_MONTH") {
    const fromMonth = today.month - 2;
    const year = fromMonth < 1 ? today.year - 1 : today.year;
    const month = fromMonth < 1 ? fromMonth + 12 : fromMonth;
    return { preset, from: iso(year, month, 1), to: iso(today.year, today.month, monthEnd(today.year, today.month)) };
  }
  const quarterStart = Math.floor((today.month - 1) / 3) * 3 + 1;
  return { preset, from: iso(today.year, quarterStart, 1), to: iso(today.year, quarterStart + 2, monthEnd(today.year, quarterStart + 2)) };
}

export function defaultBaseerPeriodRange() {
  return baseerPeriodRange("MONTH");
}

export function BaseerPeriodFilter({ language, value, onChange, presets = ["DAY", "MONTH", "MULTI_MONTH", "QUARTER", "RANGE"], className }: Props) {
  const active = useMemo(() => new Set(presets), [presets]);
  const selectPreset = (preset: BaseerPeriodPreset) => {
    if (preset === "RANGE") return onChange({ ...value, preset });
    onChange(baseerPeriodRange(preset));
  };
  const updateDate = (key: "from" | "to", next: string) => {
    const otherKey = key === "from" ? "to" : "from";
    const nextRange: BaseerPeriodRange = { ...value, preset: "RANGE", [key]: next };
    if (next && nextRange[otherKey] && nextRange.from > nextRange.to) nextRange[otherKey] = next;
    onChange(nextRange);
  };
  return <section className={["baseer-period-filter", className].filter(Boolean).join(" ")} aria-label={language === "ar" ? "فلترة الفترة" : "Period filter"}>
    <div className="baseer-period-filter__presets" role="group" aria-label={language === "ar" ? "اختيار الفترة" : "Select period"}>
      {presets.map((preset) => <button key={preset} className={value.preset === preset ? "is-active" : ""} type="button" onClick={() => selectPreset(preset)}>{labels[language][preset]}</button>)}
    </div>
    {active.has("RANGE") && value.preset === "RANGE" && <div className="baseer-period-filter__range">
      <label>{language === "ar" ? "من" : "From"}<input type="date" value={value.from} onChange={(event) => updateDate("from", event.target.value)} /></label>
      <label>{language === "ar" ? "إلى" : "To"}<input type="date" value={value.to} onChange={(event) => updateDate("to", event.target.value)} /></label>
    </div>}
  </section>;
}
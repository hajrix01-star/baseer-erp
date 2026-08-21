/** Pure period values for routes that defer the visual calendar control. */
export type BaseerPeriodPreset = "DAY" | "MONTH" | "QUARTER" | "YEAR" | "RANGE";
export type BaseerPeriodRange = { preset: BaseerPeriodPreset; from: string; to: string; months: readonly string[] };

export function riyadhToday() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value); return { year: get("year"), month: get("month"), day: get("day") }; }
export function iso(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function monthEnd(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function rangeFromMonth(value: string) { const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); return { from: iso(year, month, 1), to: iso(year, month, monthEnd(year, month)) }; }
export function baseerPeriodRange(preset: Exclude<BaseerPeriodPreset, "RANGE">): BaseerPeriodRange { const today = riyadhToday(); const month = `${today.year}-${String(today.month).padStart(2, "0")}`; if (preset === "DAY") { const day = iso(today.year, today.month, today.day); return { preset, from: day, to: day, months: [] }; } if (preset === "MONTH") return { preset, ...rangeFromMonth(month), months: [month] }; if (preset === "YEAR") return { preset, from: iso(today.year, 1, 1), to: iso(today.year, 12, 31), months: [] }; const start = Math.floor((today.month - 1) / 3) * 3 + 1; return { preset, from: iso(today.year, start, 1), to: iso(today.year, start + 2, monthEnd(today.year, start + 2)), months: [] }; }
export function defaultBaseerPeriodRange() { return baseerPeriodRange("MONTH"); }

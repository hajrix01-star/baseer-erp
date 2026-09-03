import { formatMonthYear } from "./number-format";
import { iso, riyadhToday } from "./baseer-period-values";

export function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function shiftCalendarDay(value: string, delta: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function cursorForCalendar(date: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(date)) return date;
  const today = riyadhToday();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

export function shiftCalendarCursor(cursor: string, delta: number) {
  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7));
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function calendarDays(cursor: string) {
  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7));
  const first = new Date(Date.UTC(year, month - 1, 1));
  const leading = first.getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - leading + 1));
    return {
      iso: iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() + 1 === month,
    };
  });
}

export function calendarMonthName(language: "ar" | "en", value: string, format: "long" | "short" = "long") {
  return formatMonthYear(value, language, format, format === "long");
}

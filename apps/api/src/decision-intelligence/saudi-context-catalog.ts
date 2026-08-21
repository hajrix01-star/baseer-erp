import umalquraModule from "@umalqura/core";

import type { OfficialContextDocumentV1 } from "./decision-context-import.service.js";

const RIYADH_TIMEZONE = "Asia/Riyadh";
const ACADEMIC_CALENDAR_SOURCE_UPDATED_AT = "2025-12-04T00:00:00.000Z";

type UmAlQuraStatic = {
  gregorianToHijri: (date: Date) => { hy: number; hm: number; hd: number };
  toDate: (hy: number, hm: number, hd: number, hour?: number, minute?: number, second?: number, millisecond?: number) => Date;
  getDaysInMonth: (hy: number, hm: number) => number;
  addDays: (date: Date, days: number) => Date;
};

type ContextCatalogEvent = Readonly<{
  externalKey: string;
  eventKind: string;
  titleAr: string;
  startsOn: string;
  endsOn: string;
  sourceUpdatedAt?: string;
}>;

type AcademicHoliday = Readonly<{
  id: string;
  academicYear: string;
  titleAr: string;
  startsOn: string;
  endsOn: string;
}>;

function loadUmAlQura(): UmAlQuraStatic {
  const imported = umalquraModule as { $?: UmAlQuraStatic; default?: { $?: UmAlQuraStatic } };
  const api = imported.default ?? imported;
  if (!api.$?.gregorianToHijri || !api.$.toDate || !api.$.getDaysInMonth || !api.$.addDays) {
    throw new Error("The local Umm al-Qura calendar could not be loaded.");
  }
  return api.$;
}

const ummAlQura = loadUmAlQura();

function riyadhYmd(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function hijriToRiyadhYmd(year: number, month: number, day: number) {
  return riyadhYmd(ummAlQura.toDate(year, month, day, 12, 0, 0, 0));
}

function shiftYmd(from: string, days: number) {
  const [year = 0, month = 0, day = 0] = from.split("-").map(Number);
  return riyadhYmd(ummAlQura.addDays(new Date(Date.UTC(year, month - 1, day, 12)), days));
}

function yearsOverlappingGregorianYear(year: number) {
  const start = ummAlQura.gregorianToHijri(new Date(year, 0, 1, 12));
  const end = ummAlQura.gregorianToHijri(new Date(year, 11, 31, 12));
  return Array.from({ length: end.hy - start.hy + 1 }, (_, index) => start.hy + index);
}

function clipToGregorianYear(event: ContextCatalogEvent, year: number): ContextCatalogEvent | null {
  const startsOn = event.startsOn > `${year}-01-01` ? event.startsOn : `${year}-01-01`;
  const endsOn = event.endsOn < `${year}-12-31` ? event.endsOn : `${year}-12-31`;
  return startsOn <= endsOn ? { ...event, startsOn, endsOn } : null;
}

/**
 * These events are calculated locally, not fetched from a web page. Islamic
 * dates carry an explicit estimated label: an official moon-sighting notice
 * may move the observed holiday by a day.
 */
export function getSaudiOccasionsForYear(year: number): ContextCatalogEvent[] {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return [];

  const fixed: ContextCatalogEvent[] = [
    { externalKey: `sa:founding:${year}`, eventKind: "FOUNDING_DAY", titleAr: "يوم التأسيس", startsOn: `${year}-02-22`, endsOn: `${year}-02-23` },
    { externalKey: `sa:national:${year}`, eventKind: "NATIONAL_DAY", titleAr: "اليوم الوطني", startsOn: `${year}-09-23`, endsOn: `${year}-09-26` },
  ];
  const islamic = yearsOverlappingGregorianYear(year).flatMap((hijriYear) => {
    const ramadanEnd = ummAlQura.getDaysInMonth(hijriYear, 9);
    const arafat = hijriToRiyadhYmd(hijriYear, 12, 9);
    return [
      { externalKey: `sa:ramadan:${hijriYear}`, eventKind: "RAMADAN_ESTIMATED", titleAr: "رمضان (تقديري)", startsOn: hijriToRiyadhYmd(hijriYear, 9, 1), endsOn: hijriToRiyadhYmd(hijriYear, 9, ramadanEnd) },
      { externalKey: `sa:eid-fitr:${hijriYear}`, eventKind: "EID_AL_FITR_ESTIMATED", titleAr: "عيد الفطر (تقديري)", startsOn: hijriToRiyadhYmd(hijriYear, 10, 1), endsOn: hijriToRiyadhYmd(hijriYear, 10, Math.min(4, ummAlQura.getDaysInMonth(hijriYear, 10))) },
      { externalKey: `sa:eid-adha:${hijriYear}`, eventKind: "EID_AL_ADHA_ESTIMATED", titleAr: "عيد الأضحى (تقديري)", startsOn: arafat, endsOn: shiftYmd(arafat, 3) },
    ] as ContextCatalogEvent[];
  });
  return [...fixed, ...islamic]
    .map((event) => clipToGregorianYear(event, year))
    .filter((event): event is ContextCatalogEvent => event !== null)
    .sort((left, right) => left.startsOn.localeCompare(right.startsOn) || left.externalKey.localeCompare(right.externalKey));
}

/**
 * The Ministry source is documented here and this small reviewed catalogue is
 * intentionally versioned in code. It is not a brittle runtime HTML scrape.
 * A new ministerial calendar is a deliberate data review/change, not an
 * untraceable change to past decision evidence.
 */
const ACADEMIC_HOLIDAYS_1447_1448: readonly AcademicHoliday[] = [
  { id: "fall-break-1447", academicYear: "1447-1448", titleAr: "إجازة الخريف للمدارس", startsOn: "2025-11-21", endsOn: "2025-11-29" },
  { id: "extra-break-1447-01", academicYear: "1447-1448", titleAr: "إجازة إضافية للمدارس", startsOn: "2025-12-11", endsOn: "2025-12-14" },
  { id: "midyear-break-1447", academicYear: "1447-1448", titleAr: "إجازة منتصف العام الدراسي", startsOn: "2026-01-09", endsOn: "2026-01-17" },
  { id: "eid-fitr-break-1447", academicYear: "1447-1448", titleAr: "إجازة عيد الفطر للمدارس", startsOn: "2026-03-06", endsOn: "2026-03-28" },
  { id: "eid-adha-break-1447", academicYear: "1447-1448", titleAr: "إجازة عيد الأضحى للمدارس", startsOn: "2026-05-22", endsOn: "2026-06-01" },
  { id: "year-end-break-1447", academicYear: "1447-1448", titleAr: "إجازة نهاية العام الدراسي", startsOn: "2026-06-25", endsOn: "2026-08-23" },
];

export function getSchoolAcademicHolidaysForYear(year: number): ContextCatalogEvent[] {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return [];
  return ACADEMIC_HOLIDAYS_1447_1448
    .map((holiday) => clipToGregorianYear({
      externalKey: `sa:moe:${holiday.academicYear}:${holiday.id}`,
      eventKind: "SCHOOL_ACADEMIC_BREAK",
      titleAr: holiday.titleAr,
      startsOn: holiday.startsOn,
      endsOn: holiday.endsOn,
      sourceUpdatedAt: ACADEMIC_CALENDAR_SOURCE_UPDATED_AT,
    }, year))
    .filter((event): event is ContextCatalogEvent => event !== null)
    .sort((left, right) => left.startsOn.localeCompare(right.startsOn) || left.externalKey.localeCompare(right.externalKey));
}

export function buildSaudiContextCatalogDocument(sourceCode: "SA_UMM_AL_QURA_OCCASIONS" | "SA_MOE_ACADEMIC_CALENDAR") : OfficialContextDocumentV1 {
  const currentYear = Number(new Intl.DateTimeFormat("en", { timeZone: RIYADH_TIMEZONE, year: "numeric" }).format(new Date()));
  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
  const events = years.flatMap((year) => sourceCode === "SA_UMM_AL_QURA_OCCASIONS" ? getSaudiOccasionsForYear(year) : getSchoolAcademicHolidaysForYear(year));
  return sourceCode === "SA_MOE_ACADEMIC_CALENDAR"
    ? { sourceUpdatedAt: ACADEMIC_CALENDAR_SOURCE_UPDATED_AT, events }
    : { events };
}

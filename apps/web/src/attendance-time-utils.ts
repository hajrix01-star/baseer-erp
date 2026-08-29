/**
 * Shared, display-only time helpers for attendance views.  Attendance rules
 * remain enforced by the API; these functions keep client presentations and
 * draft editors consistent around midnight.
 */
export type AttendanceLanguage = "ar" | "en";

export const MINUTES_PER_DAY = 1_440;

export const attendanceWeekdayNames = {
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
} as const;

export const attendanceWeekdayShortNames = {
  ar: attendanceWeekdayNames.ar,
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
} as const;

/** Schedule editor indexes use Sunday = 0 through Saturday = 6. */
export function attendanceWeekdayName(dayIndex: number, language: AttendanceLanguage, short = false) {
  const names = short ? attendanceWeekdayShortNames[language] : attendanceWeekdayNames[language];
  return names[dayIndex] ?? "";
}

/** Coverage data uses ISO weekday numbering, Monday = 1 through Sunday = 7. */
export function attendanceIsoWeekdayName(dayOfWeek: number, language: AttendanceLanguage, short = false) {
  const sundayFirstIndex = dayOfWeek === 7 ? 0 : dayOfWeek;
  return attendanceWeekdayName(sundayFirstIndex, language, short);
}

export function formatAttendanceMinute(value: number) {
  const minute = ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Returns zero for an empty or invalid time value, matching existing draft behaviour. */
export function parseAttendanceTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

/** A same-day end before its start is an overnight period; equal endpoints have no duration. */
export function attendanceIntervalMinutes(startMinute: number, endMinute: number) {
  if (startMinute === endMinute) return 0;
  return endMinute > startMinute ? endMinute - startMinute : MINUTES_PER_DAY - startMinute + endMinute;
}

export function attendanceTimeToTimelineMinute(value: string, timelineStartMinute: number) {
  const minute = parseAttendanceTime(value);
  return minute < timelineStartMinute ? minute + MINUTES_PER_DAY : minute;
}

export function attendanceMinuteToTimelineMinute(minute: number, timelineStartMinute: number) {
  return minute < timelineStartMinute ? minute + MINUTES_PER_DAY : minute;
}

export function formatAttendanceDuration(value: number, language: AttendanceLanguage) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (language === "ar") return minutes ? `${hours} س ${minutes} د` : `${hours} ساعة`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

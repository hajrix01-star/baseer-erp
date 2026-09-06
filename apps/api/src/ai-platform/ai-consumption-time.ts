/** The product's operational day is Riyadh, independent of the API host. */
export function startOfRiyadhDay(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  // Saudi Arabia is UTC+03:00 without daylight-saving time.
  return new Date(
    Date.UTC(
      Number(part("year")),
      Number(part("month")) - 1,
      Number(part("day")),
      -3,
    ),
  );
}

/** A billing month follows the same fixed business timezone as the daily cap. */
export function startOfRiyadhMonth(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, 1, -3));
}

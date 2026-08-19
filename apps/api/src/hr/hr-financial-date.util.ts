/**
 * HR financial documents use date-only UTC values.  Keep chronology checks in
 * one pure helper so every lifecycle compares the persisted business events,
 * not mutable wall-clock timestamps.
 */
export function isHrDateOnOrAfter(candidate: Date, minimum: Date): boolean {
  return candidate.getTime() >= minimum.getTime();
}

export function latestHrBusinessDate(...dates: ReadonlyArray<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date.getTime() > latest.getTime())) latest = date;
  }
  return latest;
}

export function isSameHrBusinessMonth(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth();
}

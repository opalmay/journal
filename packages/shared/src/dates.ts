/** A calendar day key, `YYYY-MM-DD`, in the journal's configured timezone. */
export type DateKey = string;

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/**
 * Which journal day an epoch-millisecond timestamp belongs to.
 * Uses the IANA timezone rather than UTC slicing, so entries written just
 * before local midnight stay on the day they were actually written, and DST
 * shifts do not move them.
 */
export function dateKeyFromTimestamp(ms: number, timeZone: string): DateKey {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isDateKey(value: string): value is DateKey {
  return DATE_KEY_RE.test(value);
}

/** `YYYY-MM-DD` shifted by whole days, staying in calendar space. */
export function addDays(date: DateKey, days: number): DateKey {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Local wall-clock `HH:mm` of a timestamp, for display and AI prompts. */
export function timeOfDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/** Normalizes a tag the same way on both client and server. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_/]/g, "")
    .slice(0, 48);
}

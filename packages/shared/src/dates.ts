/** A calendar day key, `YYYY-MM-DD`, in the journal's configured timezone. */
export type DateKey = string;

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Where the journal cuts one day from the next: the timezone, plus the local
 * hour a day starts. A `startHour` of 4 means a day runs 04:00 to 03:59 the
 * next morning, so something written at 01:30 lands on the day just lived
 * through rather than the one that technically started at midnight.
 */
export interface DayBoundary {
  timeZone: string;
  /** Local hour a journal day begins; 0 is plain midnight. */
  startHour: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** The local calendar date and hour of a timestamp, in one formatting pass. */
function localParts(ms: number, timeZone: string): { date: DateKey; hour: number } {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

/**
 * Which journal day an epoch-millisecond timestamp belongs to.
 * Uses the IANA timezone rather than UTC slicing, so entries written just
 * before local midnight stay on the day they were actually written, and DST
 * shifts do not move them. Anything before the boundary's `startHour` counts
 * as the small hours of the day before.
 */
export function dateKeyFromTimestamp(ms: number, day: DayBoundary): DateKey {
  const { date, hour } = localParts(ms, day.timeZone);
  return hour < day.startHour ? addDays(date, -1) : date;
}

/**
 * Whether a timestamp falls in the small hours that the boundary hands back
 * to the day before — so its wall-clock time reads as the morning after the
 * journal day it belongs to.
 */
export function isAfterMidnight(ms: number, day: DayBoundary): boolean {
  return localParts(ms, day.timeZone).hour < day.startHour;
}

/** The day start as a wall-clock `HH:mm`, for display. */
export function formatDayStart(startHour: number): string {
  return `${String(startHour).padStart(2, "0")}:00`;
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

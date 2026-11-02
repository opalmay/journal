import type { AiField, DayDTO } from "@journal/shared";

/** Field names as the author would say them, for the "not mentioned" line. */
export const FIELD_LABELS: Record<AiField, string> = {
  mood: "mood",
  energy: "energy",
  sleepStart: "sleep times",
  sleepEnd: "sleep times",
  sleepHours: "hours slept",
  sleepQuality: "sleep quality",
  sleepWakings: "night wakings",
  napStart: "nap times",
  napEnd: "nap times",
  napHours: "naps",
  appetite: "appetite",
  social: "social contact",
  cycleDay: "cycle day",
  caffeine: "caffeine",
  alcohol: "alcohol",
  exercise: "exercise",
  intake: "things taken",
};

/** Display order, shared by every compact read-out. */
const ORDER: AiField[] = [
  "mood",
  "energy",
  "sleepStart",
  "sleepEnd",
  "sleepHours",
  "sleepQuality",
  "sleepWakings",
  "napStart",
  "napEnd",
  "napHours",
  "appetite",
  "social",
  "cycleDay",
  "caffeine",
  "alcohol",
  "exercise",
  "intake",
];

/**
 * A length of sleep, kept short: "7h", "7h 45m", "40m". Times given to the
 * quarter hour read better this way round than as 7.8h.
 */
export const hoursLabel = (h: number) => {
  const total = Math.round(h * 60);
  const [hours, minutes] = [Math.floor(total / 60), total % 60];
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

/** One short chip label for a value, e.g. "slept 7h" or "woke 1×". */
export function metricChip(field: AiField, value: number | string): string {
  switch (field) {
    case "mood":
      return `mood ${value}`;
    case "energy":
      return `energy ${value}`;
    case "sleepStart":
      return `asleep ${value}`;
    case "sleepEnd":
      return `up ${value}`;
    case "sleepHours":
      return `slept ${hoursLabel(Number(value))}`;
    case "sleepQuality":
      return `sleep ${value}`;
    case "sleepWakings":
      return Number(value) === 0 ? "slept through" : `woke ${value}×`;
    case "napStart":
      return `nap from ${value}`;
    case "napEnd":
      return `nap until ${value}`;
    case "napHours":
      return `nap ${hoursLabel(Number(value))}`;
    case "appetite":
      return `appetite ${value}`;
    case "social":
      return value === "a_lot" ? "social a lot" : `social ${value}`;
    case "cycleDay":
      return `cycle day ${value}`;
    case "caffeine":
      return `${value} caffeine`;
    case "alcohol":
      return `${value} alcohol`;
    case "exercise":
      return String(value);
    case "intake":
      return `took ${value}`;
  }
}

function valueOf(day: DayDTO, field: AiField): number | string | null {
  return field === "mood" ? day.mood : day.metrics[field];
}

/** The two stretches of sleep entered as a pair of times, with their lengths. */
const RANGES = [
  { start: "sleepStart", end: "sleepEnd", hours: "sleepHours", verb: "slept" },
  { start: "napStart", end: "napEnd", hours: "napHours", verb: "napped" },
] as const satisfies readonly { start: AiField; end: AiField; hours: AiField; verb: string }[];

type Range = (typeof RANGES)[number];

/**
 * A stretch entered as two times reads as one chip, "slept 22:30–07:00 ·
 * 8h 30m": the hours follow from the pair, so they are not a chip of their
 * own. Null while either end is still missing.
 */
function rangeLabel(day: DayDTO, range: Range): string | null {
  const [from, to, length] = [range.start, range.end, range.hours].map((f) => valueOf(day, f));
  if (from === null || to === null) return null;
  return `${range.verb} ${from}–${to}${length === null ? "" : ` · ${hoursLabel(Number(length))}`}`;
}

/** The range chips a day has, keyed on the start field each one stands for. */
function rangeChips(day: DayDTO): { labels: Map<AiField, string>; folded: Set<AiField> } {
  const labels = new Map<AiField, string>();
  const folded = new Set<AiField>();
  for (const range of RANGES) {
    const label = rangeLabel(day, range);
    if (label === null) continue;
    labels.set(range.start, label);
    folded.add(range.end).add(range.hours);
  }
  return { labels, folded };
}

/** Every field the day has a value for, in display order. */
export function dayChips(day: DayDTO, trackCycle: boolean): { field: AiField; label: string }[] {
  const { labels, folded } = rangeChips(day);
  return ORDER.flatMap((field) => {
    if (folded.has(field)) return [];
    const range = labels.get(field);
    if (range !== undefined) return [{ field, label: range }];
    const value = valueOf(day, field);
    if (value === null || (field === "cycleDay" && !trackCycle)) return [];
    const label = metricChip(field, value);
    return [{ field, label: field === "cycleDay" && day.cycleDayDerived ? `≈ ${label}` : label }];
  });
}

/** What the day summary took from one entry, as chip labels. */
export function chipsFromRecord(day: DayDTO, recordId: string): string[] {
  const { labels, folded } = rangeChips(day);
  const fromRecord = (field: AiField) => day.metricSources[field]?.includes(recordId) ?? false;
  return ORDER.flatMap((field) => {
    if (folded.has(field)) return [];
    const range = labels.get(field);
    if (range !== undefined) {
      const { end } = RANGES.find((r) => r.start === field)!;
      return fromRecord(field) || fromRecord(end) ? [range] : [];
    }
    const value = valueOf(day, field);
    if (value === null || !fromRecord(field)) return [];
    return [metricChip(field, value)];
  });
}

/**
 * What to name in the "not mentioned" line. Each pair of times is one thing
 * there, and the hours they would have given are not named on top of them.
 */
export function missingFields(day: DayDTO, trackCycle: boolean): AiField[] {
  const starts = new Map<AiField, AiField>(RANGES.map((r) => [r.end, r.start]));
  const missing = day.metricsMissing
    .filter((f) => trackCycle || f !== "cycleDay")
    .map((f): AiField => starts.get(f) ?? f);
  return [...new Set(missing)].filter(
    (f) => !RANGES.some((r) => r.hours === f && missing.includes(r.start)),
  );
}

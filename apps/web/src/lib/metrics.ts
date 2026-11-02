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
  napHours: "naps",
  napTimes: "nap times",
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
  "napHours",
  "napTimes",
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
    case "napHours":
      return `nap ${hoursLabel(Number(value))}`;
    case "napTimes":
      return `napped ${value}`;
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

/**
 * A night entered as two times reads as one chip, "slept 22:30–07:00 · 8.5h":
 * the hours follow from the pair, so they are not also a chip of their own.
 */
function sleepRange(day: DayDTO): string | null {
  const { sleepStart, sleepEnd, sleepHours } = day.metrics;
  if (!sleepStart || !sleepEnd) return null;
  const length = sleepHours === null ? "" : ` · ${hoursLabel(sleepHours)}`;
  return `slept ${sleepStart}–${sleepEnd}${length}`;
}

/** Fields the range chip speaks for; it is keyed on `sleepStart`. */
const IN_SLEEP_RANGE: AiField[] = ["sleepEnd", "sleepHours"];

/** Every field the day has a value for, in display order. */
export function dayChips(day: DayDTO, trackCycle: boolean): { field: AiField; label: string }[] {
  const range = sleepRange(day);
  return ORDER.flatMap((field) => {
    if (range && IN_SLEEP_RANGE.includes(field)) return [];
    const value = valueOf(day, field);
    if (value === null || (field === "cycleDay" && !trackCycle)) return [];
    if (range && field === "sleepStart") return [{ field, label: range }];
    const label = metricChip(field, value);
    return [{ field, label: field === "cycleDay" && day.cycleDayDerived ? `≈ ${label}` : label }];
  });
}

/** What the day summary took from one entry, as chip labels. */
export function chipsFromRecord(day: DayDTO, recordId: string): string[] {
  const range = sleepRange(day);
  const fromRecord = (field: AiField) => day.metricSources[field]?.includes(recordId) ?? false;
  return ORDER.flatMap((field) => {
    if (range && IN_SLEEP_RANGE.includes(field)) return [];
    if (range && field === "sleepStart") {
      return fromRecord("sleepStart") || fromRecord("sleepEnd") ? [range] : [];
    }
    const value = valueOf(day, field);
    if (value === null || !fromRecord(field)) return [];
    return [metricChip(field, value)];
  });
}

/**
 * What to name in the "not mentioned" line. The two sleep times are one thing
 * there, and the hours they would have given are not named on top of them.
 */
export function missingFields(day: DayDTO, trackCycle: boolean): AiField[] {
  const missing = day.metricsMissing
    .filter((f) => trackCycle || f !== "cycleDay")
    .map((f): AiField => (f === "sleepEnd" ? "sleepStart" : f));
  const noTimes = missing.includes("sleepStart");
  return [...new Set(missing)].filter((f) => !(noTimes && f === "sleepHours"));
}

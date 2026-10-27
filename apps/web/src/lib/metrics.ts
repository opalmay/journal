import type { AiField, DayDTO } from "@journal/shared";

/** Field names as the author would say them, for the "not mentioned" line. */
export const FIELD_LABELS: Record<AiField, string> = {
  mood: "mood",
  energy: "energy",
  sleepHours: "hours slept",
  sleepQuality: "sleep quality",
  sleepWakings: "night wakings",
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
  "sleepHours",
  "sleepQuality",
  "sleepWakings",
  "napHours",
  "appetite",
  "social",
  "cycleDay",
  "caffeine",
  "alcohol",
  "exercise",
  "intake",
];

const hours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

/** One short chip label for a value, e.g. "slept 7h" or "woke 1×". */
export function metricChip(field: AiField, value: number | string): string {
  switch (field) {
    case "mood":
      return `mood ${value}`;
    case "energy":
      return `energy ${value}`;
    case "sleepHours":
      return `slept ${hours(Number(value))}`;
    case "sleepQuality":
      return `sleep ${value}`;
    case "sleepWakings":
      return Number(value) === 0 ? "slept through" : `woke ${value}×`;
    case "napHours":
      return `nap ${hours(Number(value))}`;
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

/** Every field the day has a value for, in display order. */
export function dayChips(day: DayDTO, trackCycle: boolean): { field: AiField; label: string }[] {
  return ORDER.flatMap((field) => {
    const value = valueOf(day, field);
    if (value === null || (field === "cycleDay" && !trackCycle)) return [];
    const label = metricChip(field, value);
    return [{ field, label: field === "cycleDay" && day.cycleDayDerived ? `≈ ${label}` : label }];
  });
}

/** What the day summary took from one entry, as chip labels. */
export function chipsFromRecord(day: DayDTO, recordId: string): string[] {
  return ORDER.flatMap((field) => {
    const value = valueOf(day, field);
    if (value === null || !day.metricSources[field]?.includes(recordId)) return [];
    return [metricChip(field, value)];
  });
}

export function missingFields(day: DayDTO, trackCycle: boolean): AiField[] {
  return day.metricsMissing.filter((f) => trackCycle || f !== "cycleDay");
}

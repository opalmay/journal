import { addDays } from "@journal/shared";

/** Every date from `from` to `to` inclusive, so gaps in the data stay gaps on the chart. */
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * Trailing mean over `window` days, skipping missing values. A day whose
 * window holds fewer than `minCount` values gets null, which breaks the line
 * rather than drawing a trend out of one or two points.
 */
export function rollingMean(
  values: (number | null)[],
  window: number,
  minCount: number,
): (number | null)[] {
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = values[j];
      if (v !== null && v !== undefined) {
        sum += v;
        count++;
      }
    }
    return count >= minCount ? sum / count : null;
  });
}

/** Monday on or before a date. */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
